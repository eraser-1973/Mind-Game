# Single-Admin Authentication and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, database-backed single-administrator authentication foundation, immutable security audit trail, and isolated `/admin` UI without changing participant game behavior or deploying the Worker.

**Architecture:** Migration `0011` adds one published auth policy and empty admin security tables. Independent Worker modules handle PBKDF2, privacy-minimized fingerprinting, cookies, Origin/CSRF checks, rate limiting, authentication, and audit projection; `/api/admin/*` is routed separately from participant APIs. The React entry point chooses an isolated `AdminApp` for `/admin`, so participant recovery never mounts on administrator pages.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, Web Crypto PBKDF2-HMAC-SHA256, Node `crypto` for the offline provisioning CLI, React 18, TypeScript, Vitest/Miniflare, Vite 6.

## Global Constraints

- Work only on `feature/cloudflare-d1-backend` from `f6bd43e2c85109796c47d82bf3c4f98b40c145c8`; never modify, merge, or switch to `main`.
- Use PBKDF2-HMAC-SHA256 with 600000 iterations, a fresh 16-byte salt, and a 32-byte derived key; never lower production parameters for tests.
- Use 32-byte random session and CSRF tokens; D1 stores only their SHA-256 hashes.
- Administrator cookies are `mg_admin` (`HttpOnly`, `SameSite=Strict`, `Path=/api/admin`) and `mg_admin_csrf` (readable, `SameSite=Strict`, `Path=/`), both `Secure` on HTTPS and without `Domain`.
- Sessions have an 8-hour absolute lifetime, a 30-minute idle lifetime, and a 5-minute `last_seen` write interval; a new login revokes the prior active session.
- Limit failures to 5 per normalized username/client fingerprint in 15 minutes and 30 per normalized username globally in one hour using server time and D1 facts.
- Never persist raw passwords, password command-line arguments, cookies, raw tokens, full IP addresses, raw User-Agent values, or participant identity in administrator security data.
- Quick and Formal participant flows, their cookies, APIs, scoring, candidate content, and browser persistence must remain unchanged.
- Do not implement configuration editing, exports, deletion, participant views, online password changes, roles, registration, OAuth, or deployment.
- Apply remote migration only after every local gate passes; do not provision a remote administrator.
- Produce one final commit only: `feat: add secure single-admin authentication`.

---

## File Map and Stable Interfaces

- `migrations/0011_admin_auth_audit.sql`: policy, singleton user, session, attempt, audit tables; indexes/triggers; schema version 9; no user seed.
- `worker/security/adminPassword.ts`: username/password validation, PBKDF2 records, verification, constant-time helpers, and dummy verification.
- `worker/security/clientFingerprint.ts`: `/24` IPv4 and `/48` IPv6 prefix normalization plus SHA-256-only outputs.
- `worker/security/adminCookies.ts`: token generation, Cookie parsing/serialization/clearing.
- `worker/security/adminOrigin.ts`: strict same-origin checks.
- `worker/security/adminRateLimit.ts`: D1-backed limit evaluation and Retry-After calculation.
- `worker/security/adminCsrf.ts`: Cookie/header/hash verification for authenticated writes.
- `worker/auth/adminAuth.ts`: `authenticateAdmin(request, env, options)` with revocation, expiry, and throttled touch.
- `worker/services/adminAudit.ts`: immutable audit insertion and safe metadata projection.
- `worker/routes/adminLogin.ts`, `adminSession.ts`, `adminAudit.ts`, `admin.ts`: fixed administrator HTTP contract.
- `worker/http/adminResponses.ts`: no-store JSON envelopes and security headers.
- `scripts/admin/provision-admin.mjs`: interactive first provisioning and explicit `--rotate` workflow using a protected temporary SQL file.
- `src/admin/*`: isolated API client, CSRF reader, login screen, audit panel, dashboard, and app state.
- `src/RootApp.tsx`: pathname-based application boundary; `/admin` never mounts participant `App`.
- `worker-tests/admin*.test.ts`, `src/admin/*.test.tsx`, `src/RootApp.test.tsx`: Stage 9 behavior and regression coverage.

## Task 1: Drive the Stage 9 schema from failing migration tests

**Files:**
- Create: `worker-tests/adminAuthMigration.test.ts`
- Create: `migrations/0011_admin_auth_audit.sql`

**Interfaces:**
- Produces the five administrator tables and published policy `admin-auth-1.0.0` consumed by every later task.

