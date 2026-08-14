# 模块化解耦重构设计

- 日期：2026-08-14
- 状态：已确认设计，待实现
- 项目位置：`/Users/xiejiaxue/developer/dndboard/dnd-dm-tool`

## 1. 背景与目标

当前生产代码（`worker/` + `client/` + `shared/`）实现了一个 Cloudflare 全栈多人桌游应用，功能包括：身份会话、大厅/房间/邀请、实时桌面（token/墙/地图/网格/迷雾/投影）、场景管理、战役库、先攻、资料查询（本地 R2 + 在线回退）、素材上传、迷雾、备份导入导出、审计、限流。

多个文件同时承担多种职责，功能之间耦合度高。本重构的目标：

1. **按功能/领域拆分为独立模块**，每个模块单一职责、可独立理解与测试
2. **收紧模块边界**：明确依赖方向，消除跨功能隐式耦合
3. **零行为变化**：HTTP API、WebSocket 协议、D1/DO schema、UI 表现、测试全部保持

### 重构深度（用户已确认）

结构重组 + 收紧边界（方案 A）：
- 允许：搬移文件、拆分大文件为多模块、调整模块间依赖方向（含目录重组）
- 不允许：改变对外协议、DB schema、UI 行为；不引入新依赖/库

### 范围

- 包含：`worker/src/`、`client/src/`、`shared/`（不改动内容）、构建/测试配置的 include 路径
- 排除：`server/`（旧 Express 局域网版，不在部署链路，但 `npm run test:domain` 仍编译它，故 **`shared/types.ts` 不得拆分**，避免破坏旧 server 导入）
- 排除：`scripts/`、`docs/`（cloudflare-architecture.md 的目录说明除外，见 §8）

## 2. 现状耦合分析

| 文件 | 行数 | 混合的职责 |
| --- | --- | --- |
| `worker/src/index.ts` | 356 | 入口 fetch + 全量路由 + 本地资料搜索/条目/占位图 + 审计 SQL + 素材上传校验 |
| `worker/src/room.ts` | 714 | WS 传输协议 + 命令解析 + 场景/战役路由 + SQL 持久化 + 补丁投影 + 限流 + 在线状态 |
| `worker/src/domain.ts` | 685 | 状态创建/投影 + 操作授权/校验 + 操作应用 + 场景/战役 CRUD + 先攻逻辑 + 字段校验器 |
| `worker/src/repository.ts` | 388 | 房间访问 + 邀请 + 素材存储 + DO 网关 |
| `client/src/ws.ts` | 425 | 套接字生命周期/重连 + 权威快照 + 乐观命令队列 + 补丁应用 + React hook |
| `client/src/components/BoardCanvas.tsx` | 538 | 视图缩放 + 画墙 + 擦雾 + 放 token + 删除 + 地图校准 + 迷雾渲染 |
| `client/src/App.tsx` | 179 | 路由状态机 + 邀请兑换 + 会话挂载 |

客户端除 `features/map-upload/` 外没有功能目录；组件通过 `ws` 单例与 `pending.ts` 全局总线隐式耦合。

## 3. Worker 目标结构

