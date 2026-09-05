# 专长栏拆分（已有专长 / 可选专长）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把角色卡"特性"页的专长面板拆成"已有专长"与"可选专长"上下两段，共享一个搜索框。

**Architecture:** 拆分逻辑收进 `model.ts` 的纯函数 `splitFeatOptions(catalog, sheet)`（沿用 `optionsForSheet` 的来源过滤与排序），`FeaturesTab` 只做渲染：搜索框在上，下接两个 `FeatList` 段。法术页的 `RulePicker` 不动。

**Tech Stack:** React + TypeScript + Tailwind（客户端），Vitest（测试）。

**Spec:** `docs/superpowers/specs/2026-09-05-feat-panel-split-design.md`

## Global Constraints

- 所有面向用户的文案为简体中文，与现有界面用词一致（"专长"、"已有专长"、"可选专长"、"没有匹配的专长。"）。
- 组件不做渲染测试；逻辑进 `model.ts` 并用 Vitest 单测（现有惯例）。
- 不修改 `RulePicker` 组件本身（法术页共用，超出范围）。
- 列表项样式与现有 `RulePicker` 条目一致：选中 `border-amber-500/40 bg-amber-500/10`，未选 `border-zinc-800 bg-zinc-950/50 hover:border-zinc-700`，复选框 `accent-amber-500`。
- 测试命令在仓库根目录 `dnd-dm-tool/` 下运行。

---

### Task 1: model.ts 新增 splitFeatOptions 纯函数（TDD）

**Files:**
- Modify: `client/src/plugins/dnd5e-character-sheet/model.ts`（在 `abilityBonusChoiceSlots` 之后新增导出函数）
- Test: `client/src/__tests__/character-sheet-plugin.test.ts`

**Interfaces:**
- Consumes: 同文件已有导出 `optionsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet, kind: CharacterRuleOptionKind): CharacterRuleOption[]`。
- Produces: `splitFeatOptions(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): { selected: CharacterRuleOption[]; available: CharacterRuleOption[] }` —— Task 2 的 FeaturesTab 调用。

- [ ] **Step 1: 写失败测试**

在 `client/src/__tests__/character-sheet-plugin.test.ts` 中，把 import 行：

```ts
import { abilityBonusChoiceSlots, optionsForSheet, setRuleSource } from '../plugins/dnd5e-character-sheet/model';
```

改为：

```ts
import { abilityBonusChoiceSlots, optionsForSheet, setRuleSource, splitFeatOptions } from '../plugins/dnd5e-character-sheet/model';
```

在 `describe('D&D 5e character sheet plugin', () => {` 内、`it('uses the official 27-point cost curve…` 之前插入：

```ts
  it('splits feats into selected and available groups honouring rule sources', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'feat:PHB:Alert', kind: 'feat', name: '警觉', nameEn: 'Alert', source: 'PHB' },
      { id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' },
      { id: 'feat:TCE:Chef', kind: 'feat', name: '厨师', nameEn: 'Chef', source: 'TCE' },
    );
    const sheet = emptyDnd5eCharacterSheet('布鲁诺');
    sheet.rules.enabledSources = ['PHB', 'XGE'];
    sheet.feats = [
      { id: 'feat:XGE:Elven Accuracy', kind: 'feat', name: '精灵精准', nameEn: 'Elven Accuracy', source: 'XGE' },
      { id: 'feat:PHB:Alert', kind: 'feat', name: '警觉', nameEn: 'Alert', source: 'PHB' },
      { id: 'feat:PHB:Removed Feat', kind: 'feat', name: '失效引用', nameEn: 'Removed Feat', source: 'PHB' },
    ];

    const { selected, available } = splitFeatOptions(catalog, sheet);

    expect(selected.map(feat => feat.id)).toEqual(['feat:XGE:Elven Accuracy', 'feat:PHB:Alert']);
    expect(available).toEqual([]);

    const enabled = splitFeatOptions(catalog, setRuleSource(sheet, 'TCE', true));
    expect(enabled.available.map(feat => feat.id)).toEqual(['feat:TCE:Chef']);
  });
```

（`fallbackCharacterRuleCatalog()` 只含职业/种族/背景，不含专长，push 不会与内置项撞 id。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: FAIL，报 `splitFeatOptions` 未导出（`SyntaxError` 或 `not a function`）。

- [ ] **Step 3: 写最小实现**

在 `client/src/plugins/dnd5e-character-sheet/model.ts` 的 `abilityBonusChoiceSlots` 函数之后新增：

```ts
export function splitFeatOptions(
  catalog: CharacterRuleCatalog,
  sheet: Dnd5eCharacterSheet,
): { selected: CharacterRuleOption[]; available: CharacterRuleOption[] } {
  const options = optionsForSheet(catalog, sheet, 'feat');
  const byId = new Map(options.map(option => [option.id, option]));
  const selected = sheet.feats.flatMap(reference => byId.get(reference.id) ?? []);
  const selectedIds = new Set(selected.map(option => option.id));
  const available = options.filter(option => !selectedIds.has(option.id));
  return { selected, available };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: PASS（11 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add client/src/plugins/dnd5e-character-sheet/model.ts client/src/__tests__/character-sheet-plugin.test.ts
git commit -m "feat: model 层新增 splitFeatOptions 拆分已选/可选专长"
```

---

### Task 2: FeaturesTab 渲染两段专长列表

