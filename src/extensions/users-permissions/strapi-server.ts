import { withProfileUpdateWhitelist } from './controllers/user';
import type { UserUpdateCtx } from './controllers/user';
import { addFavorite, listFavorites, removeFavorite } from './controllers/favorites';
import type { FavoritesCtx } from './controllers/favorites';

type RegisterCtx = {
  request: { body?: Record<string, unknown> };
  badRequest: (message: string) => unknown;
};

type AuthController = {
  register: (ctx: RegisterCtx) => Promise<unknown>;
};

type UserController = {
  update: (ctx: UserUpdateCtx) => Promise<unknown> | unknown;
  listFavorites: (ctx: FavoritesCtx) => Promise<unknown> | unknown;
  addFavorite: (ctx: FavoritesCtx) => Promise<unknown> | unknown;
  removeFavorite: (ctx: FavoritesCtx) => Promise<unknown> | unknown;
};

/** A single content-api route added to the users-permissions plugin. */
type ContentApiRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: string;
  config?: Record<string, unknown>;
};

/**
 * Content-api router of the plugin. At extension time it is a factory function
 * exposing a `.routes` getter/setter, so the array can be extended in place.
 */
type ContentApiRouter = {
  routes: ContentApiRoute[];
};

type UsersPermissionsPlugin = {
  controllers: {
    auth: (params: unknown) => AuthController;
    user: UserController;
  };
  routes: {
    'content-api': ContentApiRouter;
  };
};

/**
 * Routes for the owner-scoped favorites API. `prefix: ''` mirrors the other
 * users-permissions content-api routes, so the URLs resolve to
 * `/api/users/me/favorites…` instead of `/api/users-permissions/users/me/…`.
 */
const FAVORITES_ROUTES: ContentApiRoute[] = [
  {
    method: 'GET',
    path: '/users/me/favorites',
    handler: 'user.listFavorites',
    config: { prefix: '' },
  },
  {
    method: 'POST',
    path: '/users/me/favorites',
    handler: 'user.addFavorite',
    config: { prefix: '' },
  },
  {
    method: 'DELETE',
    path: '/users/me/favorites/:documentId',
    handler: 'user.removeFavorite',
    config: { prefix: '' },
  },
];

/**
 * Users-permissions plugin extension. Wraps `auth.register` (role validation)
 * and `user.update` (field whitelist), then registers the favorites actions and
 * their content-api routes on the same plugin.
 *
 * @param plugin - The users-permissions plugin object being extended.
 * @returns The extended plugin.
 */
export default (plugin: UsersPermissionsPlugin) => {
  const authFactory = plugin.controllers.auth;

  plugin.controllers.auth = createAuth(authFactory);

  const userController = plugin.controllers.user;
  const update = userController.update.bind(userController);

  userController.update = withProfileUpdateWhitelist(update);

  userController.listFavorites = listFavorites;
  userController.addFavorite = addFavorite;
  userController.removeFavorite = removeFavorite;

  const contentApi = plugin.routes['content-api'];
  contentApi.routes = [...contentApi.routes, ...FAVORITES_ROUTES];

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
