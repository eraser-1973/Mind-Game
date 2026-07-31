# 阶段 2：参与者身份与正式会话

## 范围与状态

本阶段在 `feature/cloudflare-d1-backend` 分支建立正式测评的身份登记和会话创建基础。它不保存人口学信息、问卷、评分、查证、点数、沉没成本或最终决策；这些能力留给后续阶段。

2026-07-31 已在本地和远程 `mind-game-production` D1 应用 `0002_participants_sessions.sql`。远程验证结果为 `schema_version=2`、唯一 active 配置 1 条，且 `participants`、`participant_identity`、`sessions`、`session_credentials` 均为 0，因此迁移没有写入测试身份或测试会话。

## 数据库表及关系

- `configuration_sets`：保存可供新会话绑定的已发布版本集合。部分唯一索引保证最多一个 `is_active=1` 的集合，且只有 `published` 状态可以 active。
- `participants`：每次正式参与创建一个新的匿名 `participant_id`。重复身份不会复用旧参与者。
- `participant_identity`：只保存姓名、学号、手机号及规范化学号/手机号，通过 `participant_id` 与参与者关联；不保存研究过程数据。
- `sessions`：只接受 `mode=formal`，保存幂等创建键、版本快照、候选人显示顺序、流程状态和重复参与标记；身份原文不进入此表。
- `session_credentials`：只保存会话令牌的 SHA-256 哈希，不保存原始令牌；删除 participant 时由外键级联删除 identity、session 和 credential。

身份信息和研究数据的隔离边界为：身份字段只进入 `participant_identity`；会话及后续研究行为只使用 `participant_id` 和 `session_id`。当前阶段没有把身份字段加入 `ResearchData`、游戏日志或 JSON 导出。

## 初始配置版本

迁移发布并激活一条配置：

| 字段 | 值 |
| --- | --- |
| `config_set_id` | `config-2026-07-v1` |
| `task_version` | `task-1.0.0` |
| `material_version` | `material-1.0.0` |
| `point_rule_version` | `points-5-v1` |
| `scoring_version` | `RDI-2.0-prepilot` |
| `benchmark_version` | `benchmark-1.0.0` |
| `norm_version` | `NULL` |
| `status` / `is_active` | `published` / `1` |

新会话会复制全部版本字段。以后切换 active 配置不会改变已创建会话的版本归属。本阶段没有把候选人标准答案迁入配置表。

## 正式会话创建流程

正式模式页面顺序现在是：

`开始页 → 知情同意 → 身份信息登记 → 匿名基本信息 → 测前状态 → 游戏`

身份表单要求姓名、学号、手机号至少填写一项。提交期间按钮禁用；失败时留在当前页面并允许使用同一幂等键重试。成功后才进入匿名基本信息页面。

`POST /api/sessions` 执行以下流程：

1. 校验方法、JSON Content-Type、16 KiB 上限、UUID `Idempotency-Key`、`mode=formal` 和身份字段。
2. 读取唯一 active、published 的 `configuration_sets`；不存在时返回 `CONFIG_NOT_READY`。
3. 规范化学号和手机号，只用二者计算重复参与标记；姓名相同不作为重复依据。
4. 服务端生成新的 participant UUID、session UUID、32 字节随机令牌和 Fisher–Yates 候选人顺序。
5. `initial_opened_candidate` 固定为该顺序第一项；`started_at`、`deadline_at` 保持 `NULL`，身份登记不启动 15 分钟游戏计时。
6. 使用 D1 `batch` 原子写入 participant、identity、session 和 token hash。
7. 返回安全会话投影，并通过 HttpOnly Cookie 发送原始令牌。

成功响应只包含：`created`、`participantId`、`sessionId`、`mode`、配置版本、候选人顺序、初始候选人、当前步骤和创建时间。它不包含身份、规范化身份、重复标记、原始令牌或令牌哈希。

## 幂等机制

浏览器在首次提交前生成 UUID 并暂存于 `sessionStorage` 的 `mind-game.formal-session.creation-key.v1`。网络失败后复用同一键，成功后删除。

服务端以 `sessions.creation_key UNIQUE` 保证幂等：

- 首次创建返回 HTTP 201 和 `created=true`。
- 同一键重放返回 HTTP 200 和 `created=false`。
- 重放返回原 participant、session、候选人顺序和版本快照，不新增记录。
- 每次重放生成新的原始令牌，替换 `session_credentials.token_hash` 和 `rotated_at`，并重新设置 Cookie。
- 并发唯一键冲突会读取已存在会话，不向客户端暴露 D1 UNIQUE 错误。

