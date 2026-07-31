# Cloudflare Worker and D1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a same-origin Cloudflare Worker foundation that routes `/api/*` to a minimal API, delegates all other requests to the existing Vite SPA assets, and verifies a real D1 binding through `GET /api/health`.

**Architecture:** A native Workers `fetch` entry delegates API routing to a small router and delegates non-API requests to `env.ASSETS.fetch(request)`. The health route reads `app_metadata` through a focused repository. D1 starts with one infrastructure-only table and is tested locally with Cloudflare's Vitest Workers pool before any remote migration.

**Tech Stack:** React 18, TypeScript 5.5, Vite 6.4, Vitest 3.2.7, Miniflare 4.20260730.0/workerd 2026-07-30, Wrangler 4.117.0, Cloudflare Workers native APIs, Cloudflare D1.

**Implementation note:** The compatible Cloudflare Vitest pool was evaluated first, but its module fallback writes raw Windows paths into an HTTP `Location` header and fails when the required worktree path contains Chinese characters. The implemented harness therefore uses the same official Miniflare/workerd runtime and isolated D1 directly from Vitest; it preserves runtime-level coverage and runs reliably from the specified worktree.

## Global Constraints

- Work only in `D:\心理游戏\.worktrees\cloudflare-d1-backend` on `feature/cloudflare-d1-backend`.
- Start from `cbdbf987ab5124d7ea94ee2257b7fba664f0c022`; do not modify, merge, or switch to `main`.
- Do not touch the original `D:\心理游戏` worktree.
- Keep `npm run dev` as the Vite-only development command.
- Do not change React pages, game behavior, candidate content, scoring, Niko, HR, sunk-cost behavior, or JSON export.
- Use native `Request`, `Response`, D1, and assets bindings; do not add a web framework or ORM.
- Do not deploy the Worker, push the branch, or create a PR.
- Do not add participant, session, rating, evidence, questionnaire, admin, candidate configuration, scoring, export, or deletion tables/routes.
- Do not add CORS wildcard headers or secrets to the repository.
- Do not fix the unrelated PostCSS advisory in this stage.
- D1 binding is `DB`; assets binding is `ASSETS`; database name is `mind-game-production`.
- Never commit a placeholder database UUID. Configure D1 only with the real UUID returned by Cloudflare.

## File Structure

```text
worker/
  index.ts                 # Worker fetch entry
  env.ts                   # Env binding types
  router.ts                # /api routing and asset delegation
  http/responses.ts        # stable JSON envelopes and headers
  routes/health.ts         # method handling and D1-backed health response
  db/appMetadata.ts        # app_metadata lookup
migrations/
  0001_infrastructure.sql  # infrastructure metadata only
worker-tests/
  runtime.ts               # isolated Miniflare/workerd and D1 setup
  health.test.ts           # health success/error/method tests
  routing.test.ts          # API 404 and asset delegation tests
  migrations.test.ts       # migration contents and metadata tests
docs/
  backend-stage-1-setup.md
tsconfig.worker.json
vitest.worker.config.ts
```

## Worker Request Flow

```text
Request
  ├─ pathname starts with /api/
  │    ├─ exact /api/health → health handler
  │    └─ otherwise → JSON 404
  └─ all other paths → env.ASSETS.fetch(request)
```

`wrangler.jsonc` keeps `not_found_handling: "single-page-application"` and adds `run_worker_first: ["/api/*"]`. This prevents the SPA fallback from turning an unknown API route into `index.html`, while preserving normal assets and front-end deep-link fallback.

---

