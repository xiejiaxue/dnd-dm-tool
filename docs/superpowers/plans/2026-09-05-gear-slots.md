# 战斗装备槽位（护甲/主手/副手）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 装备页新增战斗装备面板：护甲/主手/副手槽位直选物品资料库，AC、命中加值、伤害按所选武器自动计算并带熟练标签。

**Architecture:** 槽位状态存 `sheet.gear`（types + validation 规范化）；`rules-engine` 修正盾牌 AC 并新增 `derived.attacks`；构建脚本补基础武器数据（`items-base.json`）与武器字段；UI 只渲染引擎派生值。

**Tech Stack:** TypeScript + React + Tailwind，Vitest；数据脚本 Node ESM。

**Spec:** `docs/superpowers/specs/2026-09-05-gear-slots-design.md`

## Global Constraints

- 面向用户文案为简体中文；熟练标签三态：**熟练 / 不熟练 / ?**；武器行固定格式 `[标签] 命中 +n · 伤害 1d8+m（类型）`，零加值省略符号后缀。
- 盾牌 AC 默认 +2，魔法盾 `armorBonus` 额外叠加；`combat.armorClassOverride` 仍最高优先。
- 副手武器伤害默认不加属性调整；两用骰仅在主手且副手槽为空时使用。
- 装备槽不计入负重与同调；旧卡无 `gear` 字段时行为与现状一致。
- 组件不做渲染测试；逻辑放 model/rules-engine 并用 Vitest 单测。
- 仓库根目录 `dnd-dm-tool/` 下运行命令；提交只 add 本任务列出的文件（工作区有大量无关未提交改动）。
- 客户端单测命令：`npx vitest run --config vitest.config.ts <文件>`。

---

### Task 1: sheet.gear 类型与规范化

**Files:**
- Modify: `shared/plugins/dnd5e-character-sheet/types.ts`（`CharacterItemProfile` 增补、新 `CharacterWeaponSlot`、`Dnd5eCharacterSheet.gear`、`DerivedAttack`、`Dnd5eDerivedCharacter.attacks`、`emptyDnd5eCharacterSheet` 默认值）
- Modify: `shared/plugins/dnd5e-character-sheet/validation.ts`（`itemProfile` 扩展、`gearSection`/`weaponSlot` 规范化）
- Test: `client/src/__tests__/character-sheet-plugin.test.ts`

**Interfaces:**
- Consumes: 现有 `safeRuleReference(value, expectedKind, enabledSources)`、`integer(value, fallback, min, max)`（validation.ts 私有）。
- Produces（后续任务依赖的精确签名）:
  - `Dnd5eCharacterSheet.gear: { armor: CharacterRuleReference | null; mainHand: CharacterWeaponSlot | null; offHand: CharacterWeaponSlot | null }`
  - `interface CharacterWeaponSlot { reference: CharacterRuleReference; hitAdjust: number; damageAdjust: number }`（reference 非空——校验失败整槽置 null）
  - `interface DerivedAttack { slot: 'mainHand' | 'offHand'; name: string; abilityUsed: AbilityKey; proficient: boolean | null; attackBonus: number; damage: string; damageBonus: number; damageType: string; notes: string[] }`
  - `CharacterItemProfile` 新可选字段：`weaponCategory?: string; damageVersatile?: string; finesse?: boolean; light?: boolean; twoHanded?: boolean; thrown?: boolean; ammunition?: boolean; reach?: boolean; bonusWeapon?: number`

- [ ] **Step 1: 写失败测试**

在 `client/src/__tests__/character-sheet-plugin.test.ts` 的 describe 内追加：

```ts
  it('normalizes gear slots and keeps legacy sheets working', () => {
    const migrated = normalizeDnd5eCharacterSheet({
      schemaVersion: 1,
      identity: { characterName: '旧角色' },
      abilities: { str: 15, dex: 12, con: 14, int: 9, wis: 11, cha: 8 },
    });
    expect(migrated.gear).toEqual({ armor: null, mainHand: null, offHand: null });

    const sheet = normalizeDnd5eCharacterSheet({
      rules: { enabledSources: ['PHB'] },
      gear: {
        armor: { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB' },
        mainHand: { reference: { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB' }, hitAdjust: 99, damageAdjust: -3 },
        offHand: { reference: { id: 'item:TCE:Chef', kind: 'item', name: '厨师', nameEn: 'Chef', source: 'TCE' }, hitAdjust: 0, damageAdjust: 0 },
      },
    });
    expect(sheet.gear.armor).toMatchObject({ nameEn: 'Leather Armor' });
    expect(sheet.gear.mainHand).toMatchObject({ hitAdjust: 20, damageAdjust: -3 });
    expect(sheet.gear.offHand).toBeNull();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: FAIL（`gear` 不存在 → `undefined` 不等于期望值）。

- [ ] **Step 3: 类型定义（types.ts）**

`CharacterItemProfile` 末尾（`description: string;` 之后）追加字段：

```ts
  weaponCategory?: string;
  damageVersatile?: string;
  finesse?: boolean;
  light?: boolean;
  twoHanded?: boolean;
  thrown?: boolean;
  ammunition?: boolean;
  reach?: boolean;
  bonusWeapon?: number;
