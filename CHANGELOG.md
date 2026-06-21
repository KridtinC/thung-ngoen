# Changelog

Versioning: **major.minor.bugfix** (major = redesign/rebrand, minor = new feature, bugfix = fix).

## 1.1.0 — Test suite + PR workflow
- Added a **`bun test`** suite covering pure logic on both sides: client PromptPay/CRC16
  (`public/lib/promptpay.js`) and server crypto, debt-settlement, and invite-code
  (`lib/crypto.ts`, `lib/settle.ts`, `lib/invite.ts`).
- Refactored those pure functions out of `server.ts`/`db.ts`/`app.js` into importable modules
  (no behaviour change) so they're testable.
- CI now runs `bun test` + compile/bundle/parse checks on every PR.
- Adopted a **PR-based workflow**: changes land via pull request (CI gate) and deploy on merge to
  `main`; no direct pushes to `main`.

## 1.0.0 — Initial public release
First versioned/open-sourced cut. Summary of everything built so far:

### Brand & design
- **Rebranded Khun Ngern (ขุนเงิน) → Thung Ngoen (ถุงเงิน)** across UI, bot copy, and the public
  URL (`khun-ngern.fly.dev` → `thung-ngoen.fly.dev`). Internal MongoDB database name and R2 bucket
  intentionally keep `khun-ngern` (no user impact, avoids data migration).
- **Siamese-cat theme** — light pastel palette (teal + gold) as default, plus a **dark-mode
  toggle** (persisted, no-FOUC). Cat logo as favicon/header mark, cat hero banner in the Flex card.
- **Cat voice** in LINE messages (summon, daily reminder, payment pushes) + light empty-state
  flourishes; in-app forms/validation kept clear.

### Features
- Group bill splitting (equal + itemised), proportional discount / service charge / VAT.
- Net-balance summary with optimal debt simplification; bills grouped by day; collapsible History.
- Dynamic PromptPay QR (EMVCo), "pay for a friend", edit/cancel bills, cancel-all-for-a-day.
- **Payment slips** uploaded to Cloudflare R2, viewable per-bill and per-day (private, presigned URLs).
- LINE group reminders + 08:00 Bangkok daily cron; invite via share link; leave/delete group.
- PromptPay PII encrypted at rest (AES-256-GCM). Payer must have PromptPay set to be selected.

### Notable fixes (see CLAUDE.md for the "why")
- Ghost overlay covering the screen — `[hidden]` was overridden by an explicit `display` rule.
- LINE WebView modal corruption when opening the file picker — moved the file input out of the
  `<dialog>` top layer.
- Slip viewer hidden behind the gallery — converted it to a `<dialog>` so it joins the top layer.
- Elysia route-param collision (`:groupKey` vs `:groupId`); `set.redirect` → `redirect()` helper.
- Stale HTML in LINE WebView — serve `index.html` with `Cache-Control: no-store` + `?v=` busting.

### Infrastructure
- Fly.io app `thung-ngoen` (sin, 1× shared-cpu-1x/512MB, always-on).
- Git + GitHub (public, `KridtinC/thung-ngoen`); GitHub Actions for PR checks and auto-deploy on `main`.
