# Prepilot Derived Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every production change follows a failing-test-first cycle.

**Goal:** Persist versioned, reproducible prepilot RES, EAC, EACS, DDS, GDS, and SLS outputs after a formal session completes, while explicitly withholding RCI and RDI values until real reliability and norm parameters exist.

**Architecture:** Add an append-only Stage 8 schema for scoring configuration, canonical source snapshots, immutable runs, per-candidate components, and metric outputs. A pure domain module owns validated formulas and canonical fingerprints; an internal scoring service reads only sealed server facts, builds a privacy-minimized snapshot, calculates available prepilot metrics, and atomically persists a new current run. Formal completion calls this internal service after its own completion transaction, so scoring failure is isolated and never changes the participant response or public resume shape.

**Post-review forward repair:** Migration 0008 reached the empty remote database
before final review. The review-discovered normalized-key and published-benchmark
guards therefore ship as `0009_stage8_integrity_guards.sql`, keep application
`schema_version=8`, and do not rewrite applied D1 history.

A second review found missing formal expert-publication, snapshot/session,
evidence-item-version, and event-time defenses after 0009 had also been applied.
Those database guards therefore ship forward-only as
`0010_stage8_publication_and_snapshot_guards.sql`; the service-side validation and
failure fingerprint were strengthened in the same change, without changing
`schema_version=8` or rewriting 0008/0009.

Final review also closed two version bypasses in unapplied 0010 and the service:
`current_app_baseline` can never become non-provisional, and unsupported or
missing scoring/benchmark/norm/reliability requests create safe idempotent
failed runs while retaining the requested versions in the failure fingerprint.

**Tech Stack:** TypeScript, Cloudflare Worker, D1/SQLite, Web Crypto SHA-256, Vitest, Miniflare, Wrangler, React 18, and Vite 6.

## Global Constraints

- Work only in `D:\心理游戏\.worktrees\cloudflare-d1-backend` on `feature/cloudflare-d1-backend`, starting at `7608aee23944a1a681c7343910ad40779f72d72e`.
- Do not switch, merge, reset, stash, clean, force-overwrite, push, create a PR, deploy a Worker, or modify `main`.
- Create one final commit only: `feat: calculate versioned prepilot metrics`.
- Add migration 0008 plus forward-only Stage 8 integrity guards; never edit
  applied migrations 0001-0010 or raw formal behavior tables.
- Keep Formal participant API and UI neutral: no metrics, benchmark values, answer keys, RDI, percentile, or resilience label in completion/resume responses.
- Keep Quick mode and its existing local MVP report unchanged; Quick must never create a D1 scoring run.
- Insert no fabricated expert score, norm parameter, or reliability parameter.
- Treat `benchmark-1.0.0` values as provisional current-app baselines: A=51, B=86, C=60, D=83, E=70.
- Store future RDI weights but do not calculate a database RDI: RES=.35, EACS=.35, DDS=.15, GDS=.10, SLS=.05.
- Every Stage 8 run is `is_pre_pilot=1`, `interpretation_status=research_only`, and `rdi_status=norms_unavailable` unless its inputs are structurally incomplete, in which case the run remains research-only and records explicit missing reasons.
- Use server timestamps, server evidence rows, server point ledger, sealed ratings, sealed final decision, and session-bound versions as the only scoring facts.
- A failed scoring attempt must not roll back or alter the already committed formal completion and must not replace the last successful/partial current run.
- Do not repair the unrelated npm/PostCSS audit warning in this stage.
- Apply migration 0008 remotely only after all local tests, local migration/smoke checks, synthetic-data cleanup, and a remote zero-business-row gate pass; do not seed remote participant, behavior, or scoring-run data.

---

## File Map and Interfaces

- `migrations/0008_prepilot_derived_metrics.sql`: additive configuration/run/snapshot/metric schema, provisional seeds, immutability, indexes, and schema version 8.
- `migrations/0009_stage8_integrity_guards.sql`: normalized version-key and published provisional benchmark guards.
- `migrations/0010_stage8_publication_and_snapshot_guards.sql`: formal expert publication, expert-row immutability, and snapshot/session guards.
- `worker/domain/prepilotMetrics.ts`: pure validated formulas and coverage/status helpers.
- `worker/domain/scoringFingerprint.ts`: recursive canonical JSON normalization and SHA-256 fingerprinting.
- `worker/services/scoringInput.ts`: reads sealed D1 facts and returns a privacy-minimized `PrepilotScoringSnapshot`.
- `worker/services/prepilotScoring.ts`: computes and atomically persists idempotent scoring runs; exports no HTTP handler.
- `worker/services/formalCompletion.ts`: invokes `ensurePrepilotScoringRun` only after completion is committed and preserves its public projection on scoring failure.
- `worker-tests/prepilotDerivedMetricsMigration.test.ts`: Stage 8 schema, seed, constraint, immutability, and privacy tests.
- `worker-tests/prepilotMetrics.test.ts`: formula, validation, coverage, and fingerprint unit tests.
- `worker-tests/prepilotScoring.test.ts`: input extraction, persistence, idempotency, recomputation, history, and failure-isolation integration tests.
- `worker-tests/prepilotIntegrityMigration.test.ts`: first forward-repair trigger coverage.
- `worker-tests/prepilotPublicationGuards.test.ts`: final publication and snapshot guard coverage.
- `docs/backend-stage-8-prepilot-derived-metrics.md`: research/operations contract, formula definitions, migration commands, cleanup, and future recomputation boundary.

Required domain signatures:

```ts
export type MetricStatus =
  | 'calculated' | 'partial' | 'unavailable' | 'not_applicable'
  | 'pending_parameters' | 'norms_unavailable';

export function calculateRes(input: {
  benchmarkValue: number;
  costAfterRisk: number;
  totalPoints: number;
  benchmarkIsProvisional: boolean;
}): { value: number; status: 'calculated' | 'partial' };

export function calculateEacComponent(direction: -1 | 0 | 1, t1: number, t3: number): number | null;
export function calculateEacsComponent(direction: -1 | 0 | 1, t1: number, t3: number, deltaTimeSec: number): number | null;
export function aggregateAvailableCase(values: Record<string, number | null>, requiredCandidateIds: readonly string[]): {
  value: number | null; status: 'calculated' | 'partial' | 'unavailable'; coverageCount: number; requiredCount: number; missingCandidateIds: string[];
};
export function calculateRci(eac: number, sd: number, reliability: number): number;
export function calculateDds(input: { costAfterRisk: number; totalPoints: number; timeAfterRiskSec: number; totalTimeSec: number }): number;
export function calculateGds(input: { shallowCandidateCount: number; candidateCount: number; benchmarkValue: number; benchmarkIsProvisional: boolean }): { value: number; status: 'calculated' | 'partial' };
export function calculateSls(choiceStatus: string, choice: string | null): { value: number | null; status: MetricStatus; missingReason: string | null };
export function calculateRdiWithNorms(values: Record<'RES' | 'EACS' | 'DDS' | 'GDS' | 'SLS', number>, norms: Record<string, { mean: number; sd: number }>): { rdiZ: number; rdiT: number };
export function canonicalizeScoringInput(value: unknown): string;
export async function fingerprintScoringInput(value: unknown): Promise<string>;
export async function ensurePrepilotScoringRun(db: D1Database, sessionId: string, overrides?: { scoringVersion?: string; benchmarkVersion?: string }): Promise<{ runId: string; created: boolean; runStatus: 'completed' | 'partial' | 'failed' }>;
```

## Task 1: Add the Stage 8 migration through schema-first TDD

**Files:**
- Create: `worker-tests/prepilotDerivedMetricsMigration.test.ts`
- Create: `migrations/0008_prepilot_derived_metrics.sql`

- [ ] **Step 1: Write migration tests that require the exact eleven tables, indexes, seeds, privacy boundary, and immutable history**

