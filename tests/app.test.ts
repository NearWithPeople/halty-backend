import type { Core } from '@strapi/strapi';

const { setupStrapi, cleanupStrapi } = require('./strapi');

declare global {
  // eslint-disable-next-line no-var
  var strapi: Core.Strapi;
}

beforeAll(async () => {
  await setupStrapi();
});

afterAll(async () => {
  await cleanupStrapi();
});

it('strapi is defined', () => {
  expect(strapi).toBeDefined();
});
