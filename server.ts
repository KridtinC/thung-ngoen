import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import mongoose from 'mongoose';
import { connectDB, User, Group, Bill, BillItem, BillPayee, IUser, IBillPayee, IBill, generateInviteCode } from './db';
import { decryptPII } from './lib/crypto';
import { simplifyDebts } from './lib/settle';
import { slips } from './src/server/modules/slips';
import { staticRoutes } from './src/server/modules/static';
import { users } from './src/server/modules/users';
import { bills } from './src/server/modules/bills';
import { LineService } from './src/server/modules/line/service';
import { GroupService } from './src/server/modules/groups/service';

// PII encryption helpers (AES-256-GCM) live in ./lib/crypto (shared with tests).
// Slip storage (Cloudflare R2) lives in ./src/server/modules/slips.

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
        await LineService.sendGroupReminders(group, liffId).catch(err => console.error(`Reminder failed for ${group.name}:`, err));
      }
    }
  } catch (err) {
    console.error('Daily reminder cron error:', err);
  }
}, 60_000);


const app = new Elysia()
  // HTML + health/config routes (no-store index) — before staticPlugin so it wins
  .use(staticRoutes)

  // Serve remaining static assets (CSS, JS, images) — versioned via ?v= so browser cache is fine
  .use(staticPlugin({
    assets: 'public',
    prefix: '',
  }))

  // Feature modules (Elysia best practice: 1 instance = 1 controller)
  .use(slips)
  .use(users)
  .use(bills)

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
            const summary = await LineService.get(`/v2/bot/group/${lineGroupId}/summary`) as any;
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
            const profile = await LineService.get(`/v2/bot/group/${lineGroupId}/member/${member.userId}`) as any;
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
              const profile = await LineService.get(`/v2/bot/group/${source.groupId}/member/${source.userId}`) as any;
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
                  const summary = await LineService.get(`/v2/bot/group/${source.groupId}/summary`) as any;
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
  // Debug: check what LINE API returns for a group's member IDs
  .get('/api/debug/group/:groupId/members', async ({ params: { groupId } }) => {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return { error: 'No LINE token configured' };
    const count = await LineService.get(`/v2/bot/group/${groupId}/members/count`);
    const ids = await LineService.get(`/v2/bot/group/${groupId}/members/ids`);
    const summary = await LineService.get(`/v2/bot/group/${groupId}/summary`);
    return { groupId, summary, memberCount: count, memberIds: ids };
  })

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

      const group = await GroupService.resolve(groupId);
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
      let group = await GroupService.resolve(groupId);
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
      const group = await GroupService.resolve(groupId, true);

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

  // Leave a group
  .post('/api/groups/:groupId/leave', async ({ params: { groupId }, body, set }) => {
    try {
      const { lineId } = body as any;
      if (!lineId) { set.status = 400; return { error: 'lineId is required' }; }

      const group = await GroupService.resolve(groupId);
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

      const group = await GroupService.resolve(groupId);
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

      const group = await GroupService.resolve(groupId);
      if (!group) { set.status = 404; return { error: 'Group not found' }; }

      const liffId = process.env.LINE_LIFF_ID || 'mock-liff-id';
      const result = await LineService.sendGroupReminders(group, liffId, date);
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

      const group = await GroupService.resolve(groupId, true);
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
