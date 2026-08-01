# Formal Game Start and T1 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, with test-driven development and verification before completion.

**Goal:** 在不开放正式查证、T2/T3、最终录用或报告的前提下，将正式模式的游戏启动、900 秒权威计时、五名候选人的 T1 封存评分、T1 首选与信心、刷新恢复和幂等审计迁移到 Cloudflare Worker + D1；Quick 模式保持现有本地完整流程。

**Architecture:** Worker 是正式模式唯一权威状态源。`sessions` 保存研究流程与游戏起止时间，新增 `game_runs` 保存当前阶段、点数和最后服务端序号，`stage_ratings`/`stage_choices` 保存不可覆盖的阶段提交，`game_events` 保存有序审计事件。前端通过独立 formal API/controller 消费服务器快照，不把评分、选择或信心写入浏览器存储；`sessionStorage` 只保存待重试操作的 UUID 幂等键。

**Tech Stack:** React 18、TypeScript、Vite 6、Cloudflare Worker、D1/SQLite、Vitest、Miniflare、Wrangler。

---

## Task 1: 用失败测试固定 0004 数据库契约

**Files:**
- Create: `migrations/0004_formal_game_t1.sql`
- Modify: `worker-tests/migrations.test.ts`

1. 先为四张表、索引、外键级联、JSON/范围/唯一约束、T1 空证据、不可 UPDATE、`schema_version=4` 编写测试并确认失败。
2. 新增 `game_runs`、`stage_ratings`、`stage_choices`、`game_events`；保留 T2/T3 的结构位，但通过后端拒绝本阶段写入。
3. 用触发器阻止已封存评分和选择 UPDATE；不修改 0001—0003。
4. 运行 `npm run test:worker`，只在迁移契约全绿后继续。

## Task 2: 纯计时与输入契约

**Files:**
- Create: `worker/domain/gameClock.ts`
- Create: `worker/domain/formalGame.ts`
- Create: `worker-tests/gameClock.test.ts`
- Create: `worker-tests/formalGameValidation.test.ts`

1. 先测试 900 秒 deadline、剩余秒数向上取整且最低为 0、截止时刻即 expired、客户端时间不参与权威判断。
2. 先测试三类请求的白名单字段、UUID、ISO 时间、整数范围、候选人和阶段；特别拒绝 `evidenceIdsSeen`、`pointsRemaining`、`deadlineAt`、`currentStage` 和后台答案字段。
3. 实现无副作用的 `createGameClockSnapshot` 和严格解析函数。

## Task 3: Worker 正式游戏服务与路由

**Files:**
- Create: `worker/services/formalGameService.ts`
- Create: `worker/routes/formalGame.ts`
- Modify: `worker/index.ts`
- Modify: `worker/routes/researchIntake.ts`
- Create: `worker-tests/formalGameApi.test.ts`

1. 先按附件列出的启动、T1 评分、T1 choice、过期、恢复、安全和 quick 拒绝场景写 API 测试。
2. `POST /api/sessions/:sessionId/start`：鉴权并核对 consent/demographics/pre submission，使用服务器时间原子写入 `sessions`、`game_runs` 和 `game_start`，首个序号为 1；相同幂等键安全重放。
3. `POST /api/ratings`：仅接受 T1；服务器固定 `evidence_ids_seen=[]`；评分写入、事件写入和序号推进位于同一 D1 batch；相同事件重放不增序号，不同事件覆盖返回业务 409。
4. `POST /api/stage-choices`：要求五个唯一 T1 已封存；保存首选和 0—100 信心，推进 `T1_COMPLETE`；同样幂等且不可覆盖。
5. 并发序号策略：事件先以 `last_sequence_no + 1` 的子查询插入，关联记录从事件读取该序号，再更新 `game_runs.last_sequence_no`；唯一约束冲突重读/有限重试，保证同 session 单调唯一。
6. 所有正式写接口在写前用服务器时间检查 deadline。首次检测过期时幂等写 `time_expired_at` 和唯一 `timer_expired` 事件；不补评分、不补 choice、不完成 session。
7. 扩展 resume：`playing` 返回已封存 ratings/choice、阶段、时间、点数和服务端候选人顺序；GET 保持只读，expired 由当前服务器时间计算。
8. 保持统一 JSON envelope、no-store、requestId 和错误脱敏。

## Task 4: 正式前端 API、幂等键与服务器快照模型

**Files:**
- Create: `src/types/formalGame.ts`
- Create: `src/api/formalGame.ts`
- Create: `src/utils/formalPendingKeys.ts`
- Create: `src/hooks/useFormalGameController.ts`
- Create: `src/__tests__/formalGameApi.test.ts`
- Create: `src/__tests__/formalGameController.test.ts`

