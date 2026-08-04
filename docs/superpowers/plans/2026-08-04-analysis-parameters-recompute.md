# Stage 10B Analysis Parameters and Recalculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable expert/norm/reliability/scoring configuration, formal RCIi/RDI calculation, and resumable administrator-controlled recalculation without exposing analysis to participants.

**Architecture:** Preserve `prepilotScoring.ts` as the Stage 8 orchestrator. Add a formal-analysis service and recompute-job service that share pure formula/fingerprint helpers and consume only sealed D1 facts. Extend the existing Stage 10A admin request guard, receipts, audit and configuration editor patterns instead of adding a second security model.

**Tech Stack:** Cloudflare Worker, D1/SQLite, TypeScript, React 18, Vite, Vitest, Miniflare.

## Global Constraints

- Work only on `feature/cloudflare-d1-backend`; do not switch, merge, push, deploy, create a PR, reset, stash or clean.
- Keep the forward migration chain immutable: `0013_analysis_configuration_recompute.sql` is schema 11, `0014_expert_benchmark_management.sql` is schema 12, and `0015_analysis_parameter_management.sql` is schema 13. Do not change migrations 0001-0014.
- Schema 13 adds lifecycle-only fields and protections; no migration seed may contain expert scores, norm values, reliability values, jobs, scoring runs, administrator or participant data.
- Published analysis objects, validation history, operation receipts, scoring runs and job history remain immutable.
- Formal automatic scoring uses the session-bound versions; administrator jobs use their explicit published target tuple without modifying session versions.
- Stage 8 `prepilotScoring.ts` behavior remains unchanged. Stage 10B has an independent formal-analysis orchestrator.
- RCI is candidate-level RCIi only; RDI uses strict complete-case; never generate a level or percentile.
- Formal completion/resume and Quick remain analysis-free.
- Every new production behavior starts with a failing test and a recorded red run.
- Each implementation task ends with targeted tests, `npm run typecheck`, `npm run build`, and a focused commit only when all are green.

---

## File map

| File | Responsibility |
| --- | --- |
| `migrations/0013_analysis_configuration_recompute.sql` | Schema 11, analysis versions, policies, standard scores, jobs and immutable triggers |
| `worker/domain/analysisConfiguration.ts` | Typed draft documents, validation and safe projections |
| `worker/domain/analysisFingerprint.ts` | Canonical SHA-256 fingerprints for the four configuration types and formal run inputs |
| `worker/domain/formalAnalysisMath.ts` | Database-free sample SD, RCIi, Z, weighted RDIz/RDIT helpers |
| `worker/services/formalScoring.ts` | Published-parameter loading, formal artifact calculation and immutable run persistence |
| `worker/services/scoringRecomputeJobs.ts` | Frozen item creation, conditional lease claim and batch processing |
| `worker/routes/adminAnalysis.ts` | Protected analysis-version and recompute APIs |
| `worker/routes/adminConfiguration.ts` | Norm/reliability fields in configuration-set validation and projections |
| `worker/services/scoringInput.ts` | Read the session reliability binding without changing Stage 8 acceptance semantics |
| `worker/router.ts`, `worker/routes/admin.ts` | Route new administrator API namespace |
| `src/admin/AdminAnalysisConsole.tsx` | Analysis configuration and recompute-job UI composition |
| `src/admin/AdminBenchmarkEditor.tsx` | Expert matrix and anonymous-code notice |
| `src/admin/AdminNormReliabilityEditors.tsx` | Structured norm/reliability forms |
| `src/admin/AdminScoringDefinitionEditor.tsx` | Typed RDI 2.0 weights/configuration form |
| `src/admin/AdminRecomputeJobs.tsx` | Manual batch controls and safe job projection |
| `src/admin/adminApi.ts`, `src/admin/adminTypes.ts` | Admin analysis DTOs and idempotent client methods |
| `src/admin/AdminDashboard.tsx` | Add Analysis navigation entry |
| `worker-tests/*analysis*.test.ts`, `src/admin/*Analysis*.test.tsx` | Regression and red-green coverage |
| `docs/backend-stage-10b-analysis-configuration.md` | Operational design, formulas, privacy, migration and cleanup notes |

