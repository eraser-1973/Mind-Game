# Participant Identity and Formal Session Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Stage 2 identity-registration and idempotent formal-session foundation without implementing later research-event, recovery, scoring, evidence, administrator, or deployment work.

**Architecture:** The existing Worker remains the same-origin entry point. A small route/validation/domain/repository/service stack validates identity input, binds each formal session to one published configuration set, atomically writes identity and research records to separate D1 tables, stores only a SHA-256 session-token hash, and returns the raw token only through an HttpOnly cookie. The React formal flow adds an identity screen after consent, keeps raw identity only in component memory, stores only a safe formal-session context, and initializes the formal game from the server-generated candidate order; quick mode keeps the current browser-only path.

**Tech Stack:** React 18, TypeScript 5, Vite 6, Cloudflare Workers, D1/SQLite migrations, Web Crypto, Vitest 3, Miniflare/workerd, react-test-renderer for stateful React flow tests.

## Global Constraints

- Work only in `D:\心理游戏\.worktrees\cloudflare-d1-backend` on `feature/cloudflare-d1-backend`.
- Start from commit `d729e66b86d95fb9564453465b9239bc7efea5fa`; do not modify or merge `main`.
- Do not push, open a PR, run `wrangler deploy`, or change the live Worker.
- Only formal mode may create participants or sessions; quick mode must never call the formal-session API or write D1.
- Raw identity is limited to name, student ID, and phone. At least one valid value is required.
- Raw identity must never enter research tables, React research data, URLs, console output, browser storage, API responses, or exported JSON.
- Browser storage may contain only the pending idempotency UUID and the safe formal-session context; it must never contain the session token or its hash.
- The D1 database stores only the SHA-256 token hash. The raw 32-byte token is sent only in the `mg_session` HttpOnly cookie.
- `started_at` and `deadline_at` remain `NULL`; identity registration must not start the 15-minute game timer.
- Do not implement consent/questionnaire persistence, recovery, ratings, evidence/points, sunk-cost, final submission, RDI, administrator features, CSV, deletion, or candidate-answer migration.
- Do not fix the unrelated PostCSS advisory or perform unrelated refactors.

---

## File Structure

- `migrations/0002_participants_sessions.sql`: configuration registry, separated participant identity, formal session, credential tables, constraints, indexes, seed version set, schema version 2.
- `worker/domain/identity.ts`: pure identity normalization and validation.
- `worker/domain/candidateOrder.ts`: cryptographically sourced Fisher-Yates order and order validation.
- `worker/domain/sessionToken.ts`: 32-byte token generation, SHA-256 hashing, and cookie serialization.
- `worker/validation/sessionRequest.ts`: method-independent request size/content type/idempotency/body validation and public error types.
- `worker/repositories/configurationSets.ts`: active published configuration lookup.
- `worker/repositories/participants.ts`: prior normalized-identity match counts and atomic participant/identity statement builders.
- `worker/repositories/sessions.ts`: session lookup, insert/credential statement builders, token rotation, and response projection.
- `worker/services/sessionCreation.ts`: idempotent create/replay orchestration and collision recovery.
- `worker/routes/sessions.ts`: HTTP status, public error envelope, and cookie handling only.
- `worker/router.ts`: route `/api/sessions` without changing health or unknown-API behavior.
- `worker-tests/runtime.ts`: apply every migration in lexical order to isolated D1 instances.
- `worker-tests/migrations.test.ts`: Stage 1 and Stage 2 schema/constraint tests.
- `worker-tests/identity.test.ts`: normalization and validation unit tests.
- `worker-tests/sessions.test.ts`: API, atomicity, token, cookie, idempotency, duplicates, and security integration tests.
- `src/api/formalSessions.ts`: typed same-origin API client using `credentials: 'include'`.
- `src/utils/formalSessionStorage.ts`: pending key and safe context persistence with structural validation.
- `src/components/IdentityForm.tsx`: in-memory identity form and retry UI.
- `src/types/game.ts`: formal-session public DTOs and `ResearchStep`/`ResearchData` additions, never raw identity.
- `src/App.tsx`: formal consent → identity → demographics flow; quick branch unchanged.
- `src/state/gameReducer.ts`: formal server order, quick browser order, and first-order selection.
- `src/data/researchFlow.ts`, `src/components/ConsentScreen.tsx`: accurate identity/privacy notice.
- `src/styles/game.css`: identity input/error/status styling within the existing research-card theme.
- `src/**/*.test.*`: API/storage/component/formal-order/quick-isolation regression tests.
- `docs/backend-stage-2-participants-sessions.md`: schema, privacy, API, storage, migration, rollback, and deferred Stage 3 scope.

## Data Boundaries