## Cookie 与令牌

Cookie 名为 `mg_session`，属性为：

- `HttpOnly`
- `SameSite=Strict`
- `Path=/api`
- `Max-Age=86400`
- HTTPS 请求增加 `Secure`
- 不设置 `Domain`
- 响应使用 `Cache-Control: no-store`

Cookie 值只有 32 字节随机原始令牌。D1 只保存 64 个十六进制字符的 SHA-256 哈希；原始令牌不进入响应 JSON、浏览器存储、日志或数据库明文字段。

## 身份规范化规则

- 姓名：去除首尾空白、合并内部连续空白、最长 100 字符；不限制语言。
- 学号：原值去除首尾空白、最长 64 字符；规范化值移除空白并转为大写。
- 手机号：原值去除首尾空白；规范化值移除空格、短横线和括号，允许一个开头 `+`，最终匹配 `^\+?[0-9]{6,20}$`。
- 空字符串统一写入 `NULL`。
- 三项全空返回 `IDENTITY_REQUIRED`；格式或长度非法返回 `INVALID_IDENTITY`。

错误响应不回显身份内容、SQL、堆栈、数据库 ID 或本地路径。

## 重复参与标记

重复参与不会阻止创建新 participant 和 session：

- 规范化学号已有记录时：`duplicate_student_id=1`。
- 规范化手机号已有记录时：`duplicate_phone=1`。
- `prior_identity_match_count` 保存此前匹配的去重 participant 数量。
- 仅姓名相同不会设置重复标记。

## 候选人顺序

正式模式的顺序由 Worker 使用安全随机数和无偏 Fisher–Yates 洗牌生成，包含 A–E 各一次；前端必须使用该顺序，默认打开第一位。正式会话缺少有效服务端顺序时显示初始化错误，不悄悄退回浏览器随机。

快速模式继续使用原有浏览器随机逻辑，不显示身份登记、不调用 `/api/sessions`、不创建 D1 记录，也不写正式会话存储。

## 浏览器存储边界

正式会话成功后，`localStorage` 的 `mind-game.formal-session.v1` 只保存：

- `sessionId`
- `participantId`
- `configSetId`
- 版本快照
- `candidateDisplayOrder`
- `initialOpenedCandidate`
- `createdAt`

浏览器不保存姓名、学号、手机号、身份对象、Cookie 原始令牌或 `token_hash`。损坏的 JSON 会被安全忽略，不会导致应用崩溃。本阶段只建立安全上下文，尚未实现刷新后恢复游戏进度。

## 迁移与验证命令

安装和全量门禁：

```bash
npm install
npm run test:worker
npm test -- --run
npm run typecheck
npm run build
npm run check
```

本地 D1：

```bash
npm run db:migrations:list:local
npm run db:migrate:local
npm run db:migrations:list:local
```

远程 D1（先确认账户和目标数据库）：

```bash
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

本地完整 Worker：

```bash
npm run dev:worker
```

本地浏览器冒烟覆盖 quick 无 API、formal 身份表单、空表单禁用、成功流转、候选人顺序、HttpOnly Cookie 以及浏览器无身份存储。远程迁移后应只读核对 `schema_version=2`、五张新表、唯一 active 配置和业务表计数；禁止把测试姓名、学号或手机号写入远程库。

## 阶段 3 前仍未实现

- 知情同意、人口学信息、测前/测后问卷的服务端保存。
- 正式会话刷新恢复、状态恢复和恢复 API。
- T1/T2/T3 评分、证据、点数、沉没成本和最终提交 API。
- 后续研究行为的离线补传与服务器校验。
- 管理员登录、配置管理、CSV 导出、删除和 RDI/子指标计算。

当前知情同意文案已与身份登记现实保持一致，但正式研究上线前仍需由研究负责人或伦理审查确认其最终内容、用途表述、保留期限、导出范围和退出方式。

## 回滚说明

本阶段迁移已经应用于远程库。不要通过直接删除迁移记录回滚。若上线前确需回滚，应先确认四类业务表仍为空，再由负责人批准一份新的向前迁移，按外键依赖顺序移除阶段 2 表并恢复 `schema_version`。应用代码可通过回退本分支提交恢复，但数据库结构必须使用审计过的新迁移处理。