```
worker/src/
├── index.ts          # 入口（thin）：default fetch 处理器（会话/错误/Set-Cookie 包装）
│                     #   + 具名导出 RoomDurableObject、OnlineCompendiumRateLimitDurableObject
│                     #   （满足 wrangler.jsonc exports 对类名的约束）
├── router.ts         # 纯路由分发：routeApi + routeRoomApi，只做模式匹配与委托
├── http.ts           # 保持原样（单一职责的 HTTP 管道：错误/响应/校验/同源）
├── auth.ts           # 会话；expiredSessionCookie 从 index.ts 并入
├── public-config.ts  # 保持原样
├── control-plane/    # D1 数据访问（原 repository.ts 按域拆分）
│   ├── rooms.ts      #   requireRoomAccess/listRooms/createRoom/createRoomInvite/
│   │                 #   redeemRoomInvite + roomSummary + slug 分配 + 角色/邀请校验
│   ├── assets.ts     #   createAsset/getAsset/looksLikeImage + 上传/读取的 HTTP 处理
│   ├── gateway.ts    #   callRoom/initializeRoom/forwardRoomWebSocket/internalRoomHeaders
│   └── audit.ts      #   writeAudit/writeInviteAudit（从 index.ts 抽出）
├── compendium/       # 资料查询功能包
│   ├── routes.ts     #   /api/search、/search/online、/entry/:type/:id、/token/:id 的 HTTP 处理
│   ├── local.ts      #   R2 本地搜索/条目/占位图（从 index.ts 抽出）
│   ├── online.ts     #   在线回退 + 缓存 + OnlineCompendiumRateLimitDurableObject（原样迁移）
│   └── online-data.ts#   在线数据解析（原样迁移）
└── board/            # Room Durable Object（原 room.ts 按职责拆分）
    ├── room-do.ts    #   DO 类：请求/WS 路由编排 + mutate 事务编排 + 广播/在线状态/限流
    ├── protocol.ts   #   actorFromHeaders/socketActor/objectBody/text/clientCommandId/isRecord + 常量
    ├── persistence.ts#   SQL：createSchema/loadState/回执查询/三表写入（room_state/room_events/room_command_receipts）
    ├── patches.ts    #   projectPatchOperations + projectPlayerToken
    └── domain/       # 纯领域（原 domain.ts 按职责拆分）
        ├── state.ts  #   类型（PersistedRoomState/RoomProjection/RoomActor/RoomRole）
        │             #   + createScene/createCampaign/createInitialRoomState/projectRoomState
        │             #   + ensurePlayerToken/activeScene/activeCampaign/isRoomModerator/legacyRole
        ├── ops.ts    #   authorizeOperation/authorizePlayerOperation/applyOperation
        │             #   + 操作级校验器（token/wall/patch/grid/fog/initiative/favorite…）
        ├── scenes.ts #   addScene/deleteScene/renameScene/selectScene/setSceneUnlocked
        ├── ids.ts    #   newOpaqueId + normalizeName
        └── errors.ts #   DomainError
```

### Worker 依赖方向（单向、无环）

```
index.ts → router.ts → { auth, compendium/routes, control-plane/*, public-config }
router.ts → gateway.ts → board/room-do.ts   （HTTP fetch 调用，无代码依赖）
control-plane/rooms.ts → board/domain/state.ts（仅类型 + isRoomModerator）
board/room-do.ts → board/{protocol, persistence, patches, domain/*}
```

### Worker 关键决策

1. **入口具名导出**：`export { RoomDurableObject } from './board/room-do'`、`export { OnlineCompendiumRateLimitDurableObject } from './compendium/online'`，类名不变
2. **router.ts 保留纯代理**：`routeRoomApi` 中 scenes/campaigns 的 `callRoom` 转发（各 ~8 行）属于路由职责留在 router；素材上传/地图上传的校验逻辑（content-length、formData、imageDimension）移入 `control-plane/assets.ts`
3. **room-do.ts 保留 handler 方法**：它们天然绑定 DO 实例状态；拆分的是传输（protocol）、持久化（persistence）、补丁投影（patches）、纯领域（domain）——即 room.ts 中可独立测试的职责
4. **mutate() 编排留在 room-do**，SQL 语句移入 persistence.ts（函数接收 `storage.sql`），事务原子性不变
5. **审计独立成 audit.ts**，由 router 调用（横切关注点）
6. **room-do 的广播/在线状态/限流**（broadcastState/broadcastPresence/consumeCommandBudget/safeSend/sendError/respondJson/respondError）留在类内——它们都依赖 `this.ctx.getWebSockets()` 与 attachment，拆分需要更大范围重构，超出本次边界收紧目标
7. **control-plane → board/domain 的依赖**仅限类型与 `isRoomModerator`（角色是房间领域概念，控制面执行权限时引用），属合理单向依赖

