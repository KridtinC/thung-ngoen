import { Bill, BillPayee, IUser } from '../../../../db';

// ── LINE Messaging API helpers + reminder Flex builders (non-request-dependent) ──
export abstract class LineService {
  static async push(to: string, messages: any[]): Promise<void> {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !to) return;
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ to, messages })
    }).catch(err => console.error('linePush error:', err));
  }

  static async get(path: string): Promise<any> {
    const res = await fetch(`https://api.line.me${path}`, {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (!res.ok) {
      console.error(`[LINE API] ${res.status} ${res.statusText} — GET ${path}`);
      return null;
    }
    return res.json();
  }

  // Thai short-month date, e.g. "14 มิ.ย."
  static formatDateThai(dateStr: string): string {
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  // Flex bubble summarising all unpaid bills on one date
  static buildDayReminderBubble(
    dateStr: string,
    billSummaries: { name: string; totalAmount: number; payer: string; unpaidPayees: { displayName: string; amount: number }[] }[],
    liffId: string,
    inviteCode: string
  ): any {
    const dateLabel = LineService.formatDateThai(dateStr);
    const liffUrl = `https://liff.line.me/${liffId}?invite=${inviteCode}`;

    const uniquePeople = new Set<string>();
    let totalUnpaid = 0;
    billSummaries.forEach(b => b.unpaidPayees.forEach(p => { uniquePeople.add(p.displayName); totalUnpaid += p.amount; }));

    const bodyContents: any[] = [];
    billSummaries.forEach((bill, i) => {
      if (i > 0) bodyContents.push({ type: 'separator', margin: 'md' });
      bodyContents.push({
        type: 'box', layout: 'horizontal', margin: i === 0 ? 'none' : 'md',
        contents: [
          { type: 'text', text: bill.name, flex: 4, size: 'sm', weight: 'bold', color: '#333333', wrap: true },
          { type: 'text', text: `฿${bill.totalAmount.toFixed(0)}`, flex: 2, size: 'sm', align: 'end', color: '#555555' }
        ]
      });
      bodyContents.push({ type: 'text', text: `เรียกเก็บโดย ${bill.payer}`, size: 'xxs', color: '#999999', margin: 'xs' });
      bill.unpaidPayees.forEach(p => {
        bodyContents.push({
          type: 'box', layout: 'horizontal', margin: 'xs',
          contents: [
            { type: 'text', text: `❌ ${p.displayName}`, flex: 4, size: 'xs', color: '#E53935' },
            { type: 'text', text: `${p.amount.toFixed(0)}`, flex: 2, size: 'xs', align: 'end', color: '#E53935', weight: 'bold' }
          ]
        });
      });
    });

    return {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#129cb4', paddingAll: '20px',
        contents: [
          { type: 'text', text: `🐾 ${dateLabel}`, color: '#FFFFFF', size: 'xl', weight: 'bold' },
          { type: 'text', text: `${uniquePeople.size} คนยังไม่จ่ายเมี้ยว • รวม ฿${totalUnpaid.toFixed(0)}`, color: '#FFFFFFCC', size: 'xs', margin: 'sm' }
        ]
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: bodyContents },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#129cb4', action: { type: 'uri', label: 'จ่ายเงินเมี้ยว 🐾', uri: liffUrl } }]
      }
    };
  }

  // Collect unpaid bill summaries for a group (optionally one date) and push the Flex reminder.
  static async sendGroupReminders(group: any, liffId: string, targetDate?: string): Promise<{ sent: boolean; dateCount?: number; reason?: string }> {
    const query: any = { groupId: group._id, status: { $ne: 'cancelled' } };
    if (targetDate) query.date = targetDate;

    const bills = await Bill.find(query).populate('payerId').sort({ date: 1 });

    const dateMap = new Map<string, { name: string; totalAmount: number; payer: string; unpaidPayees: { displayName: string; amount: number }[] }[]>();
    for (const bill of bills) {
      const payer = bill.payerId as any as IUser;
      const unpaidEntries = await BillPayee.find({ billId: bill._id, status: 'unpaid' }).populate('payeeId');
      const unpaidPayees = unpaidEntries
        .filter((e: any) => e.payeeId._id.toString() !== (payer._id as any).toString())
        .map((e: any) => ({ displayName: e.payeeId.displayName, amount: e.amount }));
      if (unpaidPayees.length === 0) continue;
      if (!dateMap.has(bill.date)) dateMap.set(bill.date, []);
      dateMap.get(bill.date)!.push({ name: bill.name, totalAmount: bill.totalAmount, payer: payer.displayName, unpaidPayees });
    }

    if (dateMap.size === 0) return { sent: false, reason: 'All payees have already paid' };

    const bubbles = Array.from(dateMap.entries()).map(([date, summaries]) =>
      LineService.buildDayReminderBubble(date, summaries, liffId, group.inviteCode)
    );

    const altText = targetDate
      ? `เหมียว~ ถุงเงินมาทวงค่าใช้จ่ายวันที่ ${LineService.formatDateThai(targetDate)} แล้วเมี้ยว 🐾`
      : 'เหมียว~ ถุงเงินมาทวงยอดค้างชำระแล้วเมี้ยว 🐾';

    const flexMsg = {
      type: 'flex',
      altText,
      contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
    };

    if (group.lineGroupId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      await LineService.push(group.lineGroupId, [flexMsg]);
      console.log(`📢 Sent reminder → "${group.name}" (${bubbles.length} date(s))`);
    } else {
      console.log(`📢 [Simulated] Reminder for "${group.name}":`, JSON.stringify(flexMsg, null, 2));
    }

    return { sent: true, dateCount: bubbles.length };
  }
}
