# D&D DM 追踪工具

现在这是一个 Cloudflare 全栈多人桌游应用：玩家不再需要同一 Wi‑Fi 或输入局域网 IP；DM 创建房间后，把邀请链接发给朋友即可。

```text
浏览器（同一 HTTPS URL / 同源 WSS）
        │
        ▼
Cloudflare Worker ── D1：身份、桌团、战役、房间、成员、邀请、审计
        │
        ├──────────── R2：私有地图、头像、资料库 JSON
        │
        └──────────── Room Durable Object：一张桌子的权威实时状态、WebSocket、事件
```

详细的权限、组队、房间与部署设计见 [Cloudflare 架构说明](docs/cloudflare-architecture.md)。
代码模块职责、依赖方向与新增功能落点见 [项目结构与模块边界](docs/project-structure.md)。
Actor 认领、文档 Ownership、Journal/地图标记和声明式宏的统一边界见 [面团优先的 FVTT 式文档架构](docs/fvtt-inspired-tabletop-architecture.md)。
D&D 5e 个人角色卡的插件边界、玩家权限、规则包筛选和导入语义见 [D&D 5e 角色卡插件](docs/dnd5e-character-sheet-plugin.md)。

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run cf:types
npm run db:migrate:local
npm run dev
```

访问 `http://localhost:5173` 进行带 HMR 的前端开发；它会把 `/api` 和房间 WebSocket 代理到本地 Wrangler 的 `http://localhost:8787`。也可以直接运行 `npm start` 后访问 `http://localhost:8787`。

第一次打开首页会创建一个 HttpOnly 访客会话。创建房间后地址形如 `/r/friday-table-xxxxxx`；DM 从顶部“邀请玩家”生成可重复使用的邀请码与链接，邀请码位于 URL fragment 中，浏览器不会把它送进服务器日志或 Referer。

## Cloudflare 部署

`wrangler.jsonc` 已声明 Worker Static Assets、D1、两个私有 R2 bucket 和 SQLite Durable Object。Custom Domain 只从部署环境变量读取，不写入仓库。首次部署时 Wrangler 会创建未绑定 ID 的资源；在绑定了自定义域名或对外分享前，按以下顺序完成初始化：

```bash
npm run build
npx wrangler login
export PUBLIC_SITE_DOMAIN=<你的公开域名>
npm run deploy:production           # 创建/协调 Cloudflare 资源与 Custom Domain
npm run db:migrate:remote           # 应用 D1 控制面 schema
npm run deploy:production           # 以完成迁移的数据库正式提供服务
```

迁移完成后，可把一个已经由 `/api/me` 返回的用户 ID 授予平台所有者只读审计权限。不要把具体用户 ID 写入仓库或 migration：

```bash
npx wrangler d1 execute dnd-dm-tool --remote --command \
  "INSERT INTO platform_roles (user_id, role, granted_at) VALUES ('<USER_ID>', 'owner', CAST(unixepoch() AS INTEGER) * 1000) ON CONFLICT(user_id) DO UPDATE SET role = 'owner'"
```

平台所有者会在大厅看到“全站房间（只读）”，可以读取完整地图、场景、战役库和 NPC，但不会获得其他房间的编辑、邀请或删除权限。

`PUBLIC_SITE_DOMAIN` 必须是目标 Cloudflare account 中 zone 的单个 hostname，且不能预先存在冲突的 CNAME。部署会创建 Custom Domain 所需 DNS 和证书；这个 Worker 不公开 `workers.dev` 备用地址。所有用户只访问这个 HTTPS URL；前端会自动连到同源 `wss://<PUBLIC_SITE_DOMAIN>/api/rooms/<slug>/ws`。

本仓库不含自动部署的 GitHub Actions。每次发布请在已登录目标 Cloudflare account 的终端中运行上面的命令；部署域名和备案信息均从环境变量读取，不会写进仓库：

```bash
export PUBLIC_SITE_DOMAIN=<你的公开域名>
export PUBLIC_ICP_FILING=<可选的ICP备案号>
export PUBLIC_PSB_FILING=<可选的公网安备号>
npm run deploy:production
```

两个备案变量由 Worker 在运行时公开给页面页脚；未设置的项目不会显示。它们是公开信息，不能放 API token、OAuth secret 或其他敏感值。

规则书资料是私有 R2 内容，不打包进 Worker：

```bash
npm run data:update
R2_REFERENCE_BUCKET=<你的 REFERENCE_DATA bucket 名称> npm run data:publish
```

自动创建的 R2 bucket 名称可在 Cloudflare Dashboard 或 `wrangler r2 bucket list` 中查看。请确认 5etools-cn 数据的 CC BY-NC-SA 许可与自己的公开/商业使用方式相符。

跑团资料采用统一的、纯数据内容包规范，并保存在私有 `REFERENCE_DATA` R2 中。新增模组只需提供 `manifest.json`、按章节拆分的场景、按“阵营 → 人物”拆分的 NPC 文件和带内容摘要的地图资源，无需修改应用代码。完整字段、目录和版本规则见 [跑团内容包规范 v1](docs/campaign-content-package-spec.md)。

通用内容包工作流：

```bash
npm run content:validate -- /绝对路径/my-adventure
npm run content:build -- /绝对路径/my-adventure
CONTENT_PACKAGE_ID=my-adventure R2_REFERENCE_BUCKET=<你的 REFERENCE_DATA bucket 名称> npm run content:publish
```

现有深水城脚本是把原始书籍目录转换为同一内容包规范的适配器。以下命令把本地“深水城：龙金劫”目录整理为 21 个章节场景和 NPC 档案，再发布模板清单、模板快照和地图资源：

```bash
MODULE_SOURCE_DIR='/绝对路径/深水城：龙金劫' npm run template:build:waterdeep
R2_REFERENCE_BUCKET=<你的 REFERENCE_DATA bucket 名称> npm run template:publish
```

发布后，首页“创建房间 → 跑团模板”会出现“深水城：龙金劫”。每次选择它都会创建一套新的场景、迷雾与 NPC 状态；地图图片只读共享，不重复占用每个房间的 R2 空间。

Alexandrian 重置版使用独立模板 ID，不会覆盖原版模板。它按资料目录生成 8 个可折叠场景分组，并把 NPC 按阵营归档：

```bash
MODULE_SOURCE_DIR='/绝对路径/龙金劫重置版' npm run template:build:waterdeep-remix
ROOM_TEMPLATE_ID=waterdeep-dragon-heist-remix R2_REFERENCE_BUCKET=<你的 REFERENCE_DATA bucket 名称> npm run template:publish
```

## 验证

```bash
npm test
npm run build
```

测试同时覆盖旧的纯领域逻辑，以及 Worker + D1 + Durable Object 的房间创建、邀请兑换和状态持久化。

当前 D1 schema 依次包含平台角色、FVTT 式世界文档与桌面工具迁移（`0003`–`0005`）。本地或远端升级后再启动新版 Worker，避免 Actor、Journal、宏、行动日志和用户设置接口访问尚未创建的表。

## 迁移说明

旧的 Express/局域网服务保留在 `server/`，便于参考与离线数据构建，但不再是部署入口。不要迁移旧浏览器的 `sessionId`、DM 口令或 `localStorage` 身份；新版本全部使用服务器签发的 Cookie 会话和 D1 房间成员关系。