```ts
it('publishes provisional prepilot configuration without fabricated parameters', async () => {
  const db = await createMigratedDatabase();
  expect(await scalar(db, "SELECT value FROM app_metadata WHERE key='schema_version'"))
    .toBe('8');
  expect(await row(db, "SELECT total_rdi_enabled, level_enabled FROM scoring_definitions WHERE scoring_version='RDI-2.0-prepilot'"))
    .toEqual({ total_rdi_enabled: 0, level_enabled: 0 });
  expect(await rows(db, "SELECT candidate_id, benchmark_value FROM benchmark_candidate_values WHERE benchmark_version='benchmark-1.0.0' ORDER BY candidate_id"))
    .toEqual([{ candidate_id: 'A', benchmark_value: 51 }, { candidate_id: 'B', benchmark_value: 86 }, { candidate_id: 'C', benchmark_value: 60 }, { candidate_id: 'D', benchmark_value: 83 }, { candidate_id: 'E', benchmark_value: 70 }]);
  expect(await scalar(db, 'SELECT COUNT(*) FROM benchmark_expert_scores')).toBe(0);
  expect(await scalar(db, 'SELECT COUNT(*) FROM norm_metric_parameters')).toBe(0);
  expect(await scalar(db, 'SELECT COUNT(*) FROM reliability_parameters')).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and confirm RED because migration 0008/tables do not exist**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotDerivedMetricsMigration.test.ts`

- [ ] **Step 3: Implement the additive SQL migration**

Create configuration tables `scoring_definitions`, `benchmark_sets`, `benchmark_candidate_values`, `benchmark_expert_scores`, `norm_sets`, `norm_metric_parameters`, and `reliability_parameters`. Create run tables `scoring_runs`, `scoring_input_snapshots`, `derived_metric_values`, and `candidate_metric_components` with JSON checks, allowed status checks, foreign keys, cascading run children, one-current-run partial unique index, source-fingerprint uniqueness, no-update triggers for snapshots/values/components, and a scoring-run trigger that permits only `is_current: 1 -> 0`. Seed the published prepilot definition, provisional benchmark set, exact A-E values/directions/core flags, and optional unbound empty `norm-prepilot-draft`; set schema version 8 last.

- [ ] **Step 4: Run the focused migration test and all prior migration tests until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotDerivedMetricsMigration.test.ts worker-tests/migrations.test.ts worker-tests/formalGameMigration.test.ts worker-tests/evidencePointsMigration.test.ts worker-tests/sunkCostFinalMigration.test.ts worker-tests/postTaskCompletionMigration.test.ts`

## Task 2: Implement formula and fingerprint primitives through TDD

**Files:**
- Create: `worker-tests/prepilotMetrics.test.ts`
- Create: `worker/domain/prepilotMetrics.ts`
- Create: `worker/domain/scoringFingerprint.ts`

- [ ] **Step 1: Write failing hand-calculation and rejection tests**

```ts
expect(calculateRes({ benchmarkValue: 80, costAfterRisk: 1, totalPoints: 5, benchmarkIsProvisional: true }))
  .toEqual({ value: 64, status: 'partial' });
expect(calculateEacComponent(-1, 80, 50)).toBe(30);
expect(calculateEacsComponent(-1, 80, 50, 120)).toBe(0.25);
expect(calculateDds({ costAfterRisk: 1, totalPoints: 5, timeAfterRiskSec: 120, totalTimeSec: 600 })).toBe(80);
expect(calculateGds({ shallowCandidateCount: 2, candidateCount: 5, benchmarkValue: 80, benchmarkIsProvisional: true }))
  .toEqual({ value: 32, status: 'partial' });
expect(calculateSls('answered', 'stop_loss').value).toBe(100);
expect(calculateSls('answered', 'give_up').value).toBe(80);
expect(calculateSls('answered', 'continue').value).toBe(30);
```

Also require: invalid ranges throw rather than clamp; missing T3 remains null; direction-zero E is excluded; available-case coverage 0/1-3/4 maps to unavailable/partial/calculated; RCI rejects SD<=0 and reliability<=0 or >1; RDI requires all explicit norm SDs >0; canonical fingerprints are key-order independent, array-order sensitive, and stable.

- [ ] **Step 2: Run the focused test and confirm RED because modules are absent**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotMetrics.test.ts`

- [ ] **Step 3: Implement minimal pure functions with explicit finite/range assertions**

Use the PDF formulas exactly, seconds for EACS, no T2 substitution, no default SD/reliability/norm, no silent clamp, and stable recursive object-key sorting. Preserve sequence-bearing arrays in their input order and sort only upstream source collections where the snapshot contract explicitly requires candidate or server-sequence order.

- [ ] **Step 4: Run the focused domain test until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotMetrics.test.ts`

## Task 3: Build the privacy-minimized scoring snapshot through TDD

**Files:**
- Create: `worker/services/scoringInput.ts`
- Create: `worker-tests/prepilotScoring.test.ts`

- [ ] **Step 1: Write failing integration tests for source selection, risk anchoring, server time, and privacy**

```ts
const snapshot = await buildPrepilotScoringSnapshot(db, completedSessionId);
expect(snapshot.riskExposure.primary?.candidateId).toBe('A');
expect(snapshot.riskExposure.primary?.sequenceNo).toBe(firstKeyRiskSequence);
expect(snapshot.finalDecision.serverSubmittedAt).toBe(finalServerTime);
expect(JSON.stringify(snapshot)).not.toMatch(/full_name|student_id|phone|token|trueAbility|trueFit|isToxic|riskFlags|resumeSummary|evidenceText/i);
```

Require the snapshot to include: immutable session/config/timing/order/points facts; final decision; T1/T2/T3 ratings with exact server-submitted timestamps and seen-evidence IDs; evidence events and item IDs with server sequence/time/cost/contains-key-risk; point ledger; stage choices; sunk-cost status/choice/points; provisional benchmark values/directions/core flags. The primary risk anchor is the earliest server-sequenced `contains_key_risk=1` event; all anchors are retained; post-risk cost counts only successful same-candidate unlocks with a strictly greater sequence and cross-checks the ledger.

- [ ] **Step 2: Run the focused integration test and confirm RED because the builder is absent**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts -t "builds a privacy-minimized canonical snapshot"`

- [ ] **Step 3: Implement exact D1 reads and consistency validation**

Throw safe typed scoring errors for missing completion/final/run/benchmark, impossible time intervals, bad point conservation, mismatched evidence/ledger costs, invalid candidate order, or unsupported versions. Do not read `participant_identity`; do not select material text or private candidate fields.

- [ ] **Step 4: Run the focused snapshot tests until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts -t "snapshot|risk|privacy|ledger"`

## Task 4: Compute and persist immutable scoring runs through TDD

**Files:**
- Create: `worker/services/prepilotScoring.ts`
- Extend: `worker-tests/prepilotScoring.test.ts`

- [ ] **Step 1: Write failing tests for calculated, partial, unavailable, pending, and norms-unavailable outputs**

Create completed formal fixtures covering: T3 plus stop_loss; T2 without T3; no risk/no sunk trigger; timeout_unanswered. Assert RES and GDS use provisional benchmark values and are `partial`; EAC/EACS use only A-D valid T1+T3 components; RCI is null/pending_parameters; DDS is calculated only after risk exposure and otherwise not_applicable; SLS maps choices or records explicit missing reasons; RDIz/RDIT remain null/norms_unavailable with no percentile/level.

- [ ] **Step 2: Run focused tests and confirm RED because ensure/persistence is absent**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts -t "persists prepilot metrics"`

- [ ] **Step 3: Implement calculation assembly and one atomic persistence batch**

Insert one `scoring_runs` row, one canonical `scoring_input_snapshots` row, metric rows for RES/EAC/EACS/DDS/GDS/SLS/RCI/RDIz/RDIT, and A-E component rows. Record formula/scoring/benchmark/norm versions, complete input JSON, coverage, missing reasons, run status, research-only flags, and server compute time. Set old current to zero and insert the new current run in the same D1 batch only for completed/partial output.

- [ ] **Step 4: Run focused persistence tests until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts -t "persists|coverage|pending|not applicable|timeout"`

## Task 5: Add idempotency, recomputation, and failure isolation through TDD

**Files:**
- Extend: `worker/services/prepilotScoring.ts`
- Extend: `worker-tests/prepilotScoring.test.ts`

- [ ] **Step 1: Write failing tests for identical fingerprints, new-version recomputation, historical sealing, and failed runs**

```ts
const first = await ensurePrepilotScoringRun(db, sessionId);
const replay = await ensurePrepilotScoringRun(db, sessionId);
expect(replay).toEqual({ ...first, created: false });
expect(await countRuns(db, sessionId)).toBe(1);

const recomputed = await ensurePrepilotScoringRun(db, sessionId, { scoringVersion: 'RDI-2.0-prepilot-test-2' });
expect(recomputed.runId).not.toBe(first.runId);
expect(await currentRunIds(db, sessionId)).toEqual([recomputed.runId]);
```

Corrupt a ledger after completion, assert a failed scoring run with a safe failure code/detail, assert completion remains committed, repair the fixture, rerun, and assert the successful/partial run becomes current while the failed run remains historical. Attempt ordinary updates to old snapshot/metric/component/run fields and require rejection.

- [ ] **Step 2: Run focused tests and confirm RED on duplicate/recompute/failure behavior**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts -t "idempotent|recompute|failure|immutable"`

- [ ] **Step 3: Implement uniqueness lookup, safe failed-run recording, and atomic current promotion**

Use `session_id + scoring_version + benchmark_version + norm key + source_fingerprint` uniqueness. Failed runs always use `is_current=0`; a failure never demotes an existing current result. Recompute is an internal function call only; do not add a route.

- [ ] **Step 4: Run focused tests until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/prepilotScoring.test.ts`

## Task 6: Trigger internal scoring after formal completion without changing public behavior

**Files:**
- Modify: `worker/services/formalCompletion.ts`
- Extend: `worker-tests/formalCompletionApi.test.ts`
- Extend: `worker-tests/prepilotScoring.test.ts`

- [ ] **Step 1: Write failing completion integration tests**

Assert a successful active or timeout `/end` call commits completion first, creates one scoring run, and returns the exact prior safe completion projection without a scoring field. Assert same/different-key end replay fills a missing run idempotently. Force scoring input failure and assert HTTP completion success, terminal session state, a failed scoring run, no participant-visible error, and no normal current metric result.

- [ ] **Step 2: Run focused completion tests and confirm RED because completion does not score**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/formalCompletionApi.test.ts worker-tests/prepilotScoring.test.ts -t "automatic|completion|replay|isolates"`

- [ ] **Step 3: Refactor completion return flow minimally**

After either a new completion transaction or an already-completed projection is resolved, call `ensurePrepilotScoringRun(db, sessionId)` inside a safe isolation boundary. The scoring service itself persists safe failed-run diagnostics; a last-resort scoring exception is logged without changing the response. Do not add scoring data to resume or completion types.

