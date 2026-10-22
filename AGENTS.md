# AGENTS.md — AI 协作开发协议

本仓库由多个 AI 助手并行开发。任何 AI（GPT/Codex/ZCode 等）在本仓库工作前必须遵守本协议。
目标：**任务单元 = 一个组件**，禁止全库通读式修改，降低耦合漂移风险。

## 0. 铁律（违反任何一条即任务失败）

1. **一次会话只做一个任务。** 任务简报会给出文件白名单；白名单之外的文件只允许读接口，不允许写。
2. **禁止触碰契约文件**，除非任务本身就是显式的"契约变更任务"：
   - `shared/types.ts`（Op/Scene/Campaign 契约，前后端六处消费）
   - `worker/src/domain.ts` 的 `authorizeOperation` / `applyOperation`
   - `client/src/optimistic.ts`
   - `worker/src/room.ts` 的 `projectPatchOperations`
   以上四者构成"Op 协议三写"。**任何 Op 语义变更必须四处在同一个任务内同步修改并跑全量测试。** 反之，组件任务里绝不能改它们。
3. **`server/` 目录是遗留死代码**（平行契约，未接入客户端），不要读、不要改、不要"顺手统一"。
4. **不做任务外的事**：不重命名无关变量、不改格式、不升级依赖、不删"看起来没用"的代码（很多表/字段是预留设计，见 `docs/` 文档）。
5. **行为不变原则**：重构类任务的验收标准是测试全绿 + 用户可见行为零变化。

## 1. 项目速览（不需要通读代码）

```
client/src/    React + Konva 前端（Vite 构建）
  ws.ts        connection 单例：WS 重连 + 乐观层 + pending/previews
  api.ts       HTTP 封装（依赖模块级 currentRoomSlug，由 App 设置）
  optimistic.ts  客户端版 op reducer（与 worker domain 配对，见铁律 2）
  pending.ts   "拿起放置"全局事件总线
  components/  UI 组件（依赖图见 docs/component-dataflow-coupling.md）
worker/src/    Cloudflare Worker（唯一线上后端）
  index.ts     路由编排（无状态）
  repository.ts D1/R2 读写 + 向 DO 转发
  room.ts      Room Durable Object：协议+持久化+广播
  domain.ts    纯函数：op 校验/应用/投影
shared/types.ts 前后端唯一契约（铁律保护对象）
server/        遗留 Node 实现，死代码
docs/          架构文档：campaign-centric-redesign.md（重构计划）
                component-dataflow-coupling.md（组件/数据流/耦合分析）
```

## 2. 契约速查表（代替通读源码）

### 2.1 WS 单例 `connection`（client/src/ws.ts 暴露的全部接口）

```ts
connection.connect(slug) / connection.disconnect()
connection.sendOps(ops: Op[])            // 发棋盘命令并乐观应用
connection.sendControl(msg)              // 发控制消息 {type:'switchScene'|...}
connection.previewOps(ops): () => void   // 本地预览（返回清理函数）
connection.roomSlug / connection.viewer
useScene(): { scene, role, roomRole, viewer, revision, online, connected, campaign, messages }
getMySessionId(): string
```

### 2.2 HTTP `api`（client/src/api.ts，全部方法签名见该文件头部，按需 grep 单个方法）

调用前 App 已设置房间上下文；路径自动带 `/api/rooms/:slug` 前缀。

### 2.3 `pending` 总线（client/src/pending.ts 全部）

```ts
setPending(p: PendingToken | null) / subscribe(cb) / getPending()
```

### 2.4 Op 协议（完整定义在 shared/types.ts，改动走契约变更任务）

25 个 op：moveToken / addToken / removeToken / updateToken / addPlayer / removePlayer /
updatePlayer / addWall / removeWall / updateGrid / updateMap / updateMapScale / addEnemy /
removeEnemy / switchCampaign / submitInitiative / addToInitiative / removeFromInitiative /
advanceTurn / reorderInitiative / addFavorite / removeFavorite / setFog / revealAllFog / coverAllFog

### 2.5 角色体系

`roomRole: 'host'|'dm'|'assistant_dm'|'player'|'spectator'`（D1 分配）→ 前端显示角色
`role: 'dm'|'player'`（`useScene().role`）。权限判断一律用 role==='dm'，不要自己再映射。

## 3. 任务协议

### 3.1 任务简报模板（下发任务时填这个）

```
【任务】<一句话目标>
【背景】<为什么要做，1-2 句，可引用 docs/ 文档章节>
【文件白名单】
  可写：<路径列表>
  需要读接口的：<路径列表>
【验收标准】
  1. npm run check:worker 通过（若动了 worker/ 或共享类型）
  2. npx vitest run <相关测试文件> 通过
  3. <行为描述，通常为"用户可见行为不变">
【禁止】触碰铁律 2 所列契约文件 / 白名单外文件 / 任务外重构
```

### 3.2 验证命令

```bash
npm run check:worker              # worker 侧类型检查
npx vitest run client/src/...     # 单个测试文件（客户端纯函数）
npm run test:worker               # worker 全量测试（契约任务必跑）
npm run build                     # 全量构建（发布前）
```

### 3.3 汇报格式

每个任务结束输出：改动文件清单（含白名单外是否被触碰——理论上必须是"否"）、
验证命令及结果、遗留风险（若有）。

## 4. 已知架构约束（改组件时不要破坏）

- 广播分两档：op 类走 patch，聊天/场景控制走全量 state——组件不能假设别人收到增量。
- token id 由服务端重发（authorizeOperation），前端不要依赖自己生成的 id 存活。
- 地图 URL 必须以 `/api/rooms/` 开头（op 校验强制）；头像允许 `/api/token/`。
- 场景 CRUD 走 HTTP、场景切换走 WS control；聊天走 WS、日志走 HTTP（现状，通道统一属于重构计划）。
- 逐组件解耦的路线图和优先级见 `docs/component-dataflow-coupling.md` 第 3.5 节。
