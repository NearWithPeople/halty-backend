import type { Core } from '@strapi/strapi';
import { setupDefaultPermissions } from './helpers/permissions';
import { seedSampleVacancies } from './helpers/seed';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const store = strapi.store({ type: 'plugin', name: 'halty', key: 'bootstrap' });
    const hasRun = (await store.get({ key: 'permissions' })) as { done?: boolean } | null;

    if (!hasRun?.done) {
      await setupDefaultPermissions(strapi);
      await seedSampleVacancies(strapi);
      await store.set({ key: 'permissions', value: { done: true } });
      strapi.log.info('[bootstrap] Default permissions and seed data applied');
    }
  },
};
