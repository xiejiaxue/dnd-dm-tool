# 跑团战役资料库设计（Campaign + 敌人库）

- 日期：2026-08-05
- 状态：已确认设计，待实现
- 项目位置：`/Users/xiejiaxue/Documents/DnD-DMTool`

## 1. 背景与目标

当前工具只有「场景」层级（`data/scenes/<id>.json`，每个场景自带 token/墙/网格/收藏夹）。用户要跑几套不同的跑团项目，需要一个「战役（跑团项目）」顶层容器：

- 每个战役包含**多个场景** + **一套战役级共享敌人资料库**
- 敌人库中的敌人可**跨场景重复调用**（一键生成 token / 拿起后指定位置）
- 现有场景**自动归入「默认战役」**，不丢数据

经需求澄清确认的边界（YAGNI）：
- 资料库**只存敌人模板 + 场景**；暂不做预置遭遇 / NPC 档案 / 法术装备收藏
- 敌人模板**仅从查询面板搜索时加入**，不做手动添加、不做从场景 token 入库
- 敌人模板只存身份信息（entryId + 中文名），怪物详情/头像按需从 5e 库与 `/api/token/:entryId` 获取

## 2. 架构选型

采用**方案 A：战役层叠加在现有 SceneStore 之上**。

- 场景仍独立存 `data/scenes/`，现有场景逻辑（REST/WS/BoardCanvas）完全不动
- 新增战役存储 `data/campaigns/`，一个文件一个战役（含元数据 + 敌人库）
- 职责清晰、迁移量小、可按战役整包导出

## 3. 数据模型

```ts
// shared/types.ts 新增
export interface EnemyTemplate {
  entryId: string;   // 如 'MM__Goblin'
  nameZh: string;    // 如 '地精'
}

export interface Campaign {
  id: string;
  name: string;
  sceneIds: string[];        // 战役内的场景 id，一个场景只属于一个战役
  enemies: EnemyTemplate[];  // 按 entryId 去重，保持加入顺序
}
```

- 敌人头像 URL 由 entryId 推导：`/api/token/<entryId>`，不入库
- `sceneIds` 为空则战役无场景

## 4. 存储与迁移

目录布局：
```
data/
├─ campaigns/
│  ├─ index.json          战役列表 [{id, name}]
│  └─ <id>.json           战役详情 {id, name, sceneIds, enemies}
└─ scenes/                保持不变
```

- 新增 `CampaignStore(dir)`（模式照抄 `SceneStore`）：
  - `list(): Promise<{id,name}[]>`（扫目录或读 index.json）
  - `create(name): Promise<Campaign>`
  - `get(id): Promise<Campaign>`（不存在抛 `CampaignNotFoundError`）
  - `save(campaign): void`
  - `delete(id): Promise<void>`
- **迁移**：`GameServer.init()` 时若无任何战役（`campaigns` 目录空）→ 自动创建「默认战役」，把 `SceneStore.list()` 的全部场景 id 收录，并将当前场景（last-scene 或首个场景）绑定为该战役的当前场景。

## 5. 后端接口

### 5.1 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/campaigns` | 战役列表 |
| POST | `/api/campaigns {name}` | 新建战役 |
| GET | `/api/campaigns/:id` | 战役详情（含敌人库） |
| DELETE | `/api/campaigns/:id` | 删除战役（不删场景文件） |
| POST | `/api/campaigns/:id/scenes` | 把场景加入战役（`{sceneId}`），从原战役移除 |

- 错误：战役/场景不存在 → 404

### 5.2 WebSocket ops（服务器权威）

新增 op（`shared/types.ts` 的 `Op` union）：
```ts
| { op: 'addEnemy'; entryId: string; nameZh: string }        // 加入当前战役库（去重）
| { op: 'removeEnemy'; entryId: string }                     // 移出当前战役库
| { op: 'switchCampaign'; campaignId: string }               // DM：切换战役
```

- `canOp`：上述三者 DM 专属（玩家不可）
- `applyOp`：
  - `addEnemy`：向 `currentCampaign` 的 `enemies` push（若 entryId 已存在则忽略），去重
  - `removeEnemy`：filter 掉该 entryId
  - `switchCampaign`：需持有 `CampaignStore` 与当前场景引用——由 `GameServer` 在 op 到达前特殊处理（不走 applyOp），切换后广播 `{type:'state'}`（含 `campaign` + 该战役首个场景）