```

`CharacterInventoryEntry` 接口之后新增：

```ts
export interface CharacterWeaponSlot {
  reference: CharacterRuleReference;
  hitAdjust: number;
  damageAdjust: number;
}
```

`Dnd5eCharacterSheet` 的 `inventory: CharacterInventoryEntry[];` 之后新增一行：

```ts
  gear: { armor: CharacterRuleReference | null; mainHand: CharacterWeaponSlot | null; offHand: CharacterWeaponSlot | null };
```

`DerivedCharacterEquipment` 接口之后新增：

```ts
export interface DerivedAttack {
  slot: 'mainHand' | 'offHand';
  name: string;
  abilityUsed: AbilityKey;
  proficient: boolean | null;
  attackBonus: number;
  damage: string;
  damageBonus: number;
  damageType: string;
  notes: string[];
}
```

`Dnd5eDerivedCharacter` 的 `armorClass: number;` 之后新增：

```ts
  attacks: DerivedAttack[];
```

`emptyDnd5eCharacterSheet` 返回对象的 `inventory: [],` 之后新增：

```ts
    gear: { armor: null, mainHand: null, offHand: null },
```

- [ ] **Step 4: 规范化（validation.ts）**

`itemProfile` 函数整体替换为：

```ts
function itemProfile(value: unknown): CharacterItemProfile | undefined {
  if (!isRecord(value)) return undefined;
  const weaponCategory = text(value.weaponCategory, '', 40);
  const damageVersatile = text(value.damageVersatile, '', 80);
  return {
    category: text(value.category, 'equipment', 80), weight: finiteNumber(value.weight, 0, 0, 100_000),
    armorBase: nullableInteger(value.armorBase, 0, 100), armorDexCap: nullableInteger(value.armorDexCap, -10, 20),
    armorBonus: integer(value.armorBonus, 0, -20, 20), damage: text(value.damage, '', 80), damageType: text(value.damageType, '', 80),
    range: text(value.range, '', 80), description: text(value.description, '', 2400),
    ...(weaponCategory ? { weaponCategory } : {}),
    ...(damageVersatile ? { damageVersatile } : {}),
    ...(value.finesse === true ? { finesse: true } : {}),
    ...(value.light === true ? { light: true } : {}),
    ...(value.twoHanded === true ? { twoHanded: true } : {}),
    ...(value.thrown === true ? { thrown: true } : {}),
    ...(value.ammunition === true ? { ammunition: true } : {}),
    ...(value.reach === true ? { reach: true } : {}),
    ...(typeof value.bonusWeapon === 'number' ? { bonusWeapon: integer(value.bonusWeapon, 0, -20, 20) } : {}),
  };
}
```

文件顶部 import 的 types 列表中 `CharacterSpellProfile,` 之后加 `type CharacterWeaponSlot,`。`normalizeDnd5eCharacterSheet` 返回对象里 `inventory: inventoryList(value.inventory, enabledSources),` 之后新增：

```ts
    gear: gearSection(value.gear, enabledSources),
```

文件末尾（`inventoryList` 之后）新增两个函数：

```ts
function gearSection(value: unknown, enabledSources: readonly string[]): Dnd5eCharacterSheet['gear'] {
  const gear = record(value);
  return {
    armor: safeRuleReference(gear.armor, 'item', enabledSources),
    mainHand: weaponSlot(gear.mainHand, enabledSources),
    offHand: weaponSlot(gear.offHand, enabledSources),
  };
}

