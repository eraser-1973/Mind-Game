# 正式实验会话完整性设计

## 目标

正式测评以匿名、可恢复、可审计的会话运行；快速模式仍为本地训练体验，两者的数据、反馈策略与存储完全隔离。所有实验事件先本地持久化，再以幂等 `eventId` 上传 Cloudflare Worker / D1。

## 边界

- 保留候选人、评分、证据、问卷与报告的现有内容。
- 正式模式不显示带方向性的证据颜色、Niko 情绪或“正确/错误”评价。
- 不采集直接身份信息；后端只保存随机 participantId、sessionId 和实验数据。
- 技术错误、断网和后台标签页不会被解释为能力或韧性表现。

## 数据契约

`FormalPersistedSession` 与 `QuickPersistedSession` 是判别联合，分别以 `mode: 'formal'` / `mode: 'quick'` 区分。正式会话包含 `schemaVersion`、`appVersion`、状态、阶段快照、评分/查证/沉没成本/最终决策/客户端错误事件和上传队列；快速会话不包含研究上传字段。

关键行为以 UUID `eventId` 记录。证据事件记录点数变化及 A/C 风险证据之后的追加情况；评分事件只引用已实际解锁的 evidenceId；阶段快照记录 T1、T2、T3、FINAL 的首选候选人和 0–100 信心。

## 持久化与 API

浏览器以独立 localStorage key 保存：正式会话快照与待上传队列分开，快速会话使用独立 key。Worker 提供会话创建、事件批量写入、快照/心跳更新、完成、错误上报和恢复接口。D1 的 `event_id` 唯一约束保证重放不重复写入；点数只由成功事件计算。

刷新从本地恢复会话；联网时自动冲洗队列；`pagehide` / `visibilitychange` 发送轻量心跳。服务器以心跳超时将未完成会话识别为 abandoned。

## 验证策略

每阶段遵循 red → green：先增加会失败的单元或组件测试，实施最小代码，再运行 `npm test -- --run`、`npm run typecheck` 和 `npm run build`。最后增加 API 幂等、恢复、断网、超时与完整正式流程 E2E 覆盖。
