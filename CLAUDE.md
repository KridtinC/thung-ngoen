# CLAUDE.md — Working rules for this project

Guidance for Claude Code (and humans) working on **Thung Ngoen (ถุงเงิน)** — a LINE LIFF +
bot bill-splitting app. Read this before making changes.

## What this is
- **Thung Ngoen / ถุงเงิน** ("money bag"; Siamese-cat mascot): a LINE LIFF web app + LINE bot
  that lets friend groups split bills, track who owes whom, settle via PromptPay QR, and upload
  payment slips.
- Originally named **Khun Ngern / ขุนเงิน** — renamed to Thung Ngoen. Some **internal**
  identifiers intentionally still say `khun-ngern` (see "Things that intentionally still say
  khun-ngern").

## Stack & infra
- **Runtime/framework:** Bun + Elysia (TypeScript). `server.ts` is a thin composition root that
  `.use()`s feature modules in **`src/server/modules/{static,slips,users,bills,groups,line}`** —
  each a named Elysia plugin (`index.ts`) + `service.ts` (DB/LINE/R2 logic) + `model.ts` (`t`
  validation) where relevant. Pure logic lives in **`lib/*.ts`** (crypto, settle, invite, bill,
  money, promptpay), shared by server, client, and tests.
- **DB:** MongoDB Atlas via Mongoose (`db.ts`). Database name is `/khun-ngern`.
- **Frontend:** TypeScript in **`src/client/`**, bundled by `bun build` to **`public/app.js`**
  (a generated, gitignored artifact). HTML/CSS are hand-written in `public/`. Served statically by Elysia.
- **Hosting:** Fly.io app **`thung-ngoen`** (region `sin`, 1× shared-cpu-1x/512MB, always-on).
  URL `https://thung-ngoen.fly.dev`.
- **Object storage:** Cloudflare R2 (S3-compatible) for payment slips, via **Bun's built-in
  `Bun.S3Client`** (no extra npm deps). Bucket name is `khun-ngern`.
- **Messaging:** LINE Messaging API (push + Flex messages) and LIFF SDK v2.

## Core commands
- Local dev: `bun run dev` → builds `src/client` → `public/app.js` (watch) + runs the server at
  http://localhost:3000 (needs `.env`; full LINE/LIFF flow only works inside LINE — gated on `liff.init()`).
- Build client bundle: `bun run build:client`. Type-check: `bun run typecheck` (`tsc --noEmit`).
  Compile-check server: `bun build server.ts --target bun`. Tests: `bun test`.
- Deploy: `flyctl deploy --remote-only -a thung-ngoen` (or push to `main` → GitHub Actions deploys).
  The Docker image runs `bun run build:client`, so `public/app.js` is built in-image (it's gitignored).

## Versioning rule (package.json `version`, format major.minor.bugfix)
Bump on every change:
- **major** — large redesign / rebrand / architecture change (e.g. the Siamese-cat re-theme).
- **minor** — new feature that doesn't break anything.
- **bugfix** — bug fix only.
Commit the version bump together with the change.

## Hard-won lessons / gotchas (avoid re-hitting these bugs)

### LINE in-app WebView (iOS) quirks
- **File `<input type="file">` must NOT live inside a `showModal()` `<dialog>`.** Opening the OS
  file picker from inside the top-layer modal corrupts the dialog's rendering on return (it
  repaints with default white/UA styling). Keep the file input as a direct child of `<body>` and
  trigger it via JS (`input.click()`) from a button inside the dialog. (See slip upload.)
- **Top-layer stacking:** a `<dialog>` opened with `showModal()` renders in the browser **top
  layer**, above ANY normal `z-index`. A plain `<div>` overlay can't appear above it. If an
  overlay must sit above a dialog (e.g. the full-screen slip viewer over the slips gallery), make
  it a `<dialog>` too and `showModal()` it.
- **HTML is cached aggressively.** Serve `index.html` via an explicit Elysia route with
  `Cache-Control: no-store` (the `staticPlugin` `headers` option did NOT apply). Bust CSS/JS with
  `?v=N` query strings — **bump them on every deploy that changes app.js/styles.css.**

### CSS / theming
- **The `hidden` attribute is defeated by any explicit `display` rule.** `[hidden]` only sets
  `display:none` at UA priority, so a rule like `#overlay{display:flex}` keeps it visible forever.
  Always pair such rules with `#overlay[hidden]{display:none}`, or scope display to `[open]` /
  `:not([hidden])`. (This caused the "ghost overlay covering the screen" bug.)
- **Theme system:** colors are CSS variables on `:root` (light, default) and
  `:root[data-theme="dark"]`. A no-FOUC inline script in `<head>` sets `data-theme` from
  `localStorage.theme` (falling back to system preference) BEFORE the stylesheet loads. The
  toggle button writes `localStorage.theme`. Keep variable NAMES stable so component rules don't
  change — only values differ per theme.
- **Dark-designed overlays break on light.** `rgba(255,255,255,0.xx)` surface tints vanish on a
  light background. Use the theme-aware overlay vars (`--ov-faint/soft/med`, `--divider`,
  `--scrollbar`) instead of hard-coded white/black overlays. Keep modal backdrops dark in both
  themes.

### Elysia / server
- **Route param names must be identical for the same path prefix.** e.g. every `/api/groups/:X/...`
  route must use the SAME `:groupId` — mixing `:groupId` and `:groupKey` throws at boot
  ("route already exists with a different parameter name").
- **Redirects:** use the exported `redirect(url)` helper (`import { redirect } from 'elysia'`),
  not `set.redirect` (the latter silently returned 200 in this Elysia version). Used for serving
  private R2 slips via short-lived presigned URLs.

### Fly.io
- **App names are immutable.** Renaming = create a NEW app and migrate. Secrets do NOT transfer
  between apps — re-set them all. **`ENCRYPTION_KEY` must be byte-identical** across apps or
  existing encrypted PromptPay numbers can't be decrypted; **`MONGODB_URI`** and the **R2_***
  secrets must point to the same DB/bucket to keep data. Use `flyctl secrets import --stage` then
  one `flyctl deploy` (avoids an extra restart). Verify parity with `flyctl secrets list` (compare
  digests).
- The Fly Doctor / deploy warning **"machines not listening on 0.0.0.0:3000"** during a rolling
  deploy is a transient health-check blip while the new machine boots — not a real crash.
- Default `fly deploy` may create 2 machines (HA). This app runs **1** (`flyctl scale count 1`).

### LINE / LIFF
- **Invite links and the bot's "open app" button are built from the LIFF ID**
  (`https://liff.line.me/${LINE_LIFF_ID}?invite=...`), NOT the Fly domain — so they survive a URL
  change as long as the LIFF ID is unchanged and its **Endpoint URL** is repointed in the LINE
  Developers Console. Webhook URL also lives there (`/webhook`).
- Flex message images need a **public HTTPS** URL (we host `hero.png` in `public/`). LINE caches
  Flex image URLs — bump a `?v=` on the URL to force a refresh.
- Bot is summoned by typing the brand word in chat: currently **`ถุงเงิน`** only
  (`text.includes('ถุงเงิน')` in `server.ts`).

### Product / copy
- This is a **money app** — keep UI labels, forms, and validation clear and literal. The playful
  Siamese-cat voice (เมี้ยว/🐾) belongs in **LINE messages** (summon, reminders, payment pushes)
  and light empty-state flourishes only.
- PromptPay numbers are **PII**, encrypted at rest with AES-256-GCM (`encryptPII`/`decryptPII` in
  `server.ts`). Never log or expose raw values.
- A bill's payer must have PromptPay set up (validated client + server) before they can be the payer.

## Security (repo is PUBLIC)
- **Never commit secrets.** `.env`, `.env.*` are gitignored; real values live in Fly secrets and
  GitHub Actions secrets. `.env.example` documents the keys with empty values.
- The 8 runtime secrets: `MONGODB_URI`, `ENCRYPTION_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`,
  `LINE_LIFF_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (`LINE_CHANNEL_SECRET` is set but not yet read by code).

## Things that intentionally still say `khun-ngern`
- MongoDB **database name** (`/khun-ngern`) and the **R2 bucket** (`khun-ngern`) — internal, never
  user-visible; renaming would force a risky data migration for zero benefit. Leave them.

## Contribution workflow — ALWAYS use a PR (do NOT push to `main`)
- **Never commit directly to `main`.** For every change: create a branch, commit, push, and open a
  **pull request** (`gh pr create`). Merging the PR triggers the production deploy.
- Bump `package.json` `version` (major.minor.bugfix) and add a `CHANGELOG.md` entry in the same PR.
- Make sure `bun test` and the build checks pass locally before opening the PR (CI runs them too).

## Ripple check — never leave related files stale
Before committing/opening a PR, trace the **full impact** of the change and update everything it
touches so nothing is left behind. Walk this checklist every time and update what applies:
- **Tests** (`test/*`) — add/adjust tests for changed logic; keep `bun test` green.
- **CI/CD** (`.github/workflows/*`) — if files moved, scripts/commands changed, new build steps or
  env are needed, or check commands no longer match.
- **README.md** — features, design notes, file structure, commands, or screenshots that changed.
- **CLAUDE.md (this file)** — if conventions, gotchas, architecture, file paths, or workflow
  changed, update the rules here too (the rule file is not exempt).
- **CHANGELOG.md + `package.json` version** — every change.
- **`.env.example`** — when adding/removing/renaming an env var (and note it in the secrets list).
- **Cache-bust versions** — bump `?v=` on `styles.css`/`app.js` in `index.html` when those change
  (the client is a single bundle, so only these two query strings matter).
- **Cross-references** — grep for other places that name the thing you changed (routes, env var
  names, file paths, copy strings) so no caller/doc is left pointing at the old version.
Rule of thumb: after editing a file, ask "what else references or depends on this?" and fix those
in the same PR.

## Testing
- Test runner: **`bun test`** (`bun:test`). Tests live in `test/*.test.ts`.
- **Every feature ships with a test.** Factor the feature's pure decision/format logic into
  `lib/*.ts` and cover it with `test/*.test.ts`; DOM/LINE wiring stays a thin layer over the tested
  core. A PR adding a feature without a test is incomplete. (e.g. i18n → `lib/i18n`, LINE-vs-manual
  group rules → `lib/group-rules`, multi-select settle → `lib/settle-select`, slip gate → `lib/pay-rules`.)
- **Pure, testable logic lives in `lib/*.ts`** (`crypto`, `settle`, `invite`, `bill`, `money`,
  `promptpay`, `i18n`, `group-rules`, `settle-select`, `pay-rules`, `line-share`) — imported by the
  server modules, the client (`src/client`), and the tests. Keep new pure logic there rather than
  inline in route handlers or DOM code. DB-/DOM-/network-bound code isn't unit-tested — factor the
  pure part out and test that.
- Don't import `server.ts`/`db.ts` from tests (import-time side effects: `db.ts` calls
  `process.exit(1)` without `MONGODB_URI`; `server.ts` connects + listens). Import from `lib/` instead.
- **`bun run typecheck` (`tsc --noEmit`) is a CI gate** for the server modules + `lib/` + tests.
  The lifted client (`src/client/index.ts`) is marked `// @ts-nocheck` for now (granular DOM typing
  is a follow-up); it's still bundled by `bun build` and imports the typed `lib/*`.

## Caching (LINE WebView is aggressive)
- `index.html` is served `Cache-Control: no-store` via an explicit route. Bust `styles.css` and
  the single `app.js` bundle with `?v=N` in `index.html` — **bump on every deploy that changes them**.
- The client is **one bundle** now (`bun build src/client → public/app.js`), so there are no
  per-module `?v=` specifiers to maintain.

## CI/CD
- **PR** (`.github/workflows/ci.yml`): `bun install` → `bun test` → compile-check `server.ts` →
  bundle-check `public/lib/*` → parse-check `app.js`. Keep it green before merging.
- **main** (`.github/workflows/deploy.yml`): deploys to Fly on push/merge. Needs the
  `FLY_API_TOKEN` repo secret.