function weaponSlot(value: unknown, enabledSources: readonly string[]): CharacterWeaponSlot | null {
  if (!isRecord(value)) return null;
  const reference = safeRuleReference(value.reference, 'item', enabledSources);
  if (!reference) return null;
  return { reference, hitAdjust: integer(value.hitAdjust, 0, -20, 20), damageAdjust: integer(value.damageAdjust, 0, -20, 20) };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: PASS（既有 + 新增全绿）。

- [ ] **Step 6: 提交**

```bash
git add shared/plugins/dnd5e-character-sheet/types.ts shared/plugins/dnd5e-character-sheet/validation.ts client/src/__tests__/character-sheet-plugin.test.ts
git commit -m "feat: sheet.gear 槽位类型与规范化（护甲/主手/副手）"
```

---

### Task 2: 引擎——盾牌 AC 修正与护甲槽

**Files:**
- Modify: `shared/plugins/dnd5e-character-sheet/rules-engine.ts`（`deriveArmorClass` 重写、`deriveDnd5eCharacter` 调用点）
- Test: `client/src/__tests__/character-sheet-plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `sheet.gear`；`optionFor(options, id)`（rules-engine.ts 私有，已存在）。
- Produces: `deriveDnd5eCharacter` 返回的 `armorClass` 语义变化——主甲只来自 `gear.armor`，盾牌（category 以 `S` 开头且 `armorBase !== null`）加 `2 + armorBonus`。

- [ ] **Step 1: 写失败测试**

在 client 测试文件追加：

```ts
  it('derives armor class from gear slots with stacking shield bonus', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB', item: { category: 'LA', weight: 10, armorBase: 11, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:PHB:Shield', kind: 'item', name: '盾牌', nameEn: 'Shield', source: 'PHB', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:TCE:Repulsion Shield', kind: 'item', name: '斥力之盾', nameEn: 'Repulsion Shield', source: 'TCE', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 1, damage: '', damageType: '', range: '', description: '' } },
    );
    const sheet = emptyDnd5eCharacterSheet('盾卫');
    sheet.abilityGeneration.base = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };

    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(12);

    sheet.gear.armor = { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB' };
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(13);

    sheet.gear.offHand = { reference: { id: 'item:TCE:Repulsion Shield', kind: 'item', name: '斥力之盾', nameEn: 'Repulsion Shield', source: 'TCE' }, hitAdjust: 0, damageAdjust: 0 };
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(16);

    sheet.combat.armorClassOverride = 18;
    expect(deriveDnd5eCharacter(sheet, catalog).armorClass).toBe(18);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: 新用例 FAIL（现引擎 `armorClass` 恒为 `12`，`gear.armor`/`gear.offHand` 不生效）。

- [ ] **Step 3: 重写 deriveArmorClass**

`rules-engine.ts` 中 `deriveArmorClass` 整体替换为：

```ts
function deriveArmorClass(sheet: Dnd5eCharacterSheet, dexterityModifier: number, options: ReadonlyMap<string, CharacterRuleOption>): number {
  if (sheet.combat.armorClassOverride !== null) return sheet.combat.armorClassOverride;
  let armorClass = 10 + dexterityModifier;
  const armorProfile = optionFor(options, sheet.gear.armor?.id)?.item;
  if (armorProfile && armorProfile.armorBase !== null && !isShieldProfile(armorProfile)) {
    const dexterity = armorProfile.armorDexCap === null ? dexterityModifier : Math.min(armorProfile.armorDexCap, dexterityModifier);
    armorClass = Math.max(armorClass, armorProfile.armorBase + dexterity + armorProfile.armorBonus);
  }
  const offHandProfile = optionFor(options, sheet.gear.offHand?.reference.id)?.item;
  if (offHandProfile && isShieldProfile(offHandProfile)) armorClass += 2 + offHandProfile.armorBonus;
  return armorClass;
}

function isShieldProfile(profile: CharacterItemProfile): boolean {
  return profile.armorBase !== null && profile.category.startsWith('S');
}
```

同文件 import 区（来自 `'./types'`）补 `type CharacterItemProfile,`。`deriveDnd5eCharacter` 内调用行 `const armorClass = deriveArmorClass(sheet, modifiers.dex, equipment);` 改为：

```ts
  const armorClass = deriveArmorClass(sheet, modifiers.dex, options);
```

（`equipment` 变量仍用于负重与装备列表，保留。）

- [ ] **Step 4: 运行确认通过 + 全套**

Run: `npx vitest run --config vitest.config.ts`
Expected: PASS。注意既有用例若有依赖背包 equipped 推 AC 的断言失败，属预期行为变化——按 spec 修正该断言（背包 equipped 不再影响 AC）。

- [ ] **Step 5: 提交**

```bash
git add shared/plugins/dnd5e-character-sheet/rules-engine.ts client/src/__tests__/character-sheet-plugin.test.ts
git commit -m "fix: 盾牌 AC 改为叠加加值，主甲改由护甲槽提供"
```

---

### Task 3: 引擎——derived.attacks 攻击派生

**Files:**
- Modify: `shared/plugins/dnd5e-character-sheet/rules-engine.ts`
- Test: `client/src/__tests__/character-sheet-plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 `CharacterWeaponSlot`/`DerivedAttack`/`CharacterItemProfile` 新字段；Task 2 后的 options map。
- Produces: `derived.attacks: DerivedAttack[]`（主手在前、副手在后；空槽跳过；引用缺失或物品无伤害数据跳过）。

- [ ] **Step 1: 写失败测试**

client 测试文件追加：

```ts
  it('derives weapon attacks with ability choice, offhand and versatile rules', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB', item: { category: 'M', weight: 3, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d8', damageType: 'S', damageVersatile: '1d10', weaponCategory: '军用', range: '', description: '' } },
      { id: 'item:PHB:Dagger', kind: 'item', name: '匕首', nameEn: 'Dagger', source: 'PHB', item: { category: 'M', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d4', damageType: 'P', finesse: true, light: true, thrown: true, weaponCategory: '简易', range: '20/60', description: '' } },
      { id: 'item:PHB:Shortbow', kind: 'item', name: '短弓', nameEn: 'Shortbow', source: 'PHB', item: { category: 'R', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d6', damageType: 'P', ammunition: true, twoHanded: true, weaponCategory: '简易', range: '80/320', description: '' } },
      { id: 'item:TCE:Moon Sickle', kind: 'item', name: '+1 月镰', nameEn: '+1 Moon Sickle', source: 'TCE', item: { category: 'M', weight: 2, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d4', damageType: 'S', finesse: true, light: true, weaponCategory: 'simple', bonusWeapon: 1, range: '', description: '' } },
    );
    const fighter = catalog.options.find(option => option.id === 'class:PHB:Fighter')!;
    fighter.weaponProficiencies = ['简易', '军用'];
    const sheet = emptyDnd5eCharacterSheet('战士');
    sheet.advancement.class = { id: fighter.id, kind: 'class', name: fighter.name, nameEn: fighter.nameEn, source: fighter.source };
    sheet.abilityGeneration.base = { str: 15, dex: 14, con: 10, int: 8, wis: 12, cha: 10 };
    const reference = (id: string) => catalog.options.find(option => option.id === id)!.name;

    sheet.gear.mainHand = { reference: { id: 'item:PHB:Longsword', kind: 'item', name: reference('item:PHB:Longsword'), nameEn: 'Longsword', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    let attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ slot: 'mainHand', abilityUsed: 'str', proficient: true, attackBonus: 4, damage: '1d8', damageBonus: 2, damageType: 'S' });

    sheet.gear.offHand = { reference: { id: 'item:PHB:Dagger', kind: 'item', name: reference('item:PHB:Dagger'), nameEn: 'Dagger', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0].damage).toBe('1d8');
    expect(attacks[0].abilityUsed).toBe('str');
    expect(attacks[1]).toMatchObject({ slot: 'offHand', abilityUsed: 'str', proficient: true, attackBonus: 4, damage: '1d4', damageBonus: 0 });
    expect(attacks[1].notes).toContain('轻武器');

    sheet.gear.offHand = null;
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0].damage).toBe('1d10');

    sheet.gear.mainHand = { reference: { id: 'item:PHB:Shortbow', kind: 'item', name: reference('item:PHB:Shortbow'), nameEn: 'Shortbow', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0]).toMatchObject({ abilityUsed: 'dex', attackBonus: 4, damageBonus: 2, proficient: true });

    sheet.gear.mainHand = { reference: { id: 'item:TCE:Moon Sickle', kind: 'item', name: reference('item:TCE:Moon Sickle'), nameEn: '+1 Moon Sickle', source: 'TCE' }, hitAdjust: 1, damageAdjust: 2 };
    attacks = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attacks[0]).toMatchObject({ abilityUsed: 'dex', proficient: false, attackBonus: 2 + 2 + 1 + 1, damageBonus: 2 + 1 + 2 });
  });

  it('labels weapon proficiency from cleaned class proficiencies', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Quarterstaff', kind: 'item', name: '长棍', nameEn: 'Quarterstaff', source: 'PHB', item: { category: 'M', weight: 4, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d6', damageType: 'B', weaponCategory: '军用', range: '', description: '' } },
    );
    const wizard = catalog.options.find(option => option.id === 'class:PHB:Wizard')!;
    wizard.weaponProficiencies = ['{@item 匕首', '{@item 长棍', '{@item 轻弩'];
    const sheet = emptyDnd5eCharacterSheet('法师');
    sheet.advancement.class = { id: wizard.id, kind: 'class', name: wizard.name, nameEn: wizard.nameEn, source: wizard.source };
    sheet.gear.mainHand = { reference: { id: 'item:PHB:Quarterstaff', kind: 'item', name: '长棍', nameEn: 'Quarterstaff', source: 'PHB' }, hitAdjust: 0, damageAdjust: 0 };

    const [attack] = deriveDnd5eCharacter(sheet, catalog).attacks;
    expect(attack.proficient).toBe(true);
  });
