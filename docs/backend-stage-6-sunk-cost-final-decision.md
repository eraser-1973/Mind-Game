# Stage 6: sunk-cost checkpoint and final decision

## Scope

Stage 6 adds a server-authoritative sunk-cost checkpoint and final decision to the existing formal game. It reuses the Stage 4/5 session cookie, immutable stage choices, evidence exposure, point ledger, server sequence, session-bound configuration, and 900-second Worker clock. Quick mode continues to use the original local reducer, report, and JSON export.

This stage deliberately stops at `post_task`. Post-task questionnaires, task-experience manipulation checks, study completion, scoring/RDI, administration, export, and deletion management remain Stage 7 or later.

## Versioned rule and configuration binding

Migration `0006_sunk_cost_final_decision.sql` publishes `sunk-1.0.0`:

- trigger window: server remaining time is at most 300 seconds;
- minimum investment: at least 2 verification points in one candidate;
- risk condition: the same candidate has at least one actually unlocked catalog item with server-private `is_key_risk=1`;
- one sunk-cost record at most per session;
- no checkpoint after a final decision.

`configuration_sets.sunk_cost_rule_version` and `sessions.sunk_cost_rule_version` bind the rule just like the other versioned configuration. A started session cannot silently move to another rule. The safe session projection contains only the version string; private risk evidence IDs and trigger reasons are not returned.

The prepilot `is_key_risk` mapping remains provisional. The research owner must approve it before formal recruitment. Changing the mapping requires a new material/configuration version, not an update to rows already bound to sessions.

## D1 schema

- `sunk_cost_rules`: version, remaining-time threshold, investment threshold, key-risk requirement, publication status.
- `sunk_cost_events`: one session record covering `pending`, immutable answered choice, `not_triggered`, or `timeout_unanswered`; it retains the private risk snapshot, point facts, and server sequences.
- `final_decisions`: one immutable final decision per session, one unique event ID, candidate/confidence, active or timeout mode, source T1/T2/T3 choice, selection origin, server/client time, point/time facts, and sunk choice.
- `game_runs.finalized_at`: server finalization time; once set it cannot be changed.
- `game_events`: rebuilt without data loss to admit `sunk_cost_show`, `sunk_cost_choice`, and `final_submit`.

`app_metadata.schema_version` becomes `6`. Foreign-key cascade removes Stage 6 rows when the owning participant/session is removed. Published configuration rows remain.

## Trigger and target selection

`POST /api/sunk-cost/show` never trusts client risk, investment, target, remaining time, stage, or rule fields. It reads the session-bound rule, Worker clock, actual `evidence_events`/`evidence_event_items`, private catalog markers, point costs, and candidate display order.

If more than one candidate is eligible, the server chooses:

1. greatest total verification investment;
2. earliest server sequence at which key-risk evidence was actually disclosed;
3. earliest candidate in this session's immutable `candidate_display_order`.

An ineligible check returns HTTP 200 with `{triggered:false, required:false}` and writes no sunk-cost row or sequence. The first eligible show returns HTTP 201. Replays and concurrent losers return the same safe event with HTTP 200. The projection excludes risk evidence IDs and other answer keys.

## Choices and gates

`POST /api/sunk-cost/choice` accepts only `continue`, `stop_loss`, or `give_up`. All three are rendered with identical neutral visual weight. The first valid choice is sealed; a different event cannot overwrite it.

While a shown event is pending, evidence unlocks, T2/T3 rating/choice writes, and active final submission are rejected. Show replay, choice, resume, and timeout finalization remain available. `give_up` advances the run to `DECISION`; it does not fabricate a candidate or confidence.

`points_after_choice` is derived from successful negative point-ledger deltas whose server sequence is after the choice. It is recalculated for safe resume projections, rather than trusted from the browser.

If active final submission occurs without an eligible/shown checkpoint, the server creates exactly one `not_triggered` record with no show event or show sequence. If the timer expires while the prompt is unanswered, the row becomes `timeout_unanswered` with a null choice before finalization.

## Final-decision APIs

### `POST /api/final-decision`

