# 阶段 3：研究前置数据保存与会话恢复

## 范围与状态

阶段 3 在 `feature/cloudflare-d1-backend` 分支实现正式模式的知情同意、匿名人口学信息、测前状态问卷和游戏开始前的刷新恢复。正式流程现在由服务器按以下顺序控制：

`consent_pending → demographics → pre_task → game_ready`

身份登记成功后创建正式会话，但不会立即启动游戏计时。`sessions.started_at` 与 `sessions.deadline_at` 在本阶段始终保持 `NULL`。`game_ready → playing`、游戏内进度恢复、评分、证据、点数、沉没成本和最终提交均留待阶段 4 及后续阶段。

## 数据库迁移

`migrations/0003_research_intake_resume.sql` 将 `app_metadata.schema_version` 更新为 `3`，并新增四张表：

- `consent_records`：每个 session 一条有效同意记录；`event_id` 和 `session_id` 唯一，`accepted` 只能为 `1`。
- `demographic_revisions`：人口学信息的不可覆盖修订历史；`revision_no` 从 1 开始，同一 session 只有一条 `is_current=1`。
- `questionnaire_submissions`：保存问卷提交头；本阶段只写 `phase=pre`，每个 session 只能正式提交一次测前问卷。
- `questionnaire_answers`：保存五个题目的值、`touched` 和作答时间；值只能是 0–10 的整数。

四张表都通过外键关联正式 session，并使用 `ON DELETE CASCADE`。迁移还为 session、当前人口学修订、问卷 phase 和答案 submission 建立索引。迁移不包含身份、问卷答案样本、候选人后台答案或任何测试会话。

## 知情同意

当前同意版本为 `consent-1.0.0`。正式模式先展示同意书，用户主动勾选后进入身份登记。身份提交创建 session 后，前端立即调用 `POST /api/consent`；只有 session 创建与同意记录都成功，才进入人口学页面。

如果 session 已创建但同意保存因网络错误失败，浏览器保留安全 session 上下文和同一幂等键。重试只补交同意，不会再次上传身份或创建第二个 participant/session。同一 event 重放或同一 session 的相同版本再次提交都返回现有记录，不新增 consent。

正式研究上线前，知情同意文案仍需研究负责人或伦理审查最终确认，包括身份信息用途、保留期限、数据导出、退出和删除说明。

## 人口学修订

首次 `POST /api/demographics` 创建 `revision_no=1`，将 session 从 `demographics` 推进到 `pre_task`。用户在提交测前问卷前返回修改时：

1. 原当前记录改为 `is_current=0`；
2. 新增 `revision_no + 1` 的记录；
3. 新记录设为 `is_current=1`；
4. session 保持 `pre_task`。

以上操作使用 D1 `batch` 原子执行，不直接覆盖历史。到达 `game_ready` 后拒绝继续修改。枚举值、相关经历非空/去重、“无相关经历”互斥和未知字段均由服务端验证；姓名、学号、手机号不允许进入人口学请求。

## 测前问卷与 touched

测前工具版本为 `state-assessment-pre-1.0.0`，必须且只能包含：

- `stress`
- `fatigue`
- `attention`
- `mood`
- `physicalDiscomfort`

页面内部初始值为 `null`，并为每题单独维护 `touched`。界面可显示 0，但只有真实指针或键盘操作后才将该题标记为已回答；主动选择 0 是有效答案。五题未全部 touched 时不能提交，页面提示并聚焦第一道未回答题。服务端再次验证五个唯一 item、0–10 整数以及 `touched=true`，成功后原子写入一条 submission、五条 answer，并把 session 推进到 `game_ready`。第二个不同幂等键不能覆盖已提交的测前问卷。

## Cookie 会话鉴权

所有阶段 3 API 共用 `worker/auth/sessionAuth.ts`：

1. 从请求 Cookie 读取 `mg_session`；
2. 对原始令牌计算 SHA-256；
3. 查询 `session_credentials` 并使用固定时间比较哈希；
4. 校验 credential 未撤销、session 存在、`mode=formal`、状态为 `in_progress`；
5. 路径或请求体 session ID 必须与凭证 session 一致。

Cookie 原文和 token hash 不进入响应、浏览器可读存储或业务日志。缺失/错误凭证统一返回 `401 SESSION_UNAUTHORIZED`，撤销凭证返回 `401 SESSION_REVOKED`，非活动会话返回 `409 SESSION_NOT_ACTIVE`。未认证请求不会通过差异化错误暴露某个 session 是否存在。

## current_step 状态控制与完整性

`worker/domain/sessionSteps.ts` 定义本阶段允许的服务器转换。客户端传入的步骤不具权威性，API 始终读取 D1 的 `sessions.current_step`。非法顺序返回 `409 INVALID_SESSION_STEP`，相同幂等事件重放不因步骤已经推进而失败。

恢复前还会检查：

- 前置记录数量与当前步骤一致；
- `game_ready` 必须有 consent、当前 demographics、一份 pre submission 和五个 touched answer；
- `started_at`、`deadline_at` 仍为 `NULL`。

不一致时返回 `409 SESSION_DATA_INTEGRITY_ERROR`，不会用空白或伪造数据继续实验。

## 会话恢复

应用启动时只读取 `localStorage` 的安全指针 `mind-game.formal-session.v1`。无有效指针时不调用恢复 API；有指针时调用：

`GET /api/sessions/{sessionId}/resume`

服务器步骤决定恢复目标：

