import { test, expect, describe } from 'bun:test';
import { generateInviteCode, INVITE_ALPHABET } from '../lib/invite';

describe('generateInviteCode', () => {
  test('defaults to 8 characters', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  test('honours a custom length', () => {
    expect(generateInviteCode(12)).toHaveLength(12);
  });

  test('only uses the unambiguous alphabet (no 0/O/1/I/l)', () => {
    const code = generateInviteCode(200);
    for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[0O1Il]/);
  });

  test('is effectively unique across many generations', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(990); // collisions should be vanishingly rare
  });
});