```

注意：`expect(attacks[1].notes).toContain('轻武器')` 一行——副手匕首本身 `light: true`，notes 应含 `'轻武器'`（表示满足双持前提）；写测试时直接用 `toContain('轻武器')`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: FAIL（`attacks` 为 undefined）。

- [ ] **Step 3: 实现 deriveAttacks**

`rules-engine.ts` 新增（`deriveArmorClass` 之前）：

```ts
function deriveAttacks(
  sheet: Dnd5eCharacterSheet,
  options: ReadonlyMap<string, CharacterRuleOption>,
  modifiers: Record<AbilityKey, number>,
  proficiency: number,
  weaponProficiencies: readonly string[],
): DerivedAttack[] {
  const proficiencyNames = unique(weaponProficiencies.map(cleanProficiencyName));
  const attacks: DerivedAttack[] = [];
  for (const slotName of ['mainHand', 'offHand'] as const) {
    const slot: CharacterWeaponSlot | null = sheet.gear[slotName];
    const profile = optionFor(options, slot?.reference.id)?.item;
    if (!slot || !profile?.damage) continue;
    const ranged = profile.category.startsWith('R');
    const abilityUsed: AbilityKey = profile.finesse
      ? (modifiers.str >= modifiers.dex ? 'str' : 'dex')
      : ranged ? 'dex' : 'str';
    const offHandReference = sheet.gear.offHand?.reference ?? null;
    const versatile = slotName === 'mainHand' && !offHandReference && profile.damageVersatile;
    const magic = profile.bonusWeapon ?? 0;
    const proficient = weaponProficiency(profile, proficiencyNames);
    const notes = [
      profile.finesse ? '灵巧' : '',
      ranged ? '远程' : '',
      versatile ? `两用 ${profile.damageVersatile}` : '',
      profile.weaponCategory && /^[简易军用]{2}$/.test(profile.weaponCategory) ? profile.weaponCategory : '',
      slotName === 'offHand' && !profile.light ? '非轻武器' : '',
      slotName === 'offHand' && profile.light ? '轻武器' : '',
      slotName === 'mainHand' && profile.twoHanded && offHandReference ? '双手武器' : '',
    ].filter(Boolean);
    attacks.push({
      slot: slotName,
      name: slot.reference.name,
      abilityUsed,
      proficient,
      attackBonus: proficiency + modifiers[abilityUsed] + magic + slot.hitAdjust,
      damage: versatile ? profile.damageVersatile! : profile.damage,
      damageBonus: (slotName === 'offHand' ? 0 : modifiers[abilityUsed]) + magic + slot.damageAdjust,
      damageType: profile.damageType,
      notes,
    });
  }
  return attacks;
}

