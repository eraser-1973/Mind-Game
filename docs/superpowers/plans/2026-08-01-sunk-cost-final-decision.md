# Sunk Cost and Final Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Stage 5 的服务器权威评分、证据和点数账本上，实现版本化沉没成本触发、不可覆盖的沉没成本选择、主动/超时最终录用、刷新恢复和 Formal 临时 post-task 页面，同时保持 Quick 本地完整流程不变。

**Architecture:** Cloudflare Worker 与 D1 继续作为 Formal 模式唯一事实源。服务器根据 `deadline_at`、绑定规则版本、关键风险证据及账本重算资格，使用 D1 原子批处理和唯一约束封存 show、choice 与 final；浏览器只提交操作意图和 UUID 幂等键，并以安全恢复快照驱动界面。Quick 不加载新控制器、不调用新 API，也不产生 D1 记录。

**Tech Stack:** React 18、TypeScript、Vite 6、Cloudflare Worker、D1/SQLite、Vitest、Miniflare、Wrangler、playwright-core 本地浏览器冒烟。

## Global Constraints

- 工作目录固定为 `D:\心理游戏\.worktrees\cloudflare-d1-backend`，分支固定为 `feature/cloudflare-d1-backend`。
- 起始提交固定为 `f06d3b5e18054cb1a17c317258fd73a7c1a3e3af`；不修改、合并或切换 `main`。
- 只新增 `0006_sunk_cost_final_decision.sql`，不得修改 0001—0005 或重建数据库。
- Formal 总时长固定 900 秒；`sunk-1.0.0` 固定为剩余 300 秒、目标候选人累计投入至少 2 点且已解锁关键风险证据。
- 客户端不得提交风险标记、投入点数、剩余时间、提交模式、来源阶段或自动选择结果。
- `sessions.ended_at` 在 Stage 6 保持空；测后问卷、正式完成页和派生指标留到 Stage 7。
- Formal 不显示 RDI、等级、标准答案、关键风险标记或 JSON 下载；Quick 继续原完整报告。
- 不升级无关依赖，不修复现有 PostCSS 公告，不执行 `wrangler deploy`，不 push，不创建 PR。
- 全部生产行为遵循测试先行：先运行新增测试并确认因缺失功能失败，再写最小实现。

---

### Task 1: 固定 0006 数据库契约与兼容迁移

**Files:**
- Create: `migrations/0006_sunk_cost_final_decision.sql`
- Create: `worker-tests/sunkCostFinalMigration.test.ts`
- Modify: `worker-tests/runtime.ts`
- Modify: `worker-tests/sessions.test.ts`

**Interfaces:**
- Produces: `sunk_cost_rules`、`sunk_cost_events`、`final_decisions`，以及 `configuration_sets.sunk_cost_rule_version`、`sessions.sunk_cost_rule_version`、`game_runs.finalized_at`。
- Preserves: 0001—0005 的 participant、session、run、rating、choice、evidence、ledger 与 sequence 数据。

- [ ] **Step 1: 写迁移失败测试**

  测试先断言 schema 6、三张新表、规则种子、索引、外键、约束、版本绑定、旧会话填充、级联和 Stage 1—5 数据保持；当前应因 0006 不存在或表不存在而失败。

- [ ] **Step 2: 运行 RED**

  Run: `npm run test:worker -- worker-tests/sunkCostFinalMigration.test.ts`
  Expected: FAIL，错误明确指向缺失 migration/schema/table。

- [ ] **Step 3: 编写 additive migration**

  创建 `sunk_cost_rules` 并发布 `sunk-1.0.0`；用 SQLite 兼容的表重建方式给 `configuration_sets` 与 `sessions` 增加不可空版本字段，给 `game_runs` 增加 `finalized_at`，并安全扩展 `game_events.event_type` 为 `sunk_cost_show | sunk_cost_choice | final_submit`。创建 `sunk_cost_events`、`final_decisions`、索引和不可覆盖触发器，最后更新 `app_metadata.schema_version=6`。

- [ ] **Step 4: 运行 GREEN 与迁移回归**

  Run: `npm run test:worker -- worker-tests/sunkCostFinalMigration.test.ts worker-tests/evidencePointsMigration.test.ts worker-tests/formalGameMigration.test.ts`
  Expected: 新旧迁移测试全部 PASS。