## 4. Client 目标结构

```
client/src/
├── app/                    # 应用壳
│   ├── App.tsx             #   路由状态机 + 邀请兑换 + 会话挂载（仅搬迁）
│   ├── Lobby.tsx
│   └── FilingFooter.tsx
├── room/                   # 房间壳（布局组合）
│   ├── RoomTable.tsx
│   ├── TopBar.tsx
│   ├── Toolbar.tsx
│   └── InvitePlayerButton.tsx
├── features/               # 功能包（通过自身文件直接导出公开 API）
│   ├── board/
│   │   ├── BoardCanvas.tsx #   组合：Konva 图层 + 工具 hook 装配 + 浮层控件
│   │   ├── useBoardView.ts #   缩放/平移/重置（scheduleView/zoomAt/zoomCenter/resetView）
│   │   ├── useWallTool.ts  #   画墙状态机（wallStart/wallEnd/wallPreview/完成逻辑）
│   │   ├── useFogEraser.ts #   擦雾刷（eraserBatch/节流发送/revealAt）
│   │   ├── useMapCalibration.ts # 地图校准（localMapScale/adjustMapScale/setMapScale）
│   │   ├── fog.ts          #   纯函数 fogCellAt + FOG_COLOR
│   │   ├── FogOverlay.tsx  #   迷雾遮罩组件（memoized）
│   │   └── TokenShape.tsx
│   ├── scenes/SceneSwitcher.tsx
│   ├── initiative/InitiativePanel.tsx
│   ├── enemies/EnemyList.tsx + OwnCharacterCard.tsx  # 玩家角色卡抽离
│   ├── compendium/QueryPanel.tsx + DetailDrawer.tsx + format.ts
│   ├── backup/backup.ts + BackupTransfer.tsx
│   └── map-upload/         # 已有 feature 包，保持不变
└── lib/                    # 基础设施（无 UI）
    ├── ws/
    │   ├── transport.ts    #   套接字生命周期/重连/generation/能力协商/sendRaw
    │   ├── store.ts        #   权威快照 + pending 队列 + previews + 乐观重放
    │   ├── connection.ts   #   Connection 类组合两者 + 单例导出
    │   └── useScene.ts     #   React hook
    ├── api.ts              #   API 客户端（fetch 封装 + ApiError + 房间路由）
    ├── routing.ts
    ├── optimistic.ts       #   乐观操作应用（与 server 领域对应）
    ├── pending.ts          #   跨功能"拾起-放置"事件总线（基础设施）
    ├── tokenPlacement.ts   #   nextTokenSpawn（纯几何助手；唯一使用方是 compendium/QueryPanel，
    │                       #   放 lib 避免 compendium→board 的功能包间依赖）
    ├── upload.ts
    ├── useImage.ts
    └── types.ts            #   shared/types 的 re-export 垫片（从根目录移入）
```

### Client 关键决策

