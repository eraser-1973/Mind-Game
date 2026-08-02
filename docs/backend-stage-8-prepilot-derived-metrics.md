# Stage 8: versioned prepilot derived metrics

## Scope and non-interpretation boundary

Stage 8 calculates server-side research variables only after a complete formal
session has been sealed. The supported numeric outputs are RES, EAC/EACi,
EACS/EACSi, DDS, GDS, and SLS. RCI component rows and RCI/RDIz/RDIT metric rows
are created without numeric values so their missing-parameter state is explicit.

Every successful run is marked `is_pre_pilot=1`,
`interpretation_status=research_only`, and `rdi_status=norms_unavailable`.
Stage 8 never produces a percentile, resilience level, or participant-facing
interpretation. It does not treat the browser MVP RDI as RDI 2.0.

Formal participants continue to see only the neutral submission-success page.
Completion and resume responses contain no derived metric fields and the browser
calls no scoring route. Quick mode keeps its existing local report and MVP RDI;
Quick sessions never enter the formal D1 workflow or `scoring_runs`.

## Migration 0008 and versioned configuration

`migrations/0008_prepilot_derived_metrics.sql` advances
`app_metadata.schema_version` to `8` and creates:

- `scoring_definitions`: immutable published formula definitions and weights;
- `benchmark_sets`, `benchmark_candidate_values`, and
  `benchmark_expert_scores`: versioned provisional or expert-panel benchmarks;
- `norm_sets` and `norm_metric_parameters`: future versioned normalization data;
- `reliability_parameters`: future EAC reliability inputs for RCI;
- `scoring_runs`: one versioned calculation attempt, with one current run per
  session and append-only history;
- `scoring_input_snapshots`: privacy-minimized canonical source facts;
- `derived_metric_values`: one value/status/input/formula record per metric;
- `candidate_metric_components`: A-E EAC/EACS/RCI component facts.

The migration seeds the published definition `RDI-2.0-prepilot` with
`total_rdi_enabled=0`, `level_enabled=0`, `time_unit=second`, and future weights
RES 0.35, EACS 0.35, DDS 0.15, GDS 0.10, SLS 0.05. The weights are retained for
later validated RDI computation but are not used to create a Stage 8 RDI value.

It also seeds `benchmark-1.0.0` as a published but provisional
`current_app_baseline` set. The values are copied exactly from the existing
`baselineFitScore`: A=51, B=86, C=60, D=83, E=70. Directions are A/C=-1,
B/D=1, E=0; A-D are core EAC candidates and E is excluded. `benchmark_sd` is
NULL, `expert_count=0`, and the notes state that this is not a completed expert
review. No `trueAbility`, `trueFit`, `isToxic`, or `riskFlags` value is migrated.

`norm-prepilot-draft` is an empty draft (`sample_size=0`) and is not bound to
sessions. Migration 0008 inserts no expert score, norm metric value, or
reliability value. Before formal prepilot analysis, the research lead must
confirm the provisional benchmark, A/C/B/D direction rules, available-case
mean, primary-risk rule, DDS time definition, and SLS missing-state policy.

Stage 8 rejects every non-NULL norm or reliability override, including draft,
missing, and incomplete published versions. Such an attempt creates an
idempotent safe failed run with NULL parameter foreign keys; the requested
versions and available parameter facts remain in its canonical failure
fingerprint. Missing requested scoring or benchmark versions are handled the
same way, with the failed row referencing the session-bound versions while the
requested values remain fingerprinted. A later stage must publish and implement
a complete parameter contract before these versions can participate in a
successful run.

`migrations/0009_stage8_integrity_guards.sql` is a forward-only Stage 8 repair
added after 0008 had already reached the empty remote database. It deliberately
keeps `app_metadata.schema_version=8`. It rejects NULL/version-key mismatches in
new scoring runs and prevents INSERT/DELETE under a published benchmark version;
future benchmark values must be completed while the set is draft and only then
published. Keeping this as a separate migration avoids rewriting applied D1
history.

`migrations/0010_stage8_publication_and_snapshot_guards.sql` is the final
forward-only review repair and also leaves `schema_version=8`. It requires a
non-provisional expert benchmark to be assembled as a draft with exactly the
declared number of experts and complete A-E coverage before publication, seals
expert rows after publication, and enforces that every scoring input snapshot
names the same session as its scoring run. The scoring service independently
rechecks expert-row coverage so legacy or externally corrupted facts fail
closed with `BENCHMARK_INCOMPLETE`. A `current_app_baseline` is always
provisional at both database and service layers and cannot be relabeled as a
formal expert benchmark.

