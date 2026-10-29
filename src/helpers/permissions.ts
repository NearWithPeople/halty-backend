import type { Core } from '@strapi/strapi';

type RoleType = 'public' | 'authenticated';

const PERMISSIONS: Record<RoleType, Record<string, string[]>> = {
  public: {
    'api::vacancy.vacancy': ['find', 'findOne', 'nearby', 'search'],
    'plugin::users-permissions.auth': ['callback', 'connect', 'emailConfirmation', 'forgotPassword', 'register', 'resetPassword', 'sendEmailConfirmation'],
  },
  authenticated: {
    'api::vacancy.vacancy': ['find', 'findOne', 'nearby', 'search', 'create', 'update', 'delete', 'moderate'],
    'api::application.application': ['find', 'findOne', 'create', 'update', 'updateStatus', 'addMessage'],
    'plugin::users-permissions.user': ['me', 'update', 'listFavorites', 'addFavorite', 'removeFavorite'],
    'plugin::users-permissions.auth': ['connect', 'callback', 'changePassword'],
  },
};

export async function setupDefaultPermissions(strapi: Core.Strapi) {
  const roles = await strapi.service('plugin::users-permissions.role').find();

  for (const [roleType, apiRules] of Object.entries(PERMISSIONS) as [RoleType, Record<string, string[]>][]) {
    const role = roles.find((entry: { type: string }) => entry.type === roleType);
    if (!role) continue;

    const fullRole = await strapi.service('plugin::users-permissions.role').findOne(role.id);

    for (const [uid, actions] of Object.entries(apiRules)) {
      const [namespace, controllerName] = uid.split('.');
      const controllers = fullRole.permissions?.[namespace]?.controllers;
      if (!controllers) continue;

      for (const action of actions) {
        if (controllers[controllerName]?.[action]) {
          controllers[controllerName][action].enabled = true;
        }
      }
    }

    await strapi.service('plugin::users-permissions.role').updateRole(fullRole.id, fullRole);
  }
}
