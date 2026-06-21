import { Elysia, redirect } from 'elysia';
import { SlipService } from './service';

// Payment-slip upload + private retrieval (presigned redirect).
export const slips = new Elysia({ name: 'slips' })
  // Upload a slip image to R2. Returns the stored object key.
  .post('/api/slips', async ({ body, set }) => {
    if (!SlipService.enabled) { set.status = 503; return { error: 'Slip storage is not configured.' }; }
    try {
      const file = (body as any).slip as File | undefined;
      if (!file || typeof file.arrayBuffer !== 'function') {
        set.status = 400;
        return { error: 'No slip file provided.' };
      }
      if (file.size > 8 * 1024 * 1024) {
        set.status = 413;
        return { error: 'Slip image too large (max 8MB).' };
      }
      const type = file.type || 'image/jpeg';
      if (!type.startsWith('image/')) {
        set.status = 400;
        return { error: 'Slip must be an image.' };
      }
      const key = SlipService.keyFor(file);
      await SlipService.put(key, await file.arrayBuffer(), type);
      return { key };
    } catch (err) {
      console.error('Slip upload error:', err);
      set.status = 500;
      return { error: 'Failed to upload slip.' };
    }
  })

  // Stream a slip by redirecting to a short-lived presigned R2 URL (used as an <img src>).
  .get('/api/slip', ({ query, set }) => {
    if (!SlipService.enabled) { set.status = 503; return 'Slip storage is not configured.'; }
    const key = (query as any).key as string;
    if (!key || !key.startsWith('slips/')) { set.status = 400; return 'Invalid key.'; }
    return redirect(SlipService.presign(key));
  });
