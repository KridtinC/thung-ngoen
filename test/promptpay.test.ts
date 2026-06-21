import { test, expect, describe } from 'bun:test';
import { crc16, generatePromptPayQR } from '../public/lib/promptpay.js';

describe('crc16 (CCITT-FALSE)', () => {
  test('matches the standard check vector for "123456789"', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  test('returns 4 uppercase hex chars', () => {
    expect(crc16('hello')).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe('generatePromptPayQR', () => {
  test('returns null for an invalid target length', () => {
    expect(generatePromptPayQR('12345', 100)).toBeNull();
    expect(generatePromptPayQR('', 100)).toBeNull();
  });

  test('builds a dynamic-amount payload for a mobile number', () => {
    const payload = generatePromptPayQR('0812345678', 100)!;
    expect(payload).not.toBeNull();
    expect(payload.startsWith('000201')).toBe(true);   // version
    expect(payload).toContain('010212');               // dynamic initiation
    expect(payload).toContain('A000000677010111');     // PromptPay AID
    expect(payload).toContain('0066812345678');        // mobile → intl format
    expect(payload).toContain('5303764');              // currency THB
    expect(payload).toContain('5406100.00');           // amount tag (len 06 + "100.00")
    expect(payload).toContain('5802TH');               // country
  });

  test('uses static initiation when no amount is given', () => {
    const payload = generatePromptPayQR('0812345678', 0)!;
    expect(payload).toContain('010211');               // static
    expect(payload).not.toContain('5406');             // no amount tag
  });

  test('handles a 13-digit National ID', () => {
    const payload = generatePromptPayQR('1234567890123', 50)!;
    expect(payload).toContain('1234567890123');
    expect(payload).toContain('540550.00'); // amount tag: "54" + len "05" + "50.00"
  });

  test('appends a valid CRC over the rest of the payload', () => {
    const payload = generatePromptPayQR('0812345678', 250.5)!;
    const body = payload.slice(0, -4);          // everything except the CRC
    const crc = payload.slice(-4);
    expect(body.endsWith('6304')).toBe(true);   // CRC tag id + length
    expect(crc).toBe(crc16(body));              // CRC is internally consistent
  });

  test('formats the amount to 2 decimals', () => {
    const payload = generatePromptPayQR('0812345678', 1234.5)!;
    expect(payload).toContain('1234.50');
  });
});
