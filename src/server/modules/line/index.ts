import { Elysia } from 'elysia';
import { User, Group, IUser } from '../../../../db';
import { LineService } from './service';
import { GroupService } from '../groups/service';

export const line = new Elysia({ name: 'line' })
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

;