**Files:**
- Modify: `client/src/plugins/dnd5e-character-sheet/CharacterSheetEditor.tsx:14-22`（import）、`CharacterSheetEditor.tsx:245-251`（FeaturesTab）、文件底部工具组件区（新增 `FeatList`）

**Interfaces:**
- Consumes: Task 1 的 `splitFeatOptions(catalog, sheet): { selected: CharacterRuleOption[]; available: CharacterRuleOption[] }`；同文件已有私有函数 `filterOptions(options, query)`、`inputClass()`、`Empty` 组件，以及从 `./model` 导入的 `toggleRuleReference`。
- Produces: 无外部接口（纯 UI）。

- [ ] **Step 1: 更新 import**

把 `./model` 的 import 块改为（新增 `splitFeatOptions`）：

```ts
import {
  abilityBonusChoiceSlots,
  itemsForSheet,
  optionsForSheet,
  selectedReference,
  spellsForSheet,
  splitFeatOptions,
  subclassesForSheet,
  toggleRuleReference,
} from './model';
```

- [ ] **Step 2: 重写 FeaturesTab**

把整个 `FeaturesTab` 函数替换为：

```tsx
function FeaturesTab({ catalog, sheet, derived, query, onQuery, onChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; query: string; onQuery(value: string): void; onChange(value: Dnd5eCharacterSheet): void }) {
  const { selected, available } = splitFeatOptions(catalog, sheet);
  const visibleSelected = filterOptions(selected, query);
  const visibleAvailable = filterOptions(available, query);
  const selectedIds = new Set(sheet.feats.map(item => item.id));
  const toggle = (option: CharacterRuleOption) => onChange({ ...sheet, feats: toggleRuleReference(sheet.feats, option) });
  return <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
    <Panel title={`当前特性与能力（${derived.features.length}）`}><div className="space-y-2">{derived.features.map(feature => <details key={feature.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><summary className="cursor-pointer text-sm font-medium"><span className="mr-2 text-xs text-zinc-500">{feature.origin}{feature.level ? ` · ${feature.level}级` : ''}</span>{feature.name}</summary>{feature.description && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{feature.description}</p>}</details>)}{derived.features.length === 0 && <Empty>选择种族、职业或背景后，规则特性会自动显示在这里。</Empty>}</div></Panel>
    <Panel title="专长">
      <label className="mb-3 block text-xs text-zinc-500">搜索专长<input value={query} onChange={event => onQuery(event.target.value)} placeholder="按中文、英文或来源搜索专长" className={inputClass()} /></label>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <FeatList title="已有专长" count={visibleSelected.length} emptyText={sheet.feats.length === 0 ? '还没有专长，从下方可选专长中选择。' : '没有匹配的专长。'} options={visibleSelected} selectedIds={selectedIds} onToggle={toggle} />
        <FeatList title="可选专长" count={visibleAvailable.length} emptyText="没有匹配的专长。" options={visibleAvailable} selectedIds={selectedIds} onToggle={toggle} />
      </div>
    </Panel>
  </div>;
}
```

（左栏"当前特性与能力"面板内容保持原样不动。）

- [ ] **Step 3: 新增 FeatList 组件**

在 `RulePicker` 组件定义之后、`Panel` 等工具组件附近新增：

```tsx
function FeatList({ title, count, emptyText, options, selectedIds, onToggle }: { title: string; count: number; emptyText: string; options: CharacterRuleOption[]; selectedIds: ReadonlySet<string>; onToggle(option: CharacterRuleOption): void }) {
  return <section>
    <h3 className="mb-2 text-xs font-medium text-zinc-400">{title}（{count}）</h3>
    {options.length === 0 ? <Empty>{emptyText}</Empty> : <div className="grid gap-2">{options.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${selectedIds.has(option.id) ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'}`}><input type="checkbox" checked={selectedIds.has(option.id)} onChange={() => onToggle(option)} className="mt-0.5 accent-amber-500" /><span className="min-w-0"><strong className="block truncate text-sm text-zinc-200">{option.name}</strong><span className="block truncate text-[11px] text-zinc-500">{option.nameEn} · {option.source}</span></span></label>)}</div>}
  </section>;
}
```

- [ ] **Step 4: 全量验证**

Run: `npm test && npm run build`
Expected: 两套 Vitest 套件全绿（domain 46 文件 / worker 4 文件，用例数只增不减）；`vite build` 成功、`tsc --noEmit` 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add client/src/plugins/dnd5e-character-sheet/CharacterSheetEditor.tsx
git commit -m "feat: 特性页专长栏拆分为已有专长/可选专长两段"
```

---

## 自审记录

- 规格覆盖：两段布局 ✓（Task 2 Step 2/3）、共享搜索框 ✓、计数为过滤后数量 ✓（`count={visible*}`）、三种空态文案 ✓（`emptyText` 逻辑）、已选保持选择顺序 ✓（Task 1 测试断言顺序）、失效引用忽略 ✓（`Removed Feat` 断言）、来源过滤 ✓（`setRuleSource` 断言）、法术选择器不动 ✓（未触碰 `RulePicker`）。
- 占位符扫描：无 TBD/TODO；所有代码步骤给出完整代码。
- 类型一致性：`splitFeatOptions` 的签名在 Task 1 定义、Task 2 消费一致；`FeatList` props 与调用处一一对应。
