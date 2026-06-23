import { test, expect, describe } from 'bun:test';
import { t, detectLang, keyParity, LANGS } from '../lib/i18n';

describe('i18n', () => {
  test('en and th have identical key sets (no missing translations)', () => {
    const { inEnOnly, inThOnly } = keyParity();
    expect(inEnOnly).toEqual([]);
    expect(inThOnly).toEqual([]);
  });

  test('looks up by language', () => {
    expect(t('en', 'common.cancel')).toBe('Cancel');
    expect(t('th', 'common.cancel')).toBe('ยกเลิก');
  });

  test('interpolates variables', () => {
    expect(t('en', 'pay.payingFor', { names: 'Aaa, Bbb' })).toBe('Paying for: Aaa, Bbb');
    expect(t('th', 'history.title', { n: 3 })).toBe('🗂️ ประวัติ (3)');
  });

  test('falls back to the key when missing', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key');
  });

  test('detectLang honours a Thai system hint, defaults to en', () => {
    expect(detectLang('th-TH')).toBe('th');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('fr-FR')).toBe('en');
  });

  test('description copy carries cat flavour in both languages', () => {
    expect(t('en', 'settings.blurb')).toContain('🐾');
    expect(t('th', 'settings.blurb')).toContain('เมี้ยว');
    expect(LANGS).toEqual(['en', 'th']);
  });
});
