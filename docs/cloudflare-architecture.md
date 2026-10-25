# Cloudflare 全栈架构与权限模型

## 目标与边界

应用只有一个公开入口：`https://dnd.xiejiaxue.com`。静态 React 应用、HTTP API 和 WebSocket 都在这个同源 URL 下，因而玩家无需 LAN、端口映射、IP 地址或手动输入 WebSocket 地址。

```mermaid
flowchart LR
  B["浏览器\nHTTPS + 同源 WSS"] --> W["Worker\n静态 SPA、认证、API、WS 网关"]
  W --> D["D1\n身份、成员关系、邀请、资产元数据、审计"]
  W --> R["私有 R2\n地图、头像、规则书 JSON"]
  W --> O["战役 Durable Object\n每个战役一个权威状态机"]
  O --> S["DO SQLite\n快照、事件、命令幂等记录"]
```

- Worker 是唯一公网后端；它验证 HttpOnly Cookie、请求 Origin 和 D1 权限，然后才把可信身份转给战役 DO。
- D1 是控制面：长期身份、个人库、战役、成员、邀请、R2 元数据和审计。它不承担高频 token 移动。
- 一个 `campaign:<campaignId>` 对应一个 Durable Object（binding 仍叫 `ROOMS`，类名仍为 `RoomDurableObject`，只是 Cloudflare 资源标识）。DO 串行化命令，先写 DO SQLite，再广播。它使用 hibernatable WebSocket attachment，因此重启/休眠后仍能恢复已验证的成员上下文。
- R2 全部保持私有。应用仅通过受权限保护的 `/api/campaigns/:slug/assets/:assetId` 读取战役素材，浏览器永远拿不到裸 object key 或公共 bucket URL。

Cloudflare 的 Static Assets 提供 SPA；`/api/*` 被 `run_worker_first` 保留给 Worker，避免 SPA fallback 吞掉 API 或 WebSocket upgrade。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `worker/src/` | 唯一后端：`index.ts` 入口（会话、错误处理、日志），`routes/` 按功能分组的路由表（`routes/index.ts` 汇总 `/api` 与 `/api/campaigns/:slug` 两张表），`room.ts` 战役 DO，`domain.ts` 纯状态机与操作校验，`campaign-store.ts` DO SQLite 持久化，`campaigns.ts` / `repository.ts` D1 业务，`auth.ts` / `http.ts` 会话与 HTTP 工具，`modules/` 冒险模组注册表，其余为资料库、日历等功能模块 |
| `worker/campaign-migrations/` | D1 schema（`wrangler.jsonc` 的 `migrations_dir`） |
| `shared/` | 前后端共用的类型与纯逻辑：`types.ts`、`fog.ts`、`calendar/model.ts`、模组数据（`strahd/`、`waterdeep/`、`phandelver/`、`hoard/`、`hoard-remix/`）与通用遭遇预设类型 `encounter-presets.ts` |
| `client/` | React 前端 |
| `scripts/` | 构建、数据与发布脚本；`compendium-index.ts` 为 `npm run data:update` 生成规则书索引 |

旧的 Express/局域网实现（`server/`）与旧房间模型的 D1 migration（`worker/migrations/`）已删除；需要查阅时看 Git 历史或标签 `production/before-cleanup-20261022`。

## 冒险模组

每个内置模组是 `worker/src/modules/<id>/` 下导出的一个 `AdventureModule`（类型见 `worker/src/modules/types.ts`），在 `worker/src/modules/registry.ts` 的 `MODULES` 中登记。Worker 其余代码只通过注册表使用模组，不直接引用某个模组：

| 字段 | 作用 | 使用方 |
| --- | --- | --- |
| `id` | 写入 `campaign_modules.template_json` 的 `templateId`，也是 R2 `room-templates/<id>/` 前缀；发布后不可修改 | 全部 |
| `library` | 个人库中显示的名称与说明；修改会为老用户新增一条库记录 | `campaigns.ts` |
| `scenes.count` / `scenes.prepare` | 校验 R2 清单的地图数量；可逐张校验地图并填充新场景（例如预置 Token） | `module-template.ts` |
| `compendium` | 加入资料搜索、怪物数据卡和 Token 图；按 `MODULES` 顺序查找 | `index.ts` |
| `routes` | 模组专属接口 `/api/campaigns/:slug/<path>[/<param>]`，由 Worker 转发、在战役 DO 内执行，可读写实时状态 | `index.ts`、`room.ts` |

