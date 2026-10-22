# 组件架构 · 数据流链路 · 耦合位置

> 定稿于 2026-10-10。基于本地工作区代码 + 线上部署版本比对结论（Worker 两侧一致，客户端线上多三个独立页，见 `DnD-DMTool-recovered/README.md`）。
> 姊妹文档：`campaign-centric-redesign.md`（概念层重构计划）。本文是它的数据层/组件层依据。

## 第一部分：组件架构

### 1.1 全景（六条接口边界）

```
┌──────────────── 客户端 React (client/src) ────────────────┐
│  组件层    App/Lobby/TopBar/Toolbar/QueryPanel/BoardCanvas…  │
│      ↓依赖                  ↓依赖              ↓依赖        │
│  单例层    connection(ws.ts)  api.ts          pending.ts    │
│      ↓含                ↓含                  ↓全局总线      │
│  纯函数   optimistic.ts      （currentRoomSlug 模块级可变） │
└──────┬──────────────────────┬───────────────────────────┬──┘
       │ WS 协议               │ HTTP API                  │
┌──────▼─────────┐   ┌────────▼─────────┐   ┌──────────────▼──┐
│ Room DO        │   │ Worker index.ts  │──→│ D1 (控制面)      │
│ room.ts        │←──│  └→ repository   │   │ R2 素材/资料     │
│  └→ domain.ts  │7条 │  └→ auth/http   │   │ DO SQLite(数据面)│
└──────┬─────────┘内部 │  └→ compendium   │   └─────────────────┘
       │             └──────────────────┘
┌──────▼────────────────────────────────────────────────────┐
│ shared/types.ts —— 唯一前后端契约源（Op/Scene/Campaign/…）  │
└───────────────────────────────────────────────────────────┘
```

### 1.2 客户端组件树与依赖注记

```
App ── 路由层：唯一拥有 history/location 的层（含 2 处 location.reload）
 ├─ Lobby                        → api, SessionCalculator
 └─ RoomSession                  → api（bootstrap 门控：非管理端+有活跃战役+已选角 → 直进）
     └─ Table                    （状态提升点：tool/pending/selectedId/queryCollapsed/brushSize）
         ├─ TopBar               → api + ws + upload + 5 个子弹层
         │   ├─ BackupTransfer / SceneSwitcher / CampaignSwitcher / CharacterSheetPanel
         │   └─ 职责：邀请、地图上传(三段流)、切换器宿主、消息展示、离开
         ├─ InitiativePanel      → 仅 ws
         ├─ Toolbar              → 纯 props（零数据依赖）
         ├─ EnemyList            → ws + upload + DetailDrawer
         ├─ BoardCanvas          → ws + useImage + TokenShape + pending（props 进事件出）
         │   └─ TokenShape       → useImage
         └─ QueryPanel           → api + ws + pending（三层全碰，嵌三子面板）
             ├─ ChatPanel        → 仅 ws
             ├─ JournalPanel     → 仅 api
             └─ DetailDrawer     → api + ws + format + pending
```

三个基础设施单例（import 图之外还有两处模块级可变状态）：

| 单例 | 使用处 | 备注 |
|---|---|---|
| `connection` (ws.ts) | 19 处 import | WS 重连、乐观层、pending/previews 队列都在里面 |
| `api` (api.ts) | 14 处 | `currentRoomSlug` 模块级可变，隐式依赖 App 先调 `setCurrentRoomSlug` |
| `pending` (pending.ts) | 3 处 | 全局事件总线：QueryPanel 发 → Table 切放置模式 → BoardCanvas 落子 |

### 1.3 Worker 侧模块结构

```
index.ts（路由编排，无状态）
 ├─ auth.ts        会话（HttpOnly cookie）
 ├─ repository.ts  D1 读写 + R2 素材 + 向 DO 转发的三个封装
 │                  （callRoom / initializeRoom / forwardRoomWebSocket）
 ├─ room.ts        DO：协议 + 持久化 + 广播（单写者）
 │    └─ domain.ts 纯函数：authorizeOperation / applyOperation / projectRoomState
 └─ online-compendium*.ts  在线资料代理（独立限流 DO）
```

信任链：Cookie → `requireRoomAccess`（D1 五表 JOIN）→ `internalRoomHeaders`（7 个 x-dnd-* 头）→ DO 只信内部请求（`x-dnd-internal-request`）→ op 级 `authorizeOperation`（浏览器永不能自报身份/角色）→ `projectRoomState`（DM 全量 / 玩家脱敏投影）。

### 1.4 存储所有权

| 存储 | 写者 | 内容 | 特点 |
|---|---|---|---|
| DO SQLite | 仅 DO（经 authorize） | 全部战役+场景+雾+聊天，**单 JSON 行** | 单写者串行；revision 单调；幂等回执 |
| D1 | 仅 Worker HTTP 路由 | 身份/房间/存档/角色/日志/邀请/素材元数据 | 低频控制面 |
| R2 | 仅 Worker（校验后） | 地图/头像(房间私有)、资料库(公共) | 经鉴权 URL 访问 |

