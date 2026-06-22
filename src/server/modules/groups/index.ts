import { Elysia } from 'elysia';
import { Bill, BillItem, BillPayee, User, Group, IUser, generateInviteCode } from '../../../../db';
import { decryptPII } from '../../../../lib/crypto';
import { simplifyDebts } from '../../../../lib/settle';
import { GroupService } from './service';
import { groupModels } from './model';

export const groups = new Elysia({ name: 'groups' })
  .use(groupModels)
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
  }, { body: 'groups.create' })

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
;