## Stage 10B parameter-management boundary

- Norm drafts contain exactly `RES`, `EACS`, `DDS`, `GDS`, and `SLS` parameters. Each update supplies finite means, positive SDs, a sample size of at least two, and a non-empty population note.
- Reliability drafts support only `EAC`; SD must be positive, reliability is in `(0, 1]`, and no benchmark or norm SD is used as a default.
- Scoring definitions are structured only: `RDI-2.0`, `second`, five exact weights summing to one, `available_case_mean`, `earliest_key_risk`, and `strict_complete_case`. `levelEnabled` is always `false`.
- Publishing never activates a configuration set, binds a session, triggers a recalculation, or exposes analysis values to participants. Published versions are immutable.
- This batch manages parameters only. It does not yet calculate formal RCIi/RDI, standard scores, RDIz/RDIT, or recomputation jobs.

## Task 1: Establish schema-11 red tests and migration contract — completed

**Files:**
- Create: `worker-tests/analysisConfigurationMigration.test.ts`
- Create: `migrations/0013_analysis_configuration_recompute.sql`

**Interfaces:**
- Produces schema tables `benchmark_candidate_policies`, `analysis_validation_runs`, `derived_metric_standard_scores`, `scoring_recompute_jobs`, `scoring_recompute_items`.
- Extends `configuration_sets` and `sessions` with nullable `reliability_version`.

- [x] **Step 1: Write failing migration tests**

```ts
test('0013 advances schema to 11 and creates analysis tables', async () => {
  const db = await migrateEmptyDatabase()
  expect(await schemaVersion(db)).toBe('11')
  await expectTables(db, [
    'benchmark_candidate_policies', 'analysis_validation_runs',
    'derived_metric_standard_scores', 'scoring_recompute_jobs',
    'scoring_recompute_items',
  ])
})

test('backfills only initial benchmark policies', async () => {
  const db = await migrateEmptyDatabase()
  expect(await policies(db, 'benchmark-1.0.0')).toEqual([
    ['A', -1, 1], ['B', 1, 1], ['C', -1, 1], ['D', 1, 1], ['E', 0, 0],
  ])
})
```

- [x] **Step 2: Run red tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/analysisConfigurationMigration.test.ts`

Expected: FAIL because migration 0013 and schema tables do not exist.

- [x] **Step 3: Implement only schema and constraints**

Create 0013 with no synthetic analysis values. Add check constraints, foreign keys, unique current-run and per-job/session indexes, immutable triggers, required JSON checks and published-state guards. Rebuild only tables whose existing check constraints cannot be forward-extended.

- [x] **Step 4: Run migration tests green**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/analysisConfigurationMigration.test.ts`

Expected: PASS, including preservation of Stage 8 and Stage 10A rows.

## Task 2: Add pure analysis configuration and formula contracts — completed

**Files:**
- Create: `worker/domain/analysisConfiguration.ts`
- Create: `worker/domain/analysisFingerprint.ts`
- Create: `worker/domain/formalAnalysisMath.ts`
- Create: `worker-tests/analysisConfigurationDomain.test.ts`
- Create: `worker-tests/formalAnalysisMath.test.ts`

**Interfaces:**

```ts
export function validateExpertBenchmark(document: ExpertBenchmarkDocument): ValidationResult
export function validateNorm(document: NormDocument): ValidationResult
export function validateReliability(document: ReliabilityDocument): ValidationResult
export function validateScoringDefinition(document: ScoringDefinitionDocument): ValidationResult
export function sampleMeanAndSd(values: readonly number[]): { mean: number; sampleSd: number }
export function calculateRcii(eac: number, sd: number, reliability: number): number
export function calculateRdi(input: CompleteCaseInput): CompleteCaseResult
```

