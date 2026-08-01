# Formal Post-task Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every production change follows a failing-test-first cycle.

**Goal:** Complete the formal research flow after the sealed final hiring decision by persisting the five-item post-task state assessment and fifteen-item task-experience instrument, then atomically ending the formal session and rendering a neutral thank-you screen. Preserve the server as the formal source of truth and keep Quick mode on its existing local report/export path.

**Architecture:** Extend the additive D1 schema with immutable questionnaire sequencing and one completion record per session. Route phase-specific questionnaire validation through one public endpoint and one instrument registry. A dedicated completion service allocates the existing per-game server sequence for post, task-experience, and session-complete events. The React app uses a small formal-completion API/controller layer, keeps only UUID retry keys in `sessionStorage`, hydrates navigation from the authoritative resume projection, and never persists questionnaire answers in browser storage.

**Tech Stack:** React 18, TypeScript, Vite 6, Cloudflare Worker, D1/SQLite, Vitest, Miniflare, Wrangler, and the existing browser smoke tooling.

## Global constraints

- Work only in `D:\心理游戏\.worktrees\cloudflare-d1-backend` on `feature/cloudflare-d1-backend`, starting at `aafce88797df9252c09285f72fbb1c7bc2398efa`.
- Do not switch, merge, reset, stash, clean, force-overwrite, push, create a PR, deploy, or modify `main`.
- Add only `migrations/0007_post_task_completion.sql`; do not edit migrations 0001-0006.
- Do not change questionnaire wording, grouping, scale ranges, candidate data, scoring, final decision facts, or Quick report behavior.
- Formal completion must not calculate or render RES, EAC, EACS, RCI, DDS, GDS, SLS, RDI, benchmark answers, or resilience labels.
- Formal questionnaire values may exist in React memory while the form is open, but never in `localStorage` or `sessionStorage`. Pending browser values are UUIDs only.
- All successful formal writes are server-authoritative, immutable, authenticated with `mg_session`, idempotent, and sequence-numbered by the existing `game_runs.last_sequence_no` contract.
- Preserve the known PostCSS audit notice; do not upgrade unrelated dependencies.
- Create one final commit only: `feat: complete formal post-task research flow`.

## State and instrument contracts

### Formal state machine

`post_task -> task_experience -> completion_pending -> completed`

- An active final keeps `completion_status=in_progress` until `/end`, then becomes `completed`.
- A timeout final keeps `completion_status=timeout` through `/end`.
- Both modes set `sessions.current_step=completed` and `sessions.ended_at` from server time.
- `game_runs.finalized_at`, `final_decisions`, and `sessions.final_submit_mode` remain unchanged.
- Completed sessions remain resumable but reject every game and questionnaire write.

### Post-task state assessment

- Phase: `post`
- Instrument: `state-assessment-post-1.0.0`
- Exact items, once each: `stress`, `fatigue`, `attention`, `mood`, `physicalDiscomfort`
- Every value is an integer from 0 through 10; every `touched` is `true`; every `answeredAt` is valid and plausible ISO-8601.
- A final decision and `current_step=post_task` are required. Both active (`in_progress`) and timeout sessions are accepted.

### Task-experience and manipulation check

- Phase: `task_experience`
- Instrument: `task-experience-1.0.0`
- Exact 1-10 items: `timePressure1`, `timePressure2`, `resourceLimit1`, `resourceLimit2`, `socialEvaluation1`, `socialEvaluation2`, `outcomeResponsibility1`, `outcomeResponsibility2`, `uncontrollability1`, `uncontrollability2`, `cognitiveLoad1`, `cognitiveLoad2`, `cognitiveLoad3`, `cognitiveLoad4`.
- Exact 0-10 item: `decisionConfidence`.
- Every item is touched independently. `decisionConfidence` is not populated from the final-decision confidence.
- A saved post submission and `current_step=task_experience` are required.
- Public `phase=manipulation` remains unavailable and returns `PHASE_NOT_AVAILABLE`.

## Task 1: Add migration 0007 and schema tests

**Files**

- Create: `migrations/0007_post_task_completion.sql`
- Create: `worker-tests/postTaskCompletionMigration.test.ts`
- Modify only if needed: `worker-tests/runtime.ts`

**Migration design**