```text
participant_identity (restricted identity)
        │ participant_id
        ▼
participants ──< sessions (research/session metadata only)
                    │ session_id
                    ▼
              session_credentials (token hash only)

configuration_sets ──< sessions (copied immutable version fields)
```

`participant_identity` contains only the three identity fields and normalized lookup forms. `sessions` contains participant/session IDs, version binding, random order, duplicate flags, status, timestamps, and client version, but no name, student ID, or phone. Frontend `ResearchData` may reference a safe `FormalSessionContext`, never an identity object.

## Formal Session Creation Flow

1. Formal participant accepts the revised consent notice.
2. `IdentityForm` keeps entered identity only in React component state.
3. The browser obtains or creates one pending UUID in `sessionStorage` and reuses it after network failure.
4. `POST /api/sessions` validates method, JSON content type, 16 KiB body limit, UUID idempotency key, formal mode, and normalized identity.
5. The service first checks `sessions.creation_key`. Existing sessions rotate the credential hash and replay the original safe session projection with HTTP 200.
6. New sessions load the sole active/published configuration set, query duplicate student/phone matches, generate participant/session UUIDs, a secure 32-byte token, and an unbiased Fisher-Yates A-E order.
7. One parameter-bound `DB.batch()` inserts participant, identity, session, and credential. Any failure rolls the batch back. A concurrent creation-key conflict is resolved by loading and replaying the winning session.
8. The response sets `mg_session=<raw token>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400` and adds `Secure` only for HTTPS.
9. The JSON returns only IDs, versions, order, first candidate, step, and creation time.
10. The browser deletes the pending key, stores only `FormalSessionContext` in `localStorage`, updates the anonymous research participant ID, and moves to demographics.

## Idempotency and Configuration Binding

- `Idempotency-Key` is stored as `sessions.creation_key UNIQUE`.
- A replay never creates a second participant, identity, or session and never changes the original order/version binding.
- Each replay generates a new raw token and updates only `session_credentials.token_hash` and `rotated_at`.
- A unique-key race is never returned to the client; the loser reads the winner and follows the replay path.
- `configuration_sets` has a partial unique index for one active row and a check that only `published` rows can be active.
- Sessions copy task/material/point/scoring/benchmark/norm versions at creation, so changing the active set cannot alter old sessions.

## Local Storage Boundary

- `sessionStorage['mind-game.formal-session.creation-key.v1']`: one UUID only, removed after a confirmed creation.
- `localStorage['mind-game.formal-session.v1']`: participant/session IDs, config set, version object, candidate order, first candidate, and creation time only.
- Raw identity, cookie/token, token hash, duplicate flags, questionnaire data, and game events are never placed in either store.
- Corrupt JSON or invalid candidate order is ignored and removed from use; Stage 2 does not resume the application from it.

---

### Task 1: Add Stage 2 migration tests and schema

**Files:**
- Create: `migrations/0002_participants_sessions.sql`
- Modify: `worker-tests/runtime.ts`
- Modify: `worker-tests/migrations.test.ts`

**Interfaces:**
- Produces D1 tables `configuration_sets`, `participants`, `participant_identity`, `sessions`, and `session_credentials`.
- Produces the active `config-2026-07-v1` record and `app_metadata.schema_version = 2`.

- [ ] **Step 1: Extend the runtime to load all `migrations/*.sql` files in lexical order.**
- [ ] **Step 2: Write failing schema tests for table existence, schema version 2, the seed configuration, single-active enforcement, formal-only sessions, nonempty identity, and cascades.**
- [ ] **Step 3: Run `npm run test:worker -- worker-tests/migrations.test.ts` and confirm failures are caused by missing migration 0002.**
- [ ] **Step 4: Implement the migration with SQLite `CHECK`, foreign-key, JSON, and partial unique-index constraints plus normalized lookup indexes.**
- [ ] **Step 5: Re-run the migration tests and confirm they pass.**

### Task 2: Implement pure identity, order, and token domains with TDD

**Files:**
- Create: `worker/domain/identity.ts`
- Create: `worker/domain/candidateOrder.ts`
- Create: `worker/domain/sessionToken.ts`
- Create: `worker-tests/identity.test.ts`

**Interfaces:**
- Produces `normalizeIdentity(input)`, `validateIdentity(input)`, `generateCandidateDisplayOrder()`, `isCandidateDisplayOrder()`, `generateSessionToken()`, `hashSessionToken(token)`, and `serializeSessionCookie(token, secure)`.

- [ ] **Step 1: Write failing tests for null normalization, whitespace/name collapse, student uppercase/no-space normalization, phone punctuation removal/regex, empty identity, overlength values, deterministic A-E Fisher-Yates validation, 32-byte token entropy encoding, SHA-256 hash shape, and cookie attributes.**
- [ ] **Step 2: Run the focused tests and verify feature-missing failures.**
- [ ] **Step 3: Implement minimal pure functions using Web Crypto and non-identifying typed validation errors.**
- [ ] **Step 4: Re-run the focused tests and refactor only after green.**