- [x] **Step 1: Write failing domain tests**

```ts
test('accepts two complete anonymous experts and calculates sample SD', () => {
  expect(validateExpertBenchmark(completeTwoExpertDocument).errors).toEqual([])
  expect(sampleMeanAndSd([52, 56])).toEqual({ mean: 54, sampleSd: Math.sqrt(8) })
})

test('keeps RDI unavailable when one raw metric is null', () => {
  expect(calculateRdi({ RES: 1, EACS: 1, DDS: null, GDS: 1, SLS: 1, weights }).rdiZ).toBeNull()
})
```

- [x] **Step 2: Run red tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/analysisConfigurationDomain.test.ts worker-tests/formalAnalysisMath.test.ts`

Expected: FAIL because the modules do not exist.

- [x] **Step 3: Implement minimal pure functions**

Reject illegal/identity-like expert codes, warn for name-like Latin patterns, validate complete A-E policies and metrics, permit score endpoints, calculate sample SD with `n - 1`, RCIi, Z values and strict complete-case RDI. Do not add database calls.

- [x] **Step 4: Verify green and edge cases**

Run the same command and add tests for 0/100 score endpoints, NaN/Infinity rejection, reliability bounds, fixed SLS policy, five exact weights, RCI aggregate NULL and no percentile/level output.

## Task 3: Build administrator analysis-version lifecycle APIs

**Files:**
- Create: `worker/routes/adminAnalysis.ts`
- Modify: `worker/routes/admin.ts`
- Modify: `worker/router.ts`
- Modify: `worker/services/adminAudit.ts`
- Create: `worker-tests/adminAnalysisConfigurationApi.test.ts`

**Interfaces:**

```ts
POST /api/admin/analysis/benchmarks/clone
PUT  /api/admin/analysis/benchmarks/:version
POST /api/admin/analysis/benchmarks/:version/validate
POST /api/admin/analysis/benchmarks/:version/publish
// Repeat list/get/clone/update/validate/publish for norms, reliability, scoring definitions.
```

- [ ] **Step 1: Write failing route tests**

```ts
test('publishes a validated expert draft with five server-calculated values', async () => {
  const version = await cloneBenchmark(admin, 'benchmark-1.0.0', 'expert-v1')
  await replaceMatrix(admin, version, completeTwoExpertDocument)
  await validate(admin, version)
  const published = await publish(admin, version)
  expect(published.expertCount).toBe(2)
  expect(await candidateValues(version)).toHaveLength(5)
})
```

- [ ] **Step 2: Run red route tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/adminAnalysisConfigurationApi.test.ts`

Expected: FAIL with API 404 because the analysis route is absent.

- [ ] **Step 3: Implement lifecycle with existing Stage 10A guard**

Reuse `requireAdmin`, CSRF/origin checks, UUID idempotency receipts, request hashing, safe responses and audit writes. Full matrix update uses one transaction. Publication reruns validation and atomically computes values/metadata. Norm, reliability and scoring publication require their exact typed validation contracts.

- [ ] **Step 4: Verify route behavior**

Run targeted tests covering stale revisions, same-key replay, conflicting key reuse, published immutability, unknown fields, malformed JSON, oversized body, foreign-origin rejection and no full matrix in audit/receipt.

## Task 4: Bind reliability to configuration and sessions

**Files:**
- Modify: `worker/domain/configuration.ts`
- Modify: `worker/domain/configurationFingerprint.ts`
- Modify: `worker/routes/adminConfiguration.ts`
- Modify: `worker/routes/formalSession.ts`
- Modify: `worker/services/scoringInput.ts`
- Modify: `worker-tests/adminConfigurationApi.test.ts`
- Create: `worker-tests/analysisConfigurationBinding.test.ts`

