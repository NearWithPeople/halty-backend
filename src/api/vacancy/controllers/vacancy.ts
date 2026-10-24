import { factories } from '@strapi/strapi';
import { haversineDistanceMeters } from '../../../helpers/geo';
import { requireAuthenticatedUser } from '../../../helpers/inject-owner';
import { broadcast } from '../../../helpers/realtime';

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

const EDITABLE_FIELDS = [
  'title',
  'company',
  'salary',
  'category',
  'categoryLabel',
  'attachmentType',
  'lat',
  'lng',
  'address',
  'locationName',
  'description',
  'requirements',
  'schedule',
  'payoutType',
  'color',
  'accentColor',
  'iconType',
  'buildingHeight',
  'zoneRadius',
] as const;

/**
 * Keep only employer-editable fields. System fields (`moderationStatus`,
 * `owner`, `createdByRole`, timestamps, relations) are intentionally never
 * copied from the request body.
 */
function pickEditableFields(body: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) payload[field] = body[field];
  }
  const coordinates = body.coordinates as { lat?: number; lng?: number } | undefined;
  if (payload.lat === undefined && coordinates?.lat !== undefined) payload.lat = coordinates.lat;
  if (payload.lng === undefined && coordinates?.lng !== undefined) payload.lng = coordinates.lng;
  return payload;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_FIND_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

/**
 * Normalize a query value to a non-empty string.
 *
 * Handles repeated query params (`?foo=a&foo=b`) by returning the first
 * non-empty value, and treats blank values as absent.
 *
 * @param value - Raw query value (string, array, or anything else).
 * @returns The trimmed string, or `undefined` when no usable value exists.
 */
function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = readString(item);
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/**
 * Extract the category filter from either the plain `category` param or the
 * Strapi-style `filters[category][$eq]` / `filters[category][$in]` params.
 *
 * @param query - Parsed request query.
 * @returns The requested category, or `undefined` when not provided.
 */
function readCategory(query: Record<string, unknown>): string | undefined {
  const filters = query.filters as Record<string, unknown> | undefined;
  const raw = query.category ?? filters?.category;
  const direct = readString(raw);
  if (direct) return direct;
  if (raw && typeof raw === 'object') {
    const operator = raw as Record<string, unknown>;
    return readString(operator.$eq) ?? readString(operator.$in);
  }
  return undefined;
}

/**
 * Extract the text search term from `search`, `q`, or Strapi's native `_q`.
 *
 * @param query - Parsed request query.
 * @returns The trimmed search term, or `undefined` when not provided.
 */
function readSearch(query: Record<string, unknown>): string | undefined {
  return readString(query.search) ?? readString(query.q) ?? readString(query._q);
}

/**
 * Parse and validate pagination params.
 *
 * Accepts `pagination[page]`, `pagination[pageSize]`, `pagination[start]` and
 * their shorthand aliases `limit` / `start`. `page` and `pageSize` must be
 * positive integers, `start` must be a non-negative integer, and `pageSize` is
 * capped at `MAX_PAGE_SIZE`.
 *
 * @param query - Parsed request query.
 * @param defaultPageSize - Page size used when the client omits it.
 * @returns Parsed pagination, or `{ error }` describing invalid params.
 */
function readPagination(query: Record<string, unknown>, defaultPageSize: number): { page: number; pageSize: number; start: number } | { error: string } {
  const pagination = (query.pagination ?? {}) as Record<string, unknown>;
  const invalid: string[] = [];

  const toInteger = (value: unknown, name: string, fallback: number, min: number) => {
    if (value === undefined || value === '') return fallback;
    const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < min) {
      invalid.push(`${name} >= ${min}`);
      return fallback;
    }
    return parsed;
  };

  const page = toInteger(pagination.page, 'pagination[page]', DEFAULT_PAGE, 1);
  const requestedPageSize = toInteger(
    pagination.pageSize ?? query.limit,
    'pagination[pageSize] (или limit)',
    defaultPageSize,
    1
  );
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const start = toInteger(
    pagination.start ?? query.start,
    'pagination[start] (или start)',
    (page - 1) * pageSize,
    0
  );

  if (invalid.length > 0) {
    return { error: `Некорректные параметры: ${invalid.join(', ')}` };
  }

  return { page, pageSize, start };
}

/**
 * Merge multiple filter objects into one Strapi filter.
 *
 * Empty filters are dropped; a single remaining filter is returned as-is, and
 * several are combined with `$and` so conditions cannot overwrite each other.
 *
 * @param candidates - Filters to merge; `undefined` and `{}` are ignored.
 * @returns A single Strapi filter object.
 */
