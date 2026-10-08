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
    category: 'horeca' as const,
  },
];

export async function seedSampleVacancies(strapi: Core.Strapi) {
  const existing = await strapi.documents('api::vacancy.vacancy').findMany({ limit: 1 });
  if (existing.length > 0) return;

  for (const vacancy of SAMPLE_VACANCIES) {
    await strapi.documents('api::vacancy.vacancy').create({
      data: vacancy,
      status: 'published',
    });
  }

  strapi.log.info('[seed] Created sample vacancies');
}