## Canonical scoring input and fingerprint

`worker/services/scoringInput.ts` builds `prepilot-input-1` from sealed D1 facts:

- session/completion mode and all bound versions;
- server start, deadline, finalization, and end times;
- total/remaining points and A-E display order;
- final candidate, confidence, source stage, submit mode, origin, sequence, and
  remaining points;
- sealed ratings with stage, score, server time, sequence, and the evidence IDs
  actually seen before each rating;
- evidence events and matching point-ledger entries;
- stage choices and sealed sunk-cost state;
- provisional benchmark values/directions;
- all key-risk exposures, the primary risk anchor, cost/time after that anchor,
  and distinct shallow candidates.

The snapshot deliberately excludes identity, names, student IDs, phones,
cookies, tokens/hashes, administrator data, questionnaire text/answers not used
by a formula, candidate prose, evidence prose, and hidden candidate answer
fields. `worker/domain/scoringFingerprint.ts` canonicalizes object keys, keeps
already server-sorted array order, and produces SHA-256. Run IDs and calculation
times are excluded. Identical facts and versions reuse the same run; changed
facts, ordering, scoring version, benchmark version, norm version, or reliability
version produce a different key.

Before calculation the service verifies version bindings, published definition
and benchmark, exactly one A-E benchmark set, a final decision and completion
record, all five T1 ratings, A-E display order, point-ledger conservation, final
and game point agreement, evidence snapshots, unique server sequences, final
completion sequence, and server-time order. Severe inconsistency creates a safe
failed run rather than a misleading metric.

## Formula definitions and missing-data rules

### RES

`RES = Vj × (1 - CtoxAfter / Ctotal)` where `Vj` is the final candidate's D1
benchmark, `Ctotal` is the versioned point-rule total, and `CtoxAfter` is defined
below. The pure example Vj=80, Ctotal=5, CtoxAfter=1 returns 64. Because the
current benchmark is provisional, the persisted RES is `partial` even when it
has a numeric value. Values are validated, not silently clamped.

### Risk anchor and CtoxAfter

The primary risk anchor is the earliest server evidence event with
`contains_key_risk=1`. The snapshot records its candidate, sequence, server time,
and evidence IDs, plus every other key-risk exposure. `CtoxAfter` sums only
successful evidence-unlock cost for that same primary candidate with a strictly
greater server sequence. It excludes the anchor's own cost and every other
candidate's cost, and cross-checks `evidence_events` against `point_ledger`.

If A and C both expose a key risk, all exposures remain auditable but this
formula version uses the earliest one as the primary anchor. The research lead
must confirm this rule before formal analysis. With no key risk, risk exposure is
false, `CtoxAfter=0`, risk-to-final time is absent, and DDS is not applicable.

### EAC and EACS

For core candidate i, `EACi = Di × (T3i - T1i)`. E is stored as direction zero
and excluded. T2 never substitutes for missing T3. EAC is the available-case
mean across A-D, with `required_count=4`: zero available components is
`unavailable`, one to three is `partial`, and four is `calculated`. Missing
candidates remain named and are not inserted as zero.

`EACSi = Di × ((T3i - T1i) / Δti)`, where Δti is the positive difference in
seconds between server T3 and server T1 submission times. EACS uses the same
available-case rule and coverage. No client time, minutes conversion, or overall
game time is substituted. The pure example A direction -1, T1=80, T3=50 gives
EACi=30; at Δti=120 seconds EACSi=0.25.

### RCI

The available pure function implements `RCIi = EACi / Sdiff`,
`Sdiff = sqrt(2) × SEM`, and `SEM = SD × sqrt(1-r)`. For EACi=30, SD=10, r=0.84,
the result is approximately 5.3033008589. Real Stage 8 runs do not have a
published SD/reliability version: every `rci_i` is NULL and RCI is
`pending_parameters` with `reliability_parameters_unavailable`. No SD or
reliability default is invented.

### DDS

`DDS = 100 × [1 - 0.5 × (CtoxAfter/Ctotal) - 0.5 ×
(TtoxAfter/Ttotal)]`. Ttotal is server game start to sealed final decision;
TtoxAfter is primary-risk server time to final decision. The pure example
CtoxAfter=1, Ctotal=5, TtoxAfter=120, Ttotal=600 returns 80. Invalid point/time
ranges make DDS unavailable; the implementation never clamps. With no key-risk
exposure DDS is NULL, `not_applicable`, `no_key_risk_exposure`, never 100 or 0.