- `GameServer`：
  - 新增 `currentCampaign: Campaign`、`campaignStore`
  - `init()`：迁移逻辑 + 载入默认战役
  - `handle` 增加 `switchCampaign` 分支（DM 校验同 `switchScene`）
  - 每次 `applyOp` 后同时 `campaignStore.save(currentCampaign)`（若 op 触及战役）
  - `state` 消息携带 `campaign: Campaign`，便于客户端渲染战役库与场景列表
- 现有场景 op、`switchScene` 不变；`switchScene` 需校验目标场景属于当前战役（或允许任意，见 §7 边界）

## 6. 前端

### 6.1 战役切换（TopBar）

- TopBar 增加「战役」下拉/按钮（类似场景切换器）：列出战役、新建、删除（DM）
- 切换战役 → `connection.sendControl({type:'switchCampaign', campaignId})` → 收到新 `state` 后加载该战役首个场景
- 显示当前战役名

### 6.2 场景切换器过滤

- `SceneSwitcher` 只显示 `campaign.sceneIds` 对应的场景
- 新建场景时自动加入当前战役的 `sceneIds`（走 `POST /api/campaigns/:id/scenes` 或新 op）

### 6.3 战役库（查询面板新标签「战役库」）

查询面板标签：`查询 | 战役库 | 收藏夹`（战役库替代或补充现有收藏夹；本设计中战役库为新标签，收藏夹保留）

战役库内容：
- **敌人**：列表项 = 头像（`/api/token/<entryId>`）+ 名字
  - **＋ 一键放入当前场景**：在当前场景中心网格平铺生成 1 个 token（自动编号、头像、复用现有 `addToken` 逻辑）
  - **✋ 拿起**：`setPending(...)` → 工具切「放置」→ 点画布指定位置（复用现有流程）
  - **✕**：移出战役库（`removeEnemy`）
- **场景**：当前战役的 `sceneIds` 场景列表，点击切换

### 6.4 加入战役库（查询结果）

- 查询怪物结果行加「**加入战役库**」按钮（DM）→ `addEnemy { entryId, nameZh }`
- 若已在库中，按钮显示「已在库」或隐藏

### 6.5 数据流

- `useScene` 返回的 `SceneState` 增加 `campaign: Campaign | null`
- 敌人库增删/切战役通过 WS 广播，客户端实时更新

## 7. 边界与错误处理

- 战役不存在 → 404 / `error` 消息
- `switchCampaign` 到不存在战役 → `error: campaign load failed`
- 删除战役 → 不删除场景文件（仅解绑）；被删除战役的场景回到未归属状态，可由下次迁移或手动分配
- `switchScene` 允许场景不属于当前战役（提示但仍切换），还是严格限制？——**实现时取严格限制**：仅当前战役内场景可切换，保证一致性
- 跨战役引用：REST `POST /campaigns/:id/scenes` 会把场景从原战役 `sceneIds` 移除再加入新战役

## 8. 测试

### 8.1 单元测试

- `CampaignStore` CRUD + round-trip（照抄 SceneStore 测试模式）
- 迁移：空战役 → 自动建默认战役并收录全部场景
- `applyOp`：
  - `addEnemy` 去重（同 entryId 只留一条）、保留顺序
  - `removeEnemy`
  - `canOp`：DM 可、玩家不可
- `switchCampaign` 逻辑（GameServer）

### 8.2 集成测试（ws 双端）

- DM `addEnemy` → 玩家端收到含新敌人的 `state`
- DM `switchCampaign` → 两端收到新战役 + 新场景
- 玩家尝试 `addEnemy`/`switchCampaign` → 拒绝（`error`）

## 9. 明确不做的（本版本）

- 预置遭遇 / 敌人小组
- NPC 档案
- 法术/装备收藏的战役化（现有收藏夹保持场景级）
- 从场景 token 入库、手动添加敌人
- 战役内场景排序/拖拽
- 战役导入导出（数据结构已便于整包复制）
