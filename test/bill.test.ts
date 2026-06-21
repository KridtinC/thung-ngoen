import { test, expect, describe } from 'bun:test';
import { taxFactor, computeEqualSplit, computeManualSplit, round2 } from '../lib/bill';

describe('taxFactor', () => {
  test('no tax = 1', () => expect(taxFactor(0, 0)).toBe(1));
  test('sc then vat compound', () => expect(taxFactor(10, 7)).toBeCloseTo(1.1 * 1.07, 10));
});

describe('computeEqualSplit', () => {
  test('plain split, no tax/discount', () => {
    const r = computeEqualSplit(100, 0, 0, 0, 4);
    expect(r.total).toBe(100);
    expect(r.share).toBe(25);
  });

  test('applies discount then 10% SC + 7% VAT', () => {
    // (60 - 10) * 1.1 * 1.07 = 58.85
    const r = computeEqualSplit(60, 10, 10, 7, 2);
    expect(r.total).toBe(58.85);
    expect(r.share).toBe(29.43); // round2(58.85/2)=29.43 (29.425→29.43)
  });

  test('discount never makes the base negative', () => {
    const r = computeEqualSplit(20, 100, 0, 0, 1);
    expect(r.total).toBe(0);
  });
});

describe('computeManualSplit', () => {
  test('pro-rates discount + tax across base shares', () => {
    // subtotal 60, discount 10 -> ratio 50/60; tax 1.1*1.07
    const r = computeManualSplit({ a: 40, b: 20 }, 60, 10, 10, 7);
    const ratio = 50 / 60;
    const tf = 1.1 * 1.07;
    expect(r.total).toBe(round2(60 * ratio * tf));
    expect(r.amounts.a).toBe(round2(40 * ratio * tf));
    expect(r.amounts.b).toBe(round2(20 * ratio * tf));
    // shares should add up to (approximately) the total
    expect(r.amounts.a + r.amounts.b).toBeCloseTo(r.total, 1);
  });

  test('no discount, no tax → amounts equal base shares', () => {
    const r = computeManualSplit({ a: 30, b: 70 }, 100, 0, 0, 0);
    expect(r.total).toBe(100);
    expect(r.amounts).toEqual({ a: 30, b: 70 });
  });

  test('zero subtotal does not divide by zero', () => {
    const r = computeManualSplit({}, 0, 5, 0, 0);
    expect(r.total).toBe(0);
    expect(r.amounts).toEqual({});
  });
});
