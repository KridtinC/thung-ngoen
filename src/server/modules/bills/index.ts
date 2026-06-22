import { Elysia } from 'elysia';
import mongoose from 'mongoose';
import { Bill, BillItem, BillPayee, User, Group, IUser } from '../../../../db';
import { decryptPII } from '../../../../lib/crypto';
import { computeEqualSplit, computeManualSplit } from '../../../../lib/bill';
import { GroupService } from '../groups/service';
import { LineService } from '../line/service';

export const bills = new Elysia({ name: 'bills' })
  .get('/api/groups/:groupId/bills', async ({ params: { groupId }, set }) => {
    try {
      const group = await GroupService.resolve(groupId);

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
      const group = await GroupService.resolve(b.groupKey || b.lineGroupId);
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

      // Discount / service-charge / VAT inputs (math lives in lib/bill.ts)
      const vatVal = parseFloat(vatPercent) || 0;
      const scVal = parseFloat(serviceChargePercent) || 0;
      const discountVal = Math.max(0, parseFloat(b.discountAmount) || 0);

      if (splitMethod === 'equal') {
        const baseAmount = parseFloat(b.subtotal);
        if (isNaN(baseAmount) || baseAmount <= 0) {
          set.status = 400;
          return { error: 'Invalid bill subtotal' };
        }
        subtotal = baseAmount;

        const payeeLineIds = b.payeeLineIds || [];
        if (payeeLineIds.length === 0) {
          set.status = 400;
          return { error: 'At least one payee is required' };
        }

        // Resolve payees to Mongo ObjectIds
        const payees = await User.find({ lineId: { $in: payeeLineIds } });
        const split = computeEqualSplit(baseAmount, discountVal, scVal, vatVal, payees.length);
        totalAmount = split.total;

        for (const payee of payees) {
          billPayeeEntries.push({ payeeId: payee._id as any, amount: split.share });
        }
      } else if (splitMethod === 'manual') {
        const items = b.items || [];
        if (items.length === 0) {
          set.status = 400;
          return { error: 'At least one item is required for manual split' };
        }

        // Base (pre discount/tax) share per payee, accumulated from items
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

        const split = computeManualSplit(payeeSharesMap, subtotal, discountVal, scVal, vatVal);
        totalAmount = split.total;
        for (const [pidStr, amount] of Object.entries(split.amounts)) {
          billPayeeEntries.push({
            payeeId: new mongoose.Types.ObjectId(pidStr),
            amount
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
        await LineService.push(group.lineGroupId, [{ type: 'text', text: msgText }]);
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
      const group = await GroupService.resolve(groupId);
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
;
