# 战斗装备槽位：护甲 / 主手 / 副手与自动命中伤害

日期：2026-09-05
状态：待评审

## 背景与目标

角色卡"装备"页目前只有背包、货币和物品资料库，缺少战斗装备概念：穿哪件护甲、拿什么武器、持不持盾都要玩家心算。目标：装备页新增"战斗装备"面板——护甲、主手、副手（武器或盾牌）三个槽位直接从物品资料库选择，AC、命中加值、伤害及加值按所选武器自动计算。

已确认的需求口径：

- 槽位物品**直接从物品资料库选择**，不经过背包；负重与同调仍按背包统计，装备槽是纯战斗配置。
- 附加加值（战斗风格、双武器战斗风格、宿命等）通过每件武器的**手动微调字段**实现，不内置风格选择。
- 只显示计算后的数值，**不做掷骰按钮**。

## 方案

采用 **A：槽位状态进 sheet + rules-engine 派生**。

- `Dnd5eCharacterSheet` 新增 `gear` 段（规范化、版本兼容由 `validation.ts` 负责）；
- `rules-engine.ts` 修正盾牌 AC 计算并新增 `derived.attacks`；
- 装备页 UI 渲染槽位与计算结果，全部数值来自引擎派生，组件不算规则。

落选方案：

- **复用背包 equipped 标记推导**：与"直接从资料库选"冲突，多件 equipped 护甲的归属歧义。
- **前端组件内计算**：AC 双份计算漂移，worker 端保存重算拿不到同一结果。

## 数据层

1. `scripts/data-update.mjs` 下载清单加入 `items-base.json`（合并策略与 `items.json` 相同：本地镜像优先，upstream 兜底）。镜像现缺失全部基础武器护甲（长剑、皮甲、盾牌等），不补数据则槽位无从选择。
2. `scripts/build-character-rules.mjs` 的 `itemProfile` 增补字段：
   - `weaponCategory`：`simple → '简易'`、`martial → '军用'`（其余原样保留小写）；
   - `damageVersatile`：来自 `dmg2`；
   - 属性布尔：`finesse`、`light`、`twoHanded`、`thrown`、`ammunition`、`reach`（来自 `property` 数组代码 `F/L/2H/T/A/R`）；
   - `bonusWeapon`：魔法武器命中与伤害加值（`integer` 归一化，缺省 0）。
3. 重新生成 `character-options.json` 并随部署上传 R2。

## 状态与规则引擎

### Sheet Schema（`shared/plugins/dnd5e-character-sheet/types.ts`）

```ts
interface CharacterWeaponSlot {
  reference: CharacterRuleReference | null;  // 指向 kind:'item' 的目录项
  hitAdjust: number;      // 命中微调，clamp [-20, 20]
  damageAdjust: number;   // 伤害微调，clamp [-20, 20]
}
// sheet.gear: { armor: CharacterRuleReference | null; mainHand: CharacterWeaponSlot | null; offHand: CharacterWeaponSlot | null }
```

`normalizeDnd5eCharacterSheet` 对旧卡补 `{ armor: null, mainHand: null, offHand: null }`；微调值越界截断；引用形状不合法整槽置空。装备槽不计入负重与同调。

### AC（`rules-engine.ts`）

- 盾牌（`category` 以 `S` 开头）从"当胸甲取 max"修正为**盔甲加值**：`+2 + armorBonus`，可与护甲叠加；
- 护甲槽 `gear.armor` 取代背包 equipped 推导成为唯一主甲来源（无主甲时 `10 + 敏捷`）；
- `combat.armorClassOverride` 仍然最高优先，行为不变。

### 攻击派生 `derived.attacks`

每把装备中的武器一条：

```ts
interface DerivedAttack {
  slot: 'mainHand' | 'offHand';
  name: string;            // 物品名；引用失效时显示引用名并标记
  abilityUsed: 'str' | 'dex';
  proficient: boolean | null;  // null = 无法判定
  attackBonus: number;     // 熟练 + 属性调整 + bonusWeapon + hitAdjust
  damage: string;          // 骰式，如 '1d8'
  damageBonus: number;     // 属性调整 + bonusWeapon + damageAdjust（副手见下）
  damageType: string;      // 物理伤害类型缩写原文
  notes: string[];         // 如 ['灵巧', '两用 1d10', '军用', '未熟练?']
}
```

- 属性选择：近战非灵巧 → 力量；灵巧 → 力/敏较高；远程 → 敏捷（投掷远程同样用敏捷，其典型武器如飞镖本身带灵巧）。
- 伤害骰：主手用 `damage`（`dmg1`）；副手为**空槽**且武器带 `damageVersatile` 时用两用骰 `damageVersatile`；副手为**武器或盾牌**时两用不可用，仍用 `dmg1`。
- 副手武器伤害**默认不加属性调整**（双武器战斗规则），微调字段可补；魔法 `bonusWeapon` 照加。
- 熟练判定（尽力匹配，不阻塞计算）：武器 `weaponCategory`（简易/军用）与职业+种族 `weaponProficiencies` 求交；未命中再按武器名/英文名包含匹配；都不中 → `proficient: null`，界面显示 `?`，命中加值**默认含熟练加值**（假定玩家使用顺手武器）。
- 双持合规提示（不硬性限制）：副手武器无 `light` 属性时 `notes` 加"非轻武器"；主手双手（`twoHanded`）武器在副手非空时 `notes` 加"双手武器"。

## UI（`InventoryTab` 左栏顶部"战斗装备"面板）

- 三个下拉：护甲 / 主手 / 副手；选项来自 `optionsForSheet(catalog, sheet, 'item')`，按类型预分组排序：护甲槽只列带 `armorBase` 且非盾的物品，主/副手列武器（副手额外列盾牌）。
- 护甲行显示当前 **AC 合计**（与头部"护甲等级"同源）；主/副手各显示 **命中 +X · 伤害 骰+Y（类型）· 备注**。
- 每把武器两个数字输入：命中微调 / 伤害微调。
- 引用失效（来源被关闭或目录变动）时槽位显示引用名并提示"不可用"，可一键清空。

## 测试

1. 引擎（`character-sheet-plugin.test.ts`）：
   - 盾牌 +2 与护甲叠加、无甲持盾 `10+敏+2`；
   - 灵巧取力/敏较高、远程用敏捷；
   - 副手武器伤害无属性调整、微调字段生效；
   - versatile：副手空用 `dmg2`，副手持盾回退 `dmg1`；
   - 魔法 `bonusWeapon` 同加命中与伤害；
   - 旧卡无 `gear` 字段规范化后 AC 行为与现状一致。
2. 目录构建（`character-rule-catalog.test.ts`）：基础武器 fixture 产出 `weaponCategory/damageVersatile/finesse/bonusWeapon`。
3. 模型层：槽位解析对失效引用返回可清空的"不可用"状态。

## 范围外

- 掷骰按钮、内置战斗风格、弹药追踪；
- 熟练项硬性拦截（不确定时照常计算并显示 `?`）；
- `items-base.json` 之外的新数据源。

## 部署

实现完成后：`npm run data:update` 拉取 `items-base.json` → 重建目录 → `npm run deploy:production`（客户端代码）→ R2 上传新目录。发布前逐项跑测试与构建。
