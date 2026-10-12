/**
 * Custom routes loaded before core routes
 * so /vacancies/nearby and /vacancies/search don't collide with /vacancies/:id
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/vacancies/nearby',
      handler: 'vacancy.nearby',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/vacancies/search',
      handler: 'vacancy.search',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'PATCH',
      path: '/vacancies/:id/moderation',
      handler: 'vacancy.moderate',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
