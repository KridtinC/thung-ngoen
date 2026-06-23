// Per-payer multi-select settle helpers (pure). A QR pays one recipient (the payer),
// so a settle covers a selection of that payer's unpaid (bill × payee) portions.
export interface UnpaidPortion {
  billId: string;
  payeeLineId: string;
  payeeName: string;
  billName: string;
  amount: number;
}

export interface SettleSelection {
  billId: string;
  payeeLineId: string;
  amount: number;
}

// Stable key identifying a (bill, payee) portion.
export function portionKey(p: { billId: string; payeeLineId: string }): string {
  return `${p.billId}::${p.payeeLineId}`;
}

// Default selection: the current user's own portions are pre-checked.
export function defaultSelectedKeys(portions: UnpaidPortion[], currentUserId: string): string[] {
  return portions.filter(p => p.payeeLineId === currentUserId).map(portionKey);
}

// Sum of the selected portions' amounts (rounded to 2 dp).
export function selectedTotal(portions: UnpaidPortion[], selectedKeys: string[]): number {
  const set = new Set(selectedKeys);
  const sum = portions.reduce((acc, p) => (set.has(portionKey(p)) ? acc + p.amount : acc), 0);
  return Math.round(sum * 100) / 100;
}

// The (billId, payeeLineId, amount) tuples to settle on confirm.
export function selectionsFor(portions: UnpaidPortion[], selectedKeys: string[]): SettleSelection[] {
  const set = new Set(selectedKeys);
  return portions
    .filter(p => set.has(portionKey(p)))
    .map(p => ({ billId: p.billId, payeeLineId: p.payeeLineId, amount: p.amount }));
}

// Distinct names of selected payees who are NOT the current user (for "Paying for: …").
export function payingForNames(portions: UnpaidPortion[], selectedKeys: string[], currentUserId: string): string[] {
  const set = new Set(selectedKeys);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of portions) {
    if (!set.has(portionKey(p)) || p.payeeLineId === currentUserId || seen.has(p.payeeLineId)) continue;
    seen.add(p.payeeLineId);
    names.push(p.payeeName);
  }
  return names;
}