- `consent_pending`：回到知情同意页，重新确认后只提交 consent。
- `demographics`：回到人口学页面。
- `pre_task`：回到测前状态页，并可使用服务器返回的最新人口学 revision。
- `game_ready`：使用服务器候选人顺序进入正式游戏初始化。
- `playing`：返回 `409 GAME_RESUME_NOT_READY`，显示明确的暂不支持提示；不重置点数、不生成新游戏、不覆盖原 session。

401 或撤销/非活动状态会清理失效的本地指针；普通网络错误会保留指针并提供重试。损坏的本地 JSON 会被安全清除，不造成白屏。

恢复响应仅包含 participant/session ID、正式模式、配置版本、候选人顺序、当前步骤、同意状态、匿名人口学修订、测前答案和未启动的游戏时间字段。它不返回姓名、学号、手机号、身份重复标记、Cookie、token hash 或候选人后台答案。响应使用 `Cache-Control: no-store`。

## 浏览器存储安全边界

`localStorage` 仅保存 `mind-game.formal-session.v1` 的安全 session 上下文：匿名 ID、配置版本、候选人顺序、初始候选人、current step 和创建时间。

`sessionStorage` 只保存以下待处理操作的 UUID 幂等键：

- `mind-game.pending.session-create.v1`
- `mind-game.pending.consent.v1`
- `mind-game.pending.demographics.v1`
- `mind-game.pending.pre-task.v1`

请求成功后删除相应 pending key。姓名、学号、手机号、人口学答案、问卷答案、Cookie、token 和 token hash 均不写入 localStorage 或 sessionStorage。快速模式不创建上述正式 session 或研究操作 key。

## API

所有写接口要求 `Content-Type: application/json`、UUID `Idempotency-Key`、`credentials: include`，请求体上限 16 KiB。错误响应统一包含安全 `code`、`message` 和 `requestId`，不返回 SQL、堆栈、数据库 ID、本地路径、Cookie 或身份内容。

### `POST /api/consent`

请求：

```json
{
  "sessionId": "UUID",
  "accepted": true,
  "consentVersion": "consent-1.0.0",
  "clientAcceptedAt": "ISO-8601"
}
```

首次成功返回 201；安全重放返回 200 和 `created=false`。响应包含 session ID、`currentStep=demographics` 及同意版本/时间，不包含身份数据。

### `POST /api/demographics`

请求包含 `sessionId`、`clientSubmittedAt` 和现有 `DemographicData` 的 `demographics` 对象。首次或新修订成功返回 201，幂等重放返回 200；响应包含 revision、最新匿名人口学答案与 `currentStep=pre_task`。

### `POST /api/questionnaires`

请求包含 `phase=pre`、工具版本、开始/提交时间以及五个带 `touched=true` 的答案。首次成功返回 201，幂等重放返回 200；响应包含 submission ID、题数和 `currentStep=game_ready`。

### `GET /api/sessions/{sessionId}/resume`

要求有效 `mg_session` Cookie，不使用 Idempotency-Key。成功返回上述安全恢复投影并设置 `Cache-Control: no-store`；GET 不修改数据库。

## 前端 API 和重试

`src/api/formalResearch.ts` 集中封装 `saveFormalConsent`、`saveFormalDemographics`、`saveFormalPreTaskQuestionnaire` 和 `resumeFormalSession`。组件不散落 fetch 细节，不读取 HttpOnly Cookie，也不把请求体打印到 console。客户端统一区分 HTTP 校验错误、认证错误、冲突、请求过大、媒体类型错误、服务错误和网络错误。

每个写操作首次开始时生成独立 UUID；失败重试复用原 UUID，成功后清除。pending key 不附带请求内容，因此不会把身份、人口学或问卷答案持久化到浏览器。

## 迁移与验证命令

本地：

```bash
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:migrations:list:local
npm run test:worker
npm test -- --run
npm run typecheck
npm run build
npm run check
git diff --check
```

远程（必须先只读确认正式业务表为空）：

```bash
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

2026-08-01 验证结果：本地和远程 `mind-game-production` 都已应用 `0003_research_intake_resume.sql`，远程 `schema_version=3`，四张新表存在。迁移后远程 participants、identity、sessions、credentials、consent、demographics、questionnaire submissions 和 answers 计数均为 0；未写入远程测试数据，也未执行部署。

## 本地合成数据清理

本地真实 Worker 冒烟仅使用明确测试标记的合成身份。验证完成后按 participant 外键根记录删除，依靠级联清理 identity、session、credential 及阶段 3 研究记录，并再次查询确认测试标记剩余 0 条。不要在远程执行合成流程或复制本地测试身份。

## 阶段 4 前仍未实现

- `game_ready → playing` 的服务器启动接口和 15 分钟权威计时。
- 进行中游戏的评分、阶段首选/信心、证据查看、点数账本和恢复。
- 游戏事件离线补传、沉没成本、最终录用和测后问卷。
- RDI/子指标、管理员登录、配置管理、CSV ZIP、审计和删除。

因此，本阶段只保证“正式会话创建后到游戏初始化前”的可靠恢复。不得据此声称正在进行的游戏可以完整恢复。

## 回滚

应用代码可回退本阶段提交，但已应用的 D1 结构不应通过删除 `d1_migrations` 记录回滚。若必须移除，应先确认四张阶段 3 表为空，并由负责人批准新的向前迁移，按外键依赖顺序删除表、索引并更新 schema version。
