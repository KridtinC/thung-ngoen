import { test, expect, describe } from 'bun:test';
import { encryptPII, decryptPII } from '../lib/crypto';

// 32-byte (64 hex) test key — NOT the production key.
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('encryptPII / decryptPII', () => {
  test('round-trips a value with a key', () => {
    const plain = '0812345678';
    const enc = encryptPII(plain, KEY);
    expect(enc).not.toBe(plain);
    expect(enc.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(decryptPII(enc, KEY)).toBe(plain);
  });

  test('produces a different ciphertext each time (random IV)', () => {
    expect(encryptPII('same', KEY)).not.toBe(encryptPII('same', KEY));
  });

  test('returns plaintext unchanged when no key is configured', () => {
    const prev = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(encryptPII('0812345678')).toBe('0812345678');
      expect(decryptPII('0812345678')).toBe('0812345678');
    } finally {
      if (prev !== undefined) process.env.ENCRYPTION_KEY = prev;
    }
  });

  test('leaves legacy plaintext (no colons) untouched on decrypt', () => {
    expect(decryptPII('0812345678', KEY)).toBe('0812345678');
  });

  test('returns the input unchanged if the ciphertext is tampered', () => {
    const enc = encryptPII('0812345678', KEY);
    const tampered = enc.slice(0, -2) + (enc.slice(-2) === 'aa' ? 'bb' : 'aa');
    expect(decryptPII(tampered, KEY)).toBe(tampered); // auth tag fails → returned as-is
  });

  test('empty string passes through', () => {
    expect(encryptPII('', KEY)).toBe('');
    expect(decryptPII('', KEY)).toBe('');
  });
});