- [ ] Write failing tests that expect schema version 9, exact policy parameters, no default administrator, singleton enforcement, Base64/password column rules, token-hash uniqueness, valid foreign keys, immutable audit rows, and intact Stage 1-8 tables.
- [ ] Run `npm run test:worker -- worker-tests/adminAuthMigration.test.ts` and confirm failure because `0011` and its tables do not exist.
- [ ] Add the forward-only migration with checks, indexes, a partial unique active-session index, immutable audit triggers, session immutable-field protection, and no credential row.
- [ ] Re-run the targeted migration test and keep it green.

## Task 2: Drive cryptography, privacy helpers, and offline provisioning from tests

**Files:**
- Create: `worker-tests/adminPassword.test.ts`
- Create: `worker-tests/clientFingerprint.test.ts`
- Create: `worker-tests/adminProvision.test.ts`
- Create: `worker/security/adminPassword.ts`
- Create: `worker/security/clientFingerprint.ts`
- Create: `worker/security/adminCookies.ts`
- Create: `worker/security/adminOrigin.ts`
- Create: `scripts/admin/provision-admin.mjs`
- Modify: `package.json`

**Interfaces:**
- `createPasswordRecord(password, options?) -> Promise<AdminPasswordRecord>` always creates a fresh 16-byte salt and 32-byte key at 600000 iterations.
- `verifyAdminPassword(password, record) -> Promise<boolean>` and `verifyDummyAdminPassword(password, iterations?) -> Promise<false>` use constant-time derived-byte comparison.
- `deriveClientFingerprint(request) -> Promise<{ clientFingerprintHash; userAgentHash }>` exposes only SHA-256 hex values.
- CLI scripts `admin:provision:local` and `admin:provision:remote` accept only optional `--rotate`, prompt with hidden passwords twice, and never create a public bootstrap API.

- [ ] Write password tests for normalization, validation, salt uniqueness, exact parameter sizes, correct/wrong passwords, Base64 stability, constant-time helper use, dummy derivation, and measured 600000-iteration workerd/API behavior.
- [ ] Write fingerprint tests showing IPv4 `/24`, IPv6 `/48`, unknown IP handling, User-Agent normalization, and absence of raw inputs.
- [ ] Write provisioning tests with injected prompt/runner boundaries for first creation, singleton rejection, explicit rotation, password-version increment, new salt, session revocation, audit rows, no secret stdout/SQL, and `finally` cleanup.
- [ ] Run the targeted files and confirm expected missing-module failures.
- [ ] Implement the minimal Worker helpers and Node provisioning tool; temporary SQL may contain only salt/hash records, uses OS temp permissions, and is always deleted.
- [ ] Re-run targeted tests and confirm all pass without reducing PBKDF2 parameters.

## Task 3: Drive administrator HTTP authentication, limits, CSRF, sessions, and audit

