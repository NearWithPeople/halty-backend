type RegisterCtx = {
  request: { body?: Record<string, unknown> };
  badRequest: (message: string) => unknown;
};

type AuthController = {
  register: (ctx: RegisterCtx) => Promise<unknown>;
};

export default (plugin: {
  controllers: {
    auth: (params: unknown) => AuthController;
  };
}) => {
  const authFactory = plugin.controllers.auth;

  plugin.controllers.auth = (params: unknown) => {
    const auth = authFactory(params);
    const register = auth.register.bind(auth);

    auth.register = async (ctx: RegisterCtx) => {
      const body = { ...(ctx.request.body ?? {}) };
      const role = body.accountRole;

      if (role === 'admin') {
        return ctx.badRequest('Администратора нельзя зарегистрировать');
      }
      if (role !== 'user' && role !== 'employer') {
        return ctx.badRequest('Выберите роль: исполнитель или работодатель');
      }
      if (role === 'employer' && !String(body.companyName ?? '').trim()) {
        return ctx.badRequest('Укажите название компании');
      }

      body.accountRole = role;
      body.displayName = String(body.displayName ?? body.username ?? '').trim();
      ctx.request.body = body;
      return register(ctx);
    };

    return auth;
  };

  return plugin;
};
