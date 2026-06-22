import { Elysia, t } from 'elysia';

// Validation models for the users module (referenced by name via .model()).
export const userModels = new Elysia({ name: 'users.model' }).model({
  'users.paymentInfo': t.Object({
    promptPay: t.Optional(t.String())
  })
});
