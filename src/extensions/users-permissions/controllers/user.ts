export type UserUpdateCtx = {
  state?: { user?: { id?: number } };
  params?: { id?: string | number };
  request: { body?: Record<string, unknown> | null };
  unauthorized: (message?: string) => unknown;
  notFound: (message?: string) => unknown;
};

type UserUpdateHandler = (ctx: UserUpdateCtx) => Promise<unknown> | unknown;

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
