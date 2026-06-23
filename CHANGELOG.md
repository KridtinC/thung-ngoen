# Changelog

Versioning: **major.minor.bugfix** (major = redesign/rebrand, minor = new feature, bugfix = fix).

## 1.3.7 — UI polish: remove redundant pay-for text, themed checkboxes & slip button, group list cleanup
- **Removed** yellow "Paying for: …" text from the payment dialog header — redundant with the "Pay for others" checklist below.
- **Checkboxes** in the pay-for-others checklist now use `accent-color: var(--color-primary)` to match the teal theme of the create-bill checkboxes.
- **Slip upload button** now uses primary color dashed border and text (fixes the off-theme `--text-secondary` invalid variable that was falling back to browser default).
- **Day slips button** (e.g. "📎 สลิป (3)") now uses `.btn-secondary` to match the rest of the UI.
- **Removed** the 📋 copy-invite-link button from each group card in My Groups — redundant (the invite dialog already has copy + share).
- **CLAUDE.md**: added rule to always follow existing visual language for new UI (correct btn variants, `accent-color`, CSS variables only).
- Cache-bust `styles.css?v=34`, `app.js?v=29`.

## 1.3.6 — pay for others: hidden own portions, collapsible others toggle
- **Bug fix**: reopening the payment dialog no longer resets the total — own portions are always silently included so the amount stays correct across open/close cycles.
- **UX**: your own bill portions are no longer shown in the checklist (you always pay your share); the checklist is hidden entirely if there are no other payees to cover.
- **UX**: other people's portions are hidden by default under a "Pay for others ▼" collapsible toggle — expand to optionally pay on their behalf.
- Cache-bust `styles.css?v=33`, `app.js?v=28`.

## 1.3.5 — disable confirm button; fix QR save cache bust
- **Disable button**: `.btn:disabled` now renders at 40% opacity with `cursor: not-allowed` — the
  "I have paid this amount" button is visually disabled when no payees are selected or when a slip
  is required but not yet attached (the logic was already correct; only the visual style was missing).
- **QR save cache**: bumped `app.js?v=27` so LINE WebView discards the stale `v=26` bundle that
  still closed the payment dialog before showing the QR overlay. Cache-bust `styles.css?v=32`.

## 1.3.4 — QR & payment card UX fixes
- **Layout**: recipient card changed to `align-items: flex-start` so the amount badge and avatar
  top-align cleanly when the "paying for" list wraps to multiple lines.
- **QR**: removed the "PromptPay" text overlay from the QR canvas (it was obstructing the QR).
- **Save QR**: no longer closes the payment dialog — `qr-save-overlay` is now a `<dialog>` that
  opens with `showModal()` so it sits in the top layer above the payment dialog.
- **Screenshot hint**: added a second hint line ("หรือ กด Screenshot…" / "Or take a screenshot…")
  in the QR save overlay for users who prefer that over long-press. Cache-bust `styles.css?v=31`.

## 1.3.3 — fix "paying for" text persisting when no others selected
- **Bug fix**: "Paying for …" line stays hidden when selecting only yourself or no one — `.pay-for-line[hidden]` now overrides the `display:block` rule that was defeating the `hidden` attribute. Cache-bust `styles.css?v=30`.

## 1.3.2 — slip preview hidden-fix & delete button style
- **Bug fix**: slip preview and remove button no longer ghost-show when no slip is attached — `.slip-preview-wrap[hidden]` now correctly overrides the `display:flex` rule.
- **Style**: remove-slip button restyled to match "I have paid this amount" but solid red (`btn btn-danger btn-block`). Cache-bust `styles.css?v=29`.

## 1.3.1 — i18n/UX polish
- Profile badge moved to the far right of the header; the **whole badge** opens settings
  (the gear is now just an indicator), keyboard-accessible.
- The summary/empty/loading info box now stretches full width instead of a centered pill.
- Translated the last English bits: bills-list empty state, day "Total:" / "paid" payer line,
  Slips/Slip buttons — and fixed the **Remind** button reverting the UI to English after tapping
  (its label reset was hardcoded). Cache-bust `styles.css?v=28` / `app.js?v=26`.

## 1.3.0 — Thai/English + settle UX
- **Thai/English UI** (`lib/i18n`): full bilingual copy via a `data-i18n` dictionary + a 🌐 header
  toggle (auto-detects LINE/browser locale, remembers your choice). Cat-voice flavour added to
  descriptions/empty-states; buttons, headers, numbers and dates stay literal.
- **Per-payer multi-select settle**: tapping Pay opens a checklist of that payer's unpaid portions
  (across bills & people, your own pre-checked) with a running total + QR; confirm settles them all
  in one go. Shows "Paying for …" when covering friends.
- **Slip required** before confirming a QR payment (`lib/pay-rules`).
- **Settings gear** icon overlaid on the profile photo replaces the "Setup PromptPay" text button.
- **LINE-group rules** (`lib/group-rules`): LINE-synced groups can't be invited to / left / deleted
  (manual groups unchanged); enforced client-side + a server 403 guard.
- **Summon Flex deep-links** to the caller's group (`?invite=`); reminder Flex prices now show
  2 decimals.
- Every feature ships with a `lib/` core + test (47→53 tests). New CLAUDE.md rule to keep it that way.

## 1.2.0 — Modular architecture + TypeScript client
Internal refactor (no user-facing change) following the Elysia best-practice guide.
- **Server**: split the 1,450-line `server.ts` into feature modules under
  `src/server/modules/{static,slips,users,bills,groups,line}` — each a named Elysia plugin
  (`index.ts`) with a `service.ts` (DB/LINE/R2 logic) and, where relevant, a `model.ts`.
  `server.ts` is now a ~55-line composition root (connectDB + cron + `.use(...)` + listen).
- **`t` validation models** on the bills (create/pay/cancel-day) and groups (create) endpoints,
  registered via `.model()` (permissive — existing client payloads pass unchanged).
- **Client → TypeScript**: `public/app.js` → `src/client/index.ts`, bundled to `public/app.js`
  via `bun build` (a new build step). The served `app.js` is now a generated, gitignored artifact;
  the Dockerfile builds it.
- **Shared typed libs** (`lib/*.ts`) used by server, client, and tests: added `bill`, `money`
  (+ tests), moved `promptpay` from `public/lib`. Tests: 24 → 36.
- **Tooling**: `tsconfig.json` + `bun run typecheck` (now a CI gate for server/lib/tests);
  CI builds the client bundle. `tsc` caught and fixed a latent `generateInviteCode` re-export bug.
- Auto-release workflow (`release.yml`) + backfilled v1.0.0 / v1.1.0 releases.

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