### Task 3: Add session request validation, repositories, and service

**Files:**
- Create: `worker/validation/sessionRequest.ts`
- Create: `worker/repositories/configurationSets.ts`
- Create: `worker/repositories/participants.ts`
- Create: `worker/repositories/sessions.ts`
- Create: `worker/services/sessionCreation.ts`
- Create: `worker-tests/sessions.test.ts`

**Interfaces:**
- Consumes normalized identity, configuration records, secure order/token functions, and D1 prepared statements.
- Produces `parseCreateSessionRequest(request)`, `createOrReplayFormalSession(db, input)`, and a safe session projection with `created` status and raw token kept only in service memory.

- [ ] **Step 1: Write failing API-service integration tests for 201 creation, formal-only mode, UUID key, JSON/size validation, no active config, four atomic records, version copies, null timers, token hash only, response redaction, duplicate flags, idempotent replay, token rotation, unique-conflict sanitization, concurrency, and batch rollback.**
- [ ] **Step 2: Run `npm run test:worker -- worker-tests/sessions.test.ts` and confirm failures are due to missing service modules.**
- [ ] **Step 3: Implement request validation without logging request bodies or identity values.**
- [ ] **Step 4: Implement parameter-bound repositories and `DB.batch()` creation.**
- [ ] **Step 5: Implement replay-before-create and conflict-after-create recovery, rotating the token hash on every replay.**
- [ ] **Step 6: Re-run focused tests and refactor only while green.**

### Task 4: Expose `POST /api/sessions`

**Files:**
- Create: `worker/routes/sessions.ts`
- Modify: `worker/router.ts`
- Modify: `worker-tests/sessions.test.ts`
- Modify: `worker-tests/routing.test.ts`

**Interfaces:**
- Produces HTTP 201 for new sessions, 200 for replay, public JSON errors with request IDs, and the `mg_session` cookie.

- [ ] **Step 1: Add failing route tests for POST success, GET 405/Allow, 400/413/415/503 status mapping, HTTPS Secure, HTTP non-Secure, unknown API 404 preservation, and sanitized SQL failures.**
- [ ] **Step 2: Run focused Worker tests and confirm route-missing failures.**
- [ ] **Step 3: Add the route and router branch; keep response payloads no-store and omit identity/token/hash/duplicates/database details.**
- [ ] **Step 4: Run all Worker tests.**

### Task 5: Add frontend contracts, API client, and safe storage

**Files:**
- Modify: `src/types/game.ts`
- Create: `src/api/formalSessions.ts`
- Create: `src/api/formalSessions.test.ts`
- Create: `src/utils/formalSessionStorage.ts`
- Create: `src/utils/formalSessionStorage.test.ts`

**Interfaces:**
- Produces `FormalSessionContext`, `FormalSessionVersions`, request/response DTOs, `createFormalSession()`, pending-key helpers, and safe context load/save helpers.

- [ ] **Step 1: Write failing API tests for headers, credentials include, success-envelope validation, status-specific typed errors, and network errors.**
- [ ] **Step 2: Write failing storage tests for key reuse/removal, safe context persistence, corrupt JSON, invalid order, and absence of identity/token fields.**
- [ ] **Step 3: Run focused tests and verify expected feature-missing failures.**
- [ ] **Step 4: Implement the typed client without logging body contents and implement injectable storage helpers.**
- [ ] **Step 5: Add `formalSession: FormalSessionContext | null` to `ResearchData`; do not add raw identity fields.**
- [ ] **Step 6: Re-run focused tests.**

### Task 6: Add identity page and revised consent with TDD

**Files:**
- Create: `src/components/IdentityForm.tsx`
- Create: `src/components/IdentityForm.test.tsx`
- Modify: `src/components/ConsentScreen.tsx`
- Modify: `src/data/researchFlow.ts`
- Modify: `src/components/ResearchFlowScreens.test.tsx`
- Modify: `src/styles/game.css`

**Interfaces:**
- Produces an in-memory form that calls async `onSubmit(identity)` only when at least one valid field exists and remains mounted with a retry message on failure.

- [ ] **Step 1: Add failing tests for consent wording, no pre-session fake participant ID, empty identity disabled, each single valid field, phone error, pending disabled state, and retry error UI.**
- [ ] **Step 2: Run focused tests and confirm expected failures.**
- [ ] **Step 3: Implement the form using controlled component memory only and the existing research-card visual system.**
- [ ] **Step 4: Replace the contradictory consent copy with the approved collection/separation/access/retention/quick-mode notice while preserving voluntary participation and exit.**
- [ ] **Step 5: Re-run focused tests.**

