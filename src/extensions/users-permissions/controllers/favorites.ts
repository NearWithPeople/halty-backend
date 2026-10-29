import type { Core } from '@strapi/strapi';
import { can } from '../../../helpers/policy';
import type { AuthUser, PolicyAction } from '../../../helpers/policy';

/**
 * Minimal Koa context surface used by the favorites actions. Kept narrow so the
 * handlers can be unit-tested without bootstrapping Strapi.
 */
export type FavoritesCtx = {
  state?: { user?: AuthUser };
  params?: { documentId?: string };
  request: { body?: Record<string, unknown> | null };
  unauthorized: (message?: string) => unknown;
  notFound: (message?: string) => unknown;
  badRequest: (message?: string) => unknown;
  conflict: (message?: string) => unknown;
};

/** A vacancy as returned by the document service (with `owner` optionally populated). */
type VacancyDoc = Record<string, unknown> & { documentId?: string };
/** One entry of the repeatable `favorites` component on the user. */
type FavoriteItem = { id?: number; vacancy?: VacancyDoc | null };
/** User document with the `favorites` component loaded. */
type UserWithFavorites = { favorites?: FavoriteItem[] };

/**
 * Resolve the global Strapi instance. Plugin controllers are registered outside
 * the DI container and the `strapi-server` extension receives the plugin object,
 * not `strapi`, so the global set by `createStrapi` is the canonical reference.
 *
 * @returns The running Strapi instance.
 */
function getStrapi(): Core.Strapi {
  return (globalThis as unknown as { strapi: Core.Strapi }).strapi;
}

/**
 * Authenticate the request and authorize `action` on the caller's own favorites.
 *
 * Favorites live under `/users/me`, so the target user is always the
 * authenticated user; the {@link can} check is kept explicit (and
 * forward-looking) instead of relying on the route shape alone.
 *
 * @param ctx - Koa context of the favorites request.
 * @param action - Policy action being performed (`favorites:read|add|remove`).
 * @returns The authenticated user, or a `401`/`404` response when not allowed.
 */
function requireOwnUser(ctx: FavoritesCtx, action: PolicyAction): AuthUser {
  const user = ctx.state?.user;
  if (!user || typeof user.id !== 'number') {
    return ctx.unauthorized('Authentication required') as never;
  }
  if (!can(user, action, { userId: user.id })) {
    return ctx.notFound('User not found') as never;
  }
  return user;
}

/**
 * Extract a vacancy `documentId` from the accepted request shapes: a plain
 * string, or an object carrying `documentId` (preferred) or `id`.
 *
 * @param value - Raw `vacancy` value from the request body.
 * @returns The trimmed documentId, or `undefined` when absent/invalid.
 */
function vacancyDocumentIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const obj = value as { documentId?: unknown; id?: unknown };
    const docId = obj.documentId ?? obj.id;
    if (typeof docId === 'string' && docId.trim()) return docId.trim();
    if (typeof docId === 'number') return String(docId);
  }
  return undefined;
}

/**
 * Map a raw vacancy document to the public API shape used by the vacancy
 * endpoints: flatten the populated `owner` relation into `createdByUserId` and
 * default `moderationStatus` to `'published'`.
 *
 * @param vacancy - Vacancy document (optionally with populated `owner`), or nullish.
 * @returns The presentation shape, or `null` when `vacancy` is nullish.
 */
function presentVacancy(vacancy: VacancyDoc | null | undefined): Record<string, unknown> | null {
  if (!vacancy) return null;
  const { owner, ...rest } = vacancy;
  const ownerId = owner && typeof owner === 'object' ? (owner as { id?: number }).id : owner;
  return {
    ...rest,
    moderationStatus: vacancy.moderationStatus ?? 'published',
    createdByUserId: ownerId != null ? String(ownerId) : undefined,
  };
}

/**
 * Populate spec shared by all favorites reads: the component itself, each
 * vacancy, and its owner (needed by {@link presentVacancy}).
 */
const FAVORITES_POPULATE = {
  favorites: { populate: { vacancy: { populate: ['owner'] } } },
};

/**
 * Load the authenticated user's repeatable `favorites` component array.
 *
 * Vacancies (and their owner) are always populated, so one loader serves both
 * writes (reading `documentId` to diff the array) and reads (presenting the
 * vacancy).
 *
 * @param user - Authenticated user whose favorites should be read.
 * @returns The favorite items (empty array when the user has none).
 */
