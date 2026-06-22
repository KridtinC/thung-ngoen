import { test, expect, describe } from 'bun:test';
import { fmt } from '../lib/money';

describe('fmt', () => {
  test('always shows 2 decimals', () => {
    expect(fmt(1000)).toBe('1,000.00');
    expect(fmt(5)).toBe('5.00');
  });

  test('groups thousands', () => {
    expect(fmt(1234567.5)).toBe('1,234,567.50');
  });

  test('rounds to 2 decimals', () => {
    expect(fmt(1.005)).toBe('1.01');
    expect(fmt(0.1 + 0.2)).toBe('0.30');
  });

  test('accepts numeric strings', () => {
    expect(fmt('42')).toBe('42.00');
  });
});