function cleanProficiencyName(value: string): string {
  return value.replace(/^\{\@item\s*/u, '').replace(/\}$/u, '').trim();
}

function weaponProficiency(profile: CharacterItemProfile, proficiencyNames: readonly string[]): boolean | null {
  if (!proficiencyNames.length) return null;
  const category = profile.weaponCategory === '简易' || profile.weaponCategory === '军用' ? profile.weaponCategory : null;
  if (category && proficiencyNames.includes(category)) return true;
  if (proficiencyNames.some(name => name && ((profile.name && (profile.name.includes(name) || name.includes(profile.name))) || (profile.nameEn && (profile.nameEn.includes(name) || name.includes(profile.nameEn)))))) return true;
  return false;
}
```

`deriveDnd5eCharacter` 内，`const savingProficiencies = ...` 行之前加：

```ts
  const weaponProficiencyList = unique([...(race?.weaponProficiencies ?? []), ...(characterClass?.weaponProficiencies ?? []), ...sheet.training.weapons]);
```

原 return 里 `weapons: unique([...(race?.weaponProficiencies ?? []), ...(characterClass?.weaponProficiencies ?? []), ...sheet.training.weapons]),` 改为 `weapons: weaponProficiencyList,`。`armorClass` 行之后加：

```ts
  const attacks = deriveAttacks(sheet, options, modifiers, proficiency, weaponProficiencyList);
```

return 对象 `armorClass,` 之后加 `attacks,`。import 自 `'./types'` 补 `type CharacterWeaponSlot, type DerivedAttack,`。

- [ ] **Step 4: 运行确认通过 + 全套**

Run: `npx vitest run --config vitest.config.ts`
Expected: PASS（全部用例）。`+1 月镰` 用例中 `weaponCategory: 'simple'`（小写英文，非'简易/军用'）且名称不匹配熟练表 → 断言 `proficient: false` 是预期行为（未熟练显示"不熟练"）。

- [ ] **Step 5: 提交**

```bash
git add shared/plugins/dnd5e-character-sheet/rules-engine.ts client/src/__tests__/character-sheet-plugin.test.ts
git commit -m "feat: 引擎派生 attacks——属性选择/副手/两用/魔法加值与熟练标签"
```

---

### Task 4: 数据层——基础武器入库与武器字段

**Files:**
- Modify: `scripts/data-update.mjs:73`（下载清单）
- Modify: `scripts/build-character-rules.mjs`（`itemProfile`、`buildCharacterRuleCatalog` 的 appendEntries）
- Test: `server/test/character-rule-catalog.test.ts`

**Interfaces:**
- Consumes: 上游/中文镜像的 `items-base.json`（顶层键 `baseitem`；字段 `type/weaponCategory/dmg1/dmg2/dmgType/property/ac/bonusAc`）。
- Produces: 目录 item 选项带 `weaponCategory/damageVersatile/finesse/light/twoHanded/thrown/ammunition/reach/bonusWeapon`；本地 `data/db/items-base.json` 与重建后的 `data/db/character-options.json`（含基础武器，如 长剑）。

- [ ] **Step 1: 写失败测试**

`server/test/character-rule-catalog.test.ts` 中，现有 `writeFileSync(path.join(directory, 'races.json'), ...)` 之后追加：

```ts
    writeFileSync(path.join(directory, 'items-base.json'), JSON.stringify({
      baseitem: [
        { name: '长剑', ENG_name: 'Longsword', source: 'PHB', type: 'M', weaponCategory: 'martial', dmg1: '1d8', dmg2: '1d10', dmgType: 'S', property: ['V'], weight: 3 },
        { name: '匕首', ENG_name: 'Dagger', source: 'PHB', type: 'M', weaponCategory: 'simple', dmg1: '1d4', dmgType: 'P', property: ['F', 'L', 'T'], weight: 2 },
        { name: '盾牌', ENG_name: 'Shield', source: 'PHB', type: 'S', ac: 2, weight: 6 },
      ],
    }));
```

测试断言区追加：

```ts
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Longsword',
      item: expect.objectContaining({ category: 'M', damage: '1d8', damageVersatile: '1d10', weaponCategory: '军用', twoHanded: undefined, finesse: undefined }),
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Dagger',
      item: expect.objectContaining({ damage: '1d4', weaponCategory: '简易', finesse: true, light: true, thrown: true }),
    }));
    expect(stored.options).toContainEqual(expect.objectContaining({
      kind: 'item', nameEn: 'Shield',
      item: expect.objectContaining({ category: 'S', armorBase: 2 }),
    }));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts server/test/character-rule-catalog.test.ts`
Expected: FAIL（`weaponCategory`/`damageVersatile` undefined 断言失败——注意 `baseitem` 未被读取时整个 item 断言都会失败）。

- [ ] **Step 3: 构建脚本实现**

`build-character-rules.mjs`：

1. `buildCharacterRuleCatalog` 内 `appendEntries(options, document.item, 'item', bookFile, spellSourceLookup, document);` 之后加：

```js
    appendEntries(options, document.baseitem, 'item', bookFile, spellSourceLookup, document);