### Task 2: 纯沉没成本规则、目标排序和最终资格

**Files:**
- Create: `worker/domain/sunkCost.ts`
- Create: `worker/domain/finalDecisionEligibility.ts`
- Create: `worker-tests/sunkCostDomain.test.ts`
- Modify: `worker/domain/formalStage.ts`

**Interfaces:**
- Produces: `calculateSunkCostEligibility`、`chooseSunkCostTarget`、`buildSunkCostSnapshot`、`calculatePointsAfterChoice`、`deriveFinalDecisionEligibility`。
- Consumes: server-derived remaining seconds, candidate investment, first key-risk sequence, display order, sealed stages and saved sunk choice.

- [ ] **Step 1: 写纯函数失败测试**

  覆盖大于 300 秒、无关键风险、投入不足、满足触发、多目标按投入/首次风险/展示顺序稳定决胜、T2/T3/give_up 主动 final 资格、T1 未 give_up 拒绝，以及 choice 后账本增量计算。

- [ ] **Step 2: 运行 RED**

  Run: `npm run test:worker -- worker-tests/sunkCostDomain.test.ts`
  Expected: FAIL，因为领域模块尚不存在。

- [ ] **Step 3: 实现无 I/O 规则**

  函数只接受显式服务器事实，不读取 `Date.now()`、浏览器字段或 benchmark。目标比较键固定为 `[-pointsInvested, firstRiskSequence, displayIndex]`；最终资格只返回允许/拒绝和服务器来源阶段。

- [ ] **Step 4: 运行 GREEN**

  Run: `npm run test:worker -- worker-tests/sunkCostDomain.test.ts`
  Expected: PASS。

### Task 3: 会话版本、鉴权状态与安全请求解析

**Files:**
- Modify: `worker/repositories/configurationSets.ts`
- Modify: `worker/repositories/sessions.ts`
- Modify: `worker/services/sessionCreation.ts`
- Modify: `worker/auth/sessionAuth.ts`
- Modify: `worker/validation/formalGameRequest.ts`
- Create: `worker/validation/sunkCostFinalRequest.ts`
- Create: `worker-tests/sunkCostFinalValidation.test.ts`
- Modify: `worker-tests/sessions.test.ts`
- Modify: `src/types/game.ts`
- Modify: `src/utils/formalSessionContext.ts`
- Modify: related frontend/API parser tests

**Interfaces:**
- `authenticateFormalSession(request, db, expectedSessionId?, { allowedCompletionStatuses })` supports route-specific status policy without revealing session existence.
- Parsers produce strict `SunkCostShowInput`、`SunkCostChoiceInput`、`ActiveFinalDecisionInput`、`TimeoutFinalDecisionInput` with header UUID as event ID.

- [ ] **Step 1: 写失败测试**

  测试新会话复制 `sunkCostRule`，安全版本响应包含该字段；四种请求只接受白名单，拒绝 client risk/points/time/mode/source 字段，验证 16 KiB、JSON、UUID、ISO、candidate 和 0—100 整数。

- [ ] **Step 2: 运行 RED**

  Run: `npm run test:worker -- worker-tests/sunkCostFinalValidation.test.ts worker-tests/sessions.test.ts`
  Expected: FAIL 于缺失版本与解析器。

- [ ] **Step 3: 实现配置复制、鉴权策略和解析器**

  将 `sunk_cost_rule_version` 加入 repository/authenticated session/safe versions；resume 允许 `in_progress | timeout | completed`，游戏写接口仍只允许 `in_progress`。所有未知字段统一返回 `UNKNOWN_FIELD`。

- [ ] **Step 4: 运行 GREEN**

  Run: `npm run test:worker -- worker-tests/sunkCostFinalValidation.test.ts worker-tests/sessions.test.ts worker-tests/researchIntake.test.ts`
  Expected: PASS，旧鉴权响应仍不泄露状态差异。

### Task 4: 沉没成本 show/choice、门控与选择后投入

