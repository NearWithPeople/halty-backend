import { factories } from '@strapi/strapi';
import { haversineDistanceMeters } from '../../../helpers/geo';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export default factories.createCoreController('api::vacancy.vacancy', ({ strapi }) => ({
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
      populate: '*',
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
      .map(({ vacancy }) => vacancy);

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
      populate: '*',
      filters: {
        $or: [
          { title: { $containsi: searchTerm } },
          { company: { $containsi: searchTerm } },
          { locationName: { $containsi: searchTerm } },
        ],
      },
    });

    const total = vacancies.length;
    const start = (page - 1) * pageSize;
    const data = vacancies.slice(start, start + pageSize);

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
