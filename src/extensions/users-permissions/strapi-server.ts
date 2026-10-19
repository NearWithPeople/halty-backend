import { withProfileUpdateWhitelist } from './controllers/user';
import type { UserUpdateCtx } from './controllers/user';

type RegisterCtx = {
  request: { body?: Record<string, unknown> };
  badRequest: (message: string) => unknown;
};

type AuthController = {
  register: (ctx: RegisterCtx) => Promise<unknown>;
};

type UserController = {
  update: (ctx: UserUpdateCtx) => Promise<unknown> | unknown;
};

type UsersPermissionsPlugin = {
  controllers: {
    auth: (params: unknown) => AuthController;
    user: UserController;
  };
};

export default (plugin: UsersPermissionsPlugin) => {
  const authFactory = plugin.controllers.auth;

  plugin.controllers.auth = createAuth(authFactory);

  const userController = plugin.controllers.user;
  const update = userController.update.bind(userController);

  userController.update = withProfileUpdateWhitelist(update);

  return plugin;
};

/**
 * Creates new auth controller which in the end calls next object
 *
 * @param next - function to run in the end.
 * @returns auth controller.
 */
function createAuth(next: (params: unknown) => AuthController) {
  return (params: unknown) => {
    const auth = next(params);
    const register = auth.register.bind(auth);

    auth.register = createRegisterController(register);

    return auth;
  }
}

/**
 * Creates new register controller which in the end calls next object
 * 
 * @param next - function to call in the end
 * @returns register controller
 */
function createRegisterController(next: (ctx: RegisterCtx) => Promise<unknown>) {
  return async (ctx: RegisterCtx) => {
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
    return next(ctx);
  };
}
