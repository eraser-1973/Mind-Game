# Formal Evidence, Points, T2 and T3 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, with test-driven development and verification before completion.

**Goal:** 在 Stage 4 的正式 T1 服务端事实源上，增加版本化证据目录、五点资源账本、原子浅查/深查、T2/T3 封存评分与阶段选择、正式 Niko 反馈和完整刷新恢复；Quick 模式继续使用原本地完整流程。

**Architecture:** Cloudflare Worker + D1 是 Formal 模式中证据、余额、阶段、评分和服务端序号的唯一权威来源。浏览器只提交操作意图和 UUID 幂等键，并以服务端返回的 game snapshot 更新界面；正式证据只从已发布且与 session 绑定的材料版本按解锁返回。一个查证事务同时写入证据事件、证据明细、点数账本、通用游戏事件并更新 `game_runs`，数据库唯一约束与条件更新共同处理重复及并发请求。

**Tech Stack:** React 18、TypeScript、Vite 6、Cloudflare Worker、D1/SQLite、Vitest、Miniflare、Wrangler。

---

## Task 1: 以失败测试固定 0005 数据库契约

**Files:**
- Create: `migrations/0005_evidence_points_t2_t3.sql`
- Create: `worker-tests/evidencePointsMigration.test.ts`
- Modify: `worker-tests/migrations.test.ts`

1. 先编写并运行失败测试，覆盖 schema 5、四张新表、约束、索引、级联关系、不可变账本与事件、点数版本种子和证据种子。
2. 新建 `point_rules`，发布 `points-5-v1`：总点数 5、浅查 1、深查 3。
3. 新建 `candidate_evidence_items`，从 `src/data/candidates.ts` 精确迁入 `material-1.0.0` 的 A—E 共 20 条证据；证据 ID、层级、顺序、标题、正文、极性逐项核对。
4. 暂按现有风险设计把 A/C 的深查实锤证据标记为内部 `is_key_risk=1`，其余为 0；该映射仅供服务端研究追踪，不下发前端，并在阶段文档中标记“须研究负责人最终确认”。
5. 新建 `evidence_events`、`evidence_event_items` 与 `point_ledger`，加入 session、event、candidate+level、sequence 及余额关系约束和必要索引。
6. 只新增 0005，不修改 0001—0004；将 `app_metadata.schema_version` 推进到 5。

## Task 2: 纯领域规则、输入白名单与公开投影

**Files:**
- Create: `worker/domain/formalEvidence.ts`
- Create: `worker-tests/formalEvidenceValidation.test.ts`
- Modify: `worker/validation/formalGameRequest.ts`
- Modify: `worker-tests/formalGameApi.test.ts`

1. 先测试 shallow/deep、T2/T3、候选人、0—100 整数、ISO 时间、可选非负 client sequence 和严格未知字段拒绝。
2. 证据解锁请求只允许 `sessionId`、`candidateId`、`level`、`clientAt`、`clientSequence`；拒绝客户端余额、成本、证据 ID、材料版本、极性和风险字段。
3. 扩展评分和阶段选择输入为 `T1 | T2 | T3`，继续拒绝客户端 `evidenceIdsSeen`。
4. 增加纯 `deriveFormalStageStatus`，稳定派生 `T1_ACTIVE`、`T1_COMPLETE`、`T2_ACTIVE`、`T2_COMPLETE`、`T3_ACTIVE`、`T3_COMPLETE`，不新增最终阶段。
5. 公开证据投影只含 `id/title/content/polarity/level/order`；绝不包含 `is_key_risk`、后台基准或风险答案。

## Task 3: 原子证据解锁、点数账本与并发幂等

**Files:**
- Create: `worker/services/formalEvidence.ts`
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/routes/formalGame.ts`
- Modify: `worker/router.ts`
- Create: `worker-tests/formalEvidenceApi.test.ts`

1. 先测试 `/api/evidence/unlock` 的鉴权、JSON/体积/方法/幂等键/字段白名单、绑定材料缺失、超时和 quick 拒绝。
2. 浅查仅允许 T1 选择已封存后的 T1_COMPLETE/T2；首次浅查把 `current_stage` 置为 T2，消耗 1 点，同一候选人浅查只能成功一次。
3. 深查仅允许 T2 阶段选择已封存、候选人已有浅查和 T2 评分且余额至少 3；首次深查把 `current_stage` 置为 T3，消耗 3 点，同一候选人深查只能成功一次。
4. 每次首次解锁在一个 D1 batch 中写入 `evidence_events`、两条 `evidence_event_items`、一条 `point_ledger`、一条 `game_events`，并以旧 `last_sequence_no` 与旧余额为条件更新 `game_runs`。
5. 同一幂等键重放返回原事件；不同键请求已解锁的同一候选人+层级返回 `created=false, alreadyUnlocked=true`，复用原证据、余额与序号且不新增记录。
6. 并发不同查证竞争最后三点时，只有满足条件更新的事务可成功；失败请求重读权威状态并返回 409 `INSUFFICIENT_POINTS`，余额永不为负。
7. 新扣点前校验 `points_total = points_remaining + SUM(-delta)` 且账本每行 before/delta/after 连续；不一致返回 500 `POINT_LEDGER_INCONSISTENT`、增加 `sessions.error_count` 并只写脱敏服务端日志。
8. 响应包含服务端权威 points、stageStatus、公共证据和 server sequence；不返回关键风险标记或账本内部数据。

## Task 4: 扩展 T2/T3 评分与阶段选择

**Files:**
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/routes/formalGame.ts`
- Modify: `worker-tests/formalGameApi.test.ts`
- Create: `worker-tests/formalT2T3Api.test.ts`