### GDS

`GDS = (Nshallow/N) × Vj`, where Nshallow is the count of distinct candidates
with a successful shallow unlock, N is the validated display-order size (5), and
Vj is the final candidate benchmark. Repeated shallow requests count once and
deep unlocks do not increase coverage. The example Nshallow=2, N=5, Vj=80
returns 32. A provisional benchmark makes the persisted result `partial`.

### SLS

Server `sunk_cost_events.choice` maps stop_loss=100, give_up=80, continue=30.
`points_after_choice` is retained in metric input for later interpretation but
does not change the value. `not_triggered` yields NULL/not_applicable with
`sunk_cost_not_triggered`; `timeout_unanswered` yields NULL/unavailable with
`sunk_cost_timeout_unanswered`; missing/invalid choices remain unavailable.

### RDI pause

The future pure RDI formula standardizes RES/EACS/DDS/GDS/SLS with an explicit
complete norm set, combines their stored weights, and converts `RDIT=50+10×RDIz`.
The real Stage 8 path has no published norm binding, so RDIz and RDIT are always
NULL with `norms_unavailable`; no percentile or level is stored.

## Runs, idempotence, recomputation, and failure isolation

Formal completion first commits the Stage 7 completion transaction. A separate
best-effort follow-up calls `ensurePrepilotScoringRun`. Scoring failure is logged
server-side, creates/reuses a safe failed run where possible, and never rolls back
the valid completion or changes the neutral participant response.

The uniqueness key is session + scoring/benchmark/norm/reliability versions +
source fingerprint. Replays return the sealed run and do not duplicate snapshots,
metrics, or components. Explicit internal recomputation requires scoring and
benchmark versions. A newly successful/partial version becomes current while the
old run is atomically demoted and retained. A failed run never replaces a current
successful/partial run. Published configuration, snapshots, metrics, components,
and completed run facts are protected against ordinary update.

Failed-run fingerprints use a separate privacy-minimized canonical source that
captures the sealed session/game/rating/evidence/ledger/final/completion facts
plus the failure code. Thus an exact bad-input replay reuses its run, while a
different corruption with the same error code creates a new auditable failed
history row. No identity, credential, questionnaire answer, or prose is included.

No public `/api/scoring` or recompute route is added in Stage 8. Stage 9 is
reserved for administrator authentication and protected internal data access.
Later, validated norm/reliability publication can invoke the internal batch
service to create new historical runs without overwriting Stage 8 results.

## Verification, cleanup, migration, and rollback

Local verification:

```powershell
npm run db:migrations:list:local
npm run db:migrate:local
npm run test:worker
npm test -- --run
npm run typecheck
npm run build
npm run check
git diff --check
```

Start the real local Worker with `npm run dev:worker`. Smoke formal active and
timeout completion, T3/stop_loss, no-T3, no-risk/not-triggered,
timeout_unanswered, idempotent ensure, explicit-version recompute, isolated
failure/recovery, neutral Formal completion/resume, and unchanged Quick report.
Delete synthetic participants only after inspection; the existing foreign-key
cascade removes their identity, session, game, questionnaire, completion, and
scoring facts. Delete any test-only scoring/benchmark/norm/reliability versions
after their dependent synthetic runs. Retain only published Stage 8 configuration
and schema, then confirm all participant/behavior/scoring fact tables are zero.

Remote migration is permitted only after all local checks pass and a remote count
gate confirms every business session/fact table is zero:

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

Migration 0008 and the forward-only Stage 8 integrity guards may add only schema,
constraints/indexes/triggers, the prepilot definition, provisional A-E benchmark,
and empty draft norm set. They must not add
participants, identities, sessions, behaviors, runs, snapshots, metrics, expert
scores, norms, or reliability values. Stage 8 explicitly does not run
`wrangler deploy`.

D1 migrations are forward-only. Before remote migration, keep a D1 export/backup
and verify the empty-data gate. Rollback is restoration from that backup; never
edit applied migrations 0001-0010 or destructively rewrite historical facts.

The existing dependency audit notice is not addressed here because unrelated
dependency upgrades and the PostCSS advisory are outside Stage 8 scope.
