# DM 追踪界面设计文档（D&D 5e）

- 日期：2026-08-04
- 状态：已确认设计，待实现
- 项目位置：`/Users/xiejiaxue/Documents/DnD-DMTool`
- 使用形态：局域网多人（DM 编辑 + 玩家可拖 token）

## 1. 项目概述

一个面向 D&D 5e 跑团主持（DM）的追踪界面，浏览器运行，类似 Foundry VTT（FVTT）的简化版。
DM 在一台电脑上运行服务，DM 本人和玩家通过浏览器连接：DM 拥有完整编辑权限，玩家可查看棋盘并拖动 token。

## 2. 需求

### 2.1 功能需求
1. **棋盘**：上传地图图片作底图，在其上定义网格和可玩区域边界；网格可开关/调大小/调颜色/调偏移。
2. **场景存储**：多场景的创建、保存、切换、重命名、删除；每个操作自动保存，防断电丢数据。
3. **快速查询**：从 5e不全书（5etools 中文数据）查询怪物、法术、装备，中英文均支持模糊搜索；点选后展示完整详情。
4. **Token 放置**：可在棋盘放置怪物和玩家 token；怪物头像自动从网络下载并裁剪为圆形 token 后缓存。
5. **会话收藏夹**：DM 收藏常用怪物/法术/装备，快速拖入棋盘或查看。
6. **先攻顺序追踪**：顶部先攻栏。玩家可在自己浏览器输入先攻值提交；DM 端按数值自动排序计算行动顺序（DM 也可手动拖拽调整）；**当前回合行动者的棋盘 token 外圈金色脉冲高亮**，先攻栏同步高亮当前项。
7. **局域网多人**：DM 浏览器（localhost）为编辑模式；玩家浏览器（局域网 IP）可拖动 token、查看棋盘。

### 2.2 非功能需求
- 深色主题，DM 长时间使用友好。
- 局域网内多浏览器实时同步，低延迟。
- WebSocket 断线自动重连，并有提示横幅。
- 数据包缺失/图片下载失败时有兜底，不影响使用。

## 3. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React + Vite + Konva + Tailwind CSS | Konva 负责画布（地图/网格/墙/token 拖拽缩放） |
| 后端 | Node.js + Express + ws | Express 提供 REST/静态服务，ws 提供实时同步 |
| 搜索 | Fuse.js | 在后端对预建索引做模糊搜索 |
| 图像 | sharp | 圆形裁剪 token 头像 |
| 存储 | 本地文件系统 | `data/` 目录 |
| 测试 | Vitest | 单元 + 集成测试 |
| 数据 | 5etools 中文镜像 `tjliqy/5etools-cn`（cn2.0 分支，CC BY-NC-SA 4.0） | 含 5e不全书 中文翻译的怪物/法术/装备 JSON |

## 4. 架构

```
┌────────────────────────────────────────────────────────┐
│  DM 浏览器 (React + Konva)        玩家浏览器 (只读+拖token) │
│  ┌──────────────┐  ┌──────────┐    ┌──────────────┐     │
│  │ 查询面板       │  │ 棋盘画布  │    │ 棋盘画布      │     │
│  │ 收藏夹/先攻    │  │ token/墙 │    │ token/墙      │     │
│  └──────┬───────┘  └────┬─────┘    └──────────────┘     │
└─────────┼───────────────┼───────────────────────────────┘
          │  HTTP (REST)  │  WebSocket (状态同步)
┌─────────┴───────────────┴───────────────────────────────┐
│  Node.js 后端                                            │
│  ├─ Express: /api/search /api/entry /api/token           │
│  │           /api/scenes /api/upload                    │
│  ├─ ws: 实时同步（服务器权威，DM 权限校验）                    │
│  ├─ 5etools 中文数据（内存 LRU 懒加载 + 预建搜索索引）          │
│  └─ token 图片下载/圆形裁剪/缓存                            │
└────────────────────────────────────────────────────────┘
        │ 本地文件存储
┌───────┴──────────────────────────┐
│  data/                            │
│  ├─ scenes/      场景存档          │
│  ├─ images/tokens/   token 缓存    │
│  ├─ images/uploads/  上传地图       │
│  └─ db/5etools-cn/   离线数据包     │
└──────────────────────────────────┘
```