- Add nullable `questionnaire_submissions.sequence_no`; retain null for historical pre submissions.
- Add checks/triggers requiring a positive sequence for post/task-experience and null for pre/manipulation submissions accepted by older schema rules.
- Add partial unique indexes for `(session_id, sequence_no)` when non-null, one `post` submission per session, and one `task_experience` submission per session.
- Add immutable-field triggers for questionnaire submission identity/phase/version/event/sequence and for all questionnaire answer values/touched/timestamps. Trigger behavior must not block `ON DELETE CASCADE`.
- Add nullable `sessions.post_task_completed_at` and `sessions.task_experience_completed_at` plus one-way immutability triggers.
- Create `completion_records` with UUID primary/event IDs, unique session/event/sequence, foreign keys to session/final/post/task rows, server/client times, mode/status consistency checks, indexes, and immutable rows.
- Rebuild `game_events` additively to allow `post_task_submit`, `task_experience_submit`, and `session_complete` while preserving every Stage 1-6 row and index.
- Set `app_metadata.schema_version=7` last.
- Because SQLite cannot enforce a cross-table comparison in a `CHECK`, verify `server_completed_at >= final_decisions.server_submitted_at` transactionally in the completion service and test that service invariant.

**TDD sequence**

1. Write migration tests for schema version, columns, indexes, historical pre compatibility, phase uniqueness, completion mode/status combinations, sequence uniqueness, sealing, cascade, and Stage 1-6 preservation.
2. Run only the new migration tests and confirm failure because 0007/schema objects do not exist.
3. Implement the additive migration.
4. Run new migration tests plus all prior migration tests until green.

## Task 2: Define instrument registry and strict request validation

**Files**

- Create: `worker/domain/questionnaireInstruments.ts`
- Modify: `worker/validation/researchIntakeRequest.ts`
- Create or extend: `worker-tests/postTaskQuestionnaireApi.test.ts`
- Preserve: all Stage 3 pre-questionnaire tests

**Interfaces**

- Registry entries declare `phase`, `instrumentVersion`, ordered item IDs, and integer min/max per item.
- The shared parser accepts only exact request/body/answer keys, JSON under 16 KiB, UUID idempotency key, matching supported phase/version, unique exact items, `touched=true`, valid ISO timestamps, and plausible client time.
- Pre keeps the Stage 3 request shape including `clientStartedAt`.
- Post and task experience use the Stage 7 shape without `clientStartedAt`.
- `manipulation` returns `400 PHASE_NOT_AVAILABLE`; unknown phases and private/client-authoritative fields are rejected.

**TDD sequence**

1. Add table-driven failing validation tests for all boundaries: missing, duplicate, unknown items; 0/1/10 edges; non-integers; touched false; wrong version/phase; unknown fields; non-JSON; oversized bodies; missing/invalid key; identity/final/RDI/sequence fields.
2. Run focused tests and confirm the current pre-only parser fails Stage 7 cases.
3. Implement registry-driven parsing without duplicating route code.
4. Run focused tests and all Stage 3 research-intake tests.

## Task 3: Persist post and task questionnaires with server sequences

**Files**

- Modify: `worker/repositories/researchIntake.ts`
- Modify: `worker/services/researchIntake.ts`
- Modify: `worker/routes/researchIntake.ts`
- Modify: `worker/auth/sessionAuth.ts` only if route status policy needs a typed extension
- Extend: `worker-tests/postTaskQuestionnaireApi.test.ts`

**Write contract**

- One shared questionnaire route dispatches to phase-specific service behavior.
- Replay lookup happens before step rejection. Same event/session returns HTTP 200 with the original sequence and `created=false`.
- A different key after a sealed phase returns `409 QUESTIONNAIRE_ALREADY_SUBMITTED`.
- Post and task writes use the current run’s `last_sequence_no + 1` and a D1 atomic batch to insert submission, insert all answer rows, append the minimal game event payload, compare-and-set the run sequence, set the server completion timestamp, and advance the session step.
- Race losers reread the event or sealed phase; no unique-constraint text is exposed.
- A rejected or replayed request never increments the server sequence.
- The event payload contains only phase, instrument version, and item count, never answer values.

**TDD sequence**

1. Add failing active/timeout, gate, persistence, sequence, timestamp, idempotency, concurrency, sealing, rollback, completed-lock, and no-final/no-post cases.
2. Confirm red against the pre-only route/service.
3. Implement repository primitives and transactional services.
4. Run the focused API tests, Stage 3 tests, and all formal game tests.

## Task 4: Implement the atomic session-end endpoint

**Files**

- Create: `worker/validation/formalCompletionRequest.ts`
- Create: `worker/services/formalCompletion.ts`
- Create: `worker/routes/formalCompletion.ts`
- Modify: `worker/router.ts`
- Create: `worker-tests/formalCompletionApi.test.ts`

**Endpoint**

- `POST /api/sessions/{sessionId}/end`
- Requires JSON, UUID `Idempotency-Key`, `mg_session`, and exact body keys `sessionId`, `clientCompletedAt`, `clientSequence`.
- URL/body/cookie session IDs must match. Client sequence is audited but never used as the server sequence.
- Reject client completion status/mode/candidate/confidence/times/score/level/identity fields.

**Completion transaction**

- Before writing, validate current step, final decision, matching final mode, finalized run, correct post/task versions, exactly 5+15 touched answers, point-ledger conservation, and server completion time not earlier than the sealed final time.
- Determine the terminal status from the sealed final mode: active -> completed; timeout -> timeout.
- Atomically insert one `completion_records` row, append a minimal `session_complete` event, compare-and-set the run sequence, set `current_step=completed`, set server `ended_at`, and update only the active session’s status.
- Same idempotency key returns 200 with `created=false` and `alreadyCompleted=true`.
- A different key after completion returns the same safe completion projection. Concurrent calls converge on one row/event/sequence and never expose SQL or unique errors.
- Data inconsistency returns `500 SESSION_DATA_INCONSISTENT`, increments `sessions.error_count`, and writes no completion/ended time.

**TDD sequence**

1. Add failing request, active/timeout, missing/corrupt prerequisite, ledger, atomicity, sequence, idempotency, concurrent, completed-lock, method, and sanitized-error tests.
2. Confirm route 404/failures.
3. Implement parser, service, route, and router entry.
4. Run completion tests and all Worker tests.

## Task 5: Extend safe resume for all post-game steps

**Files**

- Modify: `worker/services/researchIntake.ts`
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/routes/researchIntake.ts`
- Modify: `worker-tests/formalCompletionApi.test.ts`
- Modify: `worker-tests/sunkCostFinalApi.test.ts`

**Projection**

- `postTask`: saved flag, instrument version, submitted time, and optionally the safe answer map while not completed.
- `taskExperience`: corresponding saved metadata/answer map while not completed.
- `completion`: completed flag, server-derived completion status/final mode/time/sequence.
- For completed sessions, return only the minimal completion-safe projection if desired; never identity, candidate answers, benchmarks, RDI, levels, token/hash, or internal ledger.

**Navigation rules**

- `post_task` -> post-task form.
- `task_experience` -> task-experience form; post is sealed.
- `completion_pending` -> neutral completing screen and retry `/end`; neither questionnaire reopens.
- `completed` -> thank-you screen; neither questionnaire nor `/end` reopens.
- Timeout sessions follow the same screens and participant-facing wording.

**TDD sequence**

1. Add failing resume tests for active and timeout at each step, sealed-form behavior, completion pending, completed, and sensitive-field absence.
2. Implement shared safe questionnaire/completion lookup and integrity checks.
3. Run resume and all Worker suites.

## Task 6: Add formal completion API, retry keys, and controller

**Files**

- Create: `src/api/formalCompletion.ts`
- Create: `src/api/formalCompletion.test.ts`
- Create: `src/hooks/useFormalCompletionController.ts`
- Create: `src/hooks/useFormalCompletionController.test.tsx` if hook-level coverage is clearer than App-only tests
- Modify: `src/utils/formalPendingKeys.ts`
- Modify: `src/utils/formalPendingKeys.test.ts`
- Modify: `src/types/game.ts`
- Modify: `src/types/formalGame.ts` as needed for resume composition
- Modify: `src/api/formalResearch.ts`
- Modify: `src/api/formalResearch.test.ts`
- Modify: `src/utils/formalSessionContext.ts`

**Client contract**

- Add typed calls for post questionnaire, task experience, and session end with strict response parsing.
- Add UUID-only keys: `mind-game.pending.post-task.v1`, `mind-game.pending.task-experience.v1`, `mind-game.pending.session-end.v1`.
- Generate a key on first submit, reuse after network failure, clear on success, and reconcile `QUESTIONNAIRE_ALREADY_SUBMITTED` through resume.
- Never serialize form values, touched state, final decision, completion result, or questionnaire responses into browser storage.
- Controller exposes post/task/end pending and error states, hydration from resume, retry behavior, and an explicit home cleanup action. It does not read the HttpOnly cookie.

**TDD sequence**

1. Add failing API parser/payload, retry-key, storage-content, resume, and Quick-zero-call tests.
2. Implement minimum API/controller/storage behavior.
3. Run focused client tests and all existing formal API/storage tests.

## Task 7: Build touched formal forms and neutral completion UI

**Files**

- Modify: `src/components/StateAssessmentScreen.tsx`
- Modify: `src/components/TaskExperienceScreen.tsx`
- Create: `src/components/FormalCompletionScreen.tsx`
- Create: `src/components/FormalCompletionPendingScreen.tsx` if a separate neutral retry surface keeps App small
- Remove or stop using in runtime: `src/components/FormalPostTaskPause.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/FormalGameScreen.tsx`
- Modify: `src/styles/game.css` only for incremental matching styles
- Modify: `src/components/ResearchFlowScreens.test.tsx`
- Modify: `src/App.test.tsx`
- Add: `src/components/FormalCompletionScreen.test.tsx`

**Form behavior**

- Post screen reuses the five current questions at 0-10, starts with null/untouched values, treats an actively selected zero as valid, focuses/highlights the first missing item, disables during submit, and stays in memory on API error.
- Formal task experience preserves current wording/group/order; starts all 15 values null/untouched; first 14 use 1-10 and decision confidence 0-10; no final-confidence default or back navigation to a sealed post form; button text is `提交正式测评`.
- Successful task submission immediately advances to the completion-pending controller and calls `/end`.

**Completion screen**

- Render only `提交成功`, the neutral saved-data thank-you copy, and `返回首页` for both active and timeout.
- Never render timeout wording, ReportScreen, generateReport, RDI/metrics, answer correctness, candidate recommendation, JSON/CSV, or raw data.
- Returning home clears `mind-game.formal-session.v1`, current formal pending UUID keys, and React formal state, then renders StartScreen. It does not issue a server delete and does not auto-clear before explicit return.

**Quick isolation**

- Quick never creates formal completion keys or calls questionnaire/end APIs.
- Quick continues directly through its current local report and JSON export behavior.

**TDD sequence**

1. Add failing component/App tests for all touched/default/zero/error/retry/resume/completed/hidden-output/home-cleanup/Quick-isolation cases.
2. Confirm failures before production UI changes.
3. Implement components, controller wiring, and state transitions without adding completion logic to the Quick reducer.
4. Run focused tests and the full frontend suite.

## Task 8: Documentation, migration, real smoke, cleanup, and one commit

**Files**

- Create: `docs/backend-stage-7-post-task-completion.md`
- Create or modify: `scripts/stage7-local-smoke.mjs`
- Create or modify: `scripts/stage7-browser-smoke.mjs`

**Documentation**

- Record exact instruments/scales/touched behavior, sealed submissions, sequence rules, four-step state machine, `/end`, active/timeout distinction, completion record fields, ended-vs-finalized meaning, resume projection, neutral formal completion page, Quick report preservation, browser storage boundary, migration/test/smoke/cleanup commands, forward-only rollback, and Stage 8 boundary.

**Verification order**

1. `npm run db:migrations:list:local`
2. `npm run db:migrate:local`
3. `npm run db:migrations:list:local`
4. `npm run test:worker`
5. `npm test -- --run`
6. `npm run typecheck`
7. `npm run build`
8. `npm run check`
9. `git diff --check`
10. Start `npm run dev:worker` and run active, timeout, four resume points, three lost-response retries, completed-write lock, Quick isolation, and return-home browser/storage scenarios.
11. Delete only clearly marked local Stage 7 synthetic participants and verify every business table is zero.
12. Confirm migration contains no identity/test answers and query remote business tables read-only for zero rows.
13. `npm run db:migrations:list:remote`
14. `npm run db:migrate:remote`
15. `npm run db:migrations:list:remote`
16. Verify remote schema version 7, new objects, and every remote business-table count remains zero.
17. Re-run full `npm run check`, `git diff --check`, security-field searches, branch/head/status checks.
18. Create exactly one commit: `feat: complete formal post-task research flow`.
19. Confirm clean status; do not push, deploy, merge, or start Stage 8.

## Real smoke assertions

- Active final -> post (5 answers) -> task experience (15 answers) -> completion: one row/event per phase, increasing sequences, active session `completed`, `ended_at` set, final facts unchanged, thank-you screen only.
- Timeout final follows the same forms/screen; terminal session status remains `timeout` and no participant-facing timeout label appears.
- Refresh at post/task/completion-pending/completed resumes the exact server step without reopening or duplicating prior submissions.
- Lost response retries reuse UUIDs and add no submission, answer, event, completion, or sequence duplicates.
- Every questionnaire/game write after completion rejects while resume succeeds.
- Quick sends zero formal API calls, creates zero formal pending keys/D1 rows, and retains its report plus JSON export.
- Return home clears only local pointers/UUIDs and retains the server completion row.

## Rollback

- Application rollback: revert the single Stage 7 feature commit only on this feature branch; never rewrite `main`.
- D1 rollback is forward-only once 0007 is applied. Do not delete `d1_migrations` rows or rewrite migrations 0001-0007. If a defect is found, preserve additive columns/tables and issue a reviewed compensating migration.
- Before remote migration, local Wrangler state may be recreated only through the established local migration workflow after confirmed synthetic-data cleanup.
- Since no deployment is authorized, the online Worker remains unchanged even after the remote schema-only migration.

## Stage 8 boundary

Stage 8 remains entirely unimplemented in this plan: no RES, EAC, EACS, RCI, DDS, GDS, SLS, RDI, norms, resilience labels, formal report, candidate-answer feedback, administrator UI/authentication, configuration publishing, CSV ZIP export, deletion workflow, quality auto-exclusion, or offline batch queue.