1. 先测试 `game_ready` 启动、失败重试复用 UUID、成功清键、评分按 T1/候选人隔离键、choice 独立键。
2. sessionStorage 只允许：`mind-game.pending.game-start.v1`、`mind-game.pending.rating.T1.<ID>.v1`、`mind-game.pending.stage-choice.T1.v1` 的 UUID；不得存评分、选择、信心、deadline 或点数。
3. Controller 以服务器 snapshot 为唯一正式游戏状态；API 成功才封存，失败保留未提交控件；resume 覆盖未确认 UI。
4. 计时显示用 `deadlineAt`、`serverNow` 和响应接收时刻校准，绝不将客户端剩余值写回服务器。

## Task 5: 正式 T1 UI 与 Quick 隔离

**Files:**
- Create: `src/components/StageChoicePanel.tsx`
- Create: `src/components/FormalT1CompletePanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/GameScreen.tsx`
- Modify: `src/components/CandidateDetail.tsx`
- Modify: `src/components/RatingPanel.tsx`
- Modify: `src/components/TimerBar.tsx`
- Modify: `src/styles/game.css`
- Create/Modify: relevant `src/__tests__/*.test.tsx`

1. 先测试 Formal 调 start/ratings/choice，Quick 不调用；Formal 无 VERIFY/本地扣点/T2/T3/final/report，Quick 原流程不变。
2. Formal 在服务器确认前不构造本地游戏事实；服务器候选人顺序贯穿列表，默认打开第一位。
3. 正式 T1 每名候选人未提交前可调 0—100，成功后显示封存且不能覆盖；网络失败显示可重试。
4. 五名 T1 完成后显示中性 `StageChoicePanel`；候选人和信心必须由玩家主动操作，confidence=0 只有 touched 后有效。
5. choice 成功后显示：`初评数据已安全保存。服务器查证与点数账本将在下一阶段接入。`
6. 过期显示：`本轮时间已结束，最终决策功能将在后续阶段接入。`
7. 正式页面不提供可用浅查/深查、T2/T3 或最终决策；Quick 完整玩法和报告保持不变。

## Task 6: 文档、全量测试与本地真实 Worker 冒烟

**Files:**
- Create: `docs/backend-stage-4-formal-game-t1.md`
- Create/Modify: test helpers only as needed

1. 运行本地迁移列表和迁移，验证 schema 4 及四张表。
2. 运行 `npm run test:worker`、`npm test -- --run`、`npm run typecheck`、`npm run build`、`npm run check`、`git diff --check`。
3. 启动 `npm run dev:worker`，使用真实 Cookie/API 流完成：研究前置 → start → 幂等重放 → A—E T1 → 重复覆盖拒绝 → T1 choice → resume T1_COMPLETE；另测 partial resume、Quick 无 API、过期写拒绝。
4. 用浏览器检查桌面/窄屏正式 T1 与 Quick 回归，保存截图作为验证证据但不提交临时截图。
5. 删除所有本地合成 participant/session/rating/choice/event/questionnaire 数据，再查询确认空。

## Task 7: 远程空库迁移、最终验证与提交

1. 先查询远程正式数据表计数，只有仍为 0 才执行 `npm run db:migrate:remote`；迁移只包含 schema/index/metadata。
2. 迁移后再次列出 migrations，并查询远程 participant/session/identity/questionnaire/game 表确认无测试记录。
3. 不运行 `wrangler deploy`，不影响线上 Worker。
4. 再次运行完整 `npm run check` 和 `git diff --check`。
5. 只提交一次：`feat: persist formal game start and T1 decisions`；确认工作区干净，不 push、不 merge、不创建 PR。

## State machine and boundaries

- Stage 3 end: `sessions.current_step=game_ready`。
- Start: `game_ready -> playing`；`game_runs.current_stage=T1`。
- Five ratings alone do not advance stage；T1 choice atomically advances `T1 -> T1_COMPLETE`。
- Stage 4 stops at `T1_COMPLETE`。T2/T3 columns exist solely for forward-compatible schema; opening their APIs before server evidence/point ledger exists would allow client-controlled evidence and break assessment integrity, so both are explicitly rejected.
- Expiry keeps `completion_status=in_progress`; it only locks writes and records an idempotent expiry audit event. No automatic candidate or assessment conclusion is fabricated.

## Rollback

- Code rollback: revert the Stage 4 commit on this feature branch.
- Local DB rollback: remove local Wrangler D1 state and reapply 0001—0003 only in a disposable local database; never edit published migrations.
- Remote DB rollback: because D1 migrations are forward-only, do not drop tables automatically. If Stage 4 must be abandoned before production traffic, add a separately reviewed compensating migration; preserve existing Stage 1—3 data.
- Application rollback remains safe because no `wrangler deploy` occurs in this stage.
