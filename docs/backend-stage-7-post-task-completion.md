# Stage 7: formal post-task questionnaires and session completion

## Scope and state machine

Stage 7 completes the formal research flow after the immutable final hiring decision. The authoritative Worker/D1 state machine is:

`post_task -> task_experience -> completion_pending -> completed`

An active final remains `completion_status=in_progress` until the end transaction and then becomes `completed`. A timeout final remains `completion_status=timeout`; it still advances to `current_step=completed`. Both paths receive a server-authored `sessions.ended_at`. `game_runs.finalized_at` continues to mean the earlier final-decision sealing time and is never overwritten. Candidate, confidence, final mode, and the `final_decisions` row are immutable throughout Stage 7.

Stage 7 does not compute RES, EAC, EACS, RCI, DDS, GDS, SLS, RDI, benchmark comparisons, or resilience grades. Those prepilot derived metrics are reserved for Stage 8.

## Migration 0007

`migrations/0007_post_task_completion.sql` advances `app_metadata.schema_version` to `7` and adds:

- nullable `questionnaire_submissions.sequence_no`; historical `pre` rows stay null while `post` and `task_experience` require a positive sequence;
- partial uniqueness for `(session_id, sequence_no)`, one post submission per session, and one task-experience submission per session;
- immutable questionnaire submission identity and immutable questionnaire answer values/timestamps;
- server timestamps `sessions.post_task_completed_at` and `sessions.task_experience_completed_at`, protected against ordinary overwrite;
- `completion_records`, one immutable record per session with final, post, task, completion status/mode, client/server completion time, event ID, and sequence;
- additive `game_events` support for `post_task_submit`, `task_experience_submit`, and `session_complete` without dropping Stage 1-6 event types or rows;
- indexes for completion time/status and questionnaire lookup.

Cross-table completion integrity is enforced by D1 triggers and the Worker transaction: the final, post, task, session, mode, times, and sequences must belong to the same session. Session cascade deletion still removes participant-owned Stage 7 rows.

## Questionnaire instruments

### Post-task state assessment

- Phase: `post`
- Version: `state-assessment-post-1.0.0`
- Five exact items: `stress`, `fatigue`, `attention`, `mood`, `physicalDiscomfort`
- Scale: integer 0-10 for every item

### Task experience and manipulation check

- Phase: `task_experience`
- Version: `task-experience-1.0.0`
- Integer 1-10 items: `timePressure1`, `timePressure2`, `resourceLimit1`, `resourceLimit2`, `socialEvaluation1`, `socialEvaluation2`, `outcomeResponsibility1`, `outcomeResponsibility2`, `uncontrollability1`, `uncontrollability2`, `cognitiveLoad1`, `cognitiveLoad2`, `cognitiveLoad3`, `cognitiveLoad4`
- Independent integer 0-10 item: `decisionConfidence`

`decisionConfidence` is a new post-task subjective answer. It is never initialized from or copied from `final_decisions.confidence`, even if a participant ultimately chooses the same number.

All items start untouched. A displayed slider position is not an answer: every item must be actively operated and submitted with `touched=true`, a valid integer value, and a plausible ISO answer time. Unknown, missing, duplicated, out-of-range, or untouched items are rejected. Public `phase=manipulation` remains unavailable; the fifteen current items are submitted once under `task_experience`.

## Submission, sealing, and sequence rules

`POST /api/questionnaires` remains the single questionnaire endpoint. It dispatches strict validation by phase and instrument version. Post requires a final decision and `current_step=post_task`; task experience requires the sealed post submission and `current_step=task_experience`. Both active and timeout sessions may complete these stages.

Each first successful post/task write atomically allocates the next existing `game_runs.last_sequence_no`, writes one questionnaire submission, all answers, one minimal game event, the new run sequence, the server completion timestamp, and the next session step. The event payload contains only phase, instrument version, and item count—not duplicated answers. A replay with the same UUID idempotency key returns the existing result without a new row or sequence. A different key cannot overwrite a sealed questionnaire.

For one session, the server ordering is always:

`final_submit < post_task_submit < task_experience_submit < session_complete`

Rejected or replayed requests do not consume a sequence. Concurrent requests converge on the single database-protected result.

## Session end API

`POST /api/sessions/{sessionId}/end` accepts only `sessionId`, `clientCompletedAt`, and `clientSequence`, plus the authenticated `mg_session` cookie and UUID `Idempotency-Key`. The client cannot choose completion status, final mode, candidate, confidence, server time, current step, score, RDI, level, or identity.

The end service requires `current_step=completion_pending`, the immutable final decision, exactly one valid five-answer post submission, exactly one valid fifteen-answer task submission, consistent points, and matching final/session mode. Its transaction allocates the next sequence, writes `completion_records`, writes `session_complete`, updates the run sequence, advances to `completed`, and writes server `ended_at`. Active becomes `completed`; timeout remains `timeout`. Replays—even with another key after completion—return the same safe completion. Concurrent attempts create one record and one event.

Once completed, all formal questionnaire and game writes are rejected. Authenticated resume remains read-only and available.

## Resume snapshots

Safe resume supports all four post-game states:

- `post_task`: return to the untouched five-item post form;
- `task_experience`: post is sealed; return to a new untouched fifteen-item task form;
- `completion_pending`: do not reopen either questionnaire; retry `/end` using the persisted UUID operation key;
- `completed`: render the neutral thank-you screen without calling `/end` again.

The resume projection returns only phase/version/count/time/sequence summaries and the safe completion summary. It never returns answer values, identity, tokens/hashes, benchmarks, or RDI.

## Formal and Quick UI isolation

Formal mode ends at a neutral `提交成功` / `感谢您的参与` screen. It does not enter `ReportScreen`, call `generateReport`, show timeout labels, expose answers, recommend candidates, display RDI/grades, or offer JSON export. Returning home removes only the local safe session pointer and pending UUID keys; it never deletes server research data.

Quick mode remains local and unchanged: it does not call post/task/end APIs and retains the existing complete report and JSON export.

## Browser storage boundary

`localStorage` stores only `mind-game.formal-session.v1`, the safe non-identity session context needed for resume. `sessionStorage` stores only UUID idempotency keys for pending consent, demographic, pre, post, task-experience, and end operations. Questionnaire answers, identity, final answers, candidate facts, point balances, and report data are not persisted by Stage 7 browser storage.

## Verification and migration commands

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

Start the real local Worker with `npm run dev:worker`. The Stage 7 browser smoke must cover active completion, timeout completion, post/task/completion-pending/completed refresh recovery, identical neutral thank-you rendering, Quick API isolation, return-home cleanup, and desktop/mobile layout. After smoke testing, delete only synthetic local participants (foreign-key cascade removes their business rows) and confirm all participant/session/questionnaire/game/completion tables are zero.

Remote migration is permitted only after every local check passes and all remote business-table counts are zero:

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

Migration 0007 may add only schema, indexes, triggers, and `schema_version=7`; it must not insert participant, identity, session, questionnaire, game, final, or completion test rows. Stage 7 does not run `wrangler deploy`.

## Rollback and security boundary

D1 migrations are forward-only. Before remote application, retain a D1 backup/export and verify the empty-business-table gate. Rollback is restoration from that backup; never edit migrations 0001-0007 after application. Application errors use the existing sanitized JSON envelope and do not return SQL, stack traces, local paths, cookies, identity, or database identifiers.

The dependency audit notice remains intentionally unchanged in this stage: Stage 7 does not upgrade unrelated packages or address the existing PostCSS advisory.