**Files:**
- Create: `worker/services/sunkCost.ts`
- Create: `worker/routes/sunkCost.ts`
- Create: `worker-tests/sunkCostApi.test.ts`
- Modify: `worker/router.ts`
- Modify: `worker/services/formalEvidence.ts`
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/routes/formalGame.ts`

**Interfaces:**
- `POST /api/sunk-cost/show`
- `POST /api/sunk-cost/choice`
- `getSunkCostGate(db, session, run, serverNow)` returns eligibility/current record without private evidence IDs.
- `requireSunkCostResponseIfNeeded` gates evidence, T2/T3 ratings/choices and active final.

- [ ] **Step 1: 写 show/choice/门控失败测试**

  覆盖 required=false 无写入；首次 show 201；同键、不同键、并发只一条；不扣点/不改阶段；三种 choice；封存；give_up 切 DECISION；pending 时阻止证据、评分、阶段选择和主动 final；resume/timeout 不阻止；响应无风险证据 ID。

- [ ] **Step 2: 运行 RED**

  Run: `npm run test:worker -- worker-tests/sunkCostApi.test.ts`
  Expected: FAIL，路由 404 或表/服务缺失。

- [ ] **Step 3: 实现服务器资格查询与原子写入**

  资格查询从 `deadline_at`、绑定规则、`point_ledger`、`evidence_events`、`candidate_evidence_items.is_key_risk` 和展示顺序重算。show 批量写主记录+game event+run sequence；choice 条件更新 pending 行并写 event/run，give_up 同批置 `current_stage=DECISION`。重复/并发均重读 winner。

- [ ] **Step 4: 集成门控并运行 GREEN**

  在证据、T2/T3 评分和 T2/T3 选择写入前调用门控；T1 数据保持原规则。Run: `npm run test:worker -- worker-tests/sunkCostApi.test.ts worker-tests/formalEvidenceApi.test.ts worker-tests/formalT2T3Api.test.ts`。Expected: PASS。

### Task 5: 主动 final、超时 final、封存和状态转换

**Files:**
- Create: `worker/services/finalDecision.ts`
- Create: `worker/routes/finalDecision.ts`
- Create: `worker-tests/finalDecisionApi.test.ts`
- Modify: `worker/router.ts`
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/services/formalEvidence.ts`
- Modify: `worker/routes/formalGame.ts`

**Interfaces:**
- `POST /api/final-decision`
- `POST /api/final-decision/timeout`
- `ensureTimeoutFinalized(db, session, serverNow)` returns the one sealed result or a safe fallback error.
- `projectFinalDecision` returns only participant-safe result fields.

- [ ] **Step 1: 写主动 final 失败测试**

  覆盖 T2_COMPLETE、T3_COMPLETE、give_up；候选人 A—E；confidence 0/100；禁止未完成阶段、pending sunk response 和已过期 active；source stage 服务器派生；not_triggered；封存、同键/不同键/并发一致；不写 ended_at、不返回报告答案。

- [ ] **Step 2: 写超时 final 失败测试**

  覆盖 deadline 前拒绝；T3→T2→T1 回退；不提交 candidate/confidence；timer_expired 先于 final_submit；重试/并发只一条；无 stage choice 时 error；pending sunk choice 标记 timeout_unanswered；active/timeout 边界以服务器 deadline 为准。

- [ ] **Step 3: 运行 RED**

  Run: `npm run test:worker -- worker-tests/finalDecisionApi.test.ts`
  Expected: FAIL，路由或服务缺失。

- [ ] **Step 4: 实现原子 finalization**

  主动 final 在事务前后验证资格、deadline、账本和唯一结果，写 `final_decisions`、`final_submit`、run finalized/DECISION/sequence、session post_task/active，并计算 choice 后投入或插入零 sequence 的 not_triggered。超时先幂等写 `timer_expired`，再按最新封存 choice 自动 final，置 `completion_status=timeout` 和 `final_submit_mode=timeout`；绝不读取评分最高者或 benchmark。

- [ ] **Step 5: 把所有正式写接口接到统一超时收口并运行 GREEN**

  Evidence/rating/stage/show/choice/active final 发现过期时调用 `ensureTimeoutFinalized` 后返回 `GAME_EXPIRED` 与安全 final snapshot。Run: `npm run test:worker -- worker-tests/finalDecisionApi.test.ts worker-tests/formalGameApi.test.ts worker-tests/formalT2T3Api.test.ts`。Expected: PASS。

### Task 6: 扩展恢复投影与前端 API/幂等键

