# Stage 3 Research Intake and Resume Implementation Plan

> Branch: `feature/cloudflare-d1-backend`
> Baseline: `dd001b721ee77a38b37a90610924a3506fad7cc1`
> Scope: consent, demographics, pre-task questionnaire, authenticated resume, and pre-game integrity only.

## Guardrails

- Keep `main` untouched and do not create a pull request or deploy the Worker.
- Keep quick mode completely local and outside all formal APIs and persistence keys.
- Do not implement T1/T2/T3 persistence, evidence/points, game timing, sunk cost, final decisions, post-task data, scoring, admin, export, or configuration editing.
- Never persist raw identity, session cookies, token hashes, demographics, or questionnaire answers in browser storage.
- Make the server `current_step` authoritative. The frontend may cache only the safe session projection.
- Write failing tests before each production change and keep all Stage 2 tests green.

## Task 1: Migration and session starting step

**Files**

- Add `migrations/0003_research_intake_resume.sql`
- Modify `worker-tests/migrations.test.ts`
- Modify `worker/repositories/sessions.ts`
- Modify `worker/services/sessionCreation.ts`
- Modify Stage 2 session expectations in `worker-tests/sessions.test.ts`

**Red test**

- Assert schema version 3, all three new tables, constraints, indexes, cascade behavior, unique pre-task submission, revision/current-row uniqueness, and `json_valid` experience payloads.
- Assert new formal sessions start at `consent_pending`, with null game timestamps.

**Implementation**

- Create `consent_records`, `demographic_revisions`, `questionnaire_submissions`, and `questionnaire_answers` with the requested keys, checks, foreign keys, and indexes.
- Update `app_metadata.schema_version` to `3`.
- Change only the initial server step from `demographics` to `consent_pending`.

**Verification**

- `npm run test:worker -- --run worker-tests/migrations.test.ts worker-tests/sessions.test.ts`

## Task 2: Reusable session-cookie authentication and step domain

**Files**

- Add `worker/auth/sessionAuth.ts`
- Add `worker/domain/sessionSteps.ts`
- Add `worker/validation/researchIntakeRequest.ts`
- Add `worker-tests/sessionAuth.test.ts`
- Add `worker-tests/sessionSteps.test.ts`
- Add `worker-tests/researchIntakeValidation.test.ts`

**Red test**

- Cover absent, malformed, mismatched, revoked, completed, and valid cookies without session-existence leakage.
- Cover every allowed/forbidden Stage 3 transition.
- Cover JSON type, 16 KiB limit, UUID idempotency keys, timestamps, exact keys, enum values, mutually exclusive experience values, exact five questionnaire items, touched flags, integer range, and direct-identity-field rejection.

**Implementation**

- Parse `mg_session`, hash with SHA-256, query credential/session, and compare fixed-length hashes in constant time.
- Return one authenticated safe session object; do not rotate or expose credentials.
- Centralize `consent_pending -> demographics -> pre_task -> game_ready` rules in a pure module.
- Centralize request parsing and public validation errors.

**Verification**

- Run the three focused test files, then all Worker tests.

## Task 3: Consent persistence API

**Files**

- Add `worker/repositories/researchIntake.ts`
- Add `worker/services/researchIntake.ts`
- Add `worker/routes/consent.ts`
- Modify `worker/router.ts`
- Add `worker-tests/consent.test.ts`

**Red test**

- Cover success (201), replay (200), atomic step advance, accepted=false, wrong version, invalid/future time, wrong step, wrong session/cookie, missing headers, non-JSON, oversized body, completed/revoked sessions, and sanitized failures.

**Implementation**

- Require authenticated formal in-progress session plus UUID `Idempotency-Key`.
- Insert one accepted consent record and atomically advance `current_step` to `demographics`.
- Replay the same `event_id` without duplicating rows or advancing twice.

## Task 4: Demographic revision API

**Files**

- Add `worker/routes/demographics.ts`
- Extend repository/service/validation modules
- Modify `worker/router.ts`
- Add `worker-tests/demographics.test.ts`

**Red test**

- Cover all enum whitelists, experience uniqueness/exclusivity, unknown/identity fields, first submit, retry idempotency, revision increment, exactly one current row, `pre_task` edit without regression, and `game_ready` rejection.

**Implementation**

- Save each accepted revision, atomically clear prior `is_current`, assign `revision_no`, and set the new current row.
- Advance `demographics` to `pre_task`; keep `pre_task` unchanged for allowed corrections.

## Task 5: Pre-task questionnaire API

**Files**

- Add `worker/routes/questionnaires.ts`
- Extend repository/service/validation modules
- Modify `worker/router.ts`
- Add `worker-tests/questionnaires.test.ts`

**Red test**

- Cover exact phase/instrument/item set, five unique answers, integers 0-10, `touched=true`, timestamps, atomic save, `game_ready` transition, null game clocks, idempotent replay, new-key overwrite rejection, and sanitized database failure.

