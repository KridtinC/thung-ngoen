import { Elysia, t } from 'elysia';

// Permissive validation: require the fields the client always sends; allow the rest
// (numeric amounts, optional/nullable slipKey, items, etc.) via additionalProperties.
export const billModels = new Elysia({ name: 'bills.model' }).model({
  'bills.create': t.Object(
    {
      name: t.String(),
      date: t.String(),
      payerLineId: t.String(),
      splitMethod: t.String()
    },
    { additionalProperties: true }
  ),
  'bills.pay': t.Object(
    { payeeLineId: t.String() },
    { additionalProperties: true }
  ),
  'bills.cancelDay': t.Object(
    { date: t.String() },
    { additionalProperties: true }
  )
});
