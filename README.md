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
npm ci
npm run cf:types
npm run db:migrate:local
npm run dev
```

访问 `http://localhost:5173` 进行带 HMR 的前端开发；它会把 `/api` 和房间 WebSocket 代理到本地 Wrangler 的 `http://localhost:8787`。也可以直接运行 `npm start` 后访问 `http://localhost:8787`。

第一次打开首页会创建一个 HttpOnly 访客会话。创建战役后地址形如 `/c/friday-table-xxxxxx`；DM 从顶部“邀请玩家”生成链接，链接的随机令牌在 URL fragment 中，浏览器不会把它送进服务器日志或 Referer。

## Cloudflare 部署

正式代码以 GitHub `main` 为准。本地主目录是 `/Users/xiejiaxue/developer/dndtool`。

合入 main 后，GitHub 的 **Production** 工作流自动安装依赖、运行测试、校验音乐、构建并发布到 https://dnd.xiejiaxue.com，然后核对线上页面及资源哈希。也可以在 main 上手动运行同一工作流。

发布凭据保存在 GitHub `production` 环境的 `CLOUDFLARE_API_TOKEN` secret 中。`npm run deploy:production` 只允许此流程从最新且干净的 main 提交执行，始终使用 `--keep-vars`。Worker 不公开 workers.dev 备用地址。

D1 和 R2 均绑定已有生产资源。日常发布不创建数据库、不清空数据、不自动运行远程迁移。备案变量继续保留在 Cloudflare。

开发、归档、回滚以及历史目录说明见 [项目管理与发布约定](docs/project-workflow.md)。

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

### 角色文件往返编辑

角色页提供「上传角色卡」「下载角色文件」「导出 PDF」三个明确入口。可编辑文件使用 `.dndcard.json` v1，可下载模板并在导入前预览；PDF 保持为阅读版。格式、大小和版本限制见 [角色文件协议](docs/character-files.md)。

### 独立掷骰

`/dice` 提供真实碰撞的 3D 骰盘及简洁模式，支持七种骰型、混合骰式、逐颗读数、自动汇总和本机历史。实现及读数规则见 [掷骰界面](docs/dice-roller.md)。
