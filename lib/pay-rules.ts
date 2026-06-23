// Slip-gate for the QR "I have paid" confirm.
// A payment slip is required before a payee can confirm a QR (PromptPay) payment.
// The payer's manual "Mark Paid" (cash received) is a separate flow and not gated here.
export interface PayConfirmState {
  hasPromptPay: boolean; // payer has a PromptPay number (QR flow available)
  hasSlip: boolean;      // a slip image is attached
}

export function canConfirmPayment(state: PayConfirmState): boolean {
  // QR confirm is only offered when the payer has PromptPay; require a slip too.
  return state.hasPromptPay && state.hasSlip;
}
