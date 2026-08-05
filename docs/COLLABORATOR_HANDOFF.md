# Mind-Game 协作开发说明

## 正确开发分支

`feature/cloudflare-d1-backend`

## 获取项目

```bash
git clone https://github.com/eraser-1973/Mind-Game.git
cd Mind-Game
git fetch origin
git switch feature/cloudflare-d1-backend
git pull origin feature/cloudflare-d1-backend
```

## 安装与验证

```bash
npm install
npm test -- --run
npm run typecheck
npm run build
```

## 修改规则

1. 从 `feature/cloudflare-d1-backend` 创建自己的修改分支。
2. 不直接修改 `main`。
3. 不修改 `0001`—`0016` 历史迁移。
4. 不提交 `.env`、`.dev.vars`、secret、密码、数据库备份、真实参与者数据或导出 ZIP。
5. 当前项目没有项目登录密码。
6. 当前 `/admin` 为公开管理员模式，不要擅自新增或删除认证功能。
7. 不执行远程 D1 迁移或 Cloudflare 部署，除非项目所有者明确授权。
8. 修改完成后运行相关测试、typecheck 和 build。
9. 将修复分支推送到 GitHub，交由项目所有者检查。

## 当前正式测评流程

T1 评分
→ T1 选人
→ 查证与 T2 评分
→ 点数允许时继续深查与 T3 评分
→ T3 选人
→ 最终录用

T2 阶段不再进行第二次选人。

## 当前主要功能

- Formal 正式测评
- Quick 快速测评
- 正式测评服务端保存与恢复
- 查证点数记录
- 管理后台查询
- ZIP/CSV 导出
- 永久删除与 tombstone
- 正式测评后台评分报告
- `schemaVersion=14`
