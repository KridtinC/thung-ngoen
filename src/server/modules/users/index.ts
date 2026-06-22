import { Elysia } from 'elysia';
import { UserService } from './service';
import { userModels } from './model';

export const users = new Elysia({ name: 'users' })
  .use(userModels)
  .get('/api/users/:lineId', async ({ params: { lineId }, set }) => {
    try {
      const user = await UserService.getByLineId(lineId);
      if (!user) { set.status = 404; return { error: 'User not found' }; }
      return { user };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })
  // Set the user's PromptPay information
  .post('/api/users/:lineId/payment-info', async ({ params: { lineId }, body, set }) => {
    try {
      const user = await UserService.setPaymentInfo(lineId, (body as any).promptPay);
      if (!user) { set.status = 404; return { error: 'User not found' }; }
      return { success: true, user };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  }, { body: 'users.paymentInfo' });
