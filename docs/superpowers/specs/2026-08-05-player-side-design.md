# 玩家端设计（玩家自维护 token + 先攻入队）

- 日期：2026-08-05
- 状态：已确认设计，待实现
- 项目位置：`/Users/xiejiaxue/Documents/DnD-DMTool`

## 1. 背景与目标

当前玩家端：可拖拽任意 token、可在先攻栏输入先攻值提交（`submitInitiative` + sessionId upsert）。但 `scene.players` 的 `PlayerToken` 模型**没有任何创建/认领 UI**，「我的角色」下拉恒为空；玩家能移动**任意** token（含怪物与他人 token）。

目标：玩家**首次连接自动获得自己的 token**（身份经 localStorage sessionId 持久），**只维护自己的 token**（拖拽/改名/改色/HP），手动输入先攻后加入全队先攻队列。采用**方案 A：服务器权威 + sessionId 权限过滤**。

经需求澄清确认的边界：
- 玩家 token **首次连接自动创建**（默认名「玩家N」+ 随机色），刷新后身份保留
- 玩家维护范围：**拖拽（仅自己的）+ 改名 + 改色 + HP**
- 先攻：**手动输入**（现有 `submitInitiative` 流程），自动选中自己的 token
- 玩家端左侧面板：**「我的角色」在上（优先）+「敌人」在下（可滚动）**；DM 端左侧仅敌人列表
- 权限收窄：玩家 `moveToken`/`updatePlayer` 仅允许作用于自己 sessionId 的 token

## 2. 数据模型

`PlayerToken` 已含 `sessionId`；HP 字段从 `Token` 继承（`hp?: { current; max }`），无需新增字段。

`updatePlayer` op 的 patch 扩展（对齐 `updateToken`）：
```ts
| { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp'>> }
```

## 3. 服务器（GameServer）

### 3.1 Client sessionId

- `Client` 增加 `sessionId: string`（默认空）。
- `init` 消息新增可选字段 `sessionId`；`Client.sessionId` 保存该值。

### 3.2 玩家 token 自动创建与跟随

- `ensurePlayerToken(scene: Scene, sessionId: string): boolean`：
  - 若 `scene.players` 已存在 `sessionId` 匹配的 token → 返回 false（无需改动）
  - 否则创建一个 `PlayerToken`：名字取该场景最小可用「玩家N」（N 从 1 递增，避开已有名），颜色从一组预设随机取，`sessionId` 绑定；push 进 `scene.players`；返回 true（需保存）
- **调用时机**：
  - `init`（玩家角色）：`ensurePlayerToken(this.current, client.sessionId)` 后，若有改动 `store.save(this.current)` 并广播
  - `switchScene` / `switchCampaign` 之后：为**所有已连接玩家**客户端对**新场景**补建 token（跟随场景），保存并广播
- 玩家 token 创建失败（保存异常）不致命，下次 op/切换重试

### 3.3 权限过滤（玩家仅操作自己的 token）

- `canOp` 保持角色级（DM 全部 / 玩家 `moveToken`+`submitInitiative`），纯函数不变
- 在 `applyAllowedOps` 的 sceneOps 应用前，对**玩家**客户端的 op 追加所有权过滤：
  - `moveToken`：目标 token 必须是 `scene.players` 中 `sessionId === client.sessionId` 的 token，否则拒绝
  - `updatePlayer`：目标 token 的 `sessionId === client.sessionId`，否则拒绝
  - 被拒绝的 op 不应用，客户端收到 `error`（权限）
- 说明：玩家仍可用 `submitInitiative`（服务器按 sessionId upsert，天然归属自己）

## 4. 客户端

### 4.1 ws.ts

- `Connection.connect()` 的 `init` 消息携带 `sessionId`：
  - 从 localStorage `player-session-id` 读取，无则 `crypto.randomUUID()` 生成并存
  - 复用现有 `submit` 中的 sessionId 逻辑，抽为单一来源

### 4.2 左侧面板（EnemyList）

- **玩家端**：面板顶部渲染「我的角色」区块（优先于敌人列表）：
  - 名字（内联改名 → `updatePlayer patch:{name}`）
  - 颜色（预设色板点击选择 → `patch:{color}`）
  - HP（`cur/max` 内联编辑 → `patch:{hp}`，复用怪物的编辑交互）
  - 拖拽提示文案
  - 自己的 token 识别：`scene.players.find(p => p.sessionId === mySessionId)`
  - 下方「敌人」列表（现有滚动区，`flex-1 min-h-0 overflow-y-auto`）
- **DM 端**：保持现有（仅敌人列表）
- 我的角色区块未找到自己的 token 时（异常态）显示占位与「自动创建中…」

### 4.3 先攻提交（InitiativePanel 玩家端）

- 移除「我的角色」下拉选择；改为**自动使用自己的 token**（`scene.players` 中匹配 sessionId）
- 保留先攻值输入 + 提交；`submitInitiative` 的 `tokenId` 填自己的 token id
- 未找到自己的 token 时禁用提交

### 4.4 棋盘拖拽门控（BoardCanvas）

- 与服务端权限一致：**玩家角色只允许拖自己的 token**（`scene.players` 中 `sessionId === mySessionId`），DM 可拖全部
- 玩家拖怪物/他人 token 时画布上也不可拖动（客户端门控，避免被服务端拒绝的卡顿感）

## 5. 权限与错误处理

- 玩家拖/改他人 token、拖怪物 → 服务器拒绝 + 客户端 `error`
- 玩家 token 创建失败 → 不致命
- 切场景/战役后玩家 token 自动出现在新场景（若新场景已存在同 sessionId 的 token 则复用）

## 6. 测试

### 6.1 单元测试

- `ensurePlayerToken`：无 token 则创建（名字「玩家N」递增、sessionId 绑定）；已有则复用不重复
- 权限过滤：玩家拖自己的 token 允许；拖怪物/他人 token 拒绝；改他人 token 拒绝
- `updatePlayer` patch 含 `hp` 的应用

### 6.2 集成测试（ws 双端）

- 玩家 init → 自动建 token（`scene.players` 含其 sessionId）
- 玩家拖自己的 token → 广播位置
- 玩家拖怪物 / 改他人 token → 被拒（`error`）
- 玩家提交先攻 → 入全队队列（tokenId 为自己的）
- 切场景后玩家 token 出现在新场景

## 7. 明确不做的（本版本）

- 玩家 token 头像（玩家无 5e 头像，保持彩色圆）
- 玩家删除自己的 token
- 玩家自动掷先攻（保持手动输入）
- DM 视角的玩家管理面板（DM 仍通过场景管理玩家 token）