```

2. `scripts/data-update.mjs` 下载清单（约 73 行）`'items.json', 'feats.json', ...` 数组中 `'items.json',` 之后加 `'items-base.json',`。

3. `itemProfile` 函数整体替换为：

```js
function itemProfile(entry) {
  const type = firstText(entry.type, entry.weaponCategory, entry.rarity, 'equipment');
  const rawWeaponCategory = firstText(entry.weaponCategory);
  const weaponCategory = rawWeaponCategory === 'simple' ? '简易' : rawWeaponCategory === 'martial' ? '军用' : rawWeaponCategory;
  const properties = Array.isArray(entry.property) ? entry.property.filter(value => typeof value === 'string') : [];
  const armorBase = Number.isFinite(entry.ac) ? integer(entry.ac, 10, 0, 100) : null;
  const armorDexCap = type === 'MA' ? 2 : type === 'HA' ? 0 : armorBase === null ? null : null;
  const damageVersatile = firstText(entry.dmg2).slice(0, 80);
  return {
    category: type.slice(0, 80),
    weight: number(entry.weight, 0, 0, 100000),
    armorBase,
    armorDexCap,
    armorBonus: signedNumber(entry.bonusAc),
    damage: firstText(entry.dmg1).slice(0, 80),
    damageType: firstText(entry.dmgType).slice(0, 80),
    ...(damageVersatile ? { damageVersatile } : {}),
    ...(weaponCategory ? { weaponCategory } : {}),
    ...(properties.includes('F') ? { finesse: true } : {}),
    ...(properties.includes('L') ? { light: true } : {}),
    ...(properties.includes('2H') ? { twoHanded: true } : {}),
    ...(properties.includes('T') ? { thrown: true } : {}),
    ...(properties.includes('A') ? { ammunition: true } : {}),
    ...(properties.includes('R') ? { reach: true } : {}),
    ...(() => { const bonus = signedNumber(entry.bonusWeapon); return bonus ? { bonusWeapon: bonus } : {}; })(),
    range: firstText(entry.range).slice(0, 80),
    description: plainText(entry.entries).slice(0, 2400),
  };
}
```

（`bonusWeapon` 行用 `signedNumber` 是因为镜像里魔法武器加值是字符串 `'+1'`；`signedNumber` 已在该脚本中存在。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run --config vitest.config.ts server/test/character-rule-catalog.test.ts`
Expected: PASS。

- [ ] **Step 5: 下载真实数据并重建目录**