**Files:**
- Modify: `worker/services/formalGame.ts`
- Modify: `worker/services/researchIntake.ts`
- Modify: `worker/routes/researchIntake.ts`
- Modify: `worker-tests/finalDecisionApi.test.ts`
- Create: `src/api/formalSunkCost.ts`
- Create: `src/api/formalSunkCost.test.ts`
- Create: `src/api/formalFinalDecision.ts`
- Create: `src/api/formalFinalDecision.test.ts`
- Modify: `src/api/formalGame.ts`
- Modify: `src/api/formalResearch.ts`
- Modify: `src/types/formalGame.ts`
- Modify: `src/types/game.ts`
- Modify: `src/utils/formalPendingKeys.ts`
- Modify: `src/utils/formalPendingKeys.test.ts`

**Interfaces:**
- Resume snapshot adds participant-safe `sunkCost` and `finalDecision`.
- Pending operations add `sunk-cost-show`、`sunk-cost-choice`、`final-decision`、`timeout-final-decision`; values are UUID only.

- [ ] **Step 1: 写恢复/API/存储失败测试**

  覆盖 eligible-not-shown、shown-pending、answered、not_triggered、active final、timeout final、GET 自动 timeout、无 risk IDs；API 路径和 payload；sessionStorage 仅 UUID 且不包含 choice/candidate/confidence。

- [ ] **Step 2: 运行 RED**

  Run: `npm test -- --run src/api/formalSunkCost.test.ts src/api/formalFinalDecision.test.ts src/utils/formalPendingKeys.test.ts`
  Expected: FAIL，模块或 parser 缺失。

- [ ] **Step 3: 实现安全投影与客户端 API**

  Resume 允许 post_task/timeout/completed；如果 playing 已过期则幂等完成超时收口。客户端 parser 使用严格字段验证，`GAME_EXPIRED` 可携带安全 finalDecision。成功或 alreadySubmitted 清键，失败保留同一键。

- [ ] **Step 4: 运行 GREEN**

  Run: `npm test -- --run src/api/formalSunkCost.test.ts src/api/formalFinalDecision.test.ts src/utils/formalPendingKeys.test.ts src/api/formalResearch.test.ts`
  Expected: PASS。

### Task 7: Formal 弹窗、最终录用页、超时与临时 post-task 页

**Files:**
- Create: `src/components/FormalSunkCostModal.tsx`
- Create: `src/components/FormalFinalDecisionScreen.tsx`
- Create: `src/components/FormalPostTaskPendingScreen.tsx`
- Create: `src/components/FormalGameScreenStage6.test.tsx`
- Modify: `src/hooks/useFormalGameController.ts`
- Modify: `src/components/FormalGameScreen.tsx`
- Modify: `src/components/GameScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/game.css`
- Modify: `src/App.test.tsx`
- Modify: `src/components/GameScreen.test.tsx`

**Interfaces:**
- Controller exposes `checkSunkCost`、`submitSunkChoice`、`submitFinalDecision`、`submitTimeoutFinal` and server snapshot only.
- Formal modal is server-gated and non-dismissible; final screen collects candidate plus touched confidence; post-task page renders only sealed safe status.

- [ ] **Step 1: 写前端失败测试**

  覆盖跨入 300 秒/操作后检查；required=false 不显示；show 成功才显示；失败保留；三按钮视觉同权；continue/stop_loss 返回；give_up 进 final；T2/T3 入口；未选候选人/未触碰信心禁用，0 有效；确认提示；失败保留输入与 key；成功/timeout 显示临时页；无报告/RDI/JSON/答案；刷新恢复；Quick 新 API 零调用且原报告继续。

- [ ] **Step 2: 运行 RED**

  Run: `npm test -- --run src/components/FormalGameScreenStage6.test.tsx src/App.test.tsx src/components/GameScreen.test.tsx`
  Expected: FAIL，Stage 6 组件与行为缺失。

- [ ] **Step 3: 实现 Controller 和 UI**

  保持深色模拟舱视觉，Formal 三个沉没成本按钮使用完全一致样式；弹窗无关闭入口。最终候选卡使用现有中性亮青选中态，不根据风险或能力变色。local countdown 只负责触发服务器检查，资格和 final 均由 API 结果决定；归零调用 timeout endpoint，竞态后恢复服务器结果。

