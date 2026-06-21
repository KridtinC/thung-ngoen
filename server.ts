import { Elysia, t, redirect } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { connectDB, User, Group, Bill, BillItem, BillPayee, IUser, IBillPayee, IBill, generateInviteCode } from './db';
import { encryptPII, decryptPII } from './lib/crypto';
import { simplifyDebts } from './lib/settle';

// PII encryption helpers (AES-256-GCM) live in ./lib/crypto (shared with tests).

// ----------------------------------------------------
// R2 Object Storage (Cloudflare) — for payment slip uploads
// Uses Bun's built-in S3-compatible client. Disabled if env vars are missing.
// ----------------------------------------------------
const r2Enabled = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);
const r2 = r2Enabled
  ? new Bun.S3Client({
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucket: process.env.R2_BUCKET!,
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: 'auto',
    })
  : null;
console.log(r2Enabled ? '🪣 R2 slip storage enabled' : '⚠️ R2 slip storage NOT configured');

// Connect to Database
await connectDB();

// Daily reminder at 08:00 Bangkok time — sends to all LINE-synced groups with unpaid bills
let lastDailyReminderDate = '';
setInterval(async () => {
  try {
    const bangkokNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const hour = bangkokNow.getHours();
    const todayBangkok = `${bangkokNow.getFullYear()}-${String(bangkokNow.getMonth() + 1).padStart(2, '0')}-${String(bangkokNow.getDate()).padStart(2, '0')}`;
    if (hour === 8 && todayBangkok !== lastDailyReminderDate) {
      lastDailyReminderDate = todayBangkok;
      console.log(`⏰ Daily reminder job running for ${todayBangkok}`);
      const liffId = process.env.LINE_LIFF_ID || '';
      const groups = await Group.find({ lineGroupId: { $exists: true, $ne: '' } });
      for (const group of groups) {
        await sendGroupReminders(group, liffId).catch(err => console.error(`Reminder failed for ${group.name}:`, err));
      }
    }
  } catch (err) {
    console.error('Daily reminder cron error:', err);
  }
}, 60_000);

// ----------------------------------------------------
// LINE push helper
// ----------------------------------------------------
async function linePush(to: string, messages: any[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !to) return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ to, messages })
  }).catch(err => console.error('linePush error:', err));
}

