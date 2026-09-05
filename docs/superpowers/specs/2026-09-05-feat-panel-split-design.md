# 角色卡专长栏拆分：已有专长 / 可选专长

日期：2026-09-05
状态：待评审

## 背景与目标

角色卡"特性"页的专长面板目前是单个平铺列表（`RulePicker`）：已选专长混在全部可选专长里，只靠琥珀色高亮区分，专长一多玩家很难找到自己已选的项。

目标：把专长栏拆成"已有专长"与"可选专长"上下两段，让玩家一眼看到已选内容与剩余可选项。

## 方案

采用 **A：拆分逻辑进 model.ts + 薄组件渲染**。

- `client/src/plugins/dnd5e-character-sheet/model.ts` 新增纯函数 `splitFeatOptions(catalog, sheet)`，返回 `{ selected: CharacterRuleOption[]; available: CharacterRuleOption[] }`：
  - 候选集来自现有 `optionsForSheet(catalog, sheet, 'feat')`（沿用规则来源开关过滤与中文排序）；
  - `selected` 按 `sheet.feats` 的选择顺序排列（引用 id 与候选集求交，忽略失效引用）；
  - `available` 为候选集中未被选择的项。
- `CharacterSheetEditor.tsx` 的 `FeaturesTab` 重渲染右侧专长面板：搜索框保留在最上方，下接"已有专长（N）"与"可选专长（M）"两段列表；列表项样式与现有 `RulePicker` 一致（复用 `toggleRuleReference` 与 `filterOptions`）。

落选方案：

- **泛化 RulePicker 支持分组**：法术页共用该组件，回归风险大，且暂无第二个需求方（YAGNI）。
- **纯 JSX 内联筛选**：选择逻辑不可测，与代码库"逻辑在 model、组件不测"的分层惯例不符。

## 交互规格

- 搜索框一个，同时过滤两段；计数 N/M 均为过滤后的数量。
- 已有专长：勾选态（☑），点击=移除；保持选择顺序。
- 可选专长：未选态（☐），点击=添加；保持现有中文排序。
- 空态：已有专长被搜索过滤到空 → "没有匹配的专长。"；未选任何专长时（无论搜索）→ "还没有专长，从下方可选专长中选择。"；可选专长搜索无匹配 → "没有匹配的专长。"

## 测试

`client/src/__tests__/character-sheet-plugin.test.ts` 新增 `splitFeatOptions` 单测：

1. 已选/未选正确拆分，`selected` 保持 `sheet.feats` 顺序；
2. 规则来源开关关闭的来源不进入任何一段；
3. `sheet.feats` 中的失效引用（候选集中不存在）被忽略。

组件不渲染测试（沿用现有惯例），构建后由 `npm run build` 保证类型正确。

## 范围外

- 法术选择器不做同样拆分（后续如需统一再单独设计）。
- 专长详情展示方式不变（列表项仍是名称 + 英文名/来源）。
