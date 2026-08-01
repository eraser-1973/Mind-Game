# Stage 5: server evidence, point ledger, T2, and T3

## Scope and source of truth

Stage 5 moves formal-mode evidence disclosure and the five verification points to the Worker/D1 boundary. The source catalog is the unchanged `src/data/candidates.ts` material set for `material-1.0.0`. Migration `0005_evidence_points_t2_t3.sql` copies the exact evidence IDs, titles, content, order, and public polarity into D1. Quick mode continues to use the local candidate data and reducer; formal mode renders evidence only from a successful Worker response or an authenticated resume snapshot.

This stage intentionally does not implement sunk-cost persistence, final hiring, timeout final submission, post-task questionnaires, RDI/sub-metrics, administration, CSV export, or deletion management. Those remain later-stage work.

## Database additions

- `point_rules`: immutable versioned totals and shallow/deep costs. Published `points-5-v1` is total 5, shallow 1, deep 3.
- `candidate_evidence_items`: versioned evidence catalog keyed by `(material_version, evidence_id)` with candidate, level, order, public polarity, and private `is_key_risk`.
- `evidence_events`: one immutable unlock fact per session/candidate/level, including authoritative before/cost/after values and server sequence.
- `evidence_event_items`: exact ordered catalog items returned by an unlock; it references the catalog rather than duplicating content.
- `point_ledger`: immutable negative deltas associated one-to-one with unlock events.
- `game_events`: rebuilt without dropping rows so `event_type=evidence_unlock` is accepted alongside Stage 4 event types.

`app_metadata.schema_version` becomes `5`. Migration tests apply 0001-0004, insert an existing run, T1 rating, T1 choice, and events, apply 0005, and verify all Stage 4 facts plus timer and balance remain unchanged.

## Temporary key-risk mapping

The prepilot mapping marks the existing negative evidence of halo candidates A and C as key risk:

- A: `A-t2-1`, `A-t2-2`, `A-t3-1`, `A-t3-2`
- C: `C-t2-1`, `C-t2-2`, `C-t3-1`, `C-t3-2`
- B, D, and E: no current key-risk item

This mapping is server-private and is never projected to the participant. **正式预实验前需要研究负责人确认。** Stage 8 must re-check every `is_key_risk` value before computing research indicators.

## Formal stage rules

The server derives the visible state from `game_runs.current_stage` plus sealed stage choices:

- `T1_COMPLETE`: five T1 ratings and the T1 choice are sealed; shallow verification is available.
- First shallow unlock advances the stored stage to `T2`; shallow remains available until the T2 choice is sealed.
- T2 is accepted only for a candidate with an actual shallow unlock. Every shallow-unlocked candidate must have T2 before T2 choice can be sealed.
- T2 choice keeps `current_stage=T2` and derives `stageStatus=T2_COMPLETE`. It locks all further shallow and T2 writes.
- Deep verification requires sealed T2 choice plus shallow and T2 for that candidate. First deep unlock advances `current_stage=T3`.
- T3 is accepted only after that candidate's deep unlock. Every deep-unlocked candidate must have T3 before T3 choice can be sealed.
- T3 choice keeps `current_stage=T3` and derives `stageStatus=T3_COMPLETE`; it locks further deep and T3 writes.
- If T2 is complete with fewer than 3 points, the participant sees the Stage 5 pause state. No final candidate is fabricated.
- If T3 is complete, the participant sees the Stage 5 pause state. Stage 6 will add the final-decision transition.

Expired runs reject new evidence, ratings, and choices. Existing unlocked material and sealed ratings remain in resume. Stage 5 neither refunds points nor completes the session.

## Evidence unlock API and atomic point accounting

`POST /api/evidence/unlock` accepts only `sessionId`, `candidateId`, `level`, `clientAt`, and optional `clientSequence`, plus UUID `Idempotency-Key` and the `mg_session` cookie. The server reads the session-bound `material_version` and `point_rule_version`; client-supplied point values, evidence IDs, versions, stage fields, or risk fields are rejected.

A successful unlock uses one D1 batch to:

1. conditionally insert `evidence_events` for the current sequence and balance;
2. insert ordered `evidence_event_items` from the server catalog;
3. insert one negative `point_ledger` delta;
4. insert matching `game_events` data with the same server sequence;
5. conditionally update `game_runs.points_remaining`, `current_stage`, `last_sequence_no`, and timestamp.

Any failed statement rolls back the batch. Conditional writes plus unique session sequence and session/candidate/level constraints prevent concurrent overspend. Before each deduction, the service recomputes the ledger chain starting at `points_total` and requires it to end at `game_runs.points_remaining`. The operational invariant is:

`points_total + SUM(point_ledger.points_delta) = points_remaining`

