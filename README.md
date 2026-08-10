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

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run cf:types
npm run db:migrate:local
npm run dev
```

访问 `http://localhost:5173` 进行带 HMR 的前端开发；它会把 `/api` 和房间 WebSocket 代理到本地 Wrangler 的 `http://localhost:8787`。也可以直接运行 `npm start` 后访问 `http://localhost:8787`。

第一次打开首页会创建一个 HttpOnly 访客会话。创建房间后地址形如 `/r/friday-table-xxxxxx`；DM 从顶部“邀请玩家”生成链接，链接的随机令牌在 URL fragment 中，浏览器不会把它送进服务器日志或 Referer。

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

## 验证

```bash
npm test
npm run build
```

测试同时覆盖旧的纯领域逻辑，以及 Worker + D1 + Durable Object 的房间创建、邀请兑换和状态持久化。

## 迁移说明

旧的 Express/局域网服务保留在 `server/`，便于参考与离线数据构建，但不再是部署入口。不要迁移旧浏览器的 `sessionId`、DM 口令或 `localStorage` 身份；新版本全部使用服务器签发的 Cookie 会话和 D1 房间成员关系。
