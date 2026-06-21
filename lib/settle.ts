// Debt simplification — pure. Given each participant's net balance
// (positive = owed money / creditor, negative = owes money / debtor),
// produce the minimal set of transfers that settles everyone up.
export interface Participant {
  id: string;
  name: string;
}

export interface SettlementTx {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

export function simplifyDebts(
  participants: Participant[],
  balanceMap: Record<string, number>
): SettlementTx[] {
  const debtors: { id: string; balance: number; name: string }[] = [];
  const creditors: { id: string; balance: number; name: string }[] = [];

  for (const p of participants) {
    const bal = balanceMap[p.id] || 0;
    if (bal < -0.01) {
      debtors.push({ id: p.id, balance: bal, name: p.name });
    } else if (bal > 0.01) {
      creditors.push({ id: p.id, balance: bal, name: p.name });
    }
  }

  // Most-negative debtor first; most-positive creditor first.
  debtors.sort((a, b) => a.balance - b.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  const transactions: SettlementTx[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const amountToPay = Math.min(Math.abs(debtor.balance), creditor.balance);

    transactions.push({
      from: debtor.id,
      fromName: debtor.name,
      to: creditor.id,
      toName: creditor.name,
      amount: parseFloat(amountToPay.toFixed(2))
    });

    debtor.balance += amountToPay;
    creditor.balance -= amountToPay;

    if (Math.abs(debtor.balance) < 0.01) dIdx++;
    if (creditor.balance < 0.01) cIdx++;
  }

  return transactions;
}