### 4.1 前端组件
- `BoardCanvas` — Konva 画布：地图图片、网格、墙、token；当前回合行动者的 token 外圈渲染金色脉冲高亮环。
- `QueryPanel` — 查询面板（怪物/法术/装备），含 `DetailDrawer` 详情覆盖层。
- `FavoritesBar` — 会话收藏夹。
- `InitiativePanel` — 顶部先攻栏。
- `Toolbar` — 左侧窄工具竖栏（选择/放置/画墙/网格/地图/缩放）。
- `TopBar` — 顶部状态栏（场景切换、玩家在线数、口令）。

### 4.2 后端职责
- REST：搜索、详情、token 图片、场景管理、图片上传。
- WebSocket：棋盘状态同步（服务器权威）。
- 数据：预建搜索索引 + 内存 LRU 懒加载完整条目。
- 图片：下载怪物肖像 → sharp 圆形裁剪 → 本地缓存。

## 5. 数据管线

### 5.1 离线数据打包
启动时执行 `npm run data:update` 脚本，从 `tjliqy/5etools-cn`（cn2.0 分支）下载：
- `data/bestiary/*.json` — 怪物（按来源书分文件，如 `bestiary-mm.json`）
- `data/spells/*.json` — 法术
- `data/items.json`、`data/feats.json`、`data/conditionsdiseases.json` — 装备/专长/状态

预处理生成两个产物：
- `index.json` — 轻量搜索索引：`{id, 中文名, 英文名, 类型, CR/环位/等级, 来源, 页码}`，约 200KB。
- `entries/` — 完整数据文件（原始 5etools schema，含中文翻译），按需懒加载。

脚本可重跑更新数据（`npm run data:update`）。

### 5.2 查询
- `GET /api/search?q=&type=&limit=` — 后端 Fuse.js 模糊搜索索引，中英文均可匹配（如「地精」「goblin」）。
- `GET /api/entry/:type/:id` — 懒加载对应书文件（内存 LRU），返回完整统计块。
- 详情渲染：怪物（AC/HP/属性/动作/特性）、法术（环位/学派/施法时间/描述）。

### 5.3 Token 头像下载
- 5etools 提供肖像图，无现成 token：`https://5e.tools/img/bestiary/<来源>/<怪物名>.jpg`。
- 首次请求时后端下载肖像 → **sharp 中心裁剪成圆形 token** → 缓存到 `data/images/tokens/`。
- 客户端统一从 `GET /api/token/:monsterId` 取图，之后不再联网。
- **兜底**：无肖像图（约三成）或下载失败时，自动生成「首字母 + 随机背景色」圆形占位 token；DM 可手动上传本地图片或贴 URL 覆盖。
- 来源域名可配置（镜像挂掉可换源）。

### 5.4 数据规模
全部书 bestiary JSON 合计约 30MB+；搜索索引约 200KB；完整数据按需懒加载，不影响启动。

## 6. 场景模型与存储

### 6.1 场景模型（`scene.json`）
```json
{
  "id": "cave-dungeon",
  "name": "洞穴地牢",
  "mapImage": "uploads/cave.jpg",
  "mapSize": [2400, 1600],
  "grid": { "size": 100, "color": "#00000040", "offset": [0,0], "snap": true },
  "playArea": { "x":0, "y":0, "w":2400, "h":1600 },
  "tokens": [
    { "id":"t1", "name":"哥布林", "kind":"monster", "entryId":"goblin",
      "x":300, "y":400, "size":100, "avatar":"/api/token/goblin" }
  ],
  "players": [
    { "id":"p1", "name":"阿拉贡", "color":"#e53e3e", "avatar":null }
  ],
  "walls": [ { "id":"w1", "p1":[0,0], "p2":[500,0] } ],
  "initiative": [
    { "id":"i1", "tokenId":"t1", "name":"哥布林", "value":18, "source":"dm", "active":true },
    { "id":"i2", "sessionId":"s3", "tokenId":"p1", "name":"阿拉贡", "value":15, "source":"player", "active":false }
  ],
  "favorites": [ { "type":"monster", "entryId":"goblin" } ]
}
```