- [ ] **Step 4: Run completion, routing, resume, and frontend tests until GREEN**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/formalCompletionApi.test.ts worker-tests/prepilotScoring.test.ts worker-tests/routing.test.ts`

Run: `npm test -- --run`

## Task 7: Document, locally migrate, smoke-test, and clean synthetic data

**Files:**
- Create: `docs/backend-stage-8-prepilot-derived-metrics.md`

- [ ] **Step 1: Write the operational/research documentation**

Document every formula and status, provisional benchmark risk, absent expert/norm/reliability rows, privacy-minimized snapshot, canonical fingerprint, current/history behavior, scoring-failure isolation, Formal/Quick isolation, local/remote migration commands, synthetic cleanup, Stage 9 boundary, and future versioned historical recomputation.

- [ ] **Step 2: Apply and inspect local migration**

Run: `npm run db:migrations:list:local`

Run: `npm run db:migrate:local`

Run: `npx wrangler d1 execute mind-game-formal --local --command "SELECT value FROM app_metadata WHERE key='schema_version'; SELECT scoring_version,total_rdi_enabled,level_enabled FROM scoring_definitions; SELECT benchmark_version,status,expert_count FROM benchmark_sets;"`

- [ ] **Step 3: Execute the eight required real local scenarios**

Use the existing same-origin Worker/browser smoke harness and direct D1 verification for: T3+stop_loss, T2 without T3, not_triggered, timeout_unanswered, identical ensure replay, test-version recompute, scoring failure then repair/recompute, and participant browser completion/resume/Quick isolation. Save no identity values or scores to committed fixtures.

- [ ] **Step 4: Remove every synthetic row and test-only scoring configuration**

Delete the synthetic participants so cascades remove identity/session/game/questionnaire/completion/scoring facts; explicitly remove test-only scoring/benchmark/norm/reliability configurations. Verify participant and behavior tables, `scoring_runs`, snapshots, metrics, and components are zero while `RDI-2.0-prepilot` and `benchmark-1.0.0` remain.

## Task 8: Run complete local verification, then guard and apply the remote migration

- [ ] **Step 1: Run fresh complete local verification**

Run: `npm run test:worker`

Run: `npm test -- --run`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm run check`

- [ ] **Step 2: Confirm local repository and database cleanliness**

Run read-only D1 count queries across participants, identity, sessions, questionnaire, game, completion, and scoring-run tables; every synthetic/business count must be zero. Confirm `git diff --check` has no whitespace errors and `git status --short` contains only intended Stage 8 source/docs/tests/migration files.

- [ ] **Step 3: Apply the remote zero-row safety gate**

Run read-only remote counts for all existing participant/business tables before migration. If any count is nonzero, stop without applying 0008. If all are zero, run `npm run db:migrate:remote` and verify schema version 8, eleven tables, published prepilot definition, provisional A-E benchmark values, zero expert/norm/reliability parameter rows, and zero scoring-run/business rows.

- [ ] **Step 4: Do not deploy the Worker**

The migration may be applied after the gate; the Worker remains undeployed because this task explicitly forbids deployment.

## Task 9: Final review and single commit

- [ ] **Step 1: Self-review against every attachment requirement**

Search for forbidden private keys and public scoring routes; inspect that Formal completion/resume response types and UI are unchanged; inspect Quick tests; verify no default norm/reliability/RDI value, no fabricated expert row, and no T2 fallback for T3.

- [ ] **Step 2: Run the final fresh verification commands again if any review edit occurs**

Use the full Task 8 command set after the last source/test/document change.

- [ ] **Step 3: Stage only intended files and create exactly one commit**

Run: `git add docs migrations worker worker-tests src/AppStage7.test.tsx vitest.worker.config.ts`

Run: `git commit -m "feat: calculate versioned prepilot metrics"`

- [ ] **Step 4: Verify final branch state**

Run: `git status --short; git branch --show-current; git rev-parse HEAD; git log --oneline 7608aee..HEAD`

Expected: clean status, branch `feature/cloudflare-d1-backend`, exactly one new commit, no push/PR/deploy, and Stage 9 absent.

## Self-review Results

- Spec coverage: migration/configuration, formulas, snapshot/fingerprint, risk/time semantics, unavailable parameters, run idempotency/history/failure isolation, completion integration, UI isolation, local smoke/cleanup, remote gate/migration, documentation, and the single-commit constraint each map to a task.
- Placeholder scan: the plan contains no deferred placeholders, default norm/reliability values, or unspecified error-handling step.
- Type consistency: the scoring input, formula outputs, fingerprint function, and `ensurePrepilotScoringRun` signatures are defined once and reused consistently.
- Intentional deviation from the writing-plans default: the user explicitly requires one final commit, so intermediate tasks do not create commits.
