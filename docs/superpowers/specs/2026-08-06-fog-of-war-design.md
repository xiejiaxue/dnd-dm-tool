# 战争迷雾 + 玩家端 UI 设计

- 日期：2026-08-06
- 状态：已确认设计，待实现
- 项目位置：`/Users/xiejiaxue/Documents/DnD-DMTool`

## 1. 背景与目标

两个功能：
1. **战争迷雾**：地图默认被迷雾覆盖；DM 用「擦除」工具揭示格子（可选笔刷尺寸），DM 端迷雾为黄色半透明可透视，玩家端为不透明深色完全遮挡（地图+怪物）；一键擦除（全揭示）/ 一键覆盖（全遮挡）。
2. **玩家端 UI**：右侧查询面板保留；战役库 tab 只显示 DM 解锁的场景（隐藏怪物数据），点击弹只读预览；DM 在场景切换器里解锁/锁定场景。

## 2. 数据模型

`Scene` 新增字段：
```ts
// 迷雾格子数组：每格是否已揭示。索引 = row * cols + col，按 FOG_CELL 划分。
fog?: boolean[];
// DM 解锁标记：解锁后玩家可在战役库查看该场景。
unlocked?: boolean;
```

- **迷雾格子尺寸**：`FOG_CELL = 50`（px，比主网格 `grid.size` 100 更密，保证擦除灵活）。旧场景无 `fog` 字段时视为全遮挡（全 false）。
- 格子数：`cols = Math.ceil(playArea.w / FOG_CELL)`，`rows = Math.ceil(playArea.h / FOG_CELL)`。1600×1200 → 32×24 = 768 格。

## 3. 迷雾操作（DM 专属 op）

```ts
| { op: 'setFog'; cells: number[]; revealed: boolean }   // 批量设置格子揭示/隐藏
| { op: 'revealAllFog' }                                  // 一键擦除（全揭示）
| { op: 'coverAllFog' }                                   // 一键覆盖（全遮挡）
| { op: 'updateSceneUnlock'; sceneId: string; unlocked: boolean }  // 解锁/锁定场景
```

- `applyOp`（纯函数，作用在 scene）：
  - `setFog`：对每个 cell 索引，若在 `[0, fog.length)` 内则 `fog[cell] = revealed`（越界忽略）
  - `revealAllFog`：`fog.fill(true)`
  - `coverAllFog`：`fog.fill(false)`
  - `updateSceneUnlock`：改 `scene.unlocked`（注意：目标可能不是当前场景——见 §5）
- `canOp`：以上 DM 专属（`setFog`/`revealAllFog`/`coverAllFog`/`updateSceneUnlock` 不在 `isPlayerOp`）。
- 场景无 `fog` 字段时，`setFog`/`revealAll`/`coverAll` 先初始化数组（长度按 playArea 计算）。

## 4. 渲染（BoardCanvas）

- 在地图 + token **之上**渲染迷雾：遍历未揭示格子，每格一个 `Rect`（`listening={false}`）：
  - **DM**：黄色半透明 `rgba(245, 158, 11, 0.35)`
  - **玩家**：不透明深色 `#0f1115`（或 `rgba(15,17,21,0.98)`）
- 迷雾在**最上层**（盖住地图与 token），但先攻高亮环等可在迷雾之上或之下——取**迷雾盖住 token**（玩家看不到未揭示区域的怪物）。
- 性能：768 格以内的 `Rect` 数量可接受；格子多时可考虑 `Group` 一次绘制，本版本直接 map。

## 5. 擦除工具（DM）

- Toolbar 新增「擦除」工具（DM），图标 🧽 或 ✏️。
- 选中擦除工具后，Toolbar 下方/擦除工具旁显示**笔刷尺寸选择**：`小 / 中 / 大`（对应半径 `0 / 1 / 2` 个迷雾格，即 1×1 / 3×3 / 5×5 格）。
- 交互（复用画墙工具的拖拽模式）：
  - `mousedown` 在画布：计算指针所在迷雾格，把以该格为中心、笔刷半径范围内的格子标记为揭示
  - `mousemove` 拖动：继续揭示经过区域的格子
  - 实时聚合一批 `cells` → `setFog { cells, revealed: true }`（节流，避免刷屏）
- `updateSceneUnlock`：DM 在 SceneSwitcher 每个场景行加「🔓/🔒」开关，切换发 op（当前场景直接改内存+保存+广播；非当前场景由 GameServer 加载该场景改文件——参照 `renameScene` 的双路径）。

## 6. 玩家端 UI

- 右侧查询面板**保留**：查询/收藏夹 tab 与 DM 一致（搜索怪物/法术/装备）。
- **战役库 tab（玩家）**：
  - 不再显示敌人库（怪物资料对玩家隐藏）
  - 只显示 `campaign.sceneIds` 中 `unlocked === true` 的场景列表（场景名）
  - 点击场景 → 弹出**只读预览**（模态层）：场景地图图片缩略（`<img src=mapImage>` 缩放）+ token 名列表（怪物与玩家 token 的名字），无编辑控件
- **战役库 tab（DM）**：保持现有（敌人库 + 场景列表）。
- `useScene().scene` 含 `fog`/`unlocked`；玩家与 DM 看到的迷雾视觉由 `role` 决定（§4）。

## 7. 边界与错误处理

- 旧场景无 `fog`/`unlocked` → 按全遮挡 / 未解锁处理（向后兼容）。
- `setFog` 越界 cell → 忽略；空数组 → no-op。
- 玩家看不到未解锁场景（战役库不列出；即使手动 switchScene 也被 DM 权限拦——现有 `switchScene` 本就 DM-only）。
- 一键擦除/覆盖是 DM 专属，广播后所有端同步。

## 8. 测试

### 8.1 单元测试
- `setFog`：批量设置、越界忽略、无 fog 时初始化数组长度正确
- `revealAllFog` / `coverAllFog`：全 true / 全 false
- `updateSceneUnlock`：改 unlocked
- `canOp`：以上 op 玩家不可

### 8.2 集成测试（ws 双端）
- DM `setFog` 揭示格子 → 玩家收到含 `fog` 的 state（对应格子 true）
- DM `revealAllFog` / `coverAllFog` → 广播
- 玩家尝试 `setFog` / `updateSceneUnlock` → 拒绝
- 场景解锁后，玩家战役库能列出（客户端逻辑由 UI 任务验证）

## 9. 明确不做的（本版本）

- 迷雾随 token 自动揭示（token 半径揭示）
- 逐像素迷雾（仅网格单元式）
- 玩家端自由切换场景（仍 DM 控制当前场景）
- 迷雾动画 / 平滑过渡