**Interfaces:**

```ts
type AnalysisBindings = {
  scoringVersion: string
  benchmarkVersion: string
  normVersion: string | null
  reliabilityVersion: string | null
}
```

- [ ] **Step 1: Write failing binding tests**

```ts
test('new session copies active reliability version while old session stays null', async () => {
  await activatePublishedAnalysisConfiguration('config-analysis-v1')
  expect((await createFormalSession()).reliabilityVersion).toBe('eac-r-1')
  expect((await legacySession()).reliabilityVersion).toBeNull()
})
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/analysisConfigurationBinding.test.ts`

Expected: FAIL because reliability is neither validated nor copied into sessions.

- [ ] **Step 3: Implement compatibility rules**

Include reliability fingerprint in the configuration fingerprint. Reject unpublished/draft/retired references and scoring-version incompatibilities. Require a published norm when total RDI is enabled; warn for provisional benchmark or absent reliability. Add reliable safe DTO projection without affecting participant completion/resume responses.

- [ ] **Step 4: Verify green**

Run targeted tests for published configuration activation, session pinning, no old-session mutation and publish/activate separation.

## Task 5: Implement formal-analysis orchestration and artifacts

**Files:**
- Create: `worker/services/formalScoring.ts`
- Modify: `worker/services/scoringInput.ts`
- Modify: `worker/services/scoringFingerprint.ts`
- Modify: `worker-tests/formalAnalysisService.test.ts`

**Interfaces:**

```ts
export async function ensureFormalScoringRun(
  db: D1Database,
  input: { sessionId: string; target: AnalysisBindings },
): Promise<{ scoringRunId: string; reused: boolean; runStatus: 'completed' | 'partial' | 'failed' }>
```

- [ ] **Step 1: Write failing service tests**

```ts
test('uses reliability parameters for RCIi and published norm values for RDI', async () => {
  const run = await ensureFormalAnalysisRun(db, { sessionId, target })
  expect(await candidateRcii(run.scoringRunId, 'A')).toBeCloseTo(expectedRcii)
  expect(await rdiT(run.scoringRunId)).toBeCloseTo(50 + 10 * expectedRdiZ)
})
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/formalAnalysisService.test.ts`

Expected: FAIL because the formal-analysis service is absent.

- [ ] **Step 3: Implement a separate formal service**

Load only published targets, sealed input and four content fingerprints. Persist component-level RCIi, an aggregate RCI record with NULL numeric value and `components_calculated`, five standard score rows, raw metrics and RDIz/RDIT. Mark unavailable values explicitly. Do not call or change `prepilotScoring.ts`.

- [ ] **Step 4: Verify calculation and current-run transactions**

Run targeted tests for reliability versus norm/benchmark SD, E exclusion, missing raw metrics, no imputation, no level/percentile, same-fingerprint reuse, changed fingerprint new run, historical preservation and failed-run isolation.

## Task 6: Implement resumable recomputation jobs with conditional leases

**Files:**
- Create: `worker/services/scoringRecomputeJobs.ts`
- Modify: `worker/routes/adminAnalysis.ts`
- Create: `worker-tests/recomputeJobsApi.test.ts`

**Interfaces:**

```ts
POST /api/admin/analysis/recompute-jobs
POST /api/admin/analysis/recompute-jobs/:jobId/run-next
GET  /api/admin/analysis/recompute-jobs/:jobId

export async function runNextRecomputeBatch(
  db: D1Database,
  jobId: string,
  batchSize: number,
): Promise<RecomputeJobProjection>
```

- [ ] **Step 1: Write failing job tests**

```ts
test('claims a stable pending item once and recovers an expired lease', async () => {
  const job = await createJobWithThreeCompletedSessions(target)
  await runNext(job.id, 1)
  expect(await jobCounts(job.id)).toMatchObject({ processed: 1 })
  await expireProcessingLease(job.id)
  await runNext(job.id, 1)
  expect(await uniqueItems(job.id)).toBe(3)
})
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest --config vitest.worker.config.ts --run worker-tests/recomputeJobsApi.test.ts`

