import { test, expect, describe } from 'bun:test';
import { buildInviteUrl } from '../lib/line-share';

describe('buildInviteUrl', () => {
  test('builds a LIFF deep-link with the invite code', () => {
    expect(buildInviteUrl('1660000000-abcdEFGH', 'Xy7Kp2Qr')).toBe(
      'https://liff.line.me/1660000000-abcdEFGH?invite=Xy7Kp2Qr'
    );
  });
});
