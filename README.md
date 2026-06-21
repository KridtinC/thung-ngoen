# Thung Ngoen (ถุงเงิน) 🐱💰

> A friendly Siamese-cat bill-splitter for LINE. Type **ถุงเงิน** in a group chat and the cat
> shows up to help everyone split bills, see who owes whom, and settle with PromptPay.

Thung Ngoen is a **LINE bot + LIFF web app** that helps groups of friends track shared expenses,
split costs (equally or per-item), settle via dynamic PromptPay QR codes, and attach payment
slips. It runs as a single Bun/Elysia server with a no-framework HTML/CSS/JS frontend.

🔗 Production: https://thung-ngoen.fly.dev

---

## ✨ Features
- **Summon by chat** — typing `ถุงเงิน` in a LINE chat replies with a Flex card to open the app.
- **Auto LINE identity** — pulls profile + group context from the LIFF/LINE APIs.
- **Smart settlement** — net balances ("who owes how much") with an **optimal debt-simplification**
  plan (minimises the number of transfers).
- **Bills by day** with per-payer summaries; a collapsible **History** for paid/cancelled bills.
- **Two split modes** — divide equally among selected payees, or itemise (per-item prices +
  per-item payees). Proportional **discount / service charge / VAT** handling.
- **Dynamic PromptPay QR** — EMVCo payload generated client-side with the exact amount.
- **Pay for a friend** — settle someone else's share on their behalf.
- **Payment slips** — upload a slip image (stored in Cloudflare R2); view per-bill or a per-day
  gallery.
- **Reminders** — push a Flex reminder to the group; an 08:00 (Bangkok) daily cron nudges unpaid bills.
- **Edit / cancel bills**, leave/delete groups, invite via share link.
- **Light & dark themes** with a toggle (light is default, matching the cat brand).

---

## 🎨 Design (art direction)
The brand is a **Siamese cat holding a money bag** ("ถุงเงิน" = money bag). The visual language is
warm and playful, but stays legible for a money app.

- **Palette** — Siamese-cat tones: **teal** primary (`#129cb4`), **gold** accent (`#e0a23a`,
  echoing the logo border/coins), cream/white surfaces, warm brown-black text. A retuned **dark
  palette** mirrors the same teal+gold accents.
- **Theming** — all colors are CSS custom properties; `:root` is the light theme and
  `:root[data-theme="dark"]` overrides it. A small inline script in `<head>` applies the saved/
  system theme before first paint (no flash). Surface tints use theme-aware overlay variables so
  they read correctly on both backgrounds.
- **Voice** — a light Siamese-cat personality (เมี้ยว / 🐾) in the **LINE messages** (summon,
  reminders, payment confirmations) and small empty-state flourishes. In-app forms, buttons, and
  validation stay plain and clear.
- **Assets** — `public/logo.png` (512×512) is the favicon, iOS touch icon, and header mark;
  `public/hero.png` (1211×676, 16:9) is the Flex summon banner.
- **Typography** — `Outfit` for display/headings, `Inter` for body (Google Fonts).
- **UI primitives** — native HTML `<dialog>` for modals; smooth grid-based expand/collapse; shimmer
  skeletons for loading.

---

## 🛠 Engineering

### Stack
- **Runtime:** [Bun](https://bun.sh/) · **Framework:** [Elysia](https://elysiajs.com/) (TypeScript)
- **DB:** MongoDB Atlas via [Mongoose](https://mongoosejs.com/)
- **Object storage:** Cloudflare **R2** (S3-compatible) via Bun's built-in `Bun.S3Client` (no extra deps)
- **Frontend:** plain HTML5 (`<dialog>`), vanilla CSS (variable-driven theming), ES-module JS — no build step
- **Hosting:** [Fly.io](https://fly.io/) — app `thung-ngoen`, region `sin`, 1× shared-cpu-1x / 512MB, always-on
- **CI/CD:** GitHub Actions (PR checks + auto-deploy on `main`)

### Data model (`db.ts`)
`User` (LINE profile + encrypted PromptPay) · `Group` (members, invite code) ·
`Bill` (payer, creator, amounts, split method, status) · `BillItem` (per-item split) ·
`BillPayee` (per-person share, status, slip key).

### Notable implementation details
- **PromptPay QR** — EMVCo TLV payload + CRC16 computed in `public/app.js`, rendered to canvas.
- **Debt simplification** — greedy creditor/debtor matching in `server.ts` produces the minimal
  set of transfers.
- **PII encryption** — PromptPay numbers are encrypted at rest with **AES-256-GCM**
  (`encryptPII`/`decryptPII`), keyed by `ENCRYPTION_KEY`.
- **Slips** — uploaded to R2 server-side; served privately via short-lived **presigned URLs**
  (an Elysia route 302-redirects an `<img>` to the presigned link; the bucket is never public).
- **Caching** — `index.html` is served with `Cache-Control: no-store`; CSS/JS use `?v=N`
  cache-busting (LINE's in-app WebView caches aggressively).

### File structure
```
server.ts            Elysia server: REST API, LINE webhook, Flex messages, R2, cron
db.ts                Mongoose connection, models, seed data
public/
  index.html         LIFF app markup (header, views, dialogs)
  app.js             client logic: PromptPay QR, calculations, theme toggle, slips
  styles.css         variable-driven theming (light default + dark)
  logo.png           brand mark / favicon / touch icon
  hero.png           Flex summon banner
Dockerfile           multi-stage Bun build
fly.toml             Fly.io config
.github/workflows/   CI (PR) + CD (deploy on main)
CLAUDE.md            working rules, conventions, and hard-won gotchas — read before changing code
```

---

## 🚀 Local development
```bash
bun --version          # ensure Bun is installed
cp .env.example .env   # then fill in values (see .env.example)
bun install
bun run dev            # http://localhost:3000
```
The full LINE/LIFF flow (profiles, summon, share) only runs inside the LINE app, since the client
gates on `liff.init()`. See LINE integration below.

## 🔌 LINE integration
1. In the [LINE Developers Console](https://developers.line.biz/): create a **Messaging API**
   channel (save the access token) and a **LINE Login** channel with a **LIFF app**.
2. Set the LIFF **Endpoint URL** to your server (`https://thung-ngoen.fly.dev`) and the Messaging
   API **Webhook URL** to `…/webhook`, then **Verify**. Enable scopes `profile`, `openid` and the
   share target picker.
3. Put `LINE_LIFF_ID`, `LINE_CHANNEL_ACCESS_TOKEN` (and the rest) in `.env` / Fly secrets.
   Invite links and the bot button are LIFF-ID based, so they survive URL changes.

## ☁️ Deploy
Push to `main` → GitHub Actions deploys automatically. Manual:
```bash
flyctl deploy --remote-only -a thung-ngoen
```
Secrets live as Fly secrets (`flyctl secrets set …`) — see `.env.example` for the full list.
**Never commit real secrets** (`.env*` is gitignored).

## 🔁 CI/CD
- **Pull requests** → `.github/workflows/ci.yml`: install + compile-check `server.ts` and `app.js`.
- **Push to `main`** → `.github/workflows/deploy.yml`: deploy to Fly (needs the `FLY_API_TOKEN`
  repo secret).

## 🔢 Versioning
`package.json` `version` follows **major.minor.bugfix**: major = redesign/rebrand, minor = new
non-breaking feature, bugfix = fix. Bump it with each change.

---

See **[CLAUDE.md](./CLAUDE.md)** for working conventions and the list of platform gotchas
(LINE WebView dialogs, `[hidden]` overrides, Fly app migration, theming rules, etc.).