async function loadFavorites(user: AuthUser): Promise<FavoriteItem[]> {
  const strapi = getStrapi();
  const doc = (await strapi.documents('plugin::users-permissions.user').findOne({
    documentId: user.documentId as string,
    populate: FAVORITES_POPULATE as never,
  })) as unknown as UserWithFavorites | null;
  return (doc?.favorites ?? []) as FavoriteItem[];
}

/**
 * `GET /api/users/me/favorites` — list the caller's favorited vacancies.
 *
 * Owner-scoped by construction (`/users/me`). Returns vacancies in the same
 * shape as the public vacancy endpoints.
 *
 * @param ctx - Koa context.
 * @returns `{ data, meta: { total } }` with the favorited vacancies.
 */
export async function listFavorites(ctx: FavoritesCtx) {
  const user = requireOwnUser(ctx, 'favorites:read');
  const favorites = await loadFavorites(user);
  const data = favorites.map((item) => presentVacancy(item.vacancy)).filter(Boolean);
  return { data, meta: { total: data.length } };
}

/**
 * `POST /api/users/me/favorites` — add a vacancy to the caller's favorites.
 *
 * Body: `{ data: { vacancy: <documentId> } }`. The vacancy must exist, be
 * published and not be pending/rejected. The existing component items are kept
 * by their `id` (so their relation is untouched) and the new one is appended.
 *
 * @param ctx - Koa context.
 * @returns The added vacancy (`200`), or `400`/`404`/`409` on failure.
 */
export async function addFavorite(ctx: FavoritesCtx) {
  const user = requireOwnUser(ctx, 'favorites:add');
  const strapi = getStrapi();

  const body = (ctx.request.body ?? {}) as Record<string, unknown>;
  const dataField = (body.data ?? body) as Record<string, unknown>;
  const vacancyDocumentId = vacancyDocumentIdOf(dataField.vacancy);

  if (!vacancyDocumentId) {
    return ctx.badRequest('vacancy is required');
  }

  const vacancy = await strapi.documents('api::vacancy.vacancy').findOne({
    documentId: vacancyDocumentId,
    status: 'published',
    populate: ['owner'],
  });

  if (
    !vacancy ||
    (vacancy as { moderationStatus?: string }).moderationStatus === 'pending' ||
    (vacancy as { moderationStatus?: string }).moderationStatus === 'rejected'
  ) {
    return ctx.notFound('Vacancy not found');
  }

  const favorites = await loadFavorites(user);
  if (favorites.some((item) => item.vacancy?.documentId === vacancyDocumentId)) {
    return ctx.conflict('Vacancy is already in favorites');
  }

  const nextFavorites = [
    ...favorites
      .filter((item) => item.vacancy?.documentId !== vacancyDocumentId)
      .map((item) => ({ id: item.id })),
    { vacancy: vacancyDocumentId },
  ];

  await strapi.documents('plugin::users-permissions.user').update({
    documentId: user.documentId as string,
    data: { favorites: nextFavorites },
  });

  return { data: presentVacancy(vacancy as VacancyDoc) };
}

/**
 * `DELETE /api/users/me/favorites/:documentId` — remove a vacancy from the
 * caller's favorites.
 *
 * Only the matching component item is dropped; the remaining items keep their
 * `id` so Strapi updates them in place instead of recreating the array.
 *
 * @param ctx - Koa context; `params.documentId` is the vacancy documentId.
 * @returns `{ data: { documentId, removed: true } }` (`200`), or `400`/`404`.
 */
export async function removeFavorite(ctx: FavoritesCtx) {
  const user = requireOwnUser(ctx, 'favorites:remove');
  const strapi = getStrapi();

  const vacancyDocumentId = ctx.params?.documentId;
  if (!vacancyDocumentId) {
    return ctx.badRequest('vacancy documentId is required');
  }

  const favorites = await loadFavorites(user);
  if (!favorites.some((item) => item.vacancy?.documentId === vacancyDocumentId)) {
    return ctx.notFound('Favorite not found');
  }

  const nextFavorites = favorites
    .filter((item) => item.vacancy?.documentId !== vacancyDocumentId)
    .map((item) => ({ id: item.id }));

  await strapi.documents('plugin::users-permissions.user').update({
    documentId: user.documentId as string,
    data: { favorites: nextFavorites },
  });

  return { data: { documentId: vacancyDocumentId, removed: true } };
}
