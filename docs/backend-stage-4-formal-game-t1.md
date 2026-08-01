# 阶段 4：正式游戏启动与 T1 决策持久化

## 范围与停点

本阶段只实现正式模式从 `game_ready` 到 `playing`、五名候选人的 T1 评分、T1 首选与信心，以及这些数据的恢复。T1 阶段选择成功后，服务端将 `game_runs.current_stage` 固定为 `T1_COMPLETE`，前端显示“第一阶段数据已保存，后续阶段将在下一开发阶段开放。”并停止继续推进。

本阶段不实现查证、点数扣除、T2/T3、沉没成本、最终录用、超时自动选择、测后问卷、正式报告或 RDI。数据库结构为后续阶段保留枚举值，不代表对应 API 已开放；当前 API 会明确拒绝 T2/T3/final 写入。

## D1 迁移与数据表

`migrations/0004_formal_game_t1.sql` 将 `app_metadata.schema_version` 更新为 `4`，新增：

- `game_runs`：每个正式 session 唯一的 900 秒游戏运行记录，保存服务器开始/截止时间、当前阶段、5 点只读初始余额与服务端最后序号。
- `stage_ratings`：候选人分阶段评分。T1 强制 `evidence_ids_seen=[]`，`(session_id, candidate_id, stage)` 唯一，并由触发器禁止更新。
- `stage_choices`：阶段首选与信心，`(session_id, stage)` 唯一，并由触发器禁止更新。
- `game_events`：按 session 保存不可重复的 `event_id` 和唯一、单调递增的 `server_sequence`。

所有新业务表都以 `session_id` 外键关联 `sessions` 并使用 `ON DELETE CASCADE`。评分、信心、候选人 ID、点数、阶段和 JSON 结构均有数据库约束。

## 正式游戏启动

接口：`POST /api/sessions/{sessionId}/start`

请求要求有效的 HttpOnly `mg_session` Cookie、`Content-Type: application/json` 和 UUID `Idempotency-Key`：

```json
{
  "sessionId": "UUID",
  "clientStartedAt": "ISO-8601"
}
```

服务端只允许资料完整且 `current_step=game_ready` 的正式会话启动。首次请求原子写入 `game_runs`、`game_start` 事件，并把 session 推进到 `playing`；同一个幂等键重放返回原记录，不重置计时、不新增事件。不同幂等键再次启动返回冲突。

响应只包含公开会话投影、候选人显示顺序、初始打开候选人、服务端时钟、当前阶段和固定点数，不包含身份、恢复凭证、候选人后台答案或基准分。

## 服务端权威计时

正式模式时长固定为 900 秒。`started_at`、`deadline_at` 和 `serverNow` 由 Worker 生成；浏览器只根据响应中的 `remainingSec` 与 `deadlineAt` 校准显示，不提交或决定权威截止时间。刷新会恢复同一截止时间，不能重启 15 分钟。

服务端在每次写入前检查截止时间。截止后拒绝新的 T1 评分或阶段选择，并幂等记录一次 `timer_expired` 事件和 `time_expired_at`；不会自动选择候选人，也不会把会话伪装成已完成。

## T1 评分封存

接口：`POST /api/ratings`

```json
{
  "sessionId": "UUID",
  "candidateId": "A",
  "stage": "T1",
  "ratingValue": 0,
  "clientSubmittedAt": "ISO-8601"
}
```

评分必须是 0—100 整数。T1 的已看证据列表由服务端固定为空，不接受客户端提供证据 ID。每名候选人的 T1 评分只能成功写入一次：同一 `eventId` 重放幂等成功，不同 `eventId` 试图覆盖已封存评分返回冲突。第五名评分成功后响应 `allT1Rated=true`。

## T1 首选与信心

接口：`POST /api/stage-choices`

```json
{
  "sessionId": "UUID",
  "stage": "T1",
  "candidateId": "B",
  "confidence": 80,
  "clientSubmittedAt": "ISO-8601"
}
```

只有五名 T1 评分全部封存后才能提交。首选必须为 A—E，信心必须为用户主动输入的 0—100 整数。成功后选择被封存、写入事件并推进到 `T1_COMPLETE`。同一幂等键可安全重放，不同键不得覆盖。

## 服务端序号与幂等性

