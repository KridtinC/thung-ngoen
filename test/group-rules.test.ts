import { test, expect, describe } from 'bun:test';
import { isLineGroup, canInvite, canLeave, canDelete } from '../lib/group-rules';

describe('group-rules', () => {
  const lineGroup = { lineGroupId: 'C1234567890' };
  const manualGroup = { lineGroupId: '' };
  const manualGroup2 = {};

  test('LINE-synced group is locked down', () => {
    expect(isLineGroup(lineGroup)).toBe(true);
    expect(canInvite(lineGroup)).toBe(false);
    expect(canLeave(lineGroup)).toBe(false);
    expect(canDelete(lineGroup)).toBe(false);
  });

  test('manual group allows all actions', () => {
    for (const g of [manualGroup, manualGroup2]) {
      expect(isLineGroup(g)).toBe(false);
      expect(canInvite(g)).toBe(true);
      expect(canLeave(g)).toBe(true);
      expect(canDelete(g)).toBe(true);
    }
  });

  test('null lineGroupId is treated as manual', () => {
    expect(isLineGroup({ lineGroupId: null })).toBe(false);
  });
});
