import type { Core } from '@strapi/strapi';

const SAMPLE_VACANCIES = [
  {
    title: 'Озеленитель парковой зоны',
    company: 'Минскзеленстрой',
    employerName: 'АДМИН',
    salary: '1 650 – 2 100 BYN',
    category: 'parks_green' as const,
    categoryLabel: 'Парки и благоустройство',
    attachmentType: 'ground_zone' as const,
    lat: 53.8988,
    lng: 27.5492,
    locationName: 'Сквер Адама Міцкевіча',
    description: 'Уход за зелеными насаждениями, цветниками и газонами.',
    requirements: ['Любовь к природе', 'Аккуратность'],
    schedule: '5/2, с 08:00 до 17:00',
    payoutType: '2 раза в месяц',
    color: '#4ade80',
    accentColor: '#14532d',
    iconType: 'tree' as const,
    zoneRadius: 45,
    createdByRole: 'admin' as const,
    moderationStatus: 'published' as const,
  },
  {
    title: 'Барista',
    company: 'Coffee House',
    employerName: 'АДМИН',
    salary: '70 – 110 BYN / смена',
    categoryLabel: 'HoReCa',
    attachmentType: 'building' as const,
    lat: 53.9045,
    lng: 27.5615,
    locationName: 'Центр Минска',
    description: 'Приготовление кофе, обслуживание гостей.',
    requirements: ['Коммуникабельность', 'Опрятность'],
    schedule: '2/2',
    payoutType: 'Ежедневно',
    color: '#f97316',
    accentColor: '#9a3412',
    iconType: 'coffee' as const,
    buildingHeight: 24,
    createdByRole: 'admin' as const,
    moderationStatus: 'published' as const,
    category: 'horeca' as const,
  },
];

export async function seedSampleVacancies(strapi: Core.Strapi) {
  const existing = await strapi.documents('api::vacancy.vacancy').findMany({
    status: 'published',
    filters: { moderationStatus: { $eq: 'published' } },
    limit: 1,
  });
  if (existing.length > 0) return;

  for (const vacancy of SAMPLE_VACANCIES) {
    await strapi.documents('api::vacancy.vacancy').create({
      data: vacancy,
      status: 'published',
    });
  }

  strapi.log.info('[seed] Created sample vacancies');
}

export async function seedAdminUser(strapi: Core.Strapi) {
  const userService = strapi.plugin('users-permissions').service('user');
  const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: 'admin@halty.by' },
  });

  if (existing) {
    if (existing.provider !== 'local' || existing.accountRole !== 'admin' || existing.blocked) {
      await userService.edit(existing.id, {
        password: 'admin2026',
        provider: 'local',
        accountRole: 'admin',
        confirmed: true,
        blocked: false,
        displayName: existing.displayName || 'Админ',
      });
      strapi.log.info('[seed] Ensured admin user admin@halty.by');
    }
    return;
  }

  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  });
  if (!role) return;

  await userService.add({
    username: 'halty-admin',
    email: 'admin@halty.by',
    password: 'admin2026',
    provider: 'local',
    displayName: 'Админ',
    phone: '+375 (29) 000-00-00',
    accountRole: 'admin',
    confirmed: true,
    role: role.id,
  });

  strapi.log.info('[seed] Created admin user admin@halty.by');
}