function combineFilters(...candidates: (Record<string, unknown> | undefined)[]) {
  const filters = candidates.filter(
    (candidate): candidate is Record<string, unknown> =>
      candidate !== undefined && Object.keys(candidate).length > 0
  );
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
}

/**
 * creates in find visibility filter based on role
 * @param role 
 * @param userId if underfined, returns filter for public user
 * @returns filter
 */
function createVisibilityFilters(role: string, userId: undefined | number): Record<string, unknown> {
  if (role === 'admin') {
    return {};
  }

  if (!userId || role !== 'employer') {  
    return { moderationStatus: { $eq: 'published' } };
  }

  return { $or: [
      { moderationStatus: { $eq: 'published' } },
      { owner: { id: { $eq: userId } } },
    ], };
  
}

export default factories.createCoreController('api::vacancy.vacancy', ({ strapi }) => ({
  async find(ctx) {
    const query = ctx.query as Record<string, unknown>;
    const user = ctx.state.user as AccountUser | undefined;
    const role = accountRole(user);
    const visibilityFilters: Record<string, unknown> = createVisibilityFilters(role, user?.id);

    const category = readCategory(query);
    const searchTerm = readSearch(query);
    const pagination = readPagination(query, DEFAULT_FIND_PAGE_SIZE);
    if ('error' in pagination) return ctx.badRequest(pagination.error);
    const { page, pageSize, start } = pagination;

    const filters = combineFilters(visibilityFilters,
      category ? { category: { $eq: category } } : undefined,
      searchTerm
        ? {
            $or: [
              { title: { $containsi: searchTerm } },
              { company: { $containsi: searchTerm } },
              { locationName: { $containsi: searchTerm } },
            ],
          }
        : undefined
    );

    const [data, total] = await Promise.all([
      strapi.documents('api::vacancy.vacancy').findMany({
        status: 'published',
        filters,
        populate: ['owner'],
        limit: pageSize,
        start,
      }),
      strapi.documents('api::vacancy.vacancy').count({ status: 'published', filters }),
    ]);

    return {
      data: (data as Record<string, unknown>[]).map((item) => presentVacancy(item)),
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

    const vacancy = presentVacancy(data as Record<string, unknown>);
    broadcast('VACANCY_CREATED', { data: vacancy });
    return { data: vacancy };
  },

  async update(ctx) {
    const userId = requireAuthenticatedUser(ctx);
    const user = ctx.state.user as AccountUser;
    const role = accountRole(user);
    if (role === 'user') {
      return ctx.forbidden('Смену может редактировать работодатель или админ');
    }

    const existing = await strapi.documents('api::vacancy.vacancy').findOne({
      documentId: ctx.params.id,
      populate: ['owner'],
    });
    if (!existing) return ctx.notFound('Vacancy not found');

    const ownerId = (existing as { owner?: { id?: number } }).owner?.id;
    if (role !== 'admin' && ownerId !== userId) {
      return ctx.notFound('Vacancy not found');
    }

    const body = { ...(ctx.request.body?.data ?? ctx.request.body ?? {}) } as Record<string, unknown>;
    const data = await strapi.documents('api::vacancy.vacancy').update({
      documentId: ctx.params.id,
      data: pickEditableFields(body) as never,
      status: 'published',
      populate: ['owner'],
    });
    if (!data) return ctx.notFound('Vacancy not found');
    const vacancy = presentVacancy(data as Record<string, unknown>);
    broadcast('VACANCY_UPDATED', { data: vacancy });
    return { data: vacancy };
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
    broadcast('VACANCY_DELETED', { documentId });
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
    const vacancy = presentVacancy(data as Record<string, unknown>);
    broadcast('VACANCY_UPDATED', { data: vacancy });
    return { data: vacancy };
  },

  /**
   * Spatial query — analog of map-based content discovery in UpLift.
   * @example GET /api/vacancies/nearby?lat=53.9045&lng=27.5615&radius=3000
   */
  async nearby(ctx) {
    const query = ctx.query as Record<string, unknown>;
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const radius = Number(query.radius) || 3000;
    const category = readCategory(query);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return ctx.badRequest('lat and lng query params are required');
    }

    const vacancies = await strapi.documents('api::vacancy.vacancy').findMany({
      status: 'published',
      filters: combineFilters(
        { moderationStatus: { $eq: 'published' } },
        category ? { category: { $eq: category } } : undefined
      ),
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
