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

describe('pay for others', () => {
  test('selectedTotal when selecting only other people (no own)', () => {
    expect(selectedTotal(portions, ['b1::u-aaa', 'b2::u-bbb'])).toBe(125);
  });

  test('selectedTotal when paying own + all others', () => {
    const all = portions.map(portionKey);
    expect(selectedTotal(portions, all)).toBe(300.5);
  });

  test('payingForNames when selecting only others (no own portion selected)', () => {
    expect(payingForNames(portions, ['b1::u-aaa', 'b2::u-bbb'], me)).toEqual(['Aaa', 'Bbb']);
  });

  test('payingForNames deduplicates when one person has portions in multiple bills', () => {
    const multi = [
      { billId: 'b1', payeeLineId: 'u-me',  payeeName: 'Me',  billName: 'Lunch',  amount: 100 },
      { billId: 'b2', payeeLineId: 'u-aaa', payeeName: 'Aaa', billName: 'Dinner', amount: 50 },
      { billId: 'b3', payeeLineId: 'u-aaa', payeeName: 'Aaa', billName: 'Drinks', amount: 30 },
    ];
    expect(payingForNames(multi, ['b1::u-me', 'b2::u-aaa', 'b3::u-aaa'], 'u-me')).toEqual(['Aaa']);
  });

  test('selectionsFor returns all matched portions', () => {
    const keys = ['b1::u-me', 'b1::u-aaa', 'b2::u-bbb'];
    expect(selectionsFor(portions, keys)).toEqual([
      { billId: 'b1', payeeLineId: 'u-me',  amount: 120 },
      { billId: 'b1', payeeLineId: 'u-aaa', amount: 80 },
      { billId: 'b2', payeeLineId: 'u-bbb', amount: 45 },
    ]);
  });

  test('defaultSelectedKeys excludes other payees', () => {
    const keys = defaultSelectedKeys(portions, me);
    expect(keys).not.toContain('b1::u-aaa');
    expect(keys).not.toContain('b2::u-bbb');
  });

  test('defaultSelectedKeys returns empty when user has no portions', () => {
    expect(defaultSelectedKeys(portions, 'u-nobody')).toEqual([]);
  });
});