- [ ] **Step 4: 接入 App 恢复并运行 GREEN**

  `FormalSessionStep` 增加 `post_task`；App 在该步骤仍渲染 Formal 安全临时页，不进入现有测后问卷或 `ReportScreen`。Run: `npm test -- --run src/components/FormalGameScreenStage6.test.tsx src/App.test.tsx src/components/GameScreen.test.tsx`。Expected: PASS。

### Task 8: 文档、本地/远程迁移、真实场景和唯一提交

**Files:**
- Create: `docs/backend-stage-6-sunk-cost-final-decision.md`
- Create/Modify: `scripts/stage6-local-smoke.mjs`
- Create/Modify: `scripts/stage6-browser-smoke.mjs`

**Interfaces:**
- Scripts create only clearly named local synthetic participants, verify scenarios, then support cascade cleanup.
- Documentation records schema, rules, APIs, state transitions, security boundaries, migration, rollback and Stage 7 boundary.

- [ ] **Step 1: 编写阶段文档和真实 smoke scripts**

  文档覆盖附件列出的全部字段和边界。HTTP smoke 覆盖不触发/continue/stop_loss/give_up、active from T2/T3、timeout T3/T2/T1、active-timeout race、resume 和 Quick rejection；浏览器 smoke 覆盖 Formal modal/final/post-task 与 Quick 报告。

- [ ] **Step 2: 本地迁移和全量验证**

  Run sequentially:
  `npm run db:migrations:list:local`
  `npm run db:migrate:local`
  `npm run test:worker`
  `npm test -- --run`
  `npm run typecheck`
  `npm run build`
  `npm run check`
  `git diff --check`

- [ ] **Step 3: 真实 Worker/浏览器验收与清理**

  启动 `npm run dev:worker`，运行两个 Stage 6 smoke；逐表核对 sequence、points_after_choice、not_triggered、timeout_unanswered、final sealing 和恢复。删除所有 `Stage6 Synthetic %` participant 并确认本地业务表重新为 0。

- [ ] **Step 4: 远程空库迁移**

  先只读确认远程业务表为 0，再运行：
  `npm run db:migrations:list:remote`
  `npm run db:migrate:remote`
  `npm run db:migrations:list:remote`
  复核 schema 6、`sunk-1.0.0`、配置绑定和业务表仍为 0；绝不运行 `wrangler deploy`。

- [ ] **Step 5: 最终验证和唯一提交**

  再次运行完整 `npm run check`、`git diff --check` 和安全字段搜索。只创建一个提交：
  `git commit -m "feat: add sunk cost and final decision flow"`
  确认 `git status --short` 为空，不 push、不 merge、不创建 PR，并立即停止等待 Stage 7 指示。

## Server State and Sequence Contract

- `T2_COMPLETE` 或 `T3_COMPLETE` 可主动进入 final；`give_up` 将 run 置为 `DECISION` 并开放 final。
- Sunk show、choice、final_submit 分别占一个严格递增 sequence；timeout 时 `timer_expired` 必须先于 `final_submit`。
- `not_triggered` 是数据完整性占位，不生成 show event、不占 sequence。
- Active final：session `current_step=post_task`、`completion_status=in_progress`、`final_submit_mode=active`。
- Timeout final：session `current_step=post_task`、`completion_status=timeout`、`final_submit_mode=timeout`。
- 两者均写 `game_runs.finalized_at`，均保持 `sessions.ended_at IS NULL`。

## Rollback

- 代码：仅在本功能分支回退 Stage 6 单提交，不触碰 `main`。
- 本地 D1：可删除明确识别的本地 Wrangler 测试状态后重放 0001—0005；不得修改旧迁移。
- 远程 D1：迁移采用向前修复。若 0006 已发布，保留 additive schema，并用新的补偿迁移修正，不能删除迁移记录或重建数据库。
- 因本阶段不部署，线上 Worker 继续运行既有版本；远程 schema 6 仅为后续部署准备。

## Stage 7 Boundary

Stage 7 才实现测后状态问卷、任务体验/操纵检验、正式完成感谢页和 `sessions.ended_at`。RES、EAC、EACS、DDS、GDS、SLS、RDI、管理员、配置管理、CSV ZIP、永久删除、断网批量补传均不在本计划内。
