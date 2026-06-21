// PII encryption helpers (AES-256-GCM). Pure — key is read from the
// ENCRYPTION_KEY env var by default, or passed explicitly (used by tests).
// Stored format: iv_hex:tag_hex:ciphertext_hex. Falls back to plaintext when
// no key is configured (local dev), and returns legacy plaintext untouched.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function resolveKey(keyHex?: string): Buffer | null {
  const hex = keyHex ?? process.env.ENCRYPTION_KEY;
  return hex ? Buffer.from(hex, 'hex') : null;
}

export function encryptPII(plaintext: string, keyHex?: string): string {
  const key = resolveKey(keyHex);
  if (!key || !plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptPII(ciphertext: string, keyHex?: string): string {
  const key = resolveKey(keyHex);
  if (!key || !ciphertext) return ciphertext;
  // Not encrypted (legacy plain value — no colons)
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  try {
    const [ivHex, tagHex, encHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
  } catch {
    return ciphertext; // decryption failed — return as-is
  }
}
