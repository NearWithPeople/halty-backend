type Ctx = {
  state?: { user?: { id?: number } };
  query?: Record<string, unknown>;
  request: { body?: { data?: Record<string, unknown> } };
  throw: (status: number, message: string) => never;
};

export function getAuthenticatedUserId(ctx: Ctx): number | null {
  const userId = ctx.state?.user?.id;
  return typeof userId === 'number' ? userId : null;
}

export function requireAuthenticatedUser(ctx: Ctx): number {
  const userId = getAuthenticatedUserId(ctx);
  if (userId === null) {
    ctx.throw(401, 'Authentication required');
  }
  return userId;
}

export function injectOwnerOnCreate(ctx: Ctx) {
  const userId = requireAuthenticatedUser(ctx);
  const data = ctx.request.body?.data ?? {};

  ctx.request.body = {
    ...ctx.request.body,
    data: {
      ...data,
      owner: userId,
    },
  };
}

export function injectOwnerFilter(ctx: Ctx) {
  const userId = requireAuthenticatedUser(ctx);
  const existingFilters = ctx.query?.filters ?? {};

  ctx.query = {
    ...ctx.query,
    filters: {
      $and: [existingFilters, { owner: { id: { $eq: userId } } }],
    },
  };
}
