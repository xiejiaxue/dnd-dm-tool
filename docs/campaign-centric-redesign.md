# 战役中心化改造计划书

> 状态：已评审的设计方案，暂未实施（2026-10 讨论定稿）。
> 范围：Cloudflare Worker 实现（`worker/src`）；本地 `server/` 为遗留实现，不在改造范围内。

## 一、背景：现状梳理结论

当前模型是三层：workspace（桌团）→ room（房间）→ campaign（战役存档），模组（campaign_modules）挂在 workspace 下。经代码走查确认：

- **房间是准入闸门**：访问控制走 `room_members`（`worker/src/repository.ts` `requireRoomAccess`）；邀请 `scope_type='room'`，兑换只写 room_members，不写任何战役数据。
- **战役才是数据重心**：角色（campaign_characters.campaign_id）、日志（campaign_journals）、聊天（DO 内按 campaignId 过滤）、遭遇库（campaign.enemies）、场景（campaign.sceneIds）全部按战役分割。
- **`campaign_members` 表已存在但闲置**：D1 里有完整设计（角色 owner/dm/assistant_dm/player/spectator、状态机含 removed、permission_epoch 撤销机制，见 `worker/migrations/0001_control_plane.sql:105`），代码只在建房/建存档时给主持人写一行 owner，从未作为闸门使用。
- **模版是占位符**：`campaign_modules.template_json` 只含 `{"firstSceneName":"起始场景"}`，唯一消费点是建存档时给首场景命名（`repository.ts` `moduleFirstScene`）。没有模组 CRUD。
- **D1 `scenes` 表完全未使用**：预留的"场景模版/发布"模型，见 `docs/cloudflare-architecture.md` 的说明。

### 实际使用形态与模型的错位

真实用法是：**同一个模组，不同组玩家各开一局**。但现状：

1. `createRoom` 每次新建一个 workspace，模组库被锁死在单房间内——"同模组多组"在 API 层面做不到；
2. 一个房间 DO 只有一个 `currentCampaignId` 指针，同时只能跑一个战役——多组并行必须开多房间，导致 room ≈ campaign 事实成立，room_campaigns M:N 与传送门沦为摆设；
3. 切存档会把全房间玩家拖着走（整页刷新 + 重新选角）。

## 二、问题清单（改造动机）

### 交互层

| # | 问题 | 位置 |
|---|------|------|
| I1 | 首开两屏三步：建房 → 传送门 → 再命名 + 1 选 1 的模组假下拉 | `client/src/components/CampaignPortal.tsx` |
| I2 | 建房时系统暗中创建的战役（configured:false）永久隐藏且无人翻转，成为孤儿；用户被迫再建第二个 | `repository.ts:187` createRoom |
| I3 | 两次命名仪式，第二次毫无上下文；后端 createRoom 已预留 campaignName 参数但前端不传 | `worker/src/index.ts:135` |
| I4 | 玩家"等待 DM 选择战役存档"为静态屏，无轮询/推送，DM 选完玩家需手动刷新 | CampaignPortal |
| I5 | CampaignPortal（局前）与 CampaignSwitcher（局内）两套 UI 干"切存档"一件事 | client/src/components/ |
| I6 | 邀请语义是"进房间"而非"进战役"，与用户的玩伴边界不符 | `repository.ts:498` createRoomInvite |

### 结构层

| # | 问题 | 位置 |
|---|------|------|
| S1 | 准入闸门在 room_members，而所有玩法数据按战役分割——唯一错位的层 | `repository.ts:107` |
| S2 | `selectCampaignSave` 先提交 D1 再调 DO，失败时两边指向不同战役，/bootstrap 不对账 | `repository.ts:319` |
| S3 | assign-scene 报"房间固定绑定一个战役"409，与多存档设计自相矛盾 | `worker/src/room.ts:328` |
| S4 | 战役无删除/归档路径；客户端 `api.deleteCampaign` 在 Worker 无对应路由（404） | `client/src/api.ts:179` |
| S5 | DO 每次 mutate 整个世界 JSON 克隆 + 重写（O(全世界) 写放大） | `room.ts:411` mutate |
| S6 | disconnect-member 只断线不移除成员、不提升 access epoch，刷新即重连 | `room.ts:392` |
| S7 | 素材 R2 key 嵌 roomId、按房间路由，但元数据按战役过滤 | `repository.ts:587` |

## 三、目标模型

```
用户 / 桌团（DM 的库：模组、历史战役）      ← 模组库上移，不再每次建房新建 workspace
 └─ 战役（唯一用户可见单位）
     ├─ 名册 campaign_members（现成的表，含 permission_epoch）
     ├─ 角色 / 日志 / 聊天 / 遭遇库（本来就挂在战役上，不动）
     ├─ 素材（R2 key 与路由改按战役）
     └─ 实时棋盘 = Durable Object，键从 room:<roomId> 改为 campaign:<campaignId>
```

**房间作为用户概念取消**——创建战役即开桌；URL 从 `/r/:slug` 变为 `/c/:slug`；UI 文案仍可称"房间"，但数据层只有战役一个实体。房间遗留职责的归属：