**Files:**
- Create: `worker-tests/adminApi.test.ts`
- Create: `worker-tests/adminAuth.test.ts`
- Create: `worker/http/adminResponses.ts`
- Create: `worker/security/adminRateLimit.ts`
- Create: `worker/security/adminCsrf.ts`
- Create: `worker/auth/adminAuth.ts`
- Create: `worker/services/adminAudit.ts`
- Create: `worker/routes/adminLogin.ts`
- Create: `worker/routes/adminSession.ts`
- Create: `worker/routes/adminAudit.ts`
- Create: `worker/routes/admin.ts`
- Modify: `worker/router.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- `POST /api/admin/login`: strict JSON/origin validation, generic credential errors, rate limit, one active session, two cookies.
- `GET /api/admin/session`: authenticated safe projection and safe CSRF rotation.
- `POST /api/admin/logout`: authenticated CSRF-protected revocation with idempotent cookie clearing.
- `GET /api/admin/audit-logs`: fixed-order cursor pagination, action/outcome allowlists, safe metadata, and a non-recursive viewed audit.
- All `/api/admin/*` responses include no-store/no-cache/nosniff/no-referrer headers and sanitized `requestId` errors.

- [ ] Write failing integration tests covering content type/size/shape/origin, generic failures, participant-cookie rejection, cookie attributes, token hashing, old-session revocation, failure and global limits, Retry-After, and privacy fields.
- [ ] Write failing direct-auth tests with injected server time for missing/wrong/revoked credentials, password-version mismatch, idle/absolute expiry exactly-once audits, 5-minute touch throttling, and fixed absolute expiry.
- [ ] Write failing CSRF/session/logout/audit tests for every cookie/header/hash/origin combination, CSRF rotation, logout replay, cursor stability, whitelist validation, immutable logs, and participant/admin separation.
- [ ] Run targeted administrator Worker tests and confirm missing routes/modules fail.
- [ ] Implement route-local error handling and D1 batches for composite login/logout facts; unknown administrator paths remain JSON 404.
- [ ] Re-run targeted tests, then the full Worker suite.

## Task 4: Drive `/admin` routing and the minimal React console from tests

**Files:**
- Create: `src/admin/adminTypes.ts`
- Create: `src/admin/adminCsrf.ts`
- Create: `src/admin/adminApi.ts`
- Create: `src/admin/AdminLoginScreen.tsx`
- Create: `src/admin/AdminAuditLogPanel.tsx`
- Create: `src/admin/AdminDashboard.tsx`
- Create: `src/admin/AdminApp.tsx`
- Create: `src/admin/AdminApp.test.tsx`
- Create: `src/admin/adminApi.test.ts`
- Create: `src/RootApp.tsx`
- Create: `src/RootApp.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles/game.css`
- Modify: `worker/index.ts`

**Interfaces:**
- `RootApp({ pathname })` returns `AdminApp` only for `/admin` and `/admin/*`; all other paths return participant `App`.
- Admin write requests read only `mg_admin_csrf`, send `X-CSRF-Token`, refresh it once through `GET /api/admin/session`, and never touch browser storage.

- [ ] Write failing tests proving `/admin` isolation, unauthenticated/authenticated states, safe autocomplete, disabled submission, generic errors, password clearing, 429 copy, session expiry, audit pagination, logout CSRF, and zero secret/storage leakage.
- [ ] Write failing root-boundary tests proving participant pages never call administrator APIs and administrator pages never mount participant recovery or create formal sessions.
- [ ] Write failing Worker asset tests for `/admin` SPA fallback and the exact CSP/security headers without `unsafe-eval`.
- [ ] Implement the isolated admin components and minimal responsive dark UI; show no participant, scoring, export, delete, or configuration data.
- [ ] Apply CSP `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` to administrator documents.
- [ ] Re-run targeted frontend and Worker asset tests, then all frontend tests.

## Task 5: Validate operations, document, migrate remotely, and create the single commit

**Files:**
- Create: `docs/backend-stage-9-admin-auth-audit.md`
- Modify: `docs/superpowers/plans/2026-08-02-single-admin-auth-audit.md` only to mark completed checkboxes/results if useful.

**Interfaces:**
- Local and remote databases keep the policy row but zero administrator user/session/attempt/audit business rows after validation.

- [ ] Apply/list local migrations and query schema version, policy values, table counts, indexes, and triggers.
- [ ] Exercise isolated synthetic provisioning/login/rate-limit/revocation/CSRF/expiry/audit/rotation scenarios through automated tests; ensure no real credential or plaintext is emitted and canonical local admin business tables remain zero.
- [ ] Document PBKDF2 rationale and observed workerd duration, cookies, CSRF/Origin, rate limits, privacy fingerprinting, audit immutability, initialization/rotation, cleanup, local/remote commands, and Stage 10-12 deferrals.
- [ ] Run `npm run db:migrations:list:local`, `npm run db:migrate:local`, `npm run test:worker`, `npm test -- --run`, `npm run typecheck`, `npm run build`, `npm run check`, and `git diff --check`.
- [ ] Confirm migration `0011` contains neither an administrator nor password/hash seed, then run the remote migration list/apply/list gate.
- [ ] Query remote schema version/policy and confirm `admin_users`, `admin_sessions`, `admin_login_attempts`, and `admin_audit_logs` each contain zero rows; do not run remote provisioning or deployment.
- [ ] Review the complete diff for secret leakage, participant regressions, scope creep, error sanitization, and test evidence.
- [ ] Run the final verification commands again if review changes code.
- [ ] Commit all Stage 9 files once as `feat: add secure single-admin authentication`, verify clean status, and stop before Stage 10.

## Self-review Results

- Coverage: all fixed Stage 9 schema, cryptographic, provisioning, API, UI, isolation, local/remote migration, documentation, and stop-boundary requirements map to a task above.
- Placeholders: no TBD/TODO or deferred implementation placeholders are present; only explicitly out-of-scope Stage 10-12 features are named.
- Interface consistency: table/policy names, cookie names, endpoint paths, lifetimes, PBKDF2 parameters, and final commit text match the approved request exactly.
- Scope: participant gameplay, scoring, candidate materials, exports, deletion, config editing, deployment, `main`, and remote provisioning remain untouched.