Accepts `sessionId`, a public candidate ID, integer confidence 0-100, client timestamp, and optional client sequence, with a UUID `Idempotency-Key`. It is available after sealed T2 or T3, or after a sealed `give_up` choice. If the server determines the sunk-cost rule is eligible but has not been shown, it returns `SUNK_COST_SHOW_REQUIRED`. A pending checkpoint returns `SUNK_COST_RESPONSE_REQUIRED`.

The server records `submit_mode=active`, `selection_origin=active_user`, `auto_selected=0`, and the authoritative source stage. It advances the run to `DECISION`, sets `finalized_at`, and sets the session to `current_step=post_task` while leaving `completion_status=in_progress` for Stage 7.

### `POST /api/final-decision/timeout`

The server requires its deadline to have elapsed. It writes `timer_expired` before `final_submit`, then selects the latest sealed stage choice in the exact fallback order T3, T2, T1. It never chooses by score, benchmark, candidate order, or random fallback. Without any sealed T1 choice, it records expiry but does not invent a candidate.

Timeout records `submit_mode=timeout`, `selection_origin=timeout_latest_sealed_choice`, `auto_selected=1`; the session becomes `current_step=post_task`, `completion_status=timeout`. `sessions.ended_at` remains null because the research flow is not complete.

All expired game writes use this unified timeout path and then reject their original mutation with `GAME_EXPIRED`. Replayed timeout IDs and concurrent active/timeout requests converge on one immutable final decision.

## Resume and browser storage

Authenticated resume accepts `in_progress`, `timeout`, and `completed` sessions and adds safe top-level `sunkCost` and `finalDecision` snapshots. It returns no key-risk IDs, trigger reason, benchmark, toxicity, or scoring answer.

Formal UI state is reconstructed from the Worker response. `sessionStorage` stores only UUID operation keys:

- `mind-game.pending.sunk-cost-show.v1`
- `mind-game.pending.sunk-cost-choice.v1`
- `mind-game.pending.final-decision.v1`
- `mind-game.pending.timeout-final-decision.v1`

Candidate, confidence, evidence, score, points, and final content are never persisted in those keys or in formal `localStorage`. Quick mode does not call the formal Stage 6 APIs.

## Participant UI

- The formal checkpoint is a blocking, neutral modal supplied entirely by the safe server snapshot.
- The formal final page is titled `锁定最终录用人选`, lists only the five public candidate cards, has no preselection, and requires an actively touched 0-100 confidence control. A touched value of 0 is valid.
- A successful active or timeout final shows only: `最终录用结果已安全保存。测后状态与任务体验问卷将在下一阶段接入。`
- It does not expose RDI, resilience classification, expert scores, answer keys, or JSON export.
- Quick mode keeps its existing report and export behavior.

## Validation and verification

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

Real local Worker smoke:

```powershell
npm run dev:worker -- --port 8792
$env:SMOKE_ORIGIN='http://127.0.0.1:8792'
node scripts/stage6-local-smoke.mjs
node scripts/stage6-browser-smoke.mjs
```

The API smoke covers 10 paths: not-triggered, all three choices, active T2/T3, timeout T1/T2/T3, and an active/timeout race. It rejects Quick at the formal session boundary and removes every synthetic participant in `finally`. The browser smoke walks the public formal flow through active final and the post-task pause, accepts an explicitly touched confidence 0, checks storage, checks mobile rendering, and verifies Quick does not create a formal session.

## Remote migration safeguard

Before applying 0006 remotely, count every business table. Proceed only when participants, identity, sessions, credentials, consent, demographics, questionnaires, game runs/events, ratings/choices, evidence events/items, and point ledger are all zero.

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

After migration, verify schema version 6, the published `sunk-1.0.0` row, the configuration binding, and zero business rows. Do not run `wrangler deploy` in Stage 6.

## Rollback

Do not edit an applied migration and do not delete/recreate D1. If migration fails, preserve the error and fix forward in a new migration. Code rollback to Stage 5 is safe only before publishing 0006; after publication, keep the additive schema and deploy compatible code. Synthetic smoke cleanup deletes only the participant IDs it created, relying on foreign-key cascades.

## Next stage

Stage 7 must add post-task state and task-experience questionnaires, then an explicit research-session completion transaction. Until that work is implemented, formal sessions intentionally stop at `post_task`, and active sessions remain `in_progress` while timeout sessions retain `timeout`.