1. **ws.ts 三拆**：`transport` 只懂连接/发送/重连，不知业务消息类型；`store` 只懂权威快照 + 待确认命令 + 预览的乐观重放，不知 socket；`connection` 组装两者。公开 API（`connection.sendOps/sendControl/connect/disconnect/onMessage`、`useScene`、`getMySessionId`）签名不变，组件仅改 import 路径
2. **BoardCanvas 五拆**：每个工具一个 hook 拥有自己的状态机；`fog.ts` 的 `fogCellAt` 与 `FogOverlay` 可独立于 Konva 测试
3. **pending.ts 留在 lib/**：它是跨功能协调总线（QueryPanel 拾起 → BoardCanvas 放置），放 lib 使 compendium 功能包不产生对 board 功能包的依赖
4. **OwnCharacterCard 抽离**：EnemyList 中玩家角色卡（改名/HP/配色/头像上传）与敌人列表是独立职责，拆为两个组件
5. **组件间依赖规则**：组件只能 import 功能包公开文件或 lib；功能包之间不互相 import（必要时走 lib 总线）；map-upload 保持现状是唯一例外
6. **import 路径**：无路径别名，feature 内文件用相对路径（`../../lib/...`），lib 内部用 `./...`
7. **`client/src/store.ts`（moveToken/addToken/addWall 构造助手）为死代码**：检索确认无任何文件 import 它，随重构删除（删除死代码不改变行为；若实现中发现隐藏引用则改归 lib/ 保留）

## 5. 数据流与错误处理（不变）

- HTTP 路由、WS 消息协议（state/patch/ack/meta/error/resync/capabilities、op/场景控制消息）字节级不变
- `HttpError`（`http.ts`）、`DomainError`（`board/domain/errors.ts`）语义不变
- DO 内部 SQL 语句、幂等回执、命令预算、投影逻辑逐字迁移

## 6. 测试迁移

| 测试 | 迁移去向 | 配置改动 |
| --- | --- | --- |
| `client/src/__tests__/api.test.ts` | `client/src/lib/` | 无 |
| `client/src/__tests__/optimistic.test.ts` | `client/src/lib/` | 无 |
| `client/src/__tests__/routing.test.ts` | `client/src/lib/` | 无 |
| `client/src/__tests__/ws.test.ts` | `client/src/lib/ws/` | 无 |
| `client/src/__tests__/backup.test.ts` | `client/src/features/backup/` | 无 |
| `client/src/__tests__/format.test.ts` | `client/src/features/compendium/` | 无 |
| `client/src/__tests__/map-upload.test.ts` | `client/src/features/map-upload/` | 无 |
| `client/src/__tests__/token-placement.test.ts` | `client/src/lib/` | 无 |
| `worker/test/room-patch.test.ts` | `worker/src/board/` | `vitest.worker.config.ts` include → `['worker/src/**/*.test.ts']` |
| `worker/test/room.integration.test.ts` | `worker/src/board/` | 同上 |
| `worker/test/online-compendium-data.test.ts` | `worker/src/compendium/` | 同上 |
| `worker/test/public-config.test.ts` | `worker/src/` | 同上 |
| `worker/test/raw.d.ts` | `worker/src/` | — |

`vitest.config.ts` 的 `client/src/**/*.test.ts` 通配符已覆盖新目录，无需改动。测试 import 路径随代码迁移更新。

## 7. 验证标准（完成的定义）

1. `npm test`（test:domain + test:worker）全绿
2. `npm run build`（build:client + check:worker）通过
3. `wrangler.jsonc`、`worker/migrations/`、HTTP API、WS 协议、`shared/types.ts` 零改动
4. `git diff --stat` 复核：所有变更均为移动 + 拆分，无行为代码修改（除 import 路径与文件名）
5. 运行 `npm run dev` 冒烟：创建房间 → 放置 token → 画墙 → 擦雾 → 切换场景 → 备份导出/导入（人工验证清单，由实现计划细化）

## 8. 文档

重构完成后更新 `docs/cloudflare-architecture.md`，在其结构描述中补充一句话指向新目录布局。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 大文件拆分引入笔误/符号丢失 | 拆分为"移动 + 少量编辑"，每步运行 `check:worker` / vitest；拆分顺序：先 worker（后端可独立验证），后 client |
| DO 类名/导出位置变更导致 wrangler 解析失败 | index.ts 保留具名 re-export；`npm run dev` 冒烟验证 |
| 测试通配符漏改导致 worker 测试不跑 | vitest.worker.config.ts include 显式改为 `worker/src/**/*.test.ts`；跑 `npm test` 核对测试数 |
| 客户端组件 import 路径遗漏 | 全部迁移后 `npm run build`（vite 打包会报未解析模块）兜底 |
| 工作区存在未提交的进行中修改 | 重构在用户当前工作区之上进行；设计文档单独提交，不打包他人修改 |
| shared/types.ts 拆分破坏旧 server 编译 | 明确不拆分 shared/types.ts（`test:domain` 仍编译 server） |