Run: `npm run data:update && npm run data:character-rules`
Expected: 两个脚本成功；`items-base.json` 下载成功（CN 镜像优先，失败时 upstream 兜底）。
验证（node 一次性检查）：

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('data/db/character-options.json','utf8'));const s=d.options.find(o=>o.kind==='item'&&o.nameEn==='Longsword');console.log(JSON.stringify(s&&s.item));if(!s)process.exit(1)"
```

Expected: 输出含 `"damage":"1d8","damageVersatile":"1d10","weaponCategory":"军用"`。

- [ ] **Step 6: 提交**

```bash
git add scripts/data-update.mjs scripts/build-character-rules.mjs server/test/character-rule-catalog.test.ts
git commit -m "feat: 目录构建补基础武器(items-base)与武器属性字段"
```

---

### Task 5: model 层——装备槽选项与解析

**Files:**
- Modify: `client/src/plugins/dnd5e-character-sheet/model.ts`
- Test: `client/src/__tests__/character-sheet-plugin.test.ts`

**Interfaces:**
- Consumes: `optionsForSheet(catalog, sheet, 'item')`（model.ts 已有）。
- Produces（Task 6 消费）:

```ts
export function gearOptionsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): {
  armorOptions: CharacterRuleOption[];   // armorBase !== null 且非盾
  weaponOptions: CharacterRuleOption[];  // item.damage 非空
  offHandOptions: CharacterRuleOption[]; // weaponOptions + 盾（category 以 S 开头）
};
export function resolveGearOption(catalog: CharacterRuleCatalog, reference: CharacterRuleReference | null | undefined): CharacterRuleOption | null;
```

- [ ] **Step 1: 写失败测试**

client 测试文件追加（import 行补 `gearOptionsForSheet, resolveGearOption`）：

```ts
  it('filters gear slot options and resolves stale references', () => {
    const catalog = fallbackCharacterRuleCatalog();
    catalog.options.push(
      { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB', item: { category: 'M', weight: 3, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '1d8', damageType: 'S', range: '', description: '' } },
      { id: 'item:PHB:Shield', kind: 'item', name: '盾牌', nameEn: 'Shield', source: 'PHB', item: { category: 'S', weight: 6, armorBase: 2, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:PHB:Leather Armor', kind: 'item', name: '皮甲', nameEn: 'Leather Armor', source: 'PHB', item: { category: 'LA', weight: 10, armorBase: 11, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
      { id: 'item:TCE:Chef', kind: 'item', name: '厨师用具', nameEn: 'Chef', source: 'TCE', item: { category: 'T', weight: 1, armorBase: null, armorDexCap: null, armorBonus: 0, damage: '', damageType: '', range: '', description: '' } },
    );
    const sheet = emptyDnd5eCharacterSheet();
    sheet.rules.enabledSources = ['PHB'];

    const slots = gearOptionsForSheet(catalog, sheet);
    expect(slots.armorOptions.map(option => option.nameEn)).toEqual(['Leather Armor']);
    expect(slots.weaponOptions.map(option => option.nameEn)).toEqual(['Longsword']);
    expect(slots.offHandOptions.map(option => option.nameEn)).toEqual(['Longsword', 'Shield']);
    expect(resolveGearOption(catalog, sheet.gear.armor)).toBeNull();
    expect(resolveGearOption(catalog, { id: 'item:PHB:Longsword', kind: 'item', name: '长剑', nameEn: 'Longsword', source: 'PHB' })?.nameEn).toBe('Longsword');
  });
```

（`offHandOptions` 顺序：武器在前、盾在后；同组内保持 `optionsForSheet` 的中文排序。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现**

`model.ts` 追加（`splitFeatOptions` 之后）：

```ts
const isShieldItem = (option: CharacterRuleOption) => option.item?.category.startsWith('S') ?? false;

export function gearOptionsForSheet(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): {
  armorOptions: CharacterRuleOption[];
  weaponOptions: CharacterRuleOption[];
  offHandOptions: CharacterRuleOption[];
} {
  const items = optionsForSheet(catalog, sheet, 'item').filter(option => option.item);
  const armorOptions = items.filter(option => option.item!.armorBase !== null && !isShieldItem(option));
  const weaponOptions = items.filter(option => Boolean(option.item!.damage));
  const shieldOptions = items.filter(isShieldItem);
  return { armorOptions, weaponOptions, offHandOptions: [...weaponOptions, ...shieldOptions] };
}

export function resolveGearOption(catalog: CharacterRuleCatalog, reference: CharacterRuleReference | null | undefined): CharacterRuleOption | null {
  return reference ? catalog.options.find(option => option.id === reference.id && option.kind === 'item') ?? null : null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run --config vitest.config.ts client/src/__tests__/character-sheet-plugin.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add client/src/plugins/dnd5e-character-sheet/model.ts client/src/__tests__/character-sheet-plugin.test.ts
git commit -m "feat: model 层装备槽选项过滤与失效引用解析"
```

---

### Task 6: UI——战斗装备面板

**Files:**
- Modify: `client/src/plugins/dnd5e-character-sheet/CharacterSheetEditor.tsx`（import、`InventoryTab`、新 `GearPanel`）

**Interfaces:**
- Consumes: Task 1 `sheet.gear`/`derived.attacks`；Task 5 `gearOptionsForSheet`/`resolveGearOption`；文件内已有 `filterOptions/inputClass/signed/Empty/Panel` 与 `characterRuleReference`（从 `../../types` import，需确认加入 import 列表）。
- Produces: 无外部接口。

- [ ] **Step 1: 更新 import**

`../../types` 的 import 中补 `characterRuleReference`（若尚未导入）；`./model` import 补 `gearOptionsForSheet, resolveGearOption`。

- [ ] **Step 2: InventoryTab 插入面板**

`InventoryTab` 返回结构 `<div className="space-y-4">` 的第一个子元素位置（`<Panel title="负重与货币">` 之前）插入：

```tsx
      <GearPanel catalog={catalog} sheet={sheet} derived={derived} onChange={onChange} />
```

- [ ] **Step 3: 新增 GearPanel 组件**

在 `FeatList` 之后新增：

```tsx
function GearPanel({ catalog, sheet, derived, onChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; onChange(value: Dnd5eCharacterSheet): void }) {
  const { armorOptions, weaponOptions, offHandOptions } = gearOptionsForSheet(catalog, sheet);
  const setGear = (patch: Partial<Dnd5eCharacterSheet['gear']>) => onChange({ ...sheet, gear: { ...sheet.gear, ...patch } });
  const weaponSlotView = (slotName: 'mainHand' | 'offHand') => {
    const slot = sheet.gear[slotName];
    const option = resolveGearOption(catalog, slot?.reference);
    const attack = derived.attacks.find(entry => entry.slot === slotName);
    const label = attack ? (attack.proficient === true ? '熟练' : attack.proficient === false ? '不熟练' : '?') : '';
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <label className="text-xs text-zinc-500">{slotName === 'mainHand' ? '主手武器' : '副手（武器或盾牌）'}<select
          value={slot?.reference.id ?? ''}
          onChange={event => setGear({ [slotName]: event.target.value ? { reference: characterRuleReference((slotName === 'mainHand' ? weaponOptions : offHandOptions).find(option => option.id === event.target.value)!), hitAdjust: slot?.hitAdjust ?? 0, damageAdjust: slot?.damageAdjust ?? 0 } : null } as Partial<Dnd5eCharacterSheet['gear']>)}
          className={inputClass()}
        ><option value="">空手</option>{(slotName === 'mainHand' ? weaponOptions : offHandOptions).map(option => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>
        {slot && !option && <p className="mt-2 text-xs text-red-300">当前所选 {slot.reference.name} 不可用（来源未启用或目录变动）。<button type="button" className="ml-2 text-zinc-400 underline" onClick={() => setGear({ [slotName]: null } as Partial<Dnd5eCharacterSheet['gear']>)}>清空</button></p>}
        {option && slot && !option.item?.damage && <p className="mt-2 text-xs text-zinc-500">盾牌：AC +{2 + (option.item?.armorBonus ?? 0)}</p>}
        {attack && <p className="mt-2 text-sm text-amber-300"><span className="mr-1 rounded bg-zinc-800 px-1 text-[10px] text-zinc-300">{label}</span>命中 {signed(attack.attackBonus)} · 伤害 {attack.damage}{attack.damageBonus ? signed(attack.damageBonus) : ''}{attack.damageType ? `（${attack.damageType}）` : ''}{attack.notes.length ? ` · ${attack.notes.join('、')}` : ''}</p>}
        {attack && <div className="mt-2 grid grid-cols-2 gap-2"><LabeledNumber compact label="命中微调" value={slot.hitAdjust} min={-20} max={20} onChange={value => setGear({ [slotName]: { ...slot, hitAdjust: value } } as Partial<Dnd5eCharacterSheet['gear']>)} /><LabeledNumber compact label="伤害微调" value={slot.damageAdjust} min={-20} max={20} onChange={value => setGear({ [slotName]: { ...slot, damageAdjust: value } } as Partial<Dnd5eCharacterSheet['gear']>)} /></div>}
      </div>
    );
  };
  const armorOption = resolveGearOption(catalog, sheet.gear.armor);
  return <Panel title="战斗装备">
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-zinc-500">护甲<select value={sheet.gear.armor?.id ?? ''} onChange={event => setGear({ armor: event.target.value ? characterRuleReference(armorOptions.find(option => option.id === event.target.value)!) : null })} className={inputClass()}><option value="">无护甲</option>{armorOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>
      {weaponSlotView('mainHand')}
      {weaponSlotView('offHand')}
    </div>
    <div className="mt-3 grid grid-cols-3 gap-3">
      <StatBox label="护甲等级 AC" value={derived.armorClass} />
      <StatBox label="熟练加值" value={signed(derived.proficiencyBonus)} />
      <StatBox label="先攻" value={signed(derived.initiative)} />
    </div>
    {sheet.gear.armor && !armorOption && <p className="mt-2 text-xs text-red-300">当前护甲 {sheet.gear.armor.name} 不可用。<button type="button" className="ml-2 text-zinc-400 underline" onClick={() => setGear({ armor: null })}>清空</button></p>}
  </Panel>;
}
```

实现说明（非占位）：`attack` 的 `slot` 选择器下拉在武器选项为空数组时自然只显示"空手"；`setGear` 的键值断言是 React 状态更新的薄封装，不改变引擎计算。

- [ ] **Step 4: 全量验证**

Run: `npm test && npm run build`
Expected: domain 全部通过、worker 4 文件 44 用例通过、vite 构建成功、worker tsc 无错误（预存的两个根 tsconfig 错误除外，均不在本次改动文件）。

- [ ] **Step 5: 提交**

```bash
git add client/src/plugins/dnd5e-character-sheet/CharacterSheetEditor.tsx
git commit -m "feat: 装备页战斗装备面板——槽位选择与自动命中伤害显示"
```

---

### Task 7: 数据发布与线上部署

**Files:** 无代码改动（数据与部署）。

- [ ] **Step 1: 数据已重建确认**（承接 Task 4 Step 5；若 Task 4 已做则跳过）

- [ ] **Step 2: 上传目录到 R2**

```bash
npx wrangler r2 object put dnd-dm-tool-reference-data/compendium/books/character-options.json --file data/db/character-options.json --content-type application/json --remote
```

Expected: Upload complete。

- [ ] **Step 3: 部署 Worker 与客户端**

```bash
PUBLIC_SITE_DOMAIN=dnd.xiejiaxue.com npm run deploy:production
```

Expected: 部署成功并输出 `dnd.xiejiaxue.com (custom domain)` 与版本 ID。

- [ ] **Step 4: 线上验证**

```bash
curl -s https://dnd.xiejiaxue.com/ | grep -oE '/assets/index-[^"]+\.js' | head -1
ls client/dist/assets/index-*.js | head -1
```

Expected: 两者 hash 一致。R2 回读验证：

```bash
npx wrangler r2 object get dnd-dm-tool-reference-data/compendium/books/character-options.json --file /tmp/gear-verify.json --remote && node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/gear-verify.json','utf8'));const s=d.options.find(o=>o.kind==='item'&&o.nameEn==='Longsword');console.log(s?.item?.damageVersatile)"
```

Expected: `1d10`。

---

## 自审记录

- 规格覆盖：数据层 items-base+字段（Task 4）、盾牌 AC 与护甲槽（Task 2）、attacks 全规则含熟练标签/两用/副手/微调/魔法加值（Task 3）、schema 规范化与旧卡兼容（Task 1）、槽位直选资料库+失效引用（Task 5/6）、显示格式 `[标签] 命中 +n · 伤害 1d8+m（类型）`（Task 6 Step 3）、部署（Task 7）。
- 占位符扫描：无 TBD；无"先写错再修正"式步骤（自审时已改正：Task 2 测试 AC 期望 12→13→16、Task 3 测试攻击加值按 1 级熟练 +2 重算、月镰 `proficient: false` 断言、data-update 修改并入 Task 4 Step 3）。
- 类型一致性：`CharacterWeaponSlot.reference` 非空（校验层保证，spec 草图的 `| null` 收紧为槽级 null）；`gearOptionsForSheet/resolveGearOption` 签名在 Task 5 定义、Task 6 消费一致；`DerivedAttack` 字段与 Task 6 渲染字段一一对应。
