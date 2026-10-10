# 战役中心化改造

按 2026-10-10 用户提供的计划书实施；用户明确允许重建，不要求旧房间兼容。

## 交互

- 首页「我的桌团」列出主持和参加的战役，支持搜索、归档、恢复与软删除。
- 「新战役」默认使用模组名称，只有多个模组时才显示选择器；创建后主持人直达棋盘。
- 邀请仅授予当前战役的玩家或旁观者身份。玩家首次进入选择或创建角色，后续自动恢复该战役的角色。
- 主持人可从已有战役复制名册，新局的场景、角色、聊天和日志独立。
- 战役名册可移除成员，同时撤销已连接的 WebSocket 和后续访问。
- 页面沿用暖白、炭黑、朱红强调色和简洁网格。角色卡、PDF、计算器和骰子工具保持独立入口。

## 数据和运行时

用户只拥有一个个人库，模组可供多场战役复用。`campaign_members` 是唯一准入关系；邀请兑换不会增加库成员。邀请使用一次性令牌、幂等兑换及事务内次数控制。

每个 `campaign:<id>` 对应独立实时实例。D1 负责会话、名册、模板和低频业务数据；DO 使用 `campaign_runtime`、`campaign_data`、`scene_data`、`chat_messages` 分行存储，移动操作只修改单场景，聊天追加写入。命令收据保留幂等性。

成员移除和归档提升 `permission_epoch`，立即同步实时实例并断开旧连接；WebSocket 操作检查实例内持久化权限状态。无需对每次移动查询 D1。

页面使用 `/c/:slug`，接口使用 `/api/campaigns/:slug`；素材使用 `v2/campaigns/<id>/assets/...`。DO 类名及 binding `ROOMS` 保留为 Cloudflare 资源标识，不代表房间实体。旧 `server/` 实现未改动。

## 重建部署

- 新数据库：`dnd-dm-tool-campaigns`，配置在 `wrangler.jsonc`。
- 新 schema：`worker/campaign-migrations/0001_campaign_core.sql`。
- 旧数据库和对象保留为历史备份，不迁移、不在新版显示；旧链接不重定向。
- 浏览器中的独立角色卡、计算器与骰子工具数据不受 D1 重建影响。
- `npm run db:migrate:local` / `npm run db:migrate:remote` 只操作新库。
- 验证：`npm test`、`npm run build`，再执行带目标域名的 Wrangler 部署。

当前仍使用浏览器 Cookie 访客身份；跨设备账号和完整模组编辑器不在本次范围。