1. 保留 T1 行为；把评分查询和投影改为按 session/candidate/stage 通用处理。
2. T2 只在 `current_stage=T2` 且 T2 choice 未封存时开放；候选人必须已有 shallow 事件和 T1 评分。服务端按解锁明细顺序生成 shallow `evidence_ids_seen`。
3. T3 只在 `current_stage=T3` 且 T3 choice 未封存时开放；候选人必须已有 deep 事件和 T2 评分。服务端按 shallow 后 deep 的顺序生成 `evidence_ids_seen`。
4. 评分、通用事件和 `game_runs.last_sequence_no` 同批提交；同一 eventId 重放成功，不同 eventId 覆盖同一 candidate+stage 返回 409。
5. T2 choice 要求至少一名候选人已浅查、所有浅查候选人均有 T2 评分、尚未深查；成功后保持 `current_stage=T2`，派生 `T2_COMPLETE`，封存后禁止新浅查和 T2 评分。
6. T3 choice 要求至少一名候选人已深查、所有深查候选人均有 T3 评分；成功后保持 `current_stage=T3`，派生 `T3_COMPLETE`，封存后禁止新深查和 T3 评分。
7. T2/T3 choice 与评分使用统一递增 `server_sequence`；第一提交 201、幂等重放 200、不同键覆盖 409。

## Task 5: 扩展正式恢复快照

