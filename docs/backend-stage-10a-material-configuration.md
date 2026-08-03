# Stage 10A：版本化材料与实验配置管理

## 范围与拆分原因

Stage 10A 只解决“参与者看到什么、查证成本是什么、沉没成本何时触发，以及新会话使用哪套组合配置”的版本治理。它把候选人公开资料、证据、点数规则、沉没成本规则和配置集合纳入草稿、校验、发布、激活、审计和幂等控制，同时让 Formal 页面从会话固定的服务器版本读取公开资料。

专家评分、正式 benchmark、norm、reliability、scoring definition 发布和历史评分重算属于 Stage 10B。两阶段拆分可以避免在预实验参数尚未确定时把隐藏答案维护能力和参与者公开材料发布能力耦合，也防止管理员页面意外暴露参与者数据或未定常模。

## 0012 数据模型

`migrations/0012_admin_material_configuration.sql` 将 `app_metadata.schema_version` 更新为 `10`，且不修改 0001—0011。

- `material_sets`：材料版本头、来源版本、状态、revision、校验状态、SHA-256 指纹和管理员时间元数据。
- `candidate_material_profiles`：每个材料版本下 A—E 五名候选人的公开资料；不存在能力真值、毒性、风险旗标、基准分或专家判断列。
- `candidate_evidence_items`：沿用现有证据表并增加 `updated_at`；草稿证据可维护，发布材料下证据被数据库触发器封存。
- `point_rules`：增加显示名、来源版本、revision、校验、指纹和发布元数据；现有 `points-5-v1` 回填为 published/valid。
- `sunk_cost_rules`：增加同类治理元数据；现有 `sunk-1.0.0` 回填为 published/valid。
- `configuration_sets`：增加显示名、来源、revision、校验报告、组合指纹、管理员和激活元数据；`config-2026-07-v1` 继续是唯一 active 配置。
- `configuration_validation_runs`：不可修改、不可删除的主动校验历史。
- `configuration_activation_history`：不可修改、不可删除的激活及回滚历史。
- `admin_operation_receipts`：以 UUID `Idempotency-Key` 为主键的写操作回执，保存规范化请求哈希和第一次安全响应。

迁移把 `src/data/candidates.ts` 当前公开字段精确写入 `material-1.0.0`：5 条 profile、20 条 evidence，每人两条 shallow 和两条 deep。Quick 仍使用原 TypeScript 数据；Formal 不再把该文件作为公开资料权威来源。

## 生命周期语义

组件和配置集合遵循以下语义：

1. `draft`：可编辑；每次成功保存 revision 加一，当前校验变为 `stale`。
2. `valid`：当前 revision 和当前内容指纹已有一条无 error 的校验记录；它仍是草稿，不代表已发布。
3. `published`：内容永久封存。修改必须从已发布版本克隆新的 version ID。
4. `active`：仅适用于 published configuration set；决定之后创建的新 Formal session 绑定哪些版本。

发布不会自动激活。激活使用独立确认请求，原子地清除旧 active 并设置新 active，同时写 activation history 和 admin audit。重新激活旧 published config 是回滚激活；不会删除新配置，也不会改写任何已有 session。

## 草稿、修订冲突与内容指纹

材料、点数、沉没成本和配置集合都只支持从已发布版本 clone，不提供易漏字段的空白创建器。草稿更新必须携带 `expectedRevision`；服务端通过当前 revision 和 D1 的串行写入边界拒绝过期编辑，返回 `409 CONFIG_REVISION_CONFLICT`。写接口还要求同源 Origin、JSON、管理员 Cookie、CSRF 和 UUID Idempotency-Key。

`worker/domain/configurationFingerprint.ts` 对规范化 JSON 执行 SHA-256。对象键稳定排序；profile 按候选人 ID 排序；evidence 按候选人、层级和顺序排序。指纹排除 revision、时间、管理员和 request ID。配置集合指纹同时包含组件 version 与组件 fingerprint，因此组件内容变化会让旧组合校验失效。

同一 Idempotency-Key 和相同请求返回首次回执，不重复增加 revision、发布或激活历史；同 key 不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。回执不保存密码、Cookie、token、CSRF 或参与者身份。