先攻条目字段说明：
- `source`：`dm`（DM 手动添加）或 `player`（玩家自己提交）。
- `sessionId`：玩家提交时的连接标识（可选，用于玩家重复提交时 upsert 同一条目，不产生重复）。
- `tokenId`：可选。关联棋盘 token 后，当前回合该 token 外圈高亮。玩家提交时可选择自己扮演的棋盘 player token。
- 服务器在每次提交/编辑后按 `value` 降序稳定排序（同分保持原顺序），DM 可拖拽覆盖顺序。

### 6.2 存储布局
```
data/
├─ scenes/          场景存档（JSON，每操作自动保存）
├─ images/tokens/   token 图片缓存（圆形裁剪后）
├─ images/uploads/  DM 上传的地图底图
└─ db/5etools-cn/   离线数据包 + 搜索索引
```

### 6.3 场景管理
- 启动默认打开「上次会话」场景。
- 顶部切换器：新建/打开/重命名/删除场景。
- 每个操作自动保存（服务器对 in-memory 场景应用 op 后 debounce 写盘）。

## 7. 界面布局

```
┌─────────────────────────────────────────────────────────────────────┐
│ 顶部状态栏:  ⚙ 场景「洞穴地牢」 [切换场景▾]  玩家在线:●2  口令:1234   │
├─────────────────────────────────────────────────────────────────────┤
│ 先攻栏（横向，可滚动）:   ▶ 哥布林A  哥布林B   ▷ 阿拉贡  ＋   排序  ⏭下一回合│
├───────┬─────────────────────────────────────────────┬───────────────┤
│ 工具竖栏│                                             │  查询窗口(可收起)│
│ [选择] │                                             │  ┌───────────┐ │
│ [放置] │             棋 盘 画 布  (Konva)              │  │ 🔍 搜索...  │ │
│ [画墙] │                                             │  └───────────┘ │
│ [网格] │        地图底图 + 网格 + 墙 + token             │  [查询] [收藏夹] │
│ [地图] │                                             │  ┌───────────┐ │
│ [缩放] │                                             │  │哥布林  CR¼ │ │
│       │                                             │  │火球术  3环 │ │
├───────┴─────────────────────────────────────────────┴───────────────┤
│ 底部:  会话说明 / token 统计 / 连接提示                               │
└─────────────────────────────────────────────────────────────────────┘
```

设计约定（DM 决策之外由我确定的部分）：
- **深色主题**，红/琥珀色点缀。
- **工具竖栏**宽 48px，图标按钮，选中态高亮。
- **查询窗口**宽 320px，可折叠，标签：`查询 | 收藏夹`；点结果 → 详情覆盖在查询窗口上（带返回）。
- **先攻栏**固定顶部，横向滚动；当前行动者高亮；「下一回合」按钮推进行动者。
- **先攻提交（玩家端）**：玩家视图的底部/先攻栏附近有「我的先攻」输入框 + 提交按钮；提交后出现在 DM 先攻栏并按值排序。
- **Token 菜单**：选中后旁弹浮层（改名/大小/加入先攻/删除）。
- **玩家端**：同布局，工具竖栏仅「选择」「缩放」。

## 8. 权限与同步

### 8.1 角色与权限
| 能力 | DM | 玩家 |
|---|---|---|
| 拖动/移动 token | ✅ | ✅ |
| 查看棋盘 | ✅ | ✅ |
| 放置/删除 token | ✅ | ❌ |
| 画墙/网格/上传地图 | ✅ | ❌ |
| 保存/加载场景 | ✅ | ❌ |
| 先攻：编辑/排序/下一回合 | ✅ | 仅提交自己的先攻值 |
| 查询/收藏夹 | ✅ | ✅ |

- 身份识别：`localhost` 连接 = DM；局域网 IP 连接 = 玩家。
- 口令：DM 可在设置中设置口令；玩家输入口令可升级为 DM 权限（方便 DM 用平板当第二块屏）。