Expected: FAIL because no recomputation job route or table exists.

- [ ] **Step 3: Implement job freeze, lease and batch processor**

Freeze eligible completed/timeout session IDs in one transaction. Claim each item via a state-and-lease conditional update, calculate outside the claim transaction, and finalize only when the token matches. Recompute counters from items; preserve per-item safe errors; audit job creation and each batch; reuse the same request idempotency key on retries.

- [ ] **Step 4: Verify recovery and safety**

Run targeted tests for 1/25 bounds, missing completion exclusion, concurrent claims, expired lease recovery, one failure not blocking later items, no duplicate item/run, completed-with-failures terminal state and no identity in job projections.

## Task 7: Add administrator analysis console and client contracts

**Files:**
- Create: `src/admin/AdminAnalysisConsole.tsx`
- Create: `src/admin/AdminBenchmarkEditor.tsx`
- Create: `src/admin/AdminNormReliabilityEditors.tsx`
- Create: `src/admin/AdminScoringDefinitionEditor.tsx`
- Create: `src/admin/AdminRecomputeJobs.tsx`
- Modify: `src/admin/adminApi.ts`
- Modify: `src/admin/adminTypes.ts`
- Modify: `src/admin/AdminDashboard.tsx`
- Modify: `src/admin/AdminConfigurationSetEditor.tsx`
- Create: `src/admin/AdminAnalysisConsole.test.tsx`
- Create: `src/admin/AdminAnalysisEditors.test.tsx`

**Interfaces:**

```ts
export type AdminAnalysisApi = {
  cloneBenchmark(input: CloneInput): Promise<BenchmarkDetail>
  validateNorm(version: string): Promise<ValidationProjection>
  runNextRecomputeJob(jobId: string, batchSize: number): Promise<RecomputeJob>
}
```

- [ ] **Step 1: Write failing React tests**

```tsx
it('shows anonymous-code guidance and disables a published expert matrix', () => {
  render(<AdminBenchmarkEditor detail={publishedBenchmark} />)
  expect(screen.getByText(/匿名专家编号/)).toBeVisible()
  expect(screen.getByLabelText('expert-01 A')).toBeDisabled()
})
```

- [ ] **Step 2: Run red frontend tests**

Run: `npm test -- --run src/admin/AdminAnalysisConsole.test.tsx src/admin/AdminAnalysisEditors.test.tsx`

Expected: FAIL because the Analysis console and editors do not exist.

- [ ] **Step 3: Implement typed, non-code-editing UI**

Render server validation only; do not cache expert matrices/norm parameters in browser persistence. Use existing idempotent admin client and CSRF recovery. Show published state as read-only. Require all A-E expert cells, five norm metrics, valid reliability range and weight sum before enabling validation/publish actions. Add configuration norm/reliability selectors filtered to published compatible versions. Job panel has manual next-batch control only.

- [ ] **Step 4: Verify isolation and behavior**

Run frontend tests for no participant identity, no CSV/delete controls, no formal/Quick analysis calls, published read-only state, publish-not-activate and job refresh projection.

## Task 8: Document, exercise local scenarios, migrate remote and finish

**Files:**
- Create: `docs/backend-stage-10b-analysis-configuration.md`
- Modify: existing Worker/frontend tests only as required by new contracts

- [ ] **Step 1: Write documentation test/checklist assertions**

Add a worker test asserting formal completion/resume remains free of `rdi`,
`benchmark`, `norm` and `reliability` fields, and a frontend test asserting
Quick never calls `/api/admin/analysis`.

- [ ] **Step 2: Run red isolation tests**

Run: `npm test -- --run src/App.test.tsx && npx vitest --config vitest.worker.config.ts --run worker-tests/formalAnalysisService.test.ts`