**Implementation**

- Insert one pre-task submission and five answers atomically.
- Advance only `pre_task -> game_ready`; do not start the game or set timers.

## Task 6: Authenticated resume API

**Files**

- Add `worker/routes/sessionResume.ts`
- Extend repository/service modules with safe read projections
- Modify `worker/router.ts`
- Add `worker-tests/sessionResume.test.ts`

**Red test**

- Cover all four pre-game steps, current demographics, pre-task answers, no PII/token/duplicate markers/backend answers, no mutation/cookie rotation, unauthorized/revoked/completed cases, and explicit `GAME_RESUME_NOT_READY` for `playing`.

**Implementation**

- Route `GET /api/sessions/:sessionId/resume` via exact UUID path parsing.
- Return safe session/config/order, consent state, latest demographic revision, pre-task questionnaire, and game resume metadata.

## Task 7: Frontend API client and safe operation keys

**Files**

- Add `src/api/formalResearch.ts`
- Add `src/api/formalResearch.test.ts`
- Modify `src/types/game.ts`
- Modify `src/utils/formalSessionContext.ts`
- Modify `src/utils/formalSessionStorage.ts`
- Modify their tests

**Red test**

- Cover request paths, credentials, idempotency headers, safe envelope parsing, typed errors, network failures, resume shape validation, independent pending keys, retry reuse, success clearing, corrupt context removal, and quick-mode isolation.

**Implementation**

- Add typed `saveConsent`, `saveDemographics`, `savePreTaskQuestionnaire`, and `resumeFormalSession` functions.
- Store only safe context with `currentStep`; use independent sessionStorage UUID keys for create/consent/demographics/pre-task.
- Never persist operation payloads or research answers.

## Task 8: Explicit questionnaire interaction tracking

**Files**

- Modify `src/components/ScaleQuestion.tsx`
- Modify `src/components/StateAssessmentScreen.tsx`
- Modify `src/data/researchFlow.ts`
- Modify `src/utils/researchData.ts` if normalization signatures require it
- Modify `src/components/ResearchFlowScreens.test.tsx`

**Red test**

- Verify an untouched slider has a visible neutral display but does not count as an answer.
- Verify all five items must receive user interaction, focus moves to the first missing item, and an explicitly chosen 0 is valid.
- Verify `initialValue` from authenticated resume is treated as already submitted display data without silently manufacturing new answers.

**Implementation**

- Keep form values nullable until interaction; track `touched` separately.
- Submit exactly five normalized answer objects with `touched: true` and client timestamps.

## Task 9: Formal App orchestration and refresh recovery

**Files**

- Modify `src/App.tsx`
- Add/modify `src/App.test.tsx`
- Modify `src/components/DemographicForm.tsx` for async errors/pending if needed
- Add a small reusable formal recovery/status screen only if required

**Red test**

- Cover create -> consent retry on same session -> demographics -> pre-task -> game-ready.
- Cover refresh to consent, demographics, pre-task, and game-ready.
- Cover no context (no API), 401 (clear context), network error (preserve context/retry), corrupt JSON, completed response, and unsupported playing state.
- Cover server step precedence, demographic revisions, form error retention, no raw identity replay after session creation, and quick-mode zero formal calls/keys.

**Implementation**

- Add startup recovery state machine (`idle`, `checking`, `resumed`, `no_session`, `unauthorized`, `unsupported_game_resume`, `error`).
- After identity creation, save safe context, then save already accepted consent with its own stable event ID before navigation.
- Save demographics and pre-task to the server before advancing.
- Derive UI route from the authenticated server `currentStep`; never infer progression from browser-only answers.

## Task 10: Local database, full regression, smoke test, documentation, and commit

**Files**

- Add `docs/backend-stage-3-research-intake-resume.md`
- Update this plan only if implementation evidence requires corrections

**Verification gates**

1. `npm run db:migrations:list:local`
2. `npm run db:migrate:local`
3. `npm run test:worker`
4. `npm test -- --run`
5. `npm run typecheck`
6. `npm run build`
7. `npm run check`
8. Inspect `git diff --check` and changed-file scope.
9. Start local Worker, exercise full intake, revision, resume, invalid cookie, network/retry behavior, and quick isolation; query D1 and delete all synthetic rows.
10. Confirm remote production tables contain zero formal records. Only then apply migration 0003 remotely and verify schema/tables; do not create remote research records and do not deploy.

**Commit**

- Stage only Stage 3 files.
- Commit once with exact message: `feat: persist research intake and resume sessions`.
- Do not push, merge, create a PR, or deploy.

## Rollback

- Code rollback is the single Stage 3 commit revert on this feature branch.
- Local D1 can be deleted/recreated from migrations after smoke testing.
- Remote migration 0003 is additive; rollback requires an explicit forward migration and is therefore gated behind all local verification and an empty-production-data check.
