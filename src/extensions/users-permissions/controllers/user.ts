import type { Core } from '@strapi/strapi';
import { getUserStats } from '../../../helpers/user-stats';

export type UserUpdateCtx = {
  state?: { user?: { id?: number } };
  params?: { id?: string | number };
  request: { body?: Record<string, unknown> | null };
  unauthorized: (message?: string) => unknown;
  notFound: (message?: string) => unknown;
};

type UserUpdateHandler = (ctx: UserUpdateCtx) => Promise<unknown> | unknown;

export type UserMeCtx = {
  state?: { user?: { id?: number } };
  body?: Record<string, unknown> | null;
};

type UserMeHandler = (ctx: UserMeCtx) => Promise<unknown> | unknown;

function getStrapi(): Core.Strapi {
  return (globalThis as unknown as { strapi: Core.Strapi }).strapi;
}

/**
 * Decorates a users-permissions read handler (e.g. `me`) with the user's
 * computed reputation stats (`rating`, `completedShifts`, `punctuality`,
 * `averageDelaySec`). Stats are derived on read — never persisted.
 *
 * @param originalHandler - Bound users-permissions handler that sets `ctx.body`.
 * @returns Wrapped handler that merges the stats into the response body.
 */
export function withComputedStats(originalHandler: UserMeHandler): UserMeHandler {
  return async (ctx) => {
    const result = await originalHandler(ctx);
    const userId = ctx.state?.user?.id;
    if (typeof userId === 'number' && ctx.body && typeof ctx.body === 'object') {
      const stats = await getUserStats(getStrapi(), userId);
      ctx.body = { ...ctx.body, ...stats };
    }
    return result;
  };
}

const EDITABLE_FIELDS = ['displayName', 'phone', 'tgUsername', 'tgConnected', 'companyName'] as const;

export function withProfileUpdateWhitelist(originalUpdate: UserUpdateHandler): UserUpdateHandler {
  return async (ctx) => {
    const authUserId = ctx.state?.user?.id;
    if (authUserId == null) {
      return ctx.unauthorized('Authentication required');
    }

    // check if user is updating himself
    if (String(ctx.params?.id) !== String(authUserId)) {
      return ctx.notFound('User not found');
    }

    const body = ctx.request.body ?? {};
    ctx.request.body = filterBody(body);

    return originalUpdate(ctx);
  };
}

function filterBody(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }
  }

  return data;
}