Expected: FAIL until the new contract projections are explicitly verified.

- [ ] **Step 3: Write operations documentation and execute local gates**

Document policy/privacy boundaries, formulas, missing-value policy, lifecycle,
job lease recovery, local synthetic data cleanup, remote migration command and
Stage 11 exclusions. Run `npm run db:migrations:list:local`,
`npm run db:migrate:local`, `npm test -- --run`, `npm run test:worker`,
`npm run typecheck`, `npm run build`, `npm run check`, and `git diff --check`.

- [ ] **Step 4: Perform local synthetic verification and cleanup**

Use a synthetic local admin and completed sessions to prove sample SD, RCIi,
RDI strict missing, current-run reuse/new/failure, configuration rollback and
lease recovery. Delete only the explicit local synthetic records, restore
`config-2026-07-v1`, and verify administrator/participant/session business
tables are empty.

- [ ] **Step 5: Apply remote migration only after local proof**

Read remote counts first. If `admin_users`, `participants` or `sessions` are
nonzero, stop and report without applying. Otherwise run
`npm run db:migrations:list:remote`, `npm run db:migrate:remote`, then confirm
schema 11, no pending migrations, zero expert scores/norm parameters/reliability
parameters/jobs/runs and active `config-2026-07-v1`.

- [ ] **Step 6: Commit final stage**

Run `git diff --check`, review staged files for secrets and synthetic data, then
commit once with `feat: add expert norms and scoring recomputation`. Do not push,
deploy, merge or create a PR.

## Plan self-review

- Each schema, configuration, formula, job, UI and verification requirement has a dedicated task.
- Task interfaces use a single `AnalysisBindings` tuple consistently across configuration, formal analysis and jobs.
- Every production task starts with an explicit failing test and target command.
- The plan excludes implementation of participant querying, export, deletion, levels, percentiles and deployment.

## Fast Track Release Candidate scope (2026-08-04)

The release plan is deliberately narrowed after the Norm, Reliability and
Scoring Definition parameter-management batch. This batch remains limited to
versioned parameter CRUD, validation, publication, immutability, idempotency
and audit coverage; it does not add participant-facing UI, formal RCI/RDI
calculation, or recomputation execution.

The remaining implementation is compressed into two independently reviewed
batches:

1. **Batch A — formal analysis closure.** Add a separate formal scoring
   service, pin scoring/benchmark/norm/reliability versions to a session,
   calculate candidate-level RCIi and the five standard scores, and persist
   strict complete-case RDIz/RDIT (NULL whenever any required raw indicator is
   missing). Add only a minimal, lease-recoverable recomputation API and a
   minimal administrator page for creating a job, running its next batch and
   viewing progress. Formal, resume, completion and Quick surfaces must not
   expose analysis outcomes. No levels, percentiles, charts, automatic queue
   or advanced filtering are in this batch.
2. **Batch B — delivery closure.** Add administrator participant/session
   pagination and basic filters; CSV-in-ZIP export with identity joined into
   the summary and masked phone numbers; single and bulk permanent deletion
   with a tombstone ledger and deletion audit; essential rate limiting and
   anomaly handling; local synthetic-data cleanup; then authorized remote
   migration, administrator initialization, smoke tests, Worker deployment
   and post-deployment regression verification.

Deferred to 1.1: charts, advanced querying and anomaly dashboards, automatic
background queues, multi-administrator permissions, percentiles and
resilience-level presentation, UI polish and unrelated dependency/refactor
work.

For each source-changing major batch, run one full `npm run test:worker` only
after its source has frozen. While that Worker suite runs, frontend tests,
typecheck and build may run in parallel. Run `npm run check` only immediately
before that batch's commit. Documentation-only edits do not require another
long Worker run. Critical security, version-pinning, deletion and data-leakage
coverage remains mandatory.