## 第二部分：数据流通链路

### 2.0 写路径总表（先查这张表）

| 数据 | 入口 | 通道 | 存储 | 通知方式 |
|---|---|---|---|---|
| token 移动/增删/HP | BoardCanvas、EnemyList | WS op | DO | patch 增量 |
| 雾/墙/网格/地图校准 | BoardCanvas | WS op | DO | patch |
| 先攻 DM 操作 | InitiativePanel | WS op | DO | patch；submit/addTo 落**快照** |
| 玩家先攻申报 | InitiativePanel | WS op（服务端绑定身份） | DO | 快照 |
| 聊天/骰子 | ChatPanel | WS chat | DO（内存，上限 500） | **全量 state** |
| 场景切换/改名/解锁 | SceneSwitcher、QueryPanel | WS control | DO | 全量 state |
| 场景 CRUD | QueryPanel、SceneSwitcher | HTTP（转 DO） | DO | 全量 state |
| 战役存档创建/切换 | CampaignPortal、CampaignSwitcher | HTTP | **D1 → 再转发 DO** | 全量 + 玩家整页 reload |
| 角色选择 | CampaignPortal 等 | HTTP | D1（select 再转 DO 换 token） | DO 广播 |
| 角色卡资料/日志/邀请 | 各面板、TopBar | HTTP | D1 | 无推送，靠拉取 |
| 地图/头像上传 | TopBar、EnemyList | HTTP multipart | R2 + D1 | 经后续 op 引用 |

同类功能通道不对称：聊天走 WS、日志走 HTTP；场景 CRUD 走 HTTP、场景切换走 WS control。

### 2.1 链路 A：棋盘 op（最高频）

```
① BoardCanvas 拖拽结束（仅 dragEnd 发送；擦雾有节流批处理）
② connection.sendOps：op 入 pending，本地 optimistic reducer 立即出画面
③ WS {type:'op', id, ops}（命令 UUID，断线可幂等重试）
④ DO authorizeOperation：schema/范围/权限归一 —— 注意 token id 服务端重发
⑤ mutate()：幂等回执检查 → 整状态克隆 → 事务写三表
   （room_state 整 JSON + room_events + command_receipts）
⑥ ack{commandId, revision} → 发起端按 revision 丢弃 pending
⑦ broadcastOperations：声明过 capabilities 的收 patch（须严格 revision+1，
   否则 resync 全量），其余收全量 state
```

四个语义耦合点：
- **双 reducer**：④ 的 `domain.applyOperation` 与 ②⑦ 的 `optimistic.applyOperation` 必须行为等价，漂移即 resync 风暴（表象是"卡"）；
- **token 身份翻转**：④ 重发 id，乐观层自造 id 在 ack 后被替换，按 id 记忆选中的逻辑会闪断；
- **patch 非保证**：switchCampaign/submit/addToInitiative/带编号 addToken 自动降级全量；
- **写放大**：⑤ 每次操作重写整个世界 JSON（含所有战役所有场景和雾）。

### 2.2 链路 B：聊天与控制消息

`chat` / `switchScene` / `renameScene` / `updateSceneUnlock` / 场景 CRUD / provision → 一律 `broadcastState()`：**每 socket 一次整状态克隆 + 角色投影 + 序列化**。聊天这类低价值高频消息与全量快照同档，是与状态体积相乘的放大器（见 3.4-R1）。

### 2.3 链路 C：HTTP → D1 → DO 两阶段（一致性裂缝）

| 操作 | D1 先写 | DO 后写 | 失败后果 |
|---|---|---|---|
| 切换战役 | rooms.campaign_id + last_played_at | /campaigns/select | 两边指向不同战役；bootstrap 只投影 DO，**永不 reconciliation** |
| 选角 | room_character_selections | /characters/provision | D1 与棋盘 token 短暂不一致，重连自愈 |
| 建房间 | 9 行 batch | /initialize | DO 未初始化 → connect 503，可重试自愈 |

玩家侧连锁：切战役 → DO 广播新 campaign → 玩家 Table 的 ref 检测 id 变化 → `location.reload()` → bootstrap → 传送门选角。"切战役"动用 D1 + DO + 整页刷新三层，是全项目最长更新链。

### 2.4 链路 D：素材上传三段流

```
① URL.createObjectURL 本地预览（previewOps，blob 不出浏览器）
② uploadImage → Worker 校验(格式/大小/签名) → R2 put → D1 元数据（失败补偿删 R2）
③ sendOps(updateMap{R2 URL}) → 清 preview → 发持久 op（校验器强制 /api/rooms/ 前缀）
```

