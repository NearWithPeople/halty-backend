import { factories } from '@strapi/strapi';
import { haversineDistanceMeters } from '../../../helpers/geo';
import { requireAuthenticatedUser } from '../../../helpers/inject-owner';

type AccountUser = {
  id?: number;
  email?: string;
  accountRole?: 'user' | 'employer' | 'admin';
  companyName?: string;
  displayName?: string;
};

function accountRole(user: AccountUser | undefined): 'user' | 'employer' | 'admin' {
  if (user?.accountRole === 'employer' || user?.accountRole === 'admin' || user?.accountRole === 'user') {
    return user.accountRole;
  }
  
  return 'user';
}

/**
 * Map a raw `vacancy` document to the public API shape consumed by the
 * frontend. Replaces the populated `owner` relation with a flat
 * `createdByUserId` string and defaults `moderationStatus` to `'published'`
 * when it is unset.
 *
 * @param doc - Raw vacancy document (optionally with populated `owner`), or `null`.
 * @returns The presentation vacancy document, or `null` when `doc` is null.
 */
function presentVacancy(doc: Record<string, unknown> | null) {
  if (!doc) return doc;
  const { owner, ...rest } = doc;
  const ownerRecord = owner as { id?: number } | number | null | undefined;
  const ownerId = ownerRecord && typeof ownerRecord === 'object' ? ownerRecord.id : ownerRecord;
  return {
    ...rest,
    moderationStatus: doc.moderationStatus ?? 'published',
    createdByUserId: ownerId != null ? String(ownerId) : undefined,
  };
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export default factories.createCoreController('api::vacancy.vacancy', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as AccountUser | undefined;
    const role = accountRole(user);
    const filters: Record<string, unknown> =
      role === 'admin'
        ? {}
        : role === 'employer' && user?.id
          ? {
              $or: [
                { moderationStatus: { $eq: 'published' } },
                { owner: { id: { $eq: user.id } } },
              ],
            }
          : { moderationStatus: { $eq: 'published' } };

    const data = await strapi.documents('api::vacancy.vacancy').findMany({
      status: 'published',
      filters,
      populate: ['owner'],
      limit: 100,
    });

    return { data: (data as Record<string, unknown>[]).map((item) => presentVacancy(item)) };
  },

  async findOne(ctx) {
    const data = await strapi.documents('api::vacancy.vacancy').findOne({
      documentId: ctx.params.id,
      populate: ['owner'],
    });
    if (!data) return ctx.notFound('Vacancy not found');
    return { data: presentVacancy(data as Record<string, unknown>) };
  },

  async create(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AccountUser;
    const role = accountRole(user);
    if (role === 'user') {
      return ctx.forbidden('Смену может создать работодатель или админ');
    }

    const body = { ...(ctx.request.body?.data ?? ctx.request.body ?? {}) } as Record<string, unknown>;
    const isAdmin = role === 'admin';
    const payload = {
      title: body.title,
      company: body.company ?? (isAdmin ? 'Halty' : user.companyName || user.displayName),
      employerName: isAdmin ? 'АДМИН' : user.companyName || user.displayName || 'Работодатель',
      salary: body.salary,
      category: body.category,
      categoryLabel: body.categoryLabel,
      attachmentType: body.attachmentType || 'building',
      lat: body.lat ?? (body.coordinates as { lat?: number } | undefined)?.lat,
      lng: body.lng ?? (body.coordinates as { lng?: number } | undefined)?.lng,
      address: body.address,
      locationName: body.locationName,
      description: body.description,
      requirements: body.requirements ?? [],
      schedule: body.schedule,
      payoutType: body.payoutType,
      color: body.color,
      accentColor: body.accentColor,
      iconType: body.iconType || 'coffee',
      buildingHeight: body.buildingHeight,
      zoneRadius: body.zoneRadius,
      createdByRole: isAdmin ? 'admin' : 'employer',
      moderationStatus: isAdmin ? 'published' : 'pending',
      owner: userId,
    };

    const data = await strapi.documents('api::vacancy.vacancy').create({
      data: payload as never,
      status: 'published',
      populate: ['owner'],
    });

    return { data: presentVacancy(data as Record<string, unknown>) };
  },

  async delete(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AccountUser;
    const documentId = ctx.params.id;
    const existing = await strapi.documents('api::vacancy.vacancy').findOne({
      documentId,
      populate: ['owner'],
    });
    const owner = existing as { owner?: { id?: number } } | null;
    if (!existing) return ctx.notFound('Vacancy not found');
    if (accountRole(user) !== 'admin' && owner?.owner?.id !== userId) {
      return ctx.forbidden('Можно удалить только свою смену');
    }

    const data = await strapi.documents('api::vacancy.vacancy').delete({ documentId });
    return { data };
  },

  /**
   * Admin-only moderation endpoint. Sets a vacancy's `moderationStatus` to
   * `'published'` or `'rejected'`.
   *
   * Requires an authenticated admin; returns `403` otherwise. Responds `400`
   * when `status` is neither `'published'` nor `'rejected'`, and `404` when the
   * vacancy does not exist.
   *
   * @example PATCH /api/vacancies/:id/moderation { "status": "published" }
   */
  async moderate(ctx) {
    requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AccountUser;
    if (accountRole(user) !== 'admin') {
      return ctx.forbidden('Модерация доступна только админу');
    }

    const status = ctx.request.body?.status;
    if (status !== 'published' && status !== 'rejected') {
      return ctx.badRequest('status должен быть published или rejected');
    }

    const data = await strapi.documents('api::vacancy.vacancy').update({
      documentId: ctx.params.id,
      data: { moderationStatus: status },
      status: 'published',
      populate: ['owner'],
    });
    if (!data) return ctx.notFound('Vacancy not found');
    return { data: presentVacancy(data as Record<string, unknown>) };
  },

  /**
   * Spatial query — analog of map-based content discovery in UpLift.
   * @example GET /api/vacancies/nearby?lat=53.9045&lng=27.5615&radius=3000
   */
  async nearby(ctx) {
    const lat = Number(ctx.query.lat);
    const lng = Number(ctx.query.lng);
    const radius = Number(ctx.query.radius) || 3000;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return ctx.badRequest('lat and lng query params are required');
    }

    const vacancies = await strapi.documents('api::vacancy.vacancy').findMany({
      status: 'published',
      filters: { moderationStatus: { $eq: 'published' } },
      populate: ['owner'],
    });

    const filtered = vacancies
      .map((vacancy) => {
        const vLat = Number(vacancy.lat);
        const vLng = Number(vacancy.lng);
        const distance = haversineDistanceMeters(lat, lng, vLat, vLng);
        return { vacancy, distance };
      })
      .filter(({ distance }) => distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .map(({ vacancy }) => presentVacancy(vacancy as Record<string, unknown>));

    return { data: filtered, meta: { total: filtered.length, radius } };
  },

  /**
   * Text search by title/company/location — analog of GET /api/exercises/search
   * @example GET /api/vacancies/search?search=парк&pagination[page]=1&pagination[pageSize]=20
   */
  async search(ctx) {
    const rawSearch = ctx.query.search;
    const searchTerm = typeof rawSearch === 'string' ? rawSearch.trim() : '';

    const pagination = (ctx.query?.pagination ?? {}) as Record<string, unknown>;
    const page = Number(pagination.page) || DEFAULT_PAGE;
    const pageSize = Math.min(Number(pagination.pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    if (!searchTerm) {
      return {
        data: [],
        meta: {
          pagination: { page, pageSize, pageCount: 0, total: 0 },
        },
      };
    }

    const vacancies = await strapi.documents('api::vacancy.vacancy').findMany({
      status: 'published',
      populate: ['owner'],
      filters: {
        moderationStatus: { $eq: 'published' },
        $or: [
          { title: { $containsi: searchTerm } },
          { company: { $containsi: searchTerm } },
          { locationName: { $containsi: searchTerm } },
        ],
      },
    });

    const total = vacancies.length;
    const start = (page - 1) * pageSize;
    const data = vacancies
      .slice(start, start + pageSize)
      .map((vacancy) => presentVacancy(vacancy as Record<string, unknown>));

    return {
      data,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize) || 0,
          total,
        },
      },
    };
  },
}));