### Task 7: Integrate formal flow and preserve quick isolation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/state/gameReducer.ts`
- Modify: `src/state/gameReducer.test.ts`
- Create: `src/App.test.tsx`
- Modify: `src/components/GameScreen.test.tsx`
- Modify: `src/utils/researchData.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Formal: consent → identity/session creation → demographics → pre-task → game using server order.
- Quick: start → local randomized game/report/export with no identity/API/storage.

- [ ] **Step 1: Add the React test-renderer dev dependency without changing React/Vitest versions.**
- [ ] **Step 2: Write failing tests for formal identity routing, failed submit staying on identity, successful submit moving to demographics, retry key reuse, quick no-identity/no-API, safe ResearchData, formal server order/first selection, missing formal context rejection, and unchanged quick shuffle.**
- [ ] **Step 3: Run focused tests and verify expected failures.**
- [ ] **Step 4: Integrate the API/storage workflow in `App`; clear the pending creation key on explicit reset, never store identity, and do not implement restore.**
- [ ] **Step 5: Make formal game initialization require a valid server context and set `selectedCandidateId` to the order's first item; keep quick Fisher-Yates behavior.**
- [ ] **Step 6: Re-run all frontend tests.**

### Task 8: Verify local migrations and complete Worker behavior

**Files:**
- No production file changes unless a failing test or smoke test identifies a defect; every defect first receives a regression test.

- [ ] **Step 1: Run `npm run db:migrations:list:local` and record pending 0002.**
- [ ] **Step 2: Run `npm run db:migrate:local` and verify `schema_version=2`, five tables, one active configuration, and no identity/session rows before smoke data.**
- [ ] **Step 3: Run Worker, frontend, typecheck, build, and `npm run check`.**
- [ ] **Step 4: Start `npm run dev:worker` and manually verify health, quick isolation, formal consent/identity flow, D1 records, order/first candidate, retry replay, cookie attributes, and storage redaction using non-personal synthetic local test values only.**
- [ ] **Step 5: Stop the local Worker and verify no background process remains.**

### Task 9: Apply remote schema only after all local gates

**Files:**
- No source changes.

- [ ] **Step 1: Query remote table counts and confirm the production D1 has no formal participant/session/identity data.**
- [ ] **Step 2: Inspect 0002 and confirm it contains no test identity values or candidate answer keys.**
- [ ] **Step 3: Run remote migration list, apply, then list again.**
- [ ] **Step 4: Query schema version, seed configuration, table names, and zero identity/session counts.**
- [ ] **Step 5: Do not run `wrangler deploy`; do not send API requests containing identity to the remote Worker.**

### Task 10: Document, verify, and commit Stage 2

**Files:**
- Create: `docs/backend-stage-2-participants-sessions.md`
- Optionally modify: `README.md` only for concise commands.

- [ ] **Step 1: Document schema relationships, data separation, API/idempotency/cookie/storage/normalization/duplicate/version/order rules, local/remote commands, rollback, and Stage 3 exclusions.**
- [ ] **Step 2: Explicitly note that revised consent wording still requires research-lead/ethics approval.**
- [ ] **Step 3: Run `npm install`, Worker tests, frontend tests, typecheck, build, check, migration status checks, `git diff --check`, and secret/identity-placeholder scans.**
- [ ] **Step 4: Review every Stage 2 requirement against code and tests; report any gap instead of hiding it.**
- [ ] **Step 5: Commit exactly `feat: add participant identity and formal sessions`.**
- [ ] **Step 6: Re-run the full verification on the committed clean tree and stop without Stage 3, push, deployment, merge, or PR.**

## Remote Migration and Rollback

- Local: `npm run db:migrations:list:local`, then `npm run db:migrate:local`.
- Remote only after all gates: `npm run db:migrations:list:remote`, `npm run db:migrate:remote`, then list again.
- D1 production migrations are forward-only for this stage. If 0002 fails, stop and report the exact Wrangler result; do not mark it complete or deploy.
- Before deployment (not part of this stage), application rollback is Git/Worker-version rollback. Schema rollback must use a separately reviewed compensating migration, not manual destructive SQL.
- Because no live Worker deploy occurs, the newly created remote tables remain unreachable from the current production frontend/API until a later explicitly authorized deployment.

## Explicitly Not Implemented in Stage 2

- Consent, demographics, pre/post questionnaire, or game-event server persistence.
- Refresh/session recovery or outbox/offline replay beyond the one session-creation idempotency key.
- Server-authoritative ratings, points, evidence, timers, sunk-cost, final decision, completion, RDI, or quality flags.
- Administrator login, configuration UI, export, deletion, rate limiting, or candidate answer migration.
- Live Worker deployment, Git push, PR, or main merge.