// Thai short-month date format, e.g. "14 มิ.ย."
function formatDateThai(dateStr: string): string {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

// Build a Flex bubble summarising ALL unpaid bills on one date
function buildDayReminderBubble(
  dateStr: string,
  billSummaries: { name: string; totalAmount: number; payer: string; unpaidPayees: { displayName: string; amount: number }[] }[],
  liffId: string,
  inviteCode: string
): any {
  const dateLabel = formatDateThai(dateStr);
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

// Collect unpaid bill summaries for a group (optionally filtered to one date)
// and push the Flex Message to the LINE group. Returns { sent, dateCount }.
async function sendGroupReminders(group: any, liffId: string, targetDate?: string): Promise<{ sent: boolean; dateCount?: number; reason?: string }> {
  const query: any = { groupId: group._id, status: { $ne: 'cancelled' } };
  if (targetDate) query.date = targetDate;

  const bills = await Bill.find(query).populate('payerId').sort({ date: 1 });

  // Group bills by date, keeping only those with unpaid (non-payer) payees
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
    buildDayReminderBubble(date, summaries, liffId, group.inviteCode)
  );

  const altText = targetDate
    ? `เหมียว~ ถุงเงินมาทวงค่าใช้จ่ายวันที่ ${formatDateThai(targetDate)} แล้วเมี้ยว 🐾`
    : 'เหมียว~ ถุงเงินมาทวงยอดค้างชำระแล้วเมี้ยว 🐾';

  const flexMsg = {
    type: 'flex',
    altText,
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
  };

  if (group.lineGroupId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    await linePush(group.lineGroupId, [flexMsg]);
    console.log(`📢 Sent reminder → "${group.name}" (${bubbles.length} date(s))`);
  } else {
    console.log(`📢 [Simulated] Reminder for "${group.name}":`, JSON.stringify(flexMsg, null, 2));
  }

  return { sent: true, dateCount: bubbles.length };
}

// ----------------------------------------------------
// LINE API Helpers
// ----------------------------------------------------
async function lineGet(path: string) {
  const res = await fetch(`https://api.line.me${path}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!res.ok) {
    console.error(`[LINE API] ${res.status} ${res.statusText} — GET ${path}`);
    return null;
  }
  return res.json();
}

// Resolve a group by any public key: LINE group ID, invite code, or Mongo _id.
// `populate` optionally populates the members field.
async function resolveGroup(key: string, populate = false) {
  let q = Group.findOne({ lineGroupId: key });
  if (populate) q = q.populate('members');
  let group = await q;
  if (group) return group;

  q = Group.findOne({ inviteCode: key });
  if (populate) q = q.populate('members');
  group = await q;
  if (group) return group;

  if (mongoose.Types.ObjectId.isValid(key)) {
    let q2 = Group.findById(key);
    if (populate) q2 = q2.populate('members');
    group = await q2;
    if (group) return group;
  }
  return null;
}

// Fetch every member of a LINE group and upsert them into MongoDB
async function syncGroupMembers(lineGroupId: string) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return;

  try {
    // 1. Get group name
    let groupName = `Group (${lineGroupId.substring(0, 8)})`;
    const summary = await lineGet(`/v2/bot/group/${lineGroupId}/summary`) as any;
    if (summary?.groupName) groupName = summary.groupName;

    // 2. Collect all member user IDs (paginated)
    const userIds: string[] = [];
    let nextToken: string | undefined;
    do {
      const url = `/v2/bot/group/${lineGroupId}/members/ids${nextToken ? `?start=${nextToken}` : ''}`;
      const page = await lineGet(url) as any;
      if (!page) break;
      userIds.push(...(page.memberIds || []));
      nextToken = page.next;
    } while (nextToken);

    // 3. Upsert each user profile
    const memberIds: mongoose.Types.ObjectId[] = [];
    for (const userId of userIds) {
      const profile = await lineGet(`/v2/bot/group/${lineGroupId}/member/${userId}`) as any;
      if (!profile) continue;
      const user = await User.findOneAndUpdate(
        { lineId: userId },
        { displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
        { upsert: true, new: true }
      );
      memberIds.push(user._id as mongoose.Types.ObjectId);
    }

    // 4. Create or update the group record
    let group = await Group.findOne({ lineGroupId });
    if (!group) {
      await Group.create({ lineGroupId, name: groupName, members: memberIds });
    } else {
      group.name = groupName;
      const existing = new Set((group.members as any[]).map((m: any) => m.toString()));
      for (const id of memberIds) {
        if (!existing.has(id.toString())) (group.members as any[]).push(id);
      }
      await group.save();
    }
    console.log(`✅ Synced ${memberIds.length} members for group: ${groupName}`);
  } catch (err) {
    console.error('syncGroupMembers error:', err);
  }
}

const app = new Elysia()
  // Serve index.html explicitly with no-cache headers so LINE WebView never serves stale HTML
  .get('/', ({ set }) => {
    set.headers['Cache-Control'] = 'no-store, must-revalidate';
    set.headers['Content-Type'] = 'text/html; charset=utf-8';
    return readFileSync('./public/index.html');
  })
  .get('/index.html', ({ set }) => {
    set.headers['Cache-Control'] = 'no-store, must-revalidate';
    set.headers['Content-Type'] = 'text/html; charset=utf-8';
    return readFileSync('./public/index.html');
  })

  // Serve remaining static assets (CSS, JS, images) — versioned via ?v= so browser cache is fine
  .use(staticPlugin({
    assets: 'public',
    prefix: '',
  }))

  // ----------------------------------------------------
  // LINE Webhook Endpoint
  // ----------------------------------------------------
  .post('/webhook', async ({ body, set }) => {
    try {
      const events = (body as any).events || [];
      for (const event of events) {
        // Bot joined a group — create the group record (can't list members without special LINE permission)
        if (event.type === 'join' && event.source.groupId) {
          const lineGroupId = event.source.groupId;
          console.log(`🤝 Bot joined group: ${lineGroupId}`);
          let grp = await Group.findOne({ lineGroupId });
          if (!grp) {
            let gName = `Group (${lineGroupId.substring(0, 8)})`;
            const summary = await lineGet(`/v2/bot/group/${lineGroupId}/summary`) as any;
            if (summary?.groupName) gName = summary.groupName;
            await Group.create({ lineGroupId, name: gName, members: [] });
            console.log(`✅ Created group record: ${gName}`);
          }
        }

        // New member(s) joined the group — add them right away
        if (event.type === 'memberJoined' && event.source.groupId) {
          const lineGroupId = event.source.groupId;
          const joined: any[] = event.joined?.members || [];
          console.log(`➕ ${joined.length} member(s) joined group: ${lineGroupId}`);
          for (const member of joined) {
            if (member.type !== 'user') continue;
            const profile = await lineGet(`/v2/bot/group/${lineGroupId}/member/${member.userId}`) as any;
            if (!profile) continue;
            const user = await User.findOneAndUpdate(
              { lineId: member.userId },
              { displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
              { upsert: true, new: true }
            );
            let group = await Group.findOne({ lineGroupId });
            if (!group) {
              await Group.create({ lineGroupId, name: `Group (${lineGroupId.substring(0, 8)})`, members: [user._id] });
            } else {
              const isMember = (group.members as any[]).some(m => m.toString() === (user._id as any).toString());
              if (!isMember) {
                (group.members as any[]).push(user._id);
                await group.save();
              }
            }
            console.log(`✅ Added member: ${profile.displayName}`);
          }
        }

        if (event.type === 'message' && event.message.type === 'text') {
          const text = event.message.text.trim();
          const source = event.source || {};

          // Auto-register EVERY group message sender using the individual profile endpoint
          // (bulk member-list API requires special LINE approval; individual profile always works)
          if (source.groupId && source.userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
            try {
              const profile = await lineGet(`/v2/bot/group/${source.groupId}/member/${source.userId}`) as any;
              if (profile) {
                const user = await User.findOneAndUpdate(
                  { lineId: source.userId },
                  { displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
                  { upsert: true, new: true }
                );
                let grp = await Group.findOne({ lineGroupId: source.groupId });
                if (!grp) {
                  // Fetch group name from LINE API
                  let gName = `Group (${source.groupId.substring(0, 8)})`;
                  const summary = await lineGet(`/v2/bot/group/${source.groupId}/summary`) as any;
                  if (summary?.groupName) gName = summary.groupName;
                  await Group.create({ lineGroupId: source.groupId, name: gName, members: [user._id] });
                } else {
                  const isMember = (grp.members as any[]).some(m => m.toString() === (user._id as any).toString());
                  if (!isMember) {
                    (grp.members as any[]).push(user._id);
                    await grp.save();
                    console.log(`➕ Auto-registered ${profile.displayName} into group`);
                  }
                }
              }
            } catch (err) {
              console.error('Auto-register sender error:', err);
            }
          }

          if (text.includes('ถุงเงิน')) {
            const replyToken = event.replyToken;
            // Extract LINE Group ID or default to User ID
            const lineGroupId = source.groupId || source.roomId || source.userId || 'g-test';

            // Check if group exists in database, if not create it
            let group = await Group.findOne({ lineGroupId }).populate('members');
            if (!group) {
              // Get or create a mock user for the creator if needed
              let defaultUser = await User.findOne({ lineId: source.userId || 'u-kan' });
              if (!defaultUser) {
                defaultUser = await User.create({
                  lineId: source.userId || 'u-kan',
                  displayName: 'User_' + (source.userId ? source.userId.substring(0, 5) : 'New'),
                  pictureUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=new'
                });
              }

              group = await Group.create({
                lineGroupId,
                name: source.groupId ? `Group (${lineGroupId.substring(0, 6)})` : 'Personal Chat',
                members: [defaultUser._id]
              });
            }

            // Construct Flex Message
            const flexMessage = {
              type: 'flex',
              altText: 'เหมียว~ ถุงเงินมาแล้วเมี้ยว! เดี๋ยวช่วยเก็บเงินให้เอง 🐾',
              contents: {
                type: 'bubble',
                hero: {
                  type: 'image',
                  url: 'https://thung-ngoen.fly.dev/hero.png',
                  size: 'full',
                  aspectRatio: '16:9',
                  aspectMode: 'cover'
                },
                body: {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    {
                      type: 'text',
                      text: '🐱 ถุงเงิน (Thung Ngoen)',
                      weight: 'bold',
                      size: 'xl',
                      color: '#129cb4'
                    },
                    {
                      type: 'text',
                      text: 'เหมียว~ ช่วยหารค่าใช้จ่าย สะดวก รวดเร็ว สรุปยอดทันทีเมี้ยว! 🐾',
                      size: 'xs',
                      color: '#aaaaaa',
                      wrap: true,
                      margin: 'md'
                    }
                  ]
                },
                footer: {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'sm',
                  contents: [
                    {
                      type: 'button',
                      style: 'primary',
                      color: '#129cb4',
                      action: {
                        type: 'uri',
                        label: 'เปิดถุงเงิน 🐾',
                        uri: `https://liff.line.me/${process.env.LINE_LIFF_ID || 'mock-liff-id'}`
                      }
                    }
                  ]
                }
              }
            };

            // Send reply using LINE API if token is configured
            if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
              await fetch('https://api.line.me/v2/bot/message/reply', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                },
                body: JSON.stringify({
                  replyToken,
                  messages: [flexMessage]
                })
              });
            } else {
              console.log('🤖 Simulated Bot Reply for group:', lineGroupId);
              console.log(JSON.stringify(flexMessage, null, 2));
            }
          }
        }
      }
      return { status: 'ok' };
    } catch (err) {
      console.error('Webhook error:', err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // ----------------------------------------------------
  // API Endpoints
  // ----------------------------------------------------

  // Health check for Fly.io (also confirms DB connection)
  .get('/health', () => ({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }))

  // Debug: check what LINE API returns for a group's member IDs
  .get('/api/debug/group/:groupId/members', async ({ params: { groupId } }) => {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return { error: 'No LINE token configured' };
    const count = await lineGet(`/v2/bot/group/${groupId}/members/count`);
    const ids = await lineGet(`/v2/bot/group/${groupId}/members/ids`);
    const summary = await lineGet(`/v2/bot/group/${groupId}/summary`);
    return { groupId, summary, memberCount: count, memberIds: ids };
  })

  // Frontend config (LIFF ID etc.)
  .get('/api/config', () => ({
    liffId: process.env.LINE_LIFF_ID || 'mock-liff-id'
  }))

  // ----------------------------------------------------
  // "My Groups" + manual group management
  // ----------------------------------------------------

  // List all groups the given LINE user is a member of
  .get('/api/users/:lineId/groups', async ({ params: { lineId }, set }) => {
    try {
      const user = await User.findOne({ lineId });
      if (!user) return { groups: [] };

      const groups = await Group.find({ members: user._id })
        .populate('members')
        .sort({ createdAt: -1 });

      return {
        groups: groups.map(g => ({
          key: g.inviteCode,           // public key used in URLs/API
          inviteCode: g.inviteCode,
          lineGroupId: g.lineGroupId || null,
          name: g.name,
          memberCount: (g.members as IUser[]).length,
          members: (g.members as IUser[]).map(m => ({
            displayName: m.displayName,
            pictureUrl: m.pictureUrl
          })),
          isLineGroup: !!g.lineGroupId
        }))
      };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Create a new manual group; the creator becomes the first member
  .post('/api/groups', async ({ body, set }) => {
    try {
      const { name, lineId, displayName, pictureUrl } = body as any;
      if (!name || !name.trim() || !lineId || !displayName) {
        set.status = 400;
        return { error: 'name, lineId and displayName are required' };
      }

      const creator = await User.findOneAndUpdate(
        { lineId },
        { displayName, pictureUrl: pictureUrl || '' },
        { upsert: true, new: true }
      );

      // Generate a unique invite code (retry on the rare collision)
      let inviteCode = generateInviteCode();
      for (let i = 0; i < 5; i++) {
        const clash = await Group.findOne({ inviteCode });
        if (!clash) break;
        inviteCode = generateInviteCode();
      }

      const group = await Group.create({
        inviteCode,
        name: name.trim(),
        members: [creator._id],
        createdBy: creator._id
      });

      return { success: true, key: group.inviteCode, inviteCode: group.inviteCode, name: group.name };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Join a group via its invite code (or any group key)
  .post('/api/groups/:groupId/join', async ({ params: { groupId }, body, set }) => {
    try {
      const { lineId, displayName, pictureUrl } = body as any;
      if (!lineId || !displayName) {
        set.status = 400;
        return { error: 'lineId and displayName are required' };
      }

      const group = await resolveGroup(groupId);
      if (!group) {
        set.status = 404;
        return { error: 'Group not found' };
      }

      const user = await User.findOneAndUpdate(
        { lineId },
        { displayName, pictureUrl: pictureUrl || '' },
        { upsert: true, new: true }
      );

      const isMember = (group.members as any[]).some(
        m => m.toString() === (user._id as any).toString()
      );
      if (!isMember) {
        (group.members as any[]).push(user._id);
        await group.save();
        console.log(`➕ ${displayName} joined "${group.name}" via invite`);
      }

      return { success: true, key: group.inviteCode, name: group.name };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Register a user into a group (called when LIFF opens)
  .post('/api/groups/:groupId/members', async ({ params: { groupId }, body, set }) => {
    try {
      const { lineId, displayName, pictureUrl } = body as any;
      if (!lineId || !displayName) {
        set.status = 400;
        return { error: 'lineId and displayName are required' };
      }

      // Upsert user — update display name / picture if they changed
      const user = await User.findOneAndUpdate(
        { lineId },
        { displayName, pictureUrl },
        { upsert: true, new: true }
      );

      // Use resolveGroup so an existing group is found whether the caller
      // passes a lineGroupId, an inviteCode, or a Mongo _id.
      let group = await resolveGroup(groupId);
      if (!group) {
        // No matching group — create one keyed by this LINE group ID
        let groupName = `Group (${groupId.substring(0, 8)})`;
        if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
          try {
            const r = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
              headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
            });
            if (r.ok) {
              const g = await r.json() as any;
              groupName = g.groupName || groupName;
            }
          } catch (_) {}
        }
        group = await Group.create({
          lineGroupId: groupId,
          name: groupName,
          members: [user._id]
        });
      } else {
        // Found via inviteCode / _id — backfill lineGroupId if it looks like a real LINE group ID
        // and the group doesn't already have one (links a manual group to its LINE chat).
        if (!group.lineGroupId && /^C[0-9a-f]{32}$/.test(groupId)) {
          group.lineGroupId = groupId;
        }
        const isMember = (group.members as any[]).some(
          m => m.toString() === (user._id as any).toString()
        );
        if (!isMember) {
          (group.members as any[]).push(user._id);
        }
        await group.save();
      }

      // Return the canonical invite code so the frontend can use a stable key
      return { success: true, key: group.inviteCode };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Get Group Details and Net Balances
  .get('/api/groups/:groupId', async ({ params: { groupId }, set }) => {
    try {
      // Resolve by LINE group ID, invite code, or Mongo _id
      const group = await resolveGroup(groupId, true);

      if (!group) {
        set.status = 404;
        return { error: 'Group not found' };
      }

      // Fetch all bills for this group that are not cancelled
      const bills = await Bill.find({ groupId: group._id, status: { $ne: 'cancelled' } });
      const billIds = bills.map(b => b._id);

      // Fetch all unpaid bill payees for these bills
      const unpaidPayees = await BillPayee.find({
        billId: { $in: billIds },
        status: 'unpaid'
      }).populate('payeeId');

      // Calculate net balances: who owes how much
      const balanceMap: { [userId: string]: number } = {};
      const members = group.members as IUser[];
      
      // Initialize balances
      for (const member of members) {
        balanceMap[member._id.toString()] = 0;
      }

      // Compute balances
      for (const payee of unpaidPayees) {
        const bill = bills.find(b => b._id.toString() === payee.billId.toString());
        if (bill) {
          const debtorId = payee.payeeId._id.toString();
          const creditorId = bill.payerId.toString();
          
          if (debtorId !== creditorId) {
            balanceMap[debtorId] -= payee.amount;
            balanceMap[creditorId] += payee.amount;
          }
        }
      }

      // Simplify debts into the minimal set of transfers (pure helper, unit-tested)
      const transactions = simplifyDebts(
        members.map(m => ({ id: m._id.toString(), name: m.displayName })),
        balanceMap
      );

      // Decrypt PII fields before sending to client
      const groupObj = group.toObject();
      for (const member of groupObj.members as any[]) {
        if (member.promptPay) member.promptPay = decryptPII(member.promptPay);
      }

      return {
        group: groupObj,
        netBalances: members.map(m => ({
          userId: m._id,
          displayName: m.displayName,
          pictureUrl: m.pictureUrl,
          balance: parseFloat((balanceMap[m._id.toString()] || 0).toFixed(2))
        })),
        settlementTransactions: transactions
      };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Get Bills grouped by Day for a Group
  .get('/api/groups/:groupId/bills', async ({ params: { groupId }, set }) => {
    try {
      const group = await resolveGroup(groupId);

      if (!group) {
        set.status = 404;
        return { error: 'Group not found' };
      }

      // Fetch all bills populated with payer
      const bills = await Bill.find({ groupId: group._id })
        .populate('payerId')
        .populate('createdById')
        .sort({ date: -1, createdAt: -1 });

      const billIds = bills.map(b => b._id);
      
      // Fetch all payees populated with user info
      const payees = await BillPayee.find({ billId: { $in: billIds } }).populate('payeeId');
      
      // Fetch all items for manual bills
      const items = await BillItem.find({ billId: { $in: billIds } });

      // Group bills by day
      const dailyGroups: { [date: string]: { date: string; bills: any[]; totalAmount: number; payerSummaries: any[] } } = {};

      for (const bill of bills) {
        const dateStr = bill.date;
        if (!dailyGroups[dateStr]) {
          dailyGroups[dateStr] = {
            date: dateStr,
            bills: [],
            totalAmount: 0,
            payerSummaries: []
          };
        }

        const billPayees = payees.filter(p => p.billId.toString() === bill._id.toString());
        const billItems = items.filter(i => i.billId.toString() === bill._id.toString());

        const billJSON = bill.toJSON() as any;
        if (billJSON.payerId?.promptPay) billJSON.payerId.promptPay = decryptPII(billJSON.payerId.promptPay);

        const billPayeesPlain = billPayees.map((p: any) => {
          const plain = p.toObject ? p.toObject() : { ...p };
          if (plain.payeeId?.promptPay) plain.payeeId.promptPay = decryptPII(plain.payeeId.promptPay);
          return plain;
        });

        const billData = {
          ...billJSON,
          payees: billPayeesPlain,
          items: billItems
        };

        if (bill.status !== 'cancelled') {
          dailyGroups[dateStr].totalAmount += bill.totalAmount;
        }
        dailyGroups[dateStr].bills.push(billData);
      }

      // Format output list and compute payer daily summaries
      const result = Object.values(dailyGroups).map(dayGroup => {
        const payersMap: { [payerId: string]: { displayName: string; pictureUrl: string; totalPaid: number } } = {};
        
        for (const bill of dayGroup.bills) {
          if (bill.status === 'cancelled') continue;
          
          const payer = bill.payerId as any as IUser;
          const payerIdStr = payer._id.toString();

          if (!payersMap[payerIdStr]) {
            payersMap[payerIdStr] = {
              displayName: payer.displayName,
              pictureUrl: payer.pictureUrl,
              totalPaid: 0
            };
          }
          payersMap[payerIdStr].totalPaid += bill.totalAmount;
        }

        return {
          ...dayGroup,
          totalAmount: parseFloat(dayGroup.totalAmount.toFixed(2)),
          payerSummaries: Object.entries(payersMap).map(([payerId, data]) => ({
            payerId,
            displayName: data.displayName,
            pictureUrl: data.pictureUrl,
            totalPaid: parseFloat(data.totalPaid.toFixed(2))
          }))
        };
      });

      return result;
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Create a new Bill
  .post('/api/bills', async ({ body, set }) => {
    try {
      const b = body as any;
      const {
        name,
        date,
        payerLineId,
        creatorLineId,
        splitMethod,
        vatPercent = 0,
        serviceChargePercent = 0
      } = b;

      // Find group (accepts LINE group ID, invite code, or _id)
      const group = await resolveGroup(b.groupKey || b.lineGroupId);
      if (!group) {
        set.status = 404;
        return { error: 'Group not found' };
      }

      // Find payer
      const payer = await User.findOne({ lineId: payerLineId });
      if (!payer) {
        set.status = 404;
        return { error: 'Payer not found' };
      }
      if (!payer.promptPay) {
        set.status = 400;
        return { error: `${payer.displayName} has not set up PromptPay yet.` };
      }

      let subtotal = 0;
      let totalAmount = 0;
      let billPayeeEntries: { payeeId: mongoose.Types.ObjectId; amount: number }[] = [];
      let manualItemsToCreate: { name: string; price: number; payeeIds: mongoose.Types.ObjectId[] }[] = [];

      // Pro-rate factor: Service charge then VAT
      const vatVal = parseFloat(vatPercent) || 0;
      const scVal = parseFloat(serviceChargePercent) || 0;
      const discountVal = Math.max(0, parseFloat(b.discountAmount) || 0);
      const taxFactor = (1 + scVal / 100) * (1 + vatVal / 100);

      if (splitMethod === 'equal') {
        const baseAmount = parseFloat(b.subtotal);
        if (isNaN(baseAmount) || baseAmount <= 0) {
          set.status = 400;
          return { error: 'Invalid bill subtotal' };
        }

        subtotal = baseAmount;
        const effectiveSubtotal = Math.max(0, subtotal - discountVal);
        totalAmount = parseFloat((effectiveSubtotal * taxFactor).toFixed(2));
        
        const payeeLineIds = b.payeeLineIds || [];
        if (payeeLineIds.length === 0) {
          set.status = 400;
          return { error: 'At least one payee is required' };
        }

        // Resolve payees to Mongo ObjectIds
        const payees = await User.find({ lineId: { $in: payeeLineIds } });
        const share = parseFloat((totalAmount / payees.length).toFixed(2));

        for (const payee of payees) {
          billPayeeEntries.push({
            payeeId: payee._id as any,
            amount: share
          });
        }
      } else if (splitMethod === 'manual') {
        const items = b.items || [];
        if (items.length === 0) {
          set.status = 400;
          return { error: 'At least one item is required for manual split' };
        }

        // Keep track of total share per payee
        const payeeSharesMap: { [payeeId: string]: number } = {};

        for (const item of items) {
          const itemPrice = parseFloat(item.price);
          if (isNaN(itemPrice) || itemPrice <= 0) {
            set.status = 400;
            return { error: `Invalid price for item: ${item.name}` };
          }
          subtotal += itemPrice;

          const itemPayeeLineIds = item.payeeLineIds || [];
          if (itemPayeeLineIds.length === 0) {
            set.status = 400;
            return { error: `Item "${item.name}" must have at least one payee` };
          }

          const itemPayees = await User.find({ lineId: { $in: itemPayeeLineIds } });
          const itemPayeeIds = itemPayees.map(p => p._id as any);
          const itemShare = itemPrice / itemPayeeIds.length;

          for (const pid of itemPayeeIds) {
            const pidStr = pid.toString();
            payeeSharesMap[pidStr] = (payeeSharesMap[pidStr] || 0) + itemShare;
          }

          manualItemsToCreate.push({
            name: item.name,
            price: itemPrice,
            payeeIds: itemPayeeIds
          });
        }

        const discountRatio = subtotal > 0 ? Math.max(0, subtotal - discountVal) / subtotal : 1;
        totalAmount = parseFloat((subtotal * discountRatio * taxFactor).toFixed(2));

        // Create individual payee settlements with discount + tax pro-rated
        for (const [pidStr, baseShare] of Object.entries(payeeSharesMap)) {
          billPayeeEntries.push({
            payeeId: new mongoose.Types.ObjectId(pidStr),
            amount: parseFloat((baseShare * discountRatio * taxFactor).toFixed(2))
          });
        }
      } else {
        set.status = 400;
        return { error: 'Invalid split method' };
      }

      // Resolve bill creator (falls back to payer if not provided)
      const creator = creatorLineId ? await User.findOne({ lineId: creatorLineId }) : null;

      // Create Bill in Database
      const newBill = await Bill.create({
        groupId: group._id,
        name,
        date,
        payerId: payer._id,
        createdById: creator?._id ?? payer._id,
        subtotal: parseFloat(subtotal.toFixed(2)),
        discountAmount: parseFloat(discountVal.toFixed(2)),
        vatPercent: vatVal,
        serviceChargePercent: scVal,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        splitMethod,
        status: 'unpaid'
      });

      // Save Bill Items if manual split
      if (splitMethod === 'manual') {
        for (const itemData of manualItemsToCreate) {
          await BillItem.create({
            billId: newBill._id,
            ...itemData
          });
        }
      }

      // Save Bill Payees — payer's own share is pre-marked paid (they already fronted the money)
      for (const payeeEntry of billPayeeEntries) {
        const isPayerOwnShare = payeeEntry.payeeId.toString() === (payer._id as any).toString();
        await BillPayee.create({
          billId: newBill._id,
          payeeId: payeeEntry.payeeId,
          amount: payeeEntry.amount,
          status: isPayerOwnShare ? 'paid' : 'unpaid'
        });
      }

      return {
        success: true,
        billId: newBill._id,
        totalAmount
      };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Mark payee portion as Paid
  // Upload a payment slip image to R2. Returns the stored object key.
  .post('/api/slips', async ({ body, set }) => {
    if (!r2) { set.status = 503; return { error: 'Slip storage is not configured.' }; }
    try {
      const file = (body as any).slip as File | undefined;
      if (!file || typeof file.arrayBuffer !== 'function') {
        set.status = 400;
        return { error: 'No slip file provided.' };
      }
      if (file.size > 8 * 1024 * 1024) {
        set.status = 413;
        return { error: 'Slip image too large (max 8MB).' };
      }
      const type = file.type || 'image/jpeg';
      if (!type.startsWith('image/')) {
        set.status = 400;
        return { error: 'Slip must be an image.' };
      }
      const ext = (file.name?.split('.').pop() || type.split('/')[1] || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `slips/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
      await r2.write(key, await file.arrayBuffer(), { type });
      return { key };
    } catch (err) {
      console.error('Slip upload error:', err);
      set.status = 500;
      return { error: 'Failed to upload slip.' };
    }
  })

  // Stream a slip by redirecting to a short-lived presigned R2 URL.
  // Used as an <img src>; bucket stays private.
  .get('/api/slip', ({ query, set }) => {
    if (!r2) { set.status = 503; return 'Slip storage is not configured.'; }
    const key = (query as any).key as string;
    if (!key || !key.startsWith('slips/')) { set.status = 400; return 'Invalid key.'; }
    const url = r2.presign(key, { expiresIn: 3600, method: 'GET' });
    return redirect(url);
  })

  .post('/api/bills/:id/pay', async ({ params: { id }, body, set }) => {
    try {
      const { payeeLineId, slipKey } = body as any;

      const payee = await User.findOne({ lineId: payeeLineId });
      if (!payee) {
        set.status = 404;
        return { error: 'Payee not found' };
      }

      const bill = await Bill.findById(id).populate('payerId');
      if (!bill) {
        set.status = 404;
        return { error: 'Bill not found' };
      }

      // Update payee status (and attach slip if one was uploaded)
      await BillPayee.updateOne(
        { billId: bill._id, payeeId: payee._id },
        { status: 'paid', ...(slipKey ? { slipKey } : {}) }
      );

      // Check if all payees of this bill have paid
      const unpaidPayeesCount = await BillPayee.countDocuments({
        billId: bill._id,
        status: 'unpaid'
      });

      let billFullyPaid = false;
      if (unpaidPayeesCount === 0) {
        bill.status = 'paid';
        await bill.save();
        billFullyPaid = true;
      }

      // Push LINE notification to the group
      const group = await Group.findById(bill.groupId);
      if (group?.lineGroupId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        const payer = bill.payerId as any as IUser;
        const payeeEntry = await BillPayee.findOne({ billId: bill._id, payeeId: payee._id });
        const amount = payeeEntry?.amount ?? 0;

        let msgText = `✅ ${payee.displayName} จ่ายแล้ว ${amount.toFixed(2)} บาท ให้ ${payer.displayName} เมี้ยว~ 🐾`;
        if (billFullyPaid) {
          msgText += `\n🏆 บิล "${bill.name}" จ่ายครบแล้วเมี้ยว! 🐾`;
        }
        await linePush(group.lineGroupId, [{ type: 'text', text: msgText }]);
      }

      return { success: true, billStatus: bill.status };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Cancel a Bill
  .post('/api/bills/:id/cancel', async ({ params: { id }, set }) => {
    try {
      const bill = await Bill.findById(id);
      if (!bill) {
        set.status = 404;
        return { error: 'Bill not found' };
      }

      bill.status = 'cancelled';
      await bill.save();

      // Cancel payees too
      await BillPayee.updateMany(
        { billId: bill._id },
        { status: 'paid' } // Set paid to clear net balance computations
      );

      return { success: true };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Edit a Bill (name, date, payer, amounts) — only while unpaid
  .patch('/api/bills/:id', async ({ params: { id }, body, set }) => {
    try {
      const b = body as any;
      const bill = await Bill.findById(id);
      if (!bill) { set.status = 404; return { error: 'Bill not found' }; }
      if (bill.status !== 'unpaid') { set.status = 400; return { error: 'Only unpaid bills can be edited' }; }

      const { name, date, payerLineId, splitMethod, vatPercent = 0, serviceChargePercent = 0 } = b;
      const payer = await User.findOne({ lineId: payerLineId });
      if (!payer) { set.status = 404; return { error: 'Payer not found' }; }
      if (!payer.promptPay) { set.status = 400; return { error: `${payer.displayName} has not set up PromptPay yet.` }; }

      let subtotal = 0;
      let totalAmount = 0;
      let billPayeeEntries: { payeeId: mongoose.Types.ObjectId; amount: number }[] = [];
      let manualItemsToCreate: { name: string; price: number; payeeIds: mongoose.Types.ObjectId[] }[] = [];

      const vatVal = parseFloat(vatPercent) || 0;
      const scVal = parseFloat(serviceChargePercent) || 0;
      const discountVal = Math.max(0, parseFloat(b.discountAmount) || 0);
      const taxFactor = (1 + scVal / 100) * (1 + vatVal / 100);

      if (splitMethod === 'equal') {
        const baseAmount = parseFloat(b.subtotal);
        if (isNaN(baseAmount) || baseAmount <= 0) { set.status = 400; return { error: 'Invalid bill subtotal' }; }
        subtotal = baseAmount;
        const effectiveSubtotal = Math.max(0, subtotal - discountVal);
        totalAmount = parseFloat((effectiveSubtotal * taxFactor).toFixed(2));
        const payeeLineIds = b.payeeLineIds || [];
        if (payeeLineIds.length === 0) { set.status = 400; return { error: 'At least one payee is required' }; }
        const payees = await User.find({ lineId: { $in: payeeLineIds } });
        const share = parseFloat((totalAmount / payees.length).toFixed(2));
        for (const payee of payees) billPayeeEntries.push({ payeeId: payee._id as any, amount: share });

      } else if (splitMethod === 'manual') {
        const items = b.items || [];
        if (items.length === 0) { set.status = 400; return { error: 'At least one item is required' }; }
        const payeeSharesMap: { [k: string]: number } = {};
        for (const item of items) {
          const itemPrice = parseFloat(item.price);
          if (isNaN(itemPrice) || itemPrice <= 0) { set.status = 400; return { error: `Invalid price for item: ${item.name}` }; }
          subtotal += itemPrice;
          const itemPayeeLineIds = item.payeeLineIds || [];
          if (itemPayeeLineIds.length === 0) { set.status = 400; return { error: `Item "${item.name}" must have at least one payee` }; }
          const itemPayees = await User.find({ lineId: { $in: itemPayeeLineIds } });
          const itemPayeeIds = itemPayees.map(p => p._id as any);
          const itemShare = itemPrice / itemPayeeIds.length;
          for (const pid of itemPayeeIds) {
            const s = pid.toString();
            payeeSharesMap[s] = (payeeSharesMap[s] || 0) + itemShare;
          }
          manualItemsToCreate.push({ name: item.name, price: itemPrice, payeeIds: itemPayeeIds });
        }
        const discountRatio = subtotal > 0 ? Math.max(0, subtotal - discountVal) / subtotal : 1;
        totalAmount = parseFloat((subtotal * discountRatio * taxFactor).toFixed(2));
        for (const [pidStr, baseShare] of Object.entries(payeeSharesMap)) {
          billPayeeEntries.push({
            payeeId: new mongoose.Types.ObjectId(pidStr),
            amount: parseFloat((baseShare * discountRatio * taxFactor).toFixed(2))
          });
        }
      } else {
        set.status = 400;
        return { error: 'Invalid split method' };
      }

      // Update the bill fields
      bill.name = name;
      bill.date = date;
      bill.payerId = payer._id as any;
      bill.subtotal = parseFloat(subtotal.toFixed(2));
      bill.discountAmount = parseFloat(discountVal.toFixed(2));
      bill.vatPercent = vatVal;
      bill.serviceChargePercent = scVal;
      bill.totalAmount = parseFloat(totalAmount.toFixed(2));
      bill.splitMethod = splitMethod;
      await bill.save();

      // Replace payees and items
      await BillPayee.deleteMany({ billId: bill._id });
      await BillItem.deleteMany({ billId: bill._id });

      if (splitMethod === 'manual') {
        for (const itemData of manualItemsToCreate) {
          await BillItem.create({ billId: bill._id, ...itemData });
        }
      }

      for (const payeeEntry of billPayeeEntries) {
        const isPayerOwnShare = payeeEntry.payeeId.toString() === (payer._id as any).toString();
        await BillPayee.create({
          billId: bill._id,
          payeeId: payeeEntry.payeeId,
          amount: payeeEntry.amount,
          status: isPayerOwnShare ? 'paid' : 'unpaid'
        });
      }

      return { success: true };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Cancel all unpaid bills for a group on a given date
  .post('/api/groups/:groupId/bills/cancel-day', async ({ params: { groupId }, body, set }) => {
    try {
      const { date } = body as { date: string };
      const group = await resolveGroup(groupId);
      if (!group) { set.status = 404; return { error: 'Group not found' }; }

      const bills = await Bill.find({ groupId: group._id, date, status: 'unpaid' });
      for (const bill of bills) {
        bill.status = 'cancelled';
        await bill.save();
        await BillPayee.updateMany({ billId: bill._id }, { status: 'paid' });
      }

      return { success: true, cancelledCount: bills.length };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Get user profile (including decrypted promptPay)
  .get('/api/users/:lineId', async ({ params: { lineId }, set }) => {
    try {
      const user = await User.findOne({ lineId });
      if (!user) { set.status = 404; return { error: 'User not found' }; }
      const u = user.toObject() as any;
      if (u.promptPay) u.promptPay = decryptPII(u.promptPay);
      return { user: u };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Set user's PromptPay information
  .post('/api/users/:lineId/payment-info', async ({ params: { lineId }, body, set }) => {
    try {
      const { promptPay } = body as any;
      
      const user = await User.findOneAndUpdate(
        { lineId },
        { promptPay: promptPay ? encryptPII(promptPay.trim()) : '' },
        { new: true }
      );

      if (!user) {
        set.status = 404;
        return { error: 'User not found' };
      }

      return { success: true, user };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Leave a group
  .post('/api/groups/:groupId/leave', async ({ params: { groupId }, body, set }) => {
    try {
      const { lineId } = body as any;
      if (!lineId) { set.status = 400; return { error: 'lineId is required' }; }

      const group = await resolveGroup(groupId);
      if (!group) { set.status = 404; return { error: 'Group not found' }; }

      const user = await User.findOne({ lineId });
      if (!user) { set.status = 404; return { error: 'User not found' }; }

      const before = (group.members as any[]).length;
      group.members = (group.members as any[]).filter(
        m => m.toString() !== (user._id as any).toString()
      ) as any;
      await group.save();

      console.log(`🚪 ${user.displayName} left group "${group.name}" (${before} → ${(group.members as any[]).length} members)`);
      return { success: true };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Delete a group and all its bills/items/payees
  .delete('/api/groups/:groupId', async ({ params: { groupId }, body, set }) => {
    try {
      const { lineId } = body as any;
      if (!lineId) { set.status = 400; return { error: 'lineId is required' }; }

      const group = await resolveGroup(groupId);
      if (!group) { set.status = 404; return { error: 'Group not found' }; }

      const user = await User.findOne({ lineId });
      if (!user) { set.status = 404; return { error: 'User not found' }; }

      // Only allow a member of the group to delete it
      const isMember = (group.members as any[]).some(m => m.toString() === (user._id as any).toString());
      if (!isMember) { set.status = 403; return { error: 'You are not a member of this group' }; }

      // Cascade delete all bills and their payees/items
      const bills = await Bill.find({ groupId: group._id });
      for (const bill of bills) {
        await BillPayee.deleteMany({ billId: bill._id });
        await BillItem.deleteMany({ billId: bill._id });
      }
      await Bill.deleteMany({ groupId: group._id });
      await Group.deleteOne({ _id: group._id });

      console.log(`🗑️ ${user.displayName} deleted group "${group.name}"`);
      return { success: true };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Send Flex Message reminder for a specific date: one bubble per day summarising all unpaid bills
  .post('/api/groups/:groupId/remind-day', async ({ params: { groupId }, body, set }) => {
    try {
      const { date } = body as any;
      if (!date) { set.status = 400; return { error: 'date is required (YYYY-MM-DD)' }; }

      const group = await resolveGroup(groupId);
      if (!group) { set.status = 404; return { error: 'Group not found' }; }

      const liffId = process.env.LINE_LIFF_ID || 'mock-liff-id';
      const result = await sendGroupReminders(group, liffId, date);
      return { success: true, ...result };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Send chatbot reminder
  .post('/api/groups/:groupId/remind', async ({ params: { groupId }, body, set }) => {
    try {
      const { messageText } = body as any;

      const group = await resolveGroup(groupId, true);
      if (!group) {
        set.status = 404;
        return { error: 'Group not found' };
      }

      if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        const textMessage = { type: 'text', text: messageText };

        if (group.lineGroupId) {
          // LINE-synced group: push into the shared group chat
          console.log(`📢 Reminder → LINE group chat: ${group.lineGroupId}`);
          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({ to: group.lineGroupId, messages: [textMessage] })
          });
        } else {
          // Manual group: no shared chat — push to each member individually
          console.log(`📢 Reminder → ${(group.members as IUser[]).length} members of manual group "${group.name}"`);
          for (const member of group.members as IUser[]) {
            if (!member.lineId || member.lineId.startsWith('u-')) continue; // skip seed/mock users
            await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
              },
              body: JSON.stringify({ to: member.lineId, messages: [textMessage] })
            }).catch(err => console.error(`Push to ${member.displayName} failed:`, err));
          }
        }
      } else {
        console.log(`📢 [Simulated] Reminder for "${group.name}": ${messageText}`);
      }

      return { success: true };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return { error: 'Internal Server Error' };
    }
  })

  // Listen on port 3000, bind to all interfaces for Fly.io/Docker
  .listen({ port: 3000, hostname: '0.0.0.0' });

console.log(`🚀 Elysia Server running on http://0.0.0.0:3000`);