## 校验规则

材料校验要求：A—E 恰好五条 profile；display order 为不重复的 1—5；每人两条 shallow、两条 deep，顺序恰好 1、2；证据 ID 唯一；polarity 合法；至少一条关键风险；所有公开文本、数组和经历非空；禁止隐藏答案字段与脚本型内容。

点数规则要求总点数 1—100、浅查和深查成本均为正整数、成本不超过总点数，且总点数至少支持各执行一次浅查和深查。沉没成本规则要求触发秒数为 1—899、最低投入非负且关键风险开关为布尔值。

配置集合校验要求所有引用组件存在且 published，Stage 10A 的 `normVersion` 必须为 null，并执行材料、点数和沉没成本的交叉约束。预实验 benchmark 和尚无 norm 产生 warning，不阻止发布；error 会阻止发布。

每次主动校验都写 `configuration_validation_runs`。草稿修改后旧校验不再可用于发布。发布时重新核对当前 revision、最新校验指纹和当前组件组合指纹。

## API 与审计

管理员 API 位于 `/api/admin/config/*`：

- `material-sets`、`point-rules`、`sunk-cost-rules`：list、clone、detail、update、validate、publish。
- `configuration-sets`：list、clone、detail、update、validate、publish、activate。

所有写操作记录成功审计事件；发布、激活与回滚激活使用独立 action。数据库触发器进一步阻止 published 内容、校验历史、激活历史、操作回执和审计行被 update/delete。

参与者接口 `GET /api/sessions/:sessionId/materials` 先验证 Formal session Cookie，然后只按该 session 固定的 `material_version` 读取公开 profile，并按 `candidate_display_order` 返回。响应不含 evidence、polarity、`isKeyRisk` 或任何隐藏答案字段；证据仍只能通过原 unlock API 获得。

## 前端行为与存储隔离

Formal 在 `game_ready`/`playing` 页面加载时请求 session materials，并仅放入 React 内存。请求失败显示明确错误和重试，不回退 `candidates.ts`，也不把正文写入 localStorage/sessionStorage。候选人顺序继续以 session 为准。

Quick 保留本地候选人、证据、点数和报告逻辑，不调用 Formal materials API，也不调用管理员配置 API。

`/admin` 的实验配置页面包括当前生效配置、候选人材料、点数规则、沉没成本规则和配置集合。published 版本只读；draft 显示 revision、独立保存/校验/发布操作；激活前展示当前与目标组件差异，并要求再次输入目标 configSetId。页面状态只保存在组件内存，刷新后重新读取服务器。

## 本地验证

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

真实页面/API 验证可通过 `npm run dev:worker` 启动同源 Worker，再使用本地合成管理员执行 clone、更新、校验、发布、激活和回滚。完成后必须恢复 `config-2026-07-v1` 为 active，并清除所有合成管理员、session、参与者、草稿/测试发布版本和测试审计数据，只保留初始 published 配置及 Stage 10A 表结构。

## 远程迁移与只读确认

仅在本地迁移、全量测试、类型检查、构建、check、公开文案核对和远程空数据前置检查全部通过后执行：

```powershell
npm run db:migrations:list:remote
npm run db:migrate:remote
npm run db:migrations:list:remote
```

远程迁移只允许写入 0012 的正式表结构和初始发布配置，不得创建管理员、参与者、session、测试草稿或测试审计。迁移后只读确认 schema version、5/20 数量、唯一 active 配置及业务表计数。本阶段不运行 `wrangler deploy`。

## 回滚配置

数据库迁移本身使用前向迁移，不回滚删除 0012。业务配置回滚通过管理员配置页重新激活旧的 published config：输入旧 configSetId 确认后，系统原子切换 active 标记并记录 rollback activation audit。已开始 session 继续使用其原版本，新 session 才使用回滚后的 active 配置。

## Stage 10B 尚未实现

- 专家评分录入与正式 benchmark 发布；
- norm 均值/标准差参数与版本发布；
- reliability 参数；
- scoring definition 编辑和发布；
- 历史 scoring run 批量重算。

Stage 10A 完成后应停止，以上能力必须在单独确认的 Stage 10B 中实施。
