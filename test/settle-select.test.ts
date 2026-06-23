import { test, expect, describe } from 'bun:test';
import {
  portionKey, defaultSelectedKeys, selectedTotal, selectionsFor, payingForNames
} from '../lib/settle-select';

const me = 'u-me';
const portions = [
  { billId: 'b1', payeeLineId: 'u-me',   payeeName: 'Me',  billName: 'Lunch',  amount: 120 },
  { billId: 'b1', payeeLineId: 'u-aaa',  payeeName: 'Aaa', billName: 'Lunch',  amount: 80 },
  { billId: 'b2', payeeLineId: 'u-me',   payeeName: 'Me',  billName: 'Coffee', amount: 55.5 },
  { billId: 'b2', payeeLineId: 'u-bbb',  payeeName: 'Bbb', billName: 'Coffee', amount: 45 },
];

describe('settle-select', () => {
  test('defaults to the current user\'s own portions', () => {
    expect(defaultSelectedKeys(portions, me).sort()).toEqual(['b1::u-me', 'b2::u-me'].sort());
  });

  test('selectedTotal sums the chosen portions (2dp)', () => {
    expect(selectedTotal(portions, ['b1::u-me', 'b2::u-me'])).toBe(175.5);
    expect(selectedTotal(portions, ['b1::u-me', 'b1::u-aaa', 'b2::u-bbb'])).toBe(245);
    expect(selectedTotal(portions, [])).toBe(0);
  });

  test('selectionsFor returns the pay tuples', () => {
    expect(selectionsFor(portions, ['b1::u-aaa'])).toEqual([
      { billId: 'b1', payeeLineId: 'u-aaa', amount: 80 }
    ]);
  });

  test('payingForNames lists only OTHER selected people, deduped', () => {
    expect(payingForNames(portions, ['b1::u-me', 'b1::u-aaa', 'b2::u-bbb'], me)).toEqual(['Aaa', 'Bbb']);
    expect(payingForNames(portions, ['b1::u-me', 'b2::u-me'], me)).toEqual([]);
  });

  test('portionKey is stable', () => {
    expect(portionKey({ billId: 'b1', payeeLineId: 'u-me' })).toBe('b1::u-me');
  });
});
