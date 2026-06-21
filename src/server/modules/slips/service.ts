// Slip storage service — Cloudflare R2 via Bun's built-in S3 client.
// Non-request-dependent; disabled (null) when env vars are missing.
import { randomBytes } from 'node:crypto';

const r2Enabled = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

const r2 = r2Enabled
  ? new Bun.S3Client({
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucket: process.env.R2_BUCKET!,
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: 'auto',
    })
  : null;

console.log(r2Enabled ? '🪣 R2 slip storage enabled' : '⚠️ R2 slip storage NOT configured');

export abstract class SlipService {
  static get enabled(): boolean {
    return !!r2;
  }

  // Build a unique object key from the uploaded file's type/extension.
  static keyFor(file: File): string {
    const type = file.type || 'image/jpeg';
    const ext = (file.name?.split('.').pop() || type.split('/')[1] || 'jpg')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return `slips/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
  }

  static async put(key: string, data: ArrayBuffer, type: string): Promise<void> {
    await r2!.write(key, data, { type });
  }

  // Short-lived presigned GET URL (bucket stays private).
  static presign(key: string): string {
    return r2!.presign(key, { expiresIn: 3600, method: 'GET' });
  }
}
