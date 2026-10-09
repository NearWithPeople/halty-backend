import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'PATCH',
      path: '/applications/:id/status',
      handler: 'application.updateStatus',
    },
    {
      method: 'POST',
      path: '/applications/:id/messages',
      handler: 'application.addMessage',
    },
  ]
}

export default config