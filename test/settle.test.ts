import { test, expect, describe } from 'bun:test';
import { simplifyDebts } from '../lib/settle';

const people = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cat' }
];

describe('simplifyDebts', () => {
  test('settles a simple two-person debt', () => {
    const txs = simplifyDebts(people, { a: -100, b: 100, c: 0 });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ from: 'a', to: 'b', amount: 100 });
  });

  test('routes two debtors to one creditor', () => {
    const txs = simplifyDebts(people, { a: -50, b: -50, c: 100 });
    expect(txs).toHaveLength(2);
    expect(txs.every(t => t.to === 'c')).toBe(true);
    const total = txs.reduce((s, t) => s + t.amount, 0);
    expect(total).toBeCloseTo(100, 2);
  });

  test('returns nothing when everyone is settled', () => {
    expect(simplifyDebts(people, { a: 0, b: 0, c: 0 })).toEqual([]);
  });

  test('ignores sub-cent balances (noise tolerance)', () => {
    expect(simplifyDebts(people, { a: -0.005, b: 0.005, c: 0 })).toEqual([]);
  });

  test('rounds transfer amounts to 2 decimals', () => {
    const txs = simplifyDebts(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      { a: -33.333, b: 33.333 }
    );
    expect(txs[0].amount).toBe(33.33);
  });

  test('carries display names through', () => {
    const txs = simplifyDebts(people, { a: -100, b: 100, c: 0 });
    expect(txs[0].fromName).toBe('Ann');
    expect(txs[0].toName).toBe('Bob');
  });
});