### Task 1: Pin the compatible Worker test toolchain

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.worker.json`
- Create: `vitest.worker.config.ts`
- Create: `worker-tests/runtime.ts`

**Interfaces:**
- Consumes: existing Vitest 3.2.7 and Vite build.
- Produces: `npm run test:worker` with an isolated Worker runtime and D1 binding.

- [ ] **Step 1: Install exact compatible dependencies without force flags**

```bash
npm install --save-dev --save-exact miniflare@4.20260730.0 esbuild@0.27.0 @cloudflare/workers-types@5.20260731.1 wrangler@4.117.0
```

- [ ] **Step 2: Confirm dependency resolution**

```bash
npm ls vitest miniflare esbuild wrangler @cloudflare/workers-types
```

Expected: Vitest remains 3.2.7 and all explicit Worker dependencies resolve without invalid peer dependencies.

- [ ] **Step 3: Add an independent Worker TypeScript project**

`tsconfig.worker.json` includes only `worker`, `worker-tests`, and `vitest.worker.config.ts`, uses `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`, strict mode, bundler resolution, and no emit. Add it to the root project references so `npm run typecheck` checks both browser and Worker code without adding Worker globals to `src`.

- [ ] **Step 4: Configure isolated Worker tests**

Use a dedicated Vitest config and a small Miniflare runtime factory that bundles the Worker with esbuild, creates an isolated D1 binding, applies the migration SQL, and includes only `worker-tests/**/*.test.ts`.

- [ ] **Step 5: Add scripts without changing `dev`**

```json
{
  "dev": "vite",
  "dev:worker": "npm run build && wrangler dev",
  "test:worker": "vitest --config vitest.worker.config.ts --run",
  "db:migrate:local": "wrangler d1 migrations apply mind-game-production --local",
  "db:migrate:remote": "wrangler d1 migrations apply mind-game-production --remote",
  "db:migrations:list:local": "wrangler d1 migrations list mind-game-production --local",
  "db:migrations:list:remote": "wrangler d1 migrations list mind-game-production --remote",
  "check": "npm test -- --run && npm run test:worker && npm run typecheck && npm run build"
}
```

Do not commit at this intermediate point; the stage has one final commit.

### Task 2: Write failing migration and API tests

**Files:**
- Create: `worker-tests/runtime.ts`
- Create: `worker-tests/migrations.test.ts`
- Create: `worker-tests/health.test.ts`
- Create: `worker-tests/routing.test.ts`

**Interfaces:**
- Consumes: an isolated Miniflare `DB` binding, the migration SQL, and the planned Worker default export.
- Produces: executable acceptance tests for the entire Stage 1 behavior.

- [ ] **Step 1: Write migration assertions first**

Assert that isolated D1 contains `app_metadata` and that it has `schema_version = "1"` and `service_name = "mind-game-api"`.

- [ ] **Step 2: Write health route assertions first**

Assert `GET /api/health` returns 200, JSON/no-store headers, service/database/schemaVersion/timestamp, and no wildcard CORS. Assert `POST` returns 405 with `Allow: GET` and a requestId. Call the handler with a throwing DB to assert sanitized 503.

- [ ] **Step 3: Write routing assertions first**

Assert unknown `/api/*` is JSON 404 rather than HTML, contains requestId, and omits stack/database UUID/local paths. Assert a non-API request is delegated exactly once to a fake `ASSETS` binding and returns that binding's response.

- [ ] **Step 4: Run RED verification**

```bash
npm run test:worker
```

Expected: FAIL because the migration and Worker modules do not exist. Fix only test setup mistakes; retain failures caused by missing production behavior.

### Task 3: Implement the infrastructure migration

**Files:**
- Create: `migrations/0001_infrastructure.sql`

**Interfaces:**
- Produces: `app_metadata(key, value, updated_at)` and the two required values.

- [ ] **Step 1: Add only the metadata table**

```sql
CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO app_metadata (key, value, updated_at)
VALUES
  ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('service_name', 'mind-game-api', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
```

- [ ] **Step 2: Run the migration test**

```bash
npm run test:worker -- worker-tests/migrations.test.ts
```

Expected: migration tests pass; route tests remain red.

### Task 4: Implement responses, health, router, and Worker entry

**Files:**
- Create: `worker/env.ts`
- Create: `worker/http/responses.ts`
- Create: `worker/db/appMetadata.ts`
- Create: `worker/routes/health.ts`
- Create: `worker/router.ts`
- Create: `worker/index.ts`

**Interfaces:**
- `Env`: `{ DB: D1Database; ASSETS: Fetcher }`.
- `jsonSuccess(data, requestId, status?)`: JSON success response with no-store.
- `jsonError(status, code, message, requestId, extraHeaders?)`: sanitized JSON error response.
- `readAppMetadata(db)`: returns `{ schemaVersion, serviceName } | null`.
- `routeRequest(request, env)`: routes API or delegates to assets.

- [ ] **Step 1: Implement stable response envelopes**

Every API response uses `application/json; charset=utf-8` and `Cache-Control: no-store`. Errors contain only public code/message/requestId; no error object or stack is serialized.

- [ ] **Step 2: Implement D1-backed health**

Read both required metadata keys. Return 503 `SCHEMA_NOT_READY` when values are missing and 503 `DATABASE_UNAVAILABLE` on database failure. Return 405 with `Allow: GET` for other methods.

- [ ] **Step 3: Implement exact API routing and asset delegation**

Generate one `crypto.randomUUID()` request ID for every API request. Route exact `/api/health`; return JSON `NOT_FOUND` for every other `/api/*`; delegate non-API requests to `env.ASSETS.fetch(request)`.

- [ ] **Step 4: Run GREEN verification**

```bash
npm run test:worker
```

Expected: all Worker tests pass.

### Task 5: Create and bind the real D1 database

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.gitignore`

**Interfaces:**
- Produces: real `DB` and `ASSETS` bindings for local Wrangler and future deployment.

- [ ] **Step 1: Inspect authenticated Cloudflare resources**

```bash
npx wrangler whoami
npx wrangler d1 list
```

If `mind-game-production` exists, verify it belongs to this account/project and use its UUID. If it does not exist and authentication is valid, run:

```bash
npx wrangler d1 create mind-game-production
```

Never delete or reuse an unrelated database.

- [ ] **Step 2: Write the real Wrangler configuration**

Add the schema URL, `main: "worker/index.ts"`, `ASSETS`, SPA fallback, `run_worker_first: ["/api/*"]`, and one D1 binding named `DB` with the real `mind-game-production` UUID and `migrations_dir: "migrations"`. Preserve compatibility date `2026-07-01`.

- [ ] **Step 3: Extend ignores**

Ignore `.wrangler/state/`, `.dev.vars`, `.dev.vars.*`, and local database files while continuing to track `migrations/`.

- [ ] **Step 4: Validate configuration and local migration**

```bash
npx wrangler deploy --dry-run
npm run db:migrate:local
npm run db:migrations:list:local
```

The dry run may bundle but must not deploy. Local migration must apply `0001_infrastructure.sql` and then report no pending migrations.

### Task 6: Verify the complete local Worker

**Files:**
- No production file changes unless a failing test is first added.

**Interfaces:**
- Consumes: built SPA, Worker, local D1, and Wrangler routing.

- [ ] **Step 1: Run automated gates**

```bash
npm install
npm run db:migrate:local
npm run test:worker
npm test -- --run
npm run typecheck
npm run build
npm run check
```

- [ ] **Step 2: Start the complete Worker**

```bash
npm run dev:worker
```

- [ ] **Step 3: Smoke-test Wrangler's local URL**

Verify status, content type, cache headers, and summary for:

```text
GET /api/health
GET /api/not-found
GET /
GET /frontend-route-that-does-not-exist
```

The first is JSON 200, the second JSON 404, and both page requests return the React HTML shell.

### Task 7: Apply the remote migration only after all local gates

**Files:**
- No code changes.

**Interfaces:**
- Produces: infrastructure metadata in the real `mind-game-production` D1 only.

- [ ] **Step 1: Confirm no protected data and no business tables**

```bash
npx wrangler d1 execute mind-game-production --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Proceed only if this is the newly verified project database and contains no formal data to protect.

- [ ] **Step 2: Apply and list remote migrations**

```bash
npm run db:migrate:remote
npm run db:migrations:list:remote
npx wrangler d1 execute mind-game-production --remote --command "SELECT key, value FROM app_metadata ORDER BY key;"
```

Do not run `wrangler deploy`.

### Task 8: Document, verify, and commit Stage 1

**Files:**
- Create: `docs/backend-stage-1-setup.md`
- Modify: `README.md` only for concise development commands if necessary.

**Interfaces:**
- Produces: repeatable local/remote migration and development instructions.

- [ ] **Step 1: Write setup and rollback documentation**

Document current architecture, request routing, `ASSETS`/`DB`, database name/UUID, local and remote migration commands, migration status commands, complete Worker startup, tests, secrets exclusions, rollback, why no business tables exist, and Stage 2 exclusions.

- [ ] **Step 2: Run final verification from a clean process**

```bash
npm run check
git diff --check
git status --short
```

- [ ] **Step 3: Review the exact change scope**

Confirm no files under `src/components`, `src/data`, `src/state`, `src/styles`, `src/utils`, or `public` changed, and no secret/identity data exists in the diff.

- [ ] **Step 4: Commit once**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.worker.json vitest.worker.config.ts wrangler.jsonc .gitignore worker worker-tests migrations docs/backend-stage-1-setup.md docs/superpowers/plans/2026-07-31-cloudflare-worker-d1-foundation.md README.md
git commit -m "feat: establish Worker and D1 foundation"
```

Do not push, deploy, merge, open a PR, or start Stage 2.

## Rollback

Code rollback is one revert of the final Stage 1 commit, restoring the current static-only `wrangler.jsonc`. Local D1 state can be deleted from the ignored `.wrangler/state/` directory only after confirming the path is inside this worktree. Remote migration rollback is not performed destructively in this stage: the new database contains only `app_metadata` and Wrangler's `d1_migrations`; if abandoned, leave it unused and unbound rather than deleting it automatically.

## Explicitly Not Implemented

Identity collection, participants, formal sessions, consent persistence, questionnaires, T1/T2/T3 APIs, point validation, evidence unlocks, candidate configuration, Niko/HR changes, sunk-cost APIs, final submission, RDI/derived metrics, administrator authentication, password hashing, CSV/ZIP export, deletion, offline outbox, production deployment, and any game/UI behavior change are excluded.
