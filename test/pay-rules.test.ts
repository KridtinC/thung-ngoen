import { test, expect, describe } from 'bun:test';
import { canConfirmPayment } from '../lib/pay-rules';

describe('pay-rules: slip required for QR confirm', () => {
  test('blocked until a slip is attached', () => {
    expect(canConfirmPayment({ hasPromptPay: true, hasSlip: false })).toBe(false);
    expect(canConfirmPayment({ hasPromptPay: true, hasSlip: true })).toBe(true);
  });

  test('no PromptPay → no QR confirm', () => {
    expect(canConfirmPayment({ hasPromptPay: false, hasSlip: true })).toBe(false);
    expect(canConfirmPayment({ hasPromptPay: false, hasSlip: false })).toBe(false);
  });
});
