import type { Schema, Struct } from '@strapi/strapi';

export interface FavoriteFavoriteItem extends Struct.ComponentSchema {
  collectionName: 'components_favorite_favorite_items';
  info: {
    displayName: 'Favorite item';
    icon: 'book';
  };
  attributes: {
    vacancy: Schema.Attribute.Relation<'manyToOne', 'api::vacancy.vacancy'>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'favorite.favorite-item': FavoriteFavoriteItem;
    }
  }
}