### 8.2 WebSocket 协议
- 客户端 → 服务器：
  - `{type:'init', sceneId, role}` — 加入场景。
  - `{type:'op', ops:[...]}` — 操作批量提交。
- 服务器 → 客户端：
  - `{type:'state', scene}` — 初始完整场景。
  - `{type:'op', ops:[...]}` — 应用后的操作广播。
  - `{type:'meta', online:n}` — 在线人数。
  - `{type:'error', message}`。
- 操作类型（op）：`moveToken / addToken / removeToken / updateToken / addPlayer / updatePlayer / addWall / removeWall / updateGrid / updateMap / submitInitiative / addToInitiative / removeFromInitiative / advanceTurn / reorderInitiative`。
- 服务器按角色校验 op 权限；`moveToken` 与 `submitInitiative`（提交自己的先攻）所有角色允许，其余 DM 专属。
- `submitInitiative`：按 `sessionId` upsert 玩家自己的先攻条目，服务器立即按 `value` 降序排序并广播。
- `advanceTurn`：推进当前行动者到下一位，广播后各端将对应 token 外圈高亮。
- token 拖动：本地实时渲染，**拖动结束时广播一次**（避免刷屏）；服务器应用并广播，**last-write-wins**。
- 持久化：服务器应用每个 op 到 in-memory scene 后 debounce 写盘。

## 9. REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/scenes` | 场景列表 |
| POST | `/api/scenes` | 新建场景 |
| GET | `/api/scenes/:id` | 获取场景 |
| DELETE | `/api/scenes/:id` | 删除场景 |
| GET | `/api/search?q=&type=&limit=` | 搜索索引（怪物/法术/装备） |
| GET | `/api/entry/:type/:id` | 完整条目详情 |
| GET | `/api/token/:monsterId` | 圆形 token 图片（首次下载+裁剪+缓存） |
| POST | `/api/upload/map` | 上传地图底图 |
| POST | `/api/upload/token` | 上传自定义 token 图 |
| GET | `/api/meta` | 服务信息（数据状态、版本） |
| POST | `/api/verify-password` | 口令验证 → DM 权限升级 |

## 10. 错误处理

- 图片下载失败 / 无肖像图 → 占位 token（首字母 + 随机背景色），DM 可手动覆盖。
- 数据包缺失 → 启动时提示运行 `npm run data:update`。
- WebSocket 断线 → 前端自动重连 + 断线提示横幅；重连后拉取最新完整场景。
- 上传图片超限 / 格式不支持 → 明确错误提示。

## 11. 测试方案

### 11.1 单元测试（Vitest）
- 搜索索引构建与 Fuse.js 查询（中英文、模糊匹配）。
- token 圆形裁剪（sharp，输出尺寸/透明度）。
- 场景序列化/反序列化（round-trip）。
- 先攻列表排序逻辑（value 降序、active 标记、下一位计算）。
- `submitInitiative` upsert（同 sessionId 不重复、重提交覆盖）+ 排序；`advanceTurn` 推进与 token 高亮对应关系。
- op 应用逻辑（moveToken/addToken 等）与权限校验。

### 11.2 集成测试（Vitest + ws）
- 两个 ws 客户端：DM 端发送 op，玩家端收到广播后的状态。
- 权限校验：玩家发 DM 专属 op 被拒。
- 断线重连：客户端断开重连后收到最新完整场景。

### 11.3 手动验收清单（E2E）
- 两台设备（或一机两浏览器）局域网连接：DM 拖 token 玩家可见，玩家拖 token DM 可见。
- 上传地图 → 框选可玩区域 → 网格吸附放置 → 保存 → 刷新后场景还原。
- 查询「地精」「goblin」「火球术」均能搜到并展示详情。
- 放置哥布林 token → 头像自动下载并显示圆形图。
- 断网/重启服务器后自动重连。

## 12. 明确不做的（YAGNI / 后续版本）
- token 血量/状态追踪。
- 动态视线 / 迷雾（LOS/FOW）。
- 区域标注（zones）。
- 玩家身份认证体系（仅口令）。
- 公网部署、账号系统。
- 战斗遭遇生成器。
- 墙的移动拦截（明确为纯视觉标记）。
