import mongoose, { Schema, Document } from 'mongoose';

// Connect to MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI environment variable is missing!");
  console.error("Please create a .env file and set MONGODB_URI=mongodb+srv://...");
  process.exit(1);
}

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI!);
    console.log("🔌 Connected to MongoDB Atlas successfully.");
    await migrateGroupIndexes();
    await seedMockData();
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

// ----------------------------------------------------
// Interfaces
// ----------------------------------------------------
export interface IUser extends Document {
  lineId: string; // LINE User ID
  displayName: string;
  pictureUrl: string;
  promptPay?: string;
  createdAt: Date;
}

export interface IGroup extends Document {
  lineGroupId?: string; // LINE Group ID (only for groups synced from a LINE chat)
  inviteCode: string;   // Short shareable code used in invite links (all groups)
  name: string;
  members: mongoose.Types.ObjectId[] | IUser[];
  createdBy?: mongoose.Types.ObjectId; // User who created a manual group
  createdAt: Date;
}

// Generate a short, unambiguous invite code (no 0/O/1/I/l)
export function generateInviteCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export interface IBill extends Document {
  groupId: mongoose.Types.ObjectId;
  name: string;
  date: string; // YYYY-MM-DD
  payerId: mongoose.Types.ObjectId; // Who paid advanced
  createdById?: mongoose.Types.ObjectId; // Who created this bill entry
  subtotal: number;
  discountAmount: number;
  vatPercent: number;
  serviceChargePercent: number;
  totalAmount: number;
  splitMethod: 'equal' | 'manual';
  status: 'unpaid' | 'paid' | 'cancelled';
  createdAt: Date;
}

export interface IBillItem extends Document {
  billId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  payeeIds: mongoose.Types.ObjectId[];
}

export interface IBillPayee extends Document {
  billId: mongoose.Types.ObjectId;
  payeeId: mongoose.Types.ObjectId;
  amount: number;
  status: 'unpaid' | 'paid';
  slipKey?: string; // R2 object key for uploaded payment slip
}

// ----------------------------------------------------
// Schemas & Models
// ----------------------------------------------------
const UserSchema = new Schema<IUser>({
  lineId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  pictureUrl: { type: String, required: true },
  promptPay: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const GroupSchema = new Schema<IGroup>({
  lineGroupId: { type: String, unique: true, sparse: true }, // optional: manual groups have none
  inviteCode: { type: String, unique: true, default: () => generateInviteCode() },
  name: { type: String, required: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const BillSchema = new Schema<IBill>({
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
  name: { type: String, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  payerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdById: { type: Schema.Types.ObjectId, ref: 'User' },
  subtotal: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  vatPercent: { type: Number, default: 0 },
  serviceChargePercent: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  splitMethod: { type: String, enum: ['equal', 'manual'], required: true },
  status: { type: String, enum: ['unpaid', 'paid', 'cancelled'], default: 'unpaid' },
  createdAt: { type: Date, default: Date.now }
});

const BillItemSchema = new Schema<IBillItem>({
  billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  payeeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }]
});

const BillPayeeSchema = new Schema<IBillPayee>({
  billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
  payeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  slipKey: { type: String }
});

export const User = mongoose.model<IUser>('User', UserSchema);
export const Group = mongoose.model<IGroup>('Group', GroupSchema);
export const Bill = mongoose.model<IBill>('Bill', BillSchema);
export const BillItem = mongoose.model<IBillItem>('BillItem', BillItemSchema);
export const BillPayee = mongoose.model<IBillPayee>('BillPayee', BillPayeeSchema);

// ----------------------------------------------------
// One-time migration: make lineGroupId sparse-unique, add inviteCode index,
// and backfill invite codes for any pre-existing groups.
// ----------------------------------------------------
async function migrateGroupIndexes() {
  try {
    // 1. Backfill inviteCode for legacy groups FIRST — must happen before the
    //    unique index on inviteCode is built, or the build fails on null dupes.
    const legacy = await Group.find({ $or: [{ inviteCode: { $exists: false } }, { inviteCode: null }] });
    for (const g of legacy) {
      g.inviteCode = generateInviteCode();
      await g.save();
      console.log(`🔗 Backfilled invite code for group: ${g.name}`);
    }

    // 2. Rebuild indexes to match the new schema (drops old non-sparse
    //    lineGroupId index, adds sparse lineGroupId + unique inviteCode).
    await Group.syncIndexes();
  } catch (err) {
    console.error("⚠️ Group index migration warning:", err);
  }
}

// ----------------------------------------------------
// Seeding Mock Data
// ----------------------------------------------------
async function seedMockData() {
  try {
    // 1. Seed Mock Users
    const mockUsersData = [
      {
        lineId: 'u-kan',
        displayName: 'Kan',
        pictureUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=kan',
        promptPay: '0812345678'
      },
      {
        lineId: 'u-g',
        displayName: 'G',
        pictureUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=g',
        promptPay: '0823456789'
      },
      {
        lineId: 'u-somchai',
        displayName: 'Somchai',
        pictureUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=somchai',
        promptPay: '0834567890'
      },
      {
        lineId: 'u-nat',
        displayName: 'Nat',
        pictureUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=nat',
        promptPay: '0845678901'
      }
    ];

    const seededUsers = [];
    for (const userData of mockUsersData) {
      let user = await User.findOne({ lineId: userData.lineId });
      if (!user) {
        user = await User.create(userData);
        console.log(`👤 Seeded user: ${user.displayName}`);
      }
      seededUsers.push(user);
    }

    // 2. Seed Mock Group
    const groupLineId = 'g-test';
    let group = await Group.findOne({ lineGroupId: groupLineId });
    if (!group) {
      group = await Group.create({
        lineGroupId: groupLineId,
        name: 'Test thung-ngoen',
        members: seededUsers.map(u => u._id)
      });
      console.log(`👥 Seeded group: ${group.name}`);
    }
  } catch (error) {
    console.error("❌ Error seeding mock data:", error);
  }
}
