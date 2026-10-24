import type { Core } from '@strapi/strapi';
import { setupDefaultPermissions } from './helpers/permissions';
import { initRealtime } from './helpers/realtime';
import { seedAdminUser, seedSampleVacancies } from './helpers/seed';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await setupDefaultPermissions(strapi);
    await seedSampleVacancies(strapi);
    await seedAdminUser(strapi);
    initRealtime(strapi);
    strapi.log.info('[bootstrap] Strapi API is ready for the frontend');
  },
};