**Files:**
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/services/researchIntake.ts`
- Modify: `worker-tests/formalGameApi.test.ts`
- Modify: `worker-tests/researchIntake.test.ts`

1. Resume 返回权威 points、`currentStage`、派生 `stageStatus`、所有已封存 ratings、所有 stageChoices、已解锁 evidenceUnlocks 和 lastSequenceNo。
2. Ratings 按服务端序号排序并返回服务器生成的 `evidenceIdsSeen`；T1 永远为空数组。
3. Evidence unlocks 按服务端序号排序，内部 evidence items 按 item order 排序；只返回已解锁证据。
4. 兼容 Stage 4 的 `stageChoice` 消费端，前端迁移完成后以 `stageChoices` 为主；不丢失 T1 choice。
5. Deadline 保持原值，GET 不增加序号、不写事件；过期后仍允许只读恢复已保存的点数、证据和评分。

## Task 6: 正式前端 API、幂等键与控制器

**Files:**
- Create: `src/api/formalEvidence.ts`
- Create: `src/api/formalEvidence.test.ts`
- Modify: `src/api/formalGame.ts`
- Modify: `src/api/formalGame.test.ts`
- Modify: `src/types/formalGame.ts`
- Modify: `src/utils/formalPendingKeys.ts`
- Modify: `src/utils/formalPendingKeys.test.ts`
- Modify: `src/hooks/useFormalGameController.ts`
- Create: `src/hooks/useFormalGameController.test.ts`

1. 先测试 shallow/deep、T2/T3 rating 与 T2/T3 choice 的请求契约、HTTP 状态和服务端快照合并。
2. pending key 固定为 evidence level+candidate、rating stage+candidate、stage choice stage；sessionStorage 只保存 UUID，不保存证据、评分、余额、候选人、选择或信心。
3. 每个操作失败重试复用 UUID，成功后清除；新正式 session 清理所有 Stage 5 pending keys；Quick 不创建这些 key。
4. 控制器以服务端 snapshot 为唯一事实源；提交成功后用响应/重新 resume 刷新，严禁在 Formal 本地扣点、伪造证据或自行推进阶段。
5. Formal 恢复六类关键状态：T1_COMPLETE、T2_ACTIVE、T2_COMPLETE、T3_ACTIVE、T3_COMPLETE、expired；不重置 deadline。

## Task 7: Formal 游戏 UI、Niko 与 Quick 隔离

**Files:**
- Rename/Replace: `src/components/FormalT1GameScreen.tsx` → `src/components/FormalGameScreen.tsx`
- Create: `src/components/FormalEvidencePanel.tsx`
- Create: `src/components/FormalRatingPanel.tsx`
- Create: `src/components/FormalInvestigationStatus.tsx`
- Modify: `src/components/GameScreen.tsx`
- Modify: `src/components/FormalCandidateDetail.tsx`
- Modify: `src/components/NikoChatPanel.tsx`
- Modify: `src/styles/game.css`
- Create/Modify: relevant component tests

1. 先增加失败测试，证明 Formal 不读取本地未解锁 evidence、不派发本地 VERIFY/RATE、不在客户端扣点；Quick 原流程与报告保持不变且不调用 Formal API。
2. T1_COMPLETE/T2_ACTIVE 页面显示服务器浅查能力、余额与已解锁材料；候选人浅查后只开放该候选人的 T2 评分。
3. 至少一次浅查且所有浅查候选人的 T2 已封存后显示中性的 T2 阶段首选/信心面板，并提示封存会关闭新的浅查/T2。
4. T2 choice 后只给“已浅查且有 T2”的候选人显示深查；余额不足 3 时显示 Stage 5 暂停文案，不显示无效深查按钮。
5. 深查后只开放相应候选人的 T3；所有深查候选人 T3 完成后显示 T3 阶段选择。
6. T3 complete 显示：`查证与重评数据已安全保存，最终录用将在下一阶段接入。`；只有 T2 complete 且无法深查时显示另一条附件规定的暂停文案。不得出现最终录用按钮/API。
7. Formal Niko 只依据服务端已返回的公共 evidence polarity 与相邻阶段评分差生成 happy/angry 训练反馈，不读取 `is_key_risk`；本阶段不持久化 Niko 消息，刷新后丢失的限制写入文档。
8. Quick 继续用本地 `candidates.ts`、本地 reducer、5 点玩法、完整最终决策与报告，不进入正式 API 或 pending keys。

## Task 8: 文档、本地迁移与真实 Worker 冒烟

**Files:**
- Create: `docs/backend-stage-5-evidence-points-t2-t3.md`
- Modify: test helpers only as needed

1. 文档记录表结构、证据种子核对、临时关键风险映射、原子扣点、阶段状态、幂等/并发、恢复、Formal/Quick 边界、Niko 非持久限制、迁移/回滚和 Stage 6 未实现项。
2. 运行本地迁移列表、应用 0005、再次列出并查询 schema 5、规则和 20 条证据。
3. 启动真实 `npm run dev:worker`，完成五名浅查、浅查+深查、两浅查+深查、最后三点并发竞争与六种刷新恢复状态。
4. 用浏览器检查正式桌面/窄屏 T2/T3、Niko、阶段暂停页面，并回归 Quick 完整流程；临时截图不提交。
5. 删除本地所有合成 participant/session 业务数据，逐表确认测试标记与业务表计数为 0；保留版本配置种子。

## Task 9: 全量验证、远程空库迁移和唯一提交

1. 依次运行 `npm run test:worker`、`npm test -- --run`、`npm run typecheck`、`npm run build`、`npm run check`、`git diff --check`。
2. 审计构建产物及 Formal API 响应，确认未锁定证据、关键风险字段、后台基准、身份或账本内部数据不泄漏。
3. 远程迁移前只读确认正式业务数据为 0；只有为空且全部本地验证通过，才执行 0005 远程迁移并复核迁移、schema 5、配置种子及业务表仍为 0。
4. 不运行 `wrangler deploy`，不写远程合成业务数据。
5. 最终只提交一次：`feat: add server evidence points and T2 T3 flow`；确认分支仍为 `feature/cloudflare-d1-backend`、工作区干净，不 push、不 merge、不创建 PR。

## Server stage state and sequencing

- Stage 4 baseline: `current_stage=T1_COMPLETE`、`stageStatus=T1_COMPLETE`、余额 5。
- First shallow: `current_stage=T2`、`stageStatus=T2_ACTIVE`；后续 shallow 保持 T2_ACTIVE。
- T2 choice: `current_stage=T2`、`stageStatus=T2_COMPLETE`；浅查和 T2 评分封存。
- First deep: `current_stage=T3`、`stageStatus=T3_ACTIVE`；后续 deep 保持 T3_ACTIVE。
- T3 choice: `current_stage=T3`、`stageStatus=T3_COMPLETE`；深查和 T3 评分封存。
- 每个成功的新 evidence/rating/choice 与其审计记录共享一个新 `server_sequence`；幂等重放或 already-unlocked 响应不消耗序号。
- 本阶段不使用 `DECISION`，不写 final，不完成正式 session。

## Rollback

- 应用代码：在功能分支上回退唯一 Stage 5 提交；不触碰 main。
- 本地 D1：可删除一次性本地 Wrangler 状态后仅重放 0001—0004；不要编辑已发布迁移历史。
- 远程 D1：迁移前必须确认无业务数据。D1 迁移采用向前修复；若必须撤除 0005，应另写经审查的补偿迁移，不能删除 `d1_migrations` 记录或直接改旧 SQL。
- 由于本阶段不部署，线上 Worker 应用可保持 Stage 4 版本；应用和 schema 的切换必须在后续部署阶段单独评审。

## Stage 6 pause point

以下仍明确未实现：沉没成本结构化后端、最终录用、最终信心、manual/timeout 提交类型、倒计时自动终局、测后状态、任务体验问卷、正式完成页、RES/EAC/EACS/DDS/GDS/SLS、RDI、管理员与导出/删除能力。完成 T2/T3 后只显示附件规定的安全保存提示并停止。
