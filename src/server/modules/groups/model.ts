import { Elysia, t } from 'elysia';

export const groupModels = new Elysia({ name: 'groups.model' }).model({
  'groups.create': t.Object(
    { name: t.String() },
    { additionalProperties: true }
  )
});