An inconsistency rejects the deduction, increments the session error counter, and returns a sanitized server error.

## Idempotency and sequence allocation

- Replaying the same event UUID returns HTTP 200 with `created=false` and the original evidence and point transition.
- A new UUID for an already unlocked candidate/level returns HTTP 200 with `alreadyUnlocked=true` and no new event or deduction.
- Concurrent identical unlocks converge on one row and one deduction.
- Competing unlocks for the last points use conditional sequence/balance writes; only an affordable winner is committed.
- Ratings and choices retain the Stage 4 immutable event model: the same UUID replays, while a different UUID cannot overwrite a sealed fact.
- `game_runs.last_sequence_no`, domain event sequence, ledger sequence, and evidence sequence are advanced together.

## T2/T3 evidence snapshots

The client never submits `evidenceIdsSeen`.

- T2 stores the ordered IDs from that candidate's server-recorded shallow unlock.
- T3 stores shallow IDs followed by deep IDs, each in catalog order.

These arrays are sealed with `stage_ratings` and returned by resume. A client cannot unlock a stage or forge exposure by supplying local evidence IDs.

## Resume projection and participant data boundary

Authenticated resume now includes:

- authoritative `points.total` and `points.remaining`;
- `currentStage` and derived `stageStatus`;
- sealed T1/T2/T3 ratings in server sequence;
- sealed T1/T2/T3 stage choices in server sequence;
- only this session's unlocked evidence, including public ID/title/content/polarity/order and authoritative point transition;
- unchanged `startedAt`, `deadlineAt`, `remainingSec`, and expiry state.

It excludes identity, `is_key_risk`, `contains_key_risk`, `trueAbility`, `trueFit`, `isToxic`, `riskFlags`, and benchmark answers. Unlocked evidence and point balances are React memory backed by the server snapshot; they are not written to `localStorage`. `sessionStorage` stores only pending operation UUIDs so retries reuse the same key; it never stores scores or evidence content.

## Niko boundary

Formal Niko feedback is generated only after a successful T2/T3 save, using the API-returned public polarity and the adjacent sealed score direction (T1→T2 or T2→T3). It does not read `is_key_risk`, benchmark values, or private candidate fields; it never changes server score or point state. Niko history remains component memory in Stage 5 and therefore is not reconstructed after refresh. Server ratings and evidence remain fully recoverable.

## Quick-mode isolation

Quick mode keeps the existing local `VERIFY`, `RATE`, point deduction, evidence display, Niko behavior, final choice, and report. `GameScreen` routes formal sessions to `FormalGameScreen`; Quick never instantiates the formal controller, calls `/api/evidence/unlock`, or creates D1 rows. The formal API independently rejects `mode=quick` session creation and unauthenticated evidence requests.

## Migration and verification commands

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

Real local Worker checks:

```powershell
npm run dev:worker -- --port 8792
$env:SMOKE_ORIGIN='http://127.0.0.1:8792'
node scripts/stage5-local-smoke.mjs
node scripts/stage5-browser-smoke.mjs
```

The HTTP smoke covers five shallow unlocks, shallow+deep, competing deep unlocks, idempotent replay, resume, stage sealing, and Quick rejection. The browser smoke walks the real formal intake, all five T1 ratings, T1/T2/T3 choices, shallow/deep evidence, responsive screenshots, and the Stage 5 pause.

Synthetic local participants are removed by deleting their `participants` rows with `PRAGMA foreign_keys=ON`; cascades clear identity, credentials, sessions, consent, demographics, questionnaires, game runs, ratings, choices, game events, evidence events/items, and ledger rows. Confirm every business table is zero afterward.

Only after all gates pass and remote business tables are confirmed empty:

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

Remote Stage 5 migration writes schema/configuration only: the five-point rule, 20 versioned evidence rows, indexes, triggers, and schema version. It must not create participant, identity, session, questionnaire, rating, choice, unlock, ledger, or game-event rows. `wrangler deploy` is explicitly outside Stage 5.

## Rollback

Do not edit or re-run 0001-0004 and do not delete/recreate D1. Before a production migration, take the normal D1 backup/export appropriate to the environment. If 0005 fails, stop, retain the failure log, and correct it in a new forward migration rather than rewriting a migration already applied remotely. Application rollback is a code rollback to the Stage 4 commit only if the database migration has not been published; after publication, preserve the additive schema and deploy compatible code.

## Next stage

Stage 6 will add server-side sunk-cost events, explicit end-of-investigation handling, final candidate/confidence, manual versus timeout submission semantics, and completion transitions. It must reuse this ledger, evidence exposure, stage choices, and server sequence rather than creating parallel client-authoritative state.