新增模组：建目录导出 `AdventureModule`，加入 `MODULES`，把地图清单与图片上传到 R2 `room-templates/<id>/`。带房间遭遇预设的模组（施特拉德、凡戴尔、龙后的宝山及其重置版）共用 `modules/preset-encounters.ts`：开局隐藏 Token、主持人专用的 `<模组>-scene/<sceneId>` 接口和前端 `EncounterModuleTab`。路由名不能与 `RESERVED_ROUTE_PATHS` 中的核心接口重复，`worker/test/modules.test.ts` 会检查。不要直接从 `MODULES` 移除已发布的模组：移除后无法再用它新建战役（库中旧记录仍会显示，选择时报“模组暂不可用”），已用它创建的战役的共享地图也会读不到（`repository.ts` 的 `getAsset` 只为登记中的模组从 R2 `REFERENCE_DATA` 读取地图）。下线模组需要先决定已有战役如何处理。

## 数据模型

`worker/campaign-migrations/0001_campaign_core.sql` 建立以下分层（设计背景见 `docs/campaign-centric-redesign.md`）：

```text
User（Cookie 访客身份）
└─ Workspace（个人库：模组、角色模板）
   └─ Campaign（一局战役，独立名册与分享网址 /c/:slug）
      ├─ campaign_members（唯一准入关系与角色）
      ├─ campaign_characters / campaign_journals
      └─ 战役 Durable Object（实时棋盘、token、先攻、雾、聊天、事件）
```

| 数据 | 保存位置 | 原因 |
| --- | --- | --- |
| 用户、访客会话 | D1 `users`、`auth_sessions` | 可审计、可撤销 |
| 个人库、模组、战役、成员、角色、日志 | D1 | 稳定关系与权限判定 |
| 邀请、兑换记录、权限 epoch、审计 | D1 | 连接前的权限判定 |
| 当前场景、棋盘、先攻、聊天、操作序号、命令回执 | 每战役 DO SQLite（`campaign_runtime`、`campaign_data`、`scene_data`、`chat_messages`、`command_receipts`、`campaign_events`） | 单写者、低延迟、断线恢复 |
| 地图、头像、规则书 JSON、模组素材 | 私有 R2 | 二进制对象不进入 SQL 行 |

`campaign_members` 是最后的授权边界，角色为 `owner`、`dm`、`assistant_dm`、`player`、`spectator`。移动、雾等高频操作只写 DO，不写 D1。

## 权限策略

固定角色比任意自定义 ACL 更容易审计；UI 隐藏按钮只是辅助，每个 HTTP 和 WebSocket 命令都在服务端再次判定。

| 能力 | 战役 owner | DM | Assistant DM | Player | Spectator |
| --- | ---: | ---: | ---: | ---: | ---: |
| 管理桌团、转让所有权 | ✓ |  |  |  |  |
| 创建/撤销玩家邀请 | ✓ | ✓ | ✓ |  |  |
| 编辑地图、怪物、雾、先攻、场景 | ✓ | ✓ | ✓ |  |  |
| 上传地图/通用 token | ✓ | ✓ | ✓ |  |  |
| 上传并编辑自己的头像 | ✓ | ✓ | ✓ | ✓ |  |
| 移动自己的服务器绑定角色 |  |  |  | ✓ |  |
| 只读公开投影 | ✓ | ✓ | ✓ | ✓ | ✓ |

当前实现中 owner（DO 内为 `host`）、`dm`、`assistant_dm` 都映射为棋盘 UI 的 `dm`；`spectator` 使用玩家投影但没有写操作。邀请只能授予 `player` 或 `spectator`，永远不能授予 owner/DM。

访客是受服务器控制的正式 `users` 行：首次访问生成 256-bit 随机会话令牌，D1 仅保存 SHA-256，浏览器保存 `Secure; HttpOnly; SameSite=Lax` Cookie。跨设备账号（OAuth/OIDC）尚未实现。

## 战役、邀请与实时协议

1. 创建战役：Worker 在 D1 创建 campaign 与 owner 成员，然后初始化 `campaign:<id>` DO。
2. 创建邀请：Worker 生成 256-bit 随机 token，D1 只保存摘要；只能授予 Player/Spectator，并限制次数与有效期。
3. 分享链接：`/c/<slug>#invite=<token>`。fragment 不会出现在 HTTP request 或 Referer；客户端兑换成功后立即清除 fragment。
4. 兑换：D1 在事务内条件更新使用次数，创建 `campaign_members` 与 `invite_redemptions`。未兑换用户访问战役返回泛化 404，不能枚举战役。
5. WebSocket：Worker 从 Cookie + D1 派生 `userId/memberId/role/accessEpoch`，仅以内部 header 转给 DO。浏览器 payload 中没有角色、DM token、sessionId 或可信 userId。

