# D&D DM 追踪工具

这是一个 Cloudflare 全栈多人桌游应用：DM 创建战役后直接进入棋盘，玩家通过邀请选择角色，后续自动恢复。

```text
浏览器（同一 HTTPS URL / 同源 WSS）
        │
        ▼
Cloudflare Worker ── D1：身份、个人模组库、战役、名册、邀请、审计
        │
        ├──────────── R2：私有地图、头像、资料库 JSON
        │
        └──────────── Room Durable Object：一张桌子的权威实时状态、WebSocket、事件
```

当前实现与重建说明见 [战役中心化改造](docs/campaign-centric-redesign.md)。[Cloudflare 架构说明](docs/cloudflare-architecture.md) 保留为旧版设计参考。

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run cf:types
npm run db:migrate:local
npm run dev
```

访问 `http://localhost:5173` 进行带 HMR 的前端开发；它会把 `/api` 和房间 WebSocket 代理到本地 Wrangler 的 `http://localhost:8787`。也可以直接运行 `npm start` 后访问 `http://localhost:8787`。

第一次打开首页会创建一个 HttpOnly 访客会话。创建战役后地址形如 `/c/friday-table-xxxxxx`；DM 从顶部“邀请玩家”生成链接，链接的随机令牌在 URL fragment 中，浏览器不会把它送进服务器日志或 Referer。

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

`PUBLIC_SITE_DOMAIN` 必须是目标 Cloudflare account 中 zone 的单个 hostname，且不能预先存在冲突的 CNAME。部署会创建 Custom Domain 所需 DNS 和证书；这个 Worker 不公开 `workers.dev` 备用地址。所有用户只访问这个 HTTPS URL；前端会自动连到同源 `wss://<PUBLIC_SITE_DOMAIN>/api/campaigns/<slug>/ws`。

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

## 独立工具与角色卡 PDF

- `/`：战役列表、筛选、创建、归档、恢复与删除；使用新的战役数据库，旧数据不迁移。
- `/calculator`：临时先攻与 HP 计算器。伤害先抵扣临时 HP，治疗不超过上限；支持轮次、撤销及本机自动保存。
- `/characters`：独立角色草稿，包含属性、技能熟练/专精、战斗数据、施法及长文本记录，可下载 A4 PDF。
- `/tavern`：酒馆经营小游戏，包含随机事件、连续人物剧情、招聘升级与每日收益结算，支持本机存档和备份。规则与原版区别见 [酒馆小游戏](docs/tavern-game.md)。
- 房间内原有角色卡也提供 PDF 导出，包含已添加资料的完整说明。

独立工具使用当前浏览器的 localStorage，不与房间状态同步。PDF 在浏览器生成，中文字体由本站提供，不将角色内容发送到外部生成服务。字体及衍生版本遵循 `client/public/fonts/OFL.txt`；重建方法见 `scripts/build-pdf-font.py`。D20 轮廓参考纯美苹果园 favicon，以单色 SVG 重绘。

本版本在 `codex/swiss-production` 工作树上维护，避免用主工作目录内尚在开发的 Open TRPG 引擎替换线上后端。发布到现有域名时保留线上变量：

```bash
npm test
npm run build
npx wrangler whoami
npx wrangler deploy --domain dnd.xiejiaxue.com --keep-vars
```

### 角色文件往返编辑

角色页提供「上传角色卡」「下载角色文件」「导出 PDF」三个明确入口。可编辑文件使用 `.dndcard.json` v1，可下载模板并在导入前预览；PDF 保持为阅读版。格式、大小和版本限制见 [角色文件协议](docs/character-files.md)。

### 独立掷骰

`/dice` 提供真实碰撞的 3D 骰盘及简洁模式，支持七种骰型、混合骰式、逐颗读数、自动汇总和本机历史。实现及读数规则见 [掷骰界面](docs/dice-roller.md)。
