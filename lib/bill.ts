// Bill money math — pure. Shared by the bills service (server) and tests.
// Mirrors the original inline logic in POST/PATCH /api/bills exactly.

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

// Service charge is applied first, then VAT on top.
export function taxFactor(serviceChargePercent: number, vatPercent: number): number {
  return (1 + serviceChargePercent / 100) * (1 + vatPercent / 100);
}

export interface EqualSplit {
  subtotal: number;
  total: number;
  share: number;
}

// Equal split: discount off the base, then tax, then divide across payees.
export function computeEqualSplit(
  baseAmount: number,
  discountAmount: number,
  serviceChargePercent: number,
  vatPercent: number,
  payeeCount: number
): EqualSplit {
  const discountVal = Math.max(0, discountAmount || 0);
  const effectiveSubtotal = Math.max(0, baseAmount - discountVal);
  const total = round2(effectiveSubtotal * taxFactor(serviceChargePercent, vatPercent));
  const share = round2(total / payeeCount);
  return { subtotal: baseAmount, total, share };
}

export interface ManualSplit {
  subtotal: number;
  total: number;
  amounts: Record<string, number>; // payeeId -> final amount (discount + tax pro-rated)
}

// Manual split: each payee's base share is pro-rated by the same discount ratio and tax factor.
export function computeManualSplit(
  payeeBaseShares: Record<string, number>,
  subtotal: number,
  discountAmount: number,
  serviceChargePercent: number,
  vatPercent: number
): ManualSplit {
  const discountVal = Math.max(0, discountAmount || 0);
  const discountRatio = subtotal > 0 ? Math.max(0, subtotal - discountVal) / subtotal : 1;
  const tf = taxFactor(serviceChargePercent, vatPercent);
  const total = round2(subtotal * discountRatio * tf);
  const amounts: Record<string, number> = {};
  for (const [pid, base] of Object.entries(payeeBaseShares)) {
    amounts[pid] = round2(base * discountRatio * tf);
  }
  return { subtotal, total, amounts };
}