战役 DO 的实时协议接受前端 `{ type: 'op', ops }`，但所有 op 都经过服务端 schema/范围校验和权限归一化：

- Player 只能移动自己的服务器绑定 token、改自己的显示信息、提交自己的先攻；不能提交任意 `sessionId` 或修改怪物 HP。
- DM 命令会生成/清洗资源 ID；地图只能引用当前战役的私有 asset URL。
- 每命令含有可选 client command ID，DO 用 `(member_id, command_id)` 去重；状态、事件、回执在同一 DO SQLite transaction 落盘后才广播。
- 每连接有最大帧大小、单帧 op 数量和每分钟命令预算。错误/越权命令不会修改状态。

移除成员或归档战役时，D1 把成员标记 `removed` 并递增 `permission_epoch`，再通知 DO 刷新权限、断开该成员现有 socket；重连始终重新查 D1。

## 数据投影与迷雾

DM 收到完整战役状态。Player/Spectator 投影会去掉敌人库，并将其他玩家的稳定身份 ID 置空；DO 不再像旧架构那样把一份完整原始状态无差别广播给所有 WebSocket。

不过“整图原图已经发送到浏览器”时，CSS/Konva 雾只能是视觉效果，不能保密。这一版明确把它称为 `cosmetic fog`。若游戏需要真正隐藏地图，下一阶段必须把地图切片/派生，并仅按可见格向玩家签发 tile；不要把 CSS 遮罩当作安全功能。

## R2 与资料库

- 战役素材上传：Worker 目前直接校验并写入最多 10 MiB 的 JPEG/PNG/WebP/AVIF，检查文件签名，并返回受鉴权的相对 URL。更大地图应升级为短期、单对象的 R2 直传 intent。
- 规则书：`npm run data:update` 在 Node/CI 下载并生成索引；`npm run data:publish` 将 `index.json` 和各 book JSON 上传到 `REFERENCE_DATA`。Worker 搜索索引并按需读取一个 book，再返回单个条目。
- 规则书 token 无 R2 缓存时，Worker 返回无害的 SVG 占位图。

## 生产域名与公开配置

- `wrangler.jsonc` 不保存 Custom Domain。`scripts/deploy-production.mjs` 从 `PUBLIC_SITE_DOMAIN` 读取单个 hostname，并以 Wrangler `--domain` 绑定它；Cloudflare 负责该 hostname 的 DNS 和证书。目标 zone 必须在同一个 account，且 hostname 不能有冲突 CNAME。`workers.dev` 保持关闭。
- 生产发布只通过 GitHub Actions 的 Production 工作流，在 main 上手动运行；合并 main 不会自动发布。步骤与回滚见 `docs/project-workflow.md`。
- `PUBLIC_SITE_DOMAIN`、`PUBLIC_ICP_FILING` 和 `PUBLIC_PSB_FILING` 是部署环境变量，不是 secrets。前者只供部署脚本绑定 Custom Domain；Worker 的 `/api/public-config` 只公开后两个非空、长度受限的备案字符串。客户端仅在备案变量存在时渲染相应链接，因此同一个前端产物可用于有或无备案信息的环境。

## 部署与运维

生产配置在 `wrangler.jsonc`：使用 declarative `exports` 声明 SQLite DO，不使用 legacy DO migrations。D1、R2 资源固定，常规发布不创建资源、不运行远程 migration；需要 schema 变更时单独设计兼容迁移并显式运行 `npm run db:migrate:remote`。

不要把真实 OAuth client secret、R2 S3 key 或部署凭据放入代码、`.dev.vars` 或 D1。未来 OAuth secret 用 `wrangler secret put`；运行日志与审计事件不得记录 Cookie、邀请原文或上传内容。

本地 `wrangler dev` 使用 `.wrangler/state` 以让 D1/R2/DO 数据跨重启保留。当前 Wrangler 本地 workerd 可能暂时落后 `compatibility_date` 一两天；项目配置仍保持当前生产日期，若本地 runtime 报日期不支持，可仅在开发命令增加其提示的较早 `--compatibility-date`，不要回退生产配置。