竞态防护：`mapUploadGeneration` 计数器；残余风险：无孤儿清扫。

### 2.5 链路 E：进房（冷启动路径）

`/api/me` → bootstrap（D1 五表 JOIN）→ DO `/bootstrap`（冷启动 + 整态加载 + 按 viewer 克隆投影）→ 前端门控 → WS connect（首包全量 state）。休眠房唤醒首进明显偏慢。

## 第三部分：耦合位置

### 3.1 契约层（全局耦合根）

`shared/types.ts` 是前后端唯一共享模块：25 个 Op 变体 + 数据结构 + `fogGridSize()`（双端共用算法，全项目最好的共享实践——该逻辑不可能两端漂移）。**Op 协议是"三写"的**：同一个 reducer 语义在 `domain.applyOperation`、`optimistic.applyOperation`、`room.projectPatchOperations` 各实现一遍。

### 3.2 修改影响矩阵（判断耦合的实用工具）

| 改什么 | 必须动的文件 | 处数 |
|---|---|---|
| 加一个棋盘操作 | shared/types.ts、domain.ts（authorize+apply）、room.ts（projectPatch）、optimistic.ts | 4 文件 5 switch |
| 加 HTTP 端点 | client/api.ts、worker/index.ts、repository.ts | 3 |
| 加 WS 控制消息 | client/ws.ts、worker/room.ts | 2 |
| 改 Scene 字段 | shared/types、domain 校验、optimistic、BoardCanvas/TokenShape + DO 存量 JSON 兼容 | 5+ |
| 改权限 | repository + domain + 前端 role 分支 | 3 端 |
| 改素材路由 | domain.ts 的 mapUrl 白名单（`/api/rooms/` 前缀）+ repository 素材路由 + R2 key 规则 | 焊死在 op 校验里 |

### 3.3 组件级耦合热点

| 位置 | 现状 | 评价 |
|---|---|---|
| QueryPanel | api + ws + pending 三层全碰，嵌三子面板 | 最宽叶子；但均为读订阅+发命令，无状态泄漏 |
| TopBar | 邀请/上传/切换器宿主/消息/离开 五职责 + 5 子组件 | 组件级高耦合点 |
| Table 状态提升 | selectedId/tool/pending/brushSize | Board↔Initiative 解耦的正确做法 |
| pending 总线 | 有意避免 props 穿透 | 好设计（注释明示） |
| connection / currentRoomSlug | 模块级单例 + 可变状态 | import 图不可见的隐式耦合 |
| server/ 遗留目录 | 平行契约（自己的 types），与 shared 无关 | 死代码，不在系统内 |

### 3.4 数据层风险位置（延迟/卡死对照）

| # | 风险 | 机制 | 触发条件 |
|---|---|---|---|
| R1 | **雾数组无上限膨胀** | 格数 =(图宽×scale÷50)×(图高×scale÷50)；6000×4500 图 @800% ≈ 69 万格 ≈ 4MB JSON；随 state 全量广播 × 每 socket 克隆 × 主线程 parse | 大地图 + 高校准缩放（上限刚提到 800%） |
| R2 | 全量广播档位 | 聊天/控制消息每条触发全量快照 | R1 × 在线人数 |
| R3 | resync→限流→断连正反馈 | patch 断档→resync 计入 180/min 预算→耗尽 4008 踢→重连首包又是全量 | 弱网/慢设备 × R1 |
| R4 | 收藏 404 重取风暴 | effect 依赖 scene.favorites 身份；entry 404 不进缓存 → 每条 state 消息重发缺失请求 | 收藏在线资料条目（本地 R2 无） |
| R5 | D1→DO 两阶段无对账 | 见 2.3 | 切换类操作失败 |
| R6 | 素材 no-store 无变体 | 10MB 地图每次进房重下；asset_variants 表闲置 | 大地图 × 弱网 |
| R7 | 跨境 WS 底色 | 国内 → CF edge（无中国网络）RTT 150-300ms 不稳，喂给 R1-R3 | 国内用户 |

已做对的部分：拖拽仅 dragEnd 发送、擦雾节流批处理、乐观层结构共享（改名字不拷雾）、幂等回执、指数退避、邀请兑换竞态补偿、上传 generation 防竞态。

### 3.5 与重构计划的衔接

| 本文档位置 | 对应 campaign-centric-redesign.md |
|---|---|
| 3.4-R1 写放大 / 2.1 双 reducer | Phase 3「DO 存储去 JSON 化、按场景分表、雾独立」 |
| 2.3 切战役两阶段 | Phase 3「switchCampaign/selectCampaign 两阶段随之消失」 |
| 3.4-R2 广播档位 | 建议新增 Phase 3 子项：聊天/控制消息改增量广播 |
| 3.4-R4 | 独立小修：负缓存 + TTL |
| 3.4-R6 | 独立项：签名 URL + 边缘缓存 + 启用变体表 |