- URL / 邀请链接表面 → 战役
- WebSocket / 棋盘 DO → 按战役分键（DO 内状态简化为单战役 + 场景）
- 会话角色 host/dm/assistant_dm/spectator → 留在战役成员角色（campaign_members.role 已覆盖）
- 大厅列表 → 列战役而非房间

### 目标交互流

- **DM 首开**：大厅「我的桌团」→ 新战役 →（模组 >1 时才出现选模组步）→ 起名（默认模组名）→ 直达棋盘。
- **邀请**：战役内生成链接，兑换幂等写 campaign_members(player)；玩家落地即选角（老玩家点旧角色，新玩家名字/颜色/HP），无等待屏。
- **回归**：DM 大厅点「继续」→ bootstrap 恢复棋盘；玩家从链接或"我参加的战役"直接进，自动用上次角色。
- **同模组第二组**：回大厅再开一局选同一模组，名册/角色/棋盘天然隔离。
- **同批人下一季**（原 room_campaigns 的设计初衷）：以"从上季复制名册"按钮覆盖，UI 便利而非模型特性。

## 四、实施计划（按成本递增三阶段）

### Phase 1：交互层 + 模组库上移（便宜，行为兼容）

1. workspace 改挂用户：createRoom 不再新建 workspace；DM 的库（模组、战役）跟随用户。模组复用即刻成立。
2. 创建入口合并为「新战役」：`POST /api/campaigns {name, moduleId}` 一步建战役 + owner 成员 + slug + DO 初始化；只有一个模组时前端跳过选择、名字默认模组名。
3. 删除 CampaignPortal 的 DM 侧表单与玩家等待屏；玩家落地页只剩选角。

### Phase 2：闸门迁移（中）

1. `requireRoomAccess` 的 JOIN 从 room_members 换成 campaign_members（按当前战役 + permission_epoch 校验）。
2. 邀请表加战役维度：`scope_type='campaign'`；兑换写 campaign_members；player/spectator 仍是仅有的可邀角色。
3. 移除成员落地：campaign_members.status='removed' + permission_epoch + 1，DO 侧按 epoch 断开旧连接（表已备好，补上 DO 检查即可，顺带修 S6）。
4. `room_character_selections` 的 room 维度收敛为战役级选角。
5. 补战役归档/删除（软删，顺带修 S4）。

### Phase 3：DO 改键 + 存储规范化（贵，性能收益所在）

1. DO 命名空间 `room:<roomId>` → `campaign:<campaignId>`；`PersistedRoomState` 简化为单战役 + 场景集合；switchCampaign / assign-scene / selectCampaign 两阶段提交随之消失（S2、S3 不是修复而是取消）。
2. DO 存储去 JSON 化：`room_state` 单行拆为 campaigns 行 + scenes 行 + messages 追加行（events/receipts 已是行式）；token 移动只重写单场景行，雾战格可再单独成列——把 O(全世界) 写放大降为 O(单场景)（修 S5）。
3. 素材 key 与路由改按战役（修 S7）。
4. URL 迁移 `/r/:slug` → `/c/:slug`（旧链接 308 到新地址）。
5. 存量 DO 状态拆分脚本（若已有生产数据；**趁无数据现在做成本为零**）。

### 并发与精简的收益账

- **分片**：N 个团并行 = N 个互不相遇的 DO 实例，零共享瓶颈；DO 休眠下闲置战役成本趋近零。单局内部保持单写者串行（正确性特性）。
- **写放大**：见 Phase 3 第 2 条。
- **不变式删除**：D1↔DO 指针对账、configured 孤儿战役、多存档 M:N、两套切档 UI——概念消失即 bug 消失。
- D1 继续只做低频控制面（鉴权、名册、邀请、日志），此职责划分保持不变。

## 五、风险与不做的事

- **不做的**：不合并 workspace 层（DM 的账号隔离仍有价值）；不为"固定团每周单次冒险"保留房间概念（用复制名册覆盖）；不动本地 `server/` 遗留实现。
- **风险**：D1 `scenes`/`scene_favorites` 预留表与"场景发布为模版"是另一条独立演进线，本计划不包含，但 Phase 1 的模组库上移是它的前置。
- **时序**：三阶段可独立验证、独立上线；Phase 3 越晚做迁移成本越高（存量 DO 状态与素材 key 会累积）。

## 六、涉及文件速查

| 模块 | 文件 |
|---|---|
| D1 闸门 / 邀请 / 存档 | worker/src/repository.ts |
| HTTP 路由编排 | worker/src/index.ts |
| DO 房间状态机 | worker/src/room.ts |
| 域模型 / 操作授权 | worker/src/domain.ts |
| 迁移脚本 | worker/migrations/0001-0003 |
| 客户端传送门 / 切档 | client/src/components/CampaignPortal.tsx、CampaignSwitcher.tsx |
| 客户端 API 面 | client/src/api.ts |
| 入口门控 | client/src/App.tsx:51-95 |
