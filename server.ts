import { Elysia } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { connectDB, Group } from './db';
import { LineService } from './src/server/modules/line/service';
import { slips } from './src/server/modules/slips';
import { staticRoutes } from './src/server/modules/static';
import { users } from './src/server/modules/users';
import { bills } from './src/server/modules/bills';
import { groups } from './src/server/modules/groups';
import { line } from './src/server/modules/line';

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
  .use(groups)
  .use(line)

  // Listen on port 3000, bind to all interfaces for Fly.io/Docker
  .listen({ port: 3000, hostname: '0.0.0.0' });

console.log(`🚀 Elysia Server running on http://0.0.0.0:3000`);