启动、每次评分、阶段选择和计时到期都写入独立 UUID `event_id`。服务端为每个 session 分配唯一、单调递增的 `server_sequence`，数据库唯一约束与重试处理共同防止并发请求产生重复序号。响应中的 `sequenceNo` 来自服务端，不信任客户端顺序。

浏览器仅在 `sessionStorage` 保存待提交操作的 UUID：

- `mind-game.pending.game-start.v1`
- `mind-game.pending.rating.T1.{A|B|C|D|E}.v1`
- `mind-game.pending.stage-choice.T1.v1`

失败重试复用同一 UUID，成功后清除。浏览器存储不保存评分、信心、点数、截止时间、身份或问卷答案。

## 正式会话恢复

接口：`GET /api/sessions/{sessionId}/resume`

当 session 为 `playing` 时，响应的 `game` 投影包括：固定 900 秒时长、原始开始/截止时间、服务器当前时间、剩余秒数、是否过期、当前阶段、5/5 点、按服务端序号排列的已封存评分、T1 阶段选择以及最后序号。

- 部分 T1：恢复已封存评分，未评分候选人仍可继续；不会重置计时。
- 五名评分完成但未选首选：恢复到 T1 阶段选择面板。
- T1 选择完成：恢复到 `T1_COMPLETE` 停点，不再次提交或进入 T2。
- 过期：显示正式计时结束提示，不自动选人。
- `playing` session 缺少 `game_runs`：返回 `SESSION_DATA_INTEGRITY_ERROR`，不伪造空白游戏。

## 正式模式与快速模式隔离

`GameScreen` 只有在同时收到 `mode=formal`、正式 session ID 和服务器游戏快照时才进入正式 T1 控制器。快速模式继续使用原 reducer、原 3 分钟/15 分钟本地体验、查证、Niko、报告和导出逻辑；它不会调用正式启动、评分或阶段选择 API，也不会创建上述 pending key。

正式 T1 不渲染 `VerifyPanel`、不允许客户端 `VERIFY`、不显示 Niko 方向性反馈，点数只显示服务器返回的 5 点且本阶段不可消费。候选人内容仍来自当前公开前端数据；后台答案字段不会进入正式 API 响应或游戏事件 payload。

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

远程（必须先只读确认所有正式业务表为空，并且本地验证全部通过）：

```bash
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

远程只应用结构、索引和 `schema_version=4`，不得运行合成流程或写测试数据。本阶段不执行 `wrangler deploy`。

## 本地合成数据清理

真实 Worker 冒烟只允许使用明确的本地合成身份。验证后按 participant 根记录删除，依赖外键级联清理 identity、session、credential、研究前置数据、game run、评分、选择和事件；随后逐表查询确认测试数据计数为 0。不要把合成身份或 Cookie 写入文档、Git 或远程 D1。

## 回滚与第 5 阶段

应用代码可回退本阶段提交，但已应用的 D1 迁移不应通过删除 `d1_migrations` 记录回滚。若必须撤除，应先确认四张新表为空，经批准后创建新的向前迁移。

第 5 阶段才实现服务器查证、点数账本、证据解锁、证据查看定义、T2/T3 评分关联与并发扣点。本阶段明确停止在 T1_COMPLETE，不提前实现这些能力。

## 2026-08-01 验证记录

- 本地与远程 `mind-game-production` 均已应用 `0004_formal_game_t1.sql`，迁移列表无待应用项，`schema_version=4`。
- 远程迁移前 participants、identity、sessions、credentials、consent、demographics、questionnaire submissions/answers 均为 0；迁移后四张游戏表及 sessions 仍为 0，未写入远程测试记录。
- 真实本地 Worker 冒烟生成的截止时间与开始时间相差 900 秒；五名评分、T1 首选与信心形成连续服务端序号 1—7，刷新后恢复到 `T1_COMPLETE`。
- 快速模式冒烟期间未发出 `/api/*` 请求；正式浏览器存储仅包含安全 session 指针，T1 操作成功后没有残留 pending key。
- 冒烟完成后已删除本地合成 participant，并确认 sessions、全部前置研究表和四张游戏表均为 0。
- `npm run check` 通过：前端 24 个测试文件/116 项、Worker 10 个测试文件/105 项、TypeScript 与 Vite 6.4.3 构建全部通过。
- 本阶段未执行 `wrangler deploy`，远端 Worker 代码仍保持原部署版本。
