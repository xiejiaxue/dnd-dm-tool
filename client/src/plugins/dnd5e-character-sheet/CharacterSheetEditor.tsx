import { useState } from 'react';
import {
  DND5E_ABILITIES,
  DND5E_SKILLS,
  characterRuleReference,
  pointBuyCost,
  type AbilityKey,
  type CharacterInventoryEntry,
  type CharacterRuleCatalog,
  type CharacterRuleOption,
  type Dnd5eCharacterSheet,
  type Dnd5eDerivedCharacter,
} from '../../types';
import {
  abilityBonusChoiceSlots,
  gearOptionsForSheet,
  itemsForSheet,
  optionsForSheet,
  resolveGearOption,
  selectedReference,
  spellsForSheet,
  splitFeatOptions,
  subclassesForSheet,
  toggleRuleReference,
} from './model';

type EditorTab = 'play' | 'build' | 'abilities' | 'training' | 'features' | 'spells' | 'inventory' | 'story';

const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力',
};

interface Props {
  catalog: CharacterRuleCatalog;
  sheet: Dnd5eCharacterSheet;
  derived: Dnd5eDerivedCharacter;
  color: string;
  onColor(value: string): void;
  onChange(value: Dnd5eCharacterSheet): void;
  onLiveChange(value: Dnd5eCharacterSheet): void;
}

export default function CharacterSheetEditor(props: Props) {
  const { catalog, sheet, derived, color, onColor, onChange, onLiveChange } = props;
  const [tab, setTab] = useState<EditorTab>('play');
  const [query, setQuery] = useState('');
  const [lastRoll, setLastRoll] = useState<{ label: string; roll: number; modifier: number; total: number } | null>(null);
  const roll = (label: string, modifier: number) => {
    const die = Math.floor(Math.random() * 20) + 1;
    setLastRoll({ label, roll: die, modifier, total: die + modifier });
  };

  return <>
    <CharacterHeader sheet={sheet} derived={derived} color={color} onColor={onColor} onChange={onChange} />
    <nav className="mb-5 flex overflow-x-auto border-b border-zinc-800" aria-label="角色卡栏目">
      {(['play', 'build', 'abilities', 'training', 'features', 'spells', 'inventory', 'story'] as EditorTab[]).map(value => (
        <button key={value} type="button" onClick={() => { setTab(value); setQuery(''); }} className={`shrink-0 border-b-2 px-4 py-2 text-sm ${tab === value ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-200'}`}>{tabLabel(value)}</button>
      ))}
    </nav>
    {lastRoll && <div role="status" className="mb-4 flex items-center gap-3 rounded-lg border border-violet-500/20 bg-violet-950/20 px-4 py-2 text-sm"><span className="text-zinc-400">{lastRoll.label}</span><span className="ml-auto text-xs text-zinc-500">d20 {lastRoll.roll} {signed(lastRoll.modifier)}</span><strong className="text-xl text-violet-300">{lastRoll.total}</strong><button type="button" onClick={() => setLastRoll(null)} className="text-zinc-600" title="关闭掷骰结果">×</button></div>}
    {tab === 'play' && <PlayTab sheet={sheet} derived={derived} onChange={onLiveChange} onRoll={roll} />}
    {tab === 'build' && <BuildTab catalog={catalog} sheet={sheet} onChange={onChange} />}
    {tab === 'abilities' && <AbilitiesTab catalog={catalog} sheet={sheet} derived={derived} onChange={onChange} />}
    {tab === 'training' && <TrainingTab catalog={catalog} sheet={sheet} derived={derived} onChange={onChange} onRoll={roll} />}
    {tab === 'features' && <FeaturesTab catalog={catalog} sheet={sheet} derived={derived} query={query} onQuery={setQuery} onChange={onChange} />}
    {tab === 'spells' && <SpellsTab catalog={catalog} sheet={sheet} derived={derived} query={query} onQuery={setQuery} onChange={onChange} onLiveChange={onLiveChange} />}
    {tab === 'inventory' && <InventoryTab catalog={catalog} sheet={sheet} derived={derived} query={query} onQuery={setQuery} onChange={onChange} />}
    {tab === 'story' && <StoryTab sheet={sheet} onChange={onChange} />}
  </>;
}

function CharacterHeader({ sheet, derived, color, onColor, onChange }: Pick<Props, 'sheet' | 'derived' | 'color' | 'onColor' | 'onChange'>) {
  return <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-zinc-700 text-2xl font-semibold" style={{ backgroundColor: `${color}33`, color }}>
        {sheet.identity.avatarUrl ? <img src={sheet.identity.avatarUrl} alt="" className="h-full w-full object-cover" /> : sheet.identity.characterName.trim().slice(0, 1) || '?'}
      </div>
      <label className="min-w-[220px] flex-1 text-xs text-zinc-500">角色名称<input value={sheet.identity.characterName} maxLength={120} onChange={event => onChange({ ...sheet, identity: { ...sheet.identity, characterName: event.target.value } })} className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-base font-semibold text-zinc-100 outline-none focus:border-amber-500" /></label>
      <label className="text-xs text-zinc-500">主题色<input type="color" value={color} onChange={event => onColor(event.target.value)} className="mt-1 block h-10 w-20 rounded bg-zinc-800" /></label>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
      <Summary label="等级" value={sheet.advancement.level} />
      <Summary label="熟练加值" value={signed(derived.proficiencyBonus)} />
      <Summary label="护甲等级" value={derived.armorClass} />
      <Summary label="先攻" value={signed(derived.initiative)} />
      <Summary label="速度" value={`${derived.speed} 尺`} />
      <Summary label="被动察觉" value={derived.passivePerception} />
    </div>
  </div>;
}

function PlayTab({ sheet, derived, onChange, onRoll }: { sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; onChange(value: Dnd5eCharacterSheet): void; onRoll(label: string, modifier: number): void }) {
  const hp = sheet.combat.hitPoints;
  const applyDamage = (amount: number) => {
    let temporary = hp.temporary;
    let current = hp.current;
    if (amount > 0) {
      const absorbed = Math.min(temporary, amount);
      temporary -= absorbed;
      current = Math.max(0, current - (amount - absorbed));
    } else current = Math.min(derived.hitPointsMaximum, current - amount);
    onChange({ ...sheet, combat: { ...sheet.combat, hitPoints: { ...hp, current, temporary } } });
  };
  const useHitDie = () => {
    if (derived.hitDiceRemaining <= 0) return;
    const healing = Math.max(1, Math.floor(Math.random() * derived.hitDie) + 1 + derived.modifiers.con);
    onChange({
      ...sheet,
      combat: { ...sheet.combat, hitPoints: { ...hp, current: Math.min(derived.hitPointsMaximum, hp.current + healing) } },
      play: { ...sheet.play, hitDiceSpent: sheet.play.hitDiceSpent + 1 },
    });
  };
  const longRest = () => onChange({
    ...sheet,
    combat: { ...sheet.combat, hitPoints: { ...hp, current: derived.hitPointsMaximum, temporary: 0 } },
    play: {
      ...sheet.play,
      deathSaves: { successes: 0, failures: 0 },
      hitDiceSpent: Math.max(0, sheet.play.hitDiceSpent - Math.max(1, Math.floor(sheet.advancement.level / 2))),
      spellSlotsUsed: {},
      featureUses: {},
      conditions: [],
    },
  });
  return <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
    <div className="space-y-4">
      <Panel title="生命与休息">
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="当前生命" value={hp.current} strong />
          <StatBox label="最大生命" value={derived.hitPointsMaximum} />
          <StatBox label="临时生命" value={hp.temporary} />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <ActionButton label="受到 1 点伤害" onClick={() => applyDamage(1)}>−1 HP</ActionButton>
          <ActionButton label="恢复 1 点生命" onClick={() => applyDamage(-1)}>＋1 HP</ActionButton>
          <ActionButton label={`消耗 1 枚 d${derived.hitDie} 生命骰并自动治疗`} onClick={useHitDie} disabled={derived.hitDiceRemaining <= 0}>生命骰 {derived.hitDiceRemaining}/{sheet.advancement.level}</ActionButton>
          <ActionButton label="恢复生命、法术位、特性次数和部分生命骰" onClick={longRest}>长休</ActionButton>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <LabeledNumber label="直接设置当前 HP" value={hp.current} min={0} max={derived.hitPointsMaximum} onChange={value => onChange({ ...sheet, combat: { ...sheet.combat, hitPoints: { ...hp, current: value } } })} />
          <LabeledNumber label="临时 HP" value={hp.temporary} min={0} max={100000} onChange={value => onChange({ ...sheet, combat: { ...sheet.combat, hitPoints: { ...hp, temporary: value } } })} />
        </div>
      </Panel>
      <Panel title="死亡豁免与状态">
        <div className="grid gap-3 sm:grid-cols-2">
          <DeathSaves label="成功" value={sheet.play.deathSaves.successes} onChange={successes => onChange({ ...sheet, play: { ...sheet.play, deathSaves: { ...sheet.play.deathSaves, successes } } })} />
          <DeathSaves label="失败" value={sheet.play.deathSaves.failures} danger onChange={failures => onChange({ ...sheet, play: { ...sheet.play, deathSaves: { ...sheet.play.deathSaves, failures } } })} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={sheet.play.inspiration} onChange={event => onChange({ ...sheet, play: { ...sheet.play, inspiration: event.target.checked } })} className="accent-amber-500" />拥有激励</label>
      </Panel>
    </div>
    <div className="space-y-4">
      <Panel title="常用检定">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DND5E_ABILITIES.map(key => <button key={key} type="button" onClick={() => onRoll(`${ABILITY_LABELS[key]}检定`, derived.modifiers[key])} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-left hover:border-violet-500/40"><span className="block text-xs text-zinc-500">{ABILITY_LABELS[key]}</span><strong className="text-lg">{signed(derived.modifiers[key])}</strong></button>)}
        </div>
      </Panel>
      <Panel title="豁免">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{DND5E_ABILITIES.map(key => <button key={key} type="button" onClick={() => onRoll(`${ABILITY_LABELS[key]}豁免`, derived.savingThrows[key])} className="flex items-center rounded border border-zinc-800 px-3 py-2 text-sm hover:border-violet-500/40"><span>{derived.savingThrowProficiencies.includes(key) ? '●' : '○'} {ABILITY_LABELS[key]}</span><strong className="ml-auto">{signed(derived.savingThrows[key])}</strong></button>)}</div>
      </Panel>
      {derived.spellcasting.ability && <Panel title="施法"><div className="grid grid-cols-3 gap-3"><StatBox label="施法属性" value={ABILITY_LABELS[derived.spellcasting.ability]} /><StatBox label="法术豁免 DC" value={derived.spellcasting.saveDc ?? '—'} /><StatBox label="法术攻击" value={signed(derived.spellcasting.attackBonus ?? 0)} /></div></Panel>}
    </div>
  </div>;
}

function BuildTab({ catalog, sheet, onChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; onChange(value: Dnd5eCharacterSheet): void }) {
  const races = optionsForSheet(catalog, sheet, 'race');
  const classes = optionsForSheet(catalog, sheet, 'class');
  const subclasses = subclassesForSheet(catalog, sheet);
  const backgrounds = optionsForSheet(catalog, sheet, 'background');
  const choose = (kind: 'race' | 'class' | 'subclass' | 'background', id: string, options: CharacterRuleOption[]) => {
    const reference = selectedReference(options.find(option => option.id === id));
    onChange({
      ...sheet,
      advancement: { ...sheet.advancement, [kind]: reference, ...(kind === 'class' ? { subclass: null } : {}) },
      abilityGeneration: kind === 'race' || kind === 'background' ? { ...sheet.abilityGeneration, bonusChoices: [] } : sheet.abilityGeneration,
    });
  };
  return <div className="grid gap-4 lg:grid-cols-2">
    <Panel title="身份"><div className="grid gap-3 sm:grid-cols-2">
      <TextField label="玩家名称" value={sheet.identity.playerName} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, playerName: value } })} />
      <TextField label="代词" value={sheet.identity.pronouns} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, pronouns: value } })} />
      <TextField label="阵营" value={sheet.identity.alignment} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, alignment: value } })} />
      <TextField label="信仰神祇" value={sheet.identity.faith} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, faith: value } })} />
      <TextField label="年龄" value={sheet.identity.age} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, age: value } })} />
      <TextField label="体型" value={sheet.identity.size} onChange={value => onChange({ ...sheet, identity: { ...sheet.identity, size: value } })} />
      <label className="text-xs text-zinc-500 sm:col-span-2">头像 URL（HTTPS）<input value={sheet.identity.avatarUrl} onChange={event => onChange({ ...sheet, identity: { ...sheet.identity, avatarUrl: event.target.value } })} className={inputClass()} /></label>
    </div></Panel>
    <Panel title="等级与构筑"><div className="grid gap-3 sm:grid-cols-2">
      <LabeledNumber label="等级" value={sheet.advancement.level} min={1} max={20} onChange={level => onChange({ ...sheet, advancement: { ...sheet.advancement, level } })} />
      <LabeledNumber label="经验值" value={sheet.advancement.experience} min={0} max={99999999} onChange={experience => onChange({ ...sheet, advancement: { ...sheet.advancement, experience } })} />
      <RuleSelect label="种族" value={sheet.advancement.race?.id ?? ''} options={races} onChange={id => choose('race', id, races)} />
      <RuleSelect label="职业" value={sheet.advancement.class?.id ?? ''} options={classes} onChange={id => choose('class', id, classes)} />
      <RuleSelect label="子职业" value={sheet.advancement.subclass?.id ?? ''} options={subclasses} disabled={!sheet.advancement.class} onChange={id => choose('subclass', id, subclasses)} />
      <RuleSelect label="背景" value={sheet.advancement.background?.id ?? ''} options={backgrounds} onChange={id => choose('background', id, backgrounds)} />
    </div></Panel>
  </div>;
}

function AbilitiesTab({ catalog, sheet, derived, onChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; onChange(value: Dnd5eCharacterSheet): void }) {
  const slots = abilityBonusChoiceSlots(catalog, sheet);
  const setBase = (key: AbilityKey, score: number) => onChange({ ...sheet, abilityGeneration: { ...sheet.abilityGeneration, base: { ...sheet.abilityGeneration.base, [key]: score } } });
  return <div className="space-y-4">
    <Panel title="27 点属性购点">
      <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${derived.pointBuyValid ? 'border-emerald-500/20 bg-emerald-950/20 text-emerald-300' : 'border-red-500/30 bg-red-950/30 text-red-300'}`}>已用 {derived.pointBuySpent} / 27 点，剩余 {derived.pointBuyRemaining} 点。基础值只能为 8–15，种族加值在之后自动叠加。</div>
      <label className="mb-4 flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={sheet.abilityGeneration.useRuleBonuses} onChange={event => onChange({ ...sheet, abilityGeneration: { ...sheet.abilityGeneration, useRuleBonuses: event.target.checked } })} className="accent-amber-500" />自动应用种族/背景规则加值{!sheet.abilityGeneration.useRuleBonuses && <span className="text-amber-400">（旧卡兼容模式）</span>}</label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {DND5E_ABILITIES.map(key => {
          const base = sheet.abilityGeneration.base[key];
          const increaseCost = base < 15 ? pointBuyCost(base + 1) - pointBuyCost(base) : 99;
          return <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-center">
            <span className="text-xs text-zinc-500">{ABILITY_LABELS[key]}</span>
            <div className="mt-2 flex items-center justify-center gap-2"><button type="button" onClick={() => setBase(key, base - 1)} disabled={base <= 8} className="h-8 w-8 rounded bg-zinc-800 disabled:opacity-30" title={`降低${ABILITY_LABELS[key]}`}>−</button><strong className="w-8 text-2xl">{base}</strong><button type="button" onClick={() => setBase(key, base + 1)} disabled={base >= 15 || derived.pointBuyRemaining < increaseCost} className="h-8 w-8 rounded bg-zinc-800 disabled:opacity-30" title={`提高${ABILITY_LABELS[key]}`}>＋</button></div>
            <p className="mt-2 text-[10px] text-zinc-600">购点 {pointBuyCost(base)} · 种族 {signed(derived.racialBonuses[key])}</p>
            <p className="mt-1 text-sm text-amber-300">最终 {derived.abilities[key]} ({signed(derived.modifiers[key])})</p>
          </div>;
        })}
      </div>
    </Panel>
    {slots.length > 0 && <Panel title="可选属性加值"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{slots.map((slot, index) => <label key={`${slot.label}-${index}`} className="text-xs text-zinc-500">{slot.label}：+{slot.amount}<select value={sheet.abilityGeneration.bonusChoices[index] ?? ''} onChange={event => { const bonusChoices = [...sheet.abilityGeneration.bonusChoices]; bonusChoices[index] = event.target.value as AbilityKey; onChange({ ...sheet, abilityGeneration: { ...sheet.abilityGeneration, bonusChoices } }); }} className={inputClass()}><option value="">请选择属性</option>{slot.from.map(key => <option key={key} value={key} disabled={sheet.abilityGeneration.bonusChoices.some((choice, choiceIndex) => choiceIndex !== index && choice === key)}>{ABILITY_LABELS[key]}</option>)}</select></label>)}</div></Panel>}
    <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"><summary className="cursor-pointer text-sm text-zinc-400">自定义属性加值（房规、升级或特殊奖励）</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{DND5E_ABILITIES.map(key => <LabeledNumber key={key} label={ABILITY_LABELS[key]} value={sheet.abilityGeneration.customBonuses[key]} min={-10} max={20} onChange={value => onChange({ ...sheet, abilityGeneration: { ...sheet.abilityGeneration, customBonuses: { ...sheet.abilityGeneration.customBonuses, [key]: value } } })} />)}</div></details>
  </div>;
}

function TrainingTab({ catalog, sheet, derived, onChange, onRoll }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; onChange(value: Dnd5eCharacterSheet): void; onRoll(label: string, modifier: number): void }) {
  const options = selectedBuildOptions(catalog, sheet);
  const fixed = new Set(options.flatMap(option => option.skillProficiencies ?? []).map(normalizeSkill));
  const choices = options.flatMap(option => option.skillChoices ?? []);
  const allowed = new Set(choices.flatMap(choice => choice.from.map(normalizeSkill)));
  const capacity = choices.reduce((sum, choice) => sum + choice.count, 0);
  const selected = sheet.training.skills.filter(skill => allowed.has(normalizeSkill(skill)));
  const toggle = (id: string) => {
    const has = sheet.training.skills.includes(id);
    if (!has && selected.length >= capacity && !fixed.has(id)) return;
    onChange({ ...sheet, training: { ...sheet.training, skills: has ? sheet.training.skills.filter(skill => skill !== id) : [...sheet.training.skills, id] } });
  };
  const toggleExpertise = (id: string) => onChange({ ...sheet, training: { ...sheet.training, expertise: sheet.training.expertise.includes(id) ? sheet.training.expertise.filter(skill => skill !== id) : [...sheet.training.expertise, id] } });
  return <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
    <Panel title="技能"><p className="mb-3 text-xs text-zinc-500">职业/种族可选技能：{selected.length}/{capacity}。实心圆为熟练，双圆为专精。</p><div className="grid gap-2 sm:grid-cols-2">{derived.skills.map(skill => {
      const isFixed = fixed.has(skill.id);
      const canSelect = allowed.has(skill.id);
      return <div key={skill.id} className="flex items-center gap-2 rounded border border-zinc-800 px-3 py-2 text-sm"><button type="button" onClick={() => onRoll(`${skill.name}检定`, skill.modifier)} className="min-w-0 flex-1 text-left hover:text-violet-300" title="掷 d20 检定"><span className="mr-2 text-zinc-600">{ABILITY_LABELS[skill.ability]}</span>{skill.name}</button><strong>{signed(skill.modifier)}</strong>{(isFixed || canSelect || sheet.training.skills.includes(skill.id)) && <button type="button" disabled={isFixed} onClick={() => toggle(skill.id)} className="w-7 text-amber-300 disabled:cursor-default" title={isFixed ? '由种族、职业或背景自动获得' : '切换技能熟练'}>{skill.rank > 0 ? '●' : '○'}</button>}{skill.rank > 0 && <button type="button" onClick={() => toggleExpertise(skill.id)} className="w-7 text-violet-300" title="切换专精">{skill.rank === 2 ? '◎' : '○'}</button>}</div>;
    })}</div></Panel>
    <div className="space-y-4"><Panel title="自动熟练项"><ProficiencyGroup label="护甲" values={derived.proficiencies.armor} /><ProficiencyGroup label="武器" values={derived.proficiencies.weapons} /><ProficiencyGroup label="工具" values={derived.proficiencies.tools} /><ProficiencyGroup label="语言" values={derived.proficiencies.languages} /></Panel><Panel title="自定义熟练项"><ListField label="护甲" values={sheet.training.armor} onChange={armor => onChange({ ...sheet, training: { ...sheet.training, armor } })} /><ListField label="武器" values={sheet.training.weapons} onChange={weapons => onChange({ ...sheet, training: { ...sheet.training, weapons } })} /><ListField label="工具" values={sheet.training.tools} onChange={tools => onChange({ ...sheet, training: { ...sheet.training, tools } })} /><ListField label="语言" values={sheet.training.languages} onChange={languages => onChange({ ...sheet, training: { ...sheet.training, languages } })} /></Panel></div>
  </div>;
}

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

function SpellsTab({ catalog, sheet, derived, query, onQuery, onChange, onLiveChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; query: string; onQuery(value: string): void; onChange(value: Dnd5eCharacterSheet): void; onLiveChange(value: Dnd5eCharacterSheet): void }) {
  const spells = spellsForSheet(catalog, sheet);
  const selectedOptions = sheet.spells.map(reference => ({ reference, option: catalog.options.find(option => option.id === reference.id) })).sort((a, b) => (a.reference.level ?? 0) - (b.reference.level ?? 0));
  const useSlot = (level: number, delta: number) => {
    const slot = derived.spellcasting.slots.find(entry => entry.level === level);
    if (!slot) return;
    const used = Math.max(0, Math.min(slot.maximum, slot.used + delta));
    onLiveChange({ ...sheet, play: { ...sheet.play, spellSlotsUsed: { ...sheet.play.spellSlotsUsed, [String(level)]: used } } });
  };
  return <div className="space-y-4">
    <Panel title="施法数据"><div className="grid gap-3 sm:grid-cols-3"><StatBox label="施法属性" value={derived.spellcasting.ability ? ABILITY_LABELS[derived.spellcasting.ability] : '无'} /><StatBox label="法术豁免 DC" value={derived.spellcasting.saveDc ?? '—'} /><StatBox label="法术攻击" value={derived.spellcasting.attackBonus === null ? '—' : signed(derived.spellcasting.attackBonus)} /></div>{derived.spellcasting.slots.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{derived.spellcasting.slots.map(slot => <div key={slot.level} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs"><span>{slot.level} 环</span><button type="button" onClick={() => useSlot(slot.level, 1)} disabled={slot.remaining <= 0} className="rounded bg-zinc-800 px-2 py-1 disabled:opacity-30" title="消耗一个法术位">消耗</button><strong className="text-amber-300">{slot.remaining}/{slot.maximum}</strong><button type="button" onClick={() => useSlot(slot.level, -1)} disabled={slot.used <= 0} className="rounded bg-zinc-800 px-2 py-1 disabled:opacity-30" title="恢复一个法术位">恢复</button></div>)}</div>}</Panel>
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]"><Panel title={`已有法术（${selectedOptions.length}）`}><div className="space-y-2">{selectedOptions.map(({ reference, option }) => <details key={reference.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><summary className="flex cursor-pointer items-center gap-2 text-sm"><strong className="min-w-0 flex-1 truncate">{reference.name}</strong><span className="text-xs text-zinc-500">{reference.level ? `${reference.level} 环` : '戏法'} · {reference.source}</span><label className="flex items-center gap-1 text-xs text-emerald-300" onClick={event => event.stopPropagation()}><input type="checkbox" checked={reference.prepared !== false} onChange={event => onChange({ ...sheet, spells: sheet.spells.map(spell => spell.id === reference.id ? { ...spell, prepared: event.target.checked } : spell) })} />准备</label></summary>{option?.spell && <div className="mt-2 text-xs leading-5 text-zinc-400"><p className="text-zinc-500">{[option.spell.school, option.spell.castingTime, option.spell.range, option.spell.duration, option.spell.concentration ? '专注' : '', option.spell.ritual ? '仪式' : ''].filter(Boolean).join(' · ')}</p><p className="mt-1 whitespace-pre-wrap">{option.spell.description}</p></div>}</details>)}{selectedOptions.length === 0 && <Empty>从右侧选择职业法术。</Empty>}</div></Panel><Panel title="法术书"><RulePicker title="法术" query={query} onQuery={onQuery} options={spells} selectedIds={new Set(sheet.spells.map(item => item.id))} onToggle={option => onChange({ ...sheet, spells: toggleRuleReference(sheet.spells, option) })} showLevel /></Panel></div>
  </div>;
}

function InventoryTab({ catalog, sheet, derived, query, onQuery, onChange }: { catalog: CharacterRuleCatalog; sheet: Dnd5eCharacterSheet; derived: Dnd5eDerivedCharacter; query: string; onQuery(value: string): void; onChange(value: Dnd5eCharacterSheet): void }) {
  const items = itemsForSheet(catalog, sheet);
  const visibleItems = filterOptions(items, query).slice(0, 100);
  const addItem = (option?: CharacterRuleOption) => {
    const entry: CharacterInventoryEntry = {
      id: crypto.randomUUID(), item: option ? characterRuleReference(option) : null,
      name: option?.name ?? '自定义物品', quantity: 1, weight: option?.item?.weight ?? 0,
      equipped: false, attuned: false, notes: '',
    };
    onChange({ ...sheet, inventory: [...sheet.inventory, entry] });
  };
  const update = (id: string, patch: Partial<CharacterInventoryEntry>) => onChange({ ...sheet, inventory: sheet.inventory.map(item => item.id === id ? { ...item, ...patch } : item) });
  return <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
    <div className="space-y-4"><GearPanel catalog={catalog} sheet={sheet} derived={derived} onChange={onChange} /><Panel title="负重与货币"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><StatBox label="当前负重" value={`${formatNumber(derived.equipmentWeight)} 磅`} /><StatBox label="负重上限" value={`${derived.carryingCapacity} 磅`} /><StatBox label="物品条目" value={derived.equipment.length} /><StatBox label="已同调" value={`${sheet.inventory.filter(item => item.attuned).length}/3`} /></div><div className="mt-3 grid grid-cols-5 gap-2">{(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map(key => <LabeledNumber key={key} label={key.toUpperCase()} value={sheet.currency[key]} min={0} max={100000000} onChange={value => onChange({ ...sheet, currency: { ...sheet.currency, [key]: value } })} />)}</div></Panel>
      <Panel title="装备与物品"><div className="space-y-2">{derived.equipment.map(entry => <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><div className="flex flex-wrap items-center gap-2"><div className="min-w-[140px] flex-1"><strong className="block text-sm">{entry.name}</strong><span className="text-[10px] text-zinc-600">{entry.automatic ? '职业/背景自动获得' : entry.item ? `${entry.item.source} · ${formatNumber(entry.weight)} 磅` : '自定义物品'}</span></div>{!entry.automatic && <><LabeledNumber compact label="数量" value={entry.quantity} min={0} max={100000} onChange={quantity => update(entry.id, { quantity })} /><label className="text-xs text-zinc-500"><input type="checkbox" checked={entry.equipped} onChange={event => update(entry.id, { equipped: event.target.checked })} /> 装备</label><label className="text-xs text-zinc-500"><input type="checkbox" checked={entry.attuned} onChange={event => update(entry.id, { attuned: event.target.checked })} /> 同调</label><button type="button" onClick={() => onChange({ ...sheet, inventory: sheet.inventory.filter(item => item.id !== entry.id) })} className="text-zinc-600 hover:text-red-300" title={`移除 ${entry.name}`}>×</button></>}</div></div>)}{derived.equipment.length === 0 && <Empty>选择职业、背景，或从右侧添加物品。</Empty>}</div></Panel></div>
    <Panel title="物品资料库"><label className="text-xs text-zinc-500">搜索物品<input value={query} onChange={event => onQuery(event.target.value)} placeholder="中文、英文或来源" className={inputClass()} /></label><button type="button" onClick={() => addItem()} className="mt-2 w-full rounded border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-amber-500/40 hover:text-amber-300">添加自定义物品</button><div className="mt-3 max-h-[60vh] overflow-y-auto">{visibleItems.map(option => <button key={option.id} type="button" onClick={() => addItem(option)} className="flex w-full items-center gap-2 border-b border-zinc-800/70 px-2 py-2 text-left hover:bg-zinc-800"><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{option.name}</strong><span className="block truncate text-[10px] text-zinc-600">{option.nameEn} · {option.source}{option.item?.weight ? ` · ${option.item.weight} 磅` : ''}</span></span><span className="text-amber-300">添加</span></button>)}</div></Panel>
  </div>;
}

function StoryTab({ sheet, onChange }: { sheet: Dnd5eCharacterSheet; onChange(value: Dnd5eCharacterSheet): void }) {
  return <div className="grid gap-4 lg:grid-cols-2"><Panel title="人物设定"><TextArea label="人物背景与经历" value={sheet.biography} onChange={biography => onChange({ ...sheet, biography })} /><div className="mt-3 grid gap-3 sm:grid-cols-2"><TextArea compact label="个性特点" value={sheet.roleplay.personalityTraits} onChange={personalityTraits => onChange({ ...sheet, roleplay: { ...sheet.roleplay, personalityTraits } })} /><TextArea compact label="理念" value={sheet.roleplay.ideals} onChange={ideals => onChange({ ...sheet, roleplay: { ...sheet.roleplay, ideals } })} /><TextArea compact label="羁绊" value={sheet.roleplay.bonds} onChange={bonds => onChange({ ...sheet, roleplay: { ...sheet.roleplay, bonds } })} /><TextArea compact label="缺点" value={sheet.roleplay.flaws} onChange={flaws => onChange({ ...sheet, roleplay: { ...sheet.roleplay, flaws } })} /></div></Panel><Panel title="记录"><TextArea label="角色备注" value={sheet.notes} onChange={notes => onChange({ ...sheet, notes })} /><div className="mt-3"><TextArea compact label="盟军与组织" value={sheet.roleplay.organizations} onChange={organizations => onChange({ ...sheet, roleplay: { ...sheet.roleplay, organizations } })} /></div></Panel></div>;
}

function selectedBuildOptions(catalog: CharacterRuleCatalog, sheet: Dnd5eCharacterSheet): CharacterRuleOption[] {
  const ids = [sheet.advancement.race?.id, sheet.advancement.class?.id, sheet.advancement.subclass?.id, sheet.advancement.background?.id];
  return ids.flatMap(id => id ? catalog.options.find(option => option.id === id) ?? [] : []);
}

function RulePicker({ title, query, onQuery, options, selectedIds, onToggle, showLevel = false }: { title: string; query: string; onQuery(value: string): void; options: CharacterRuleOption[]; selectedIds: ReadonlySet<string>; onToggle(option: CharacterRuleOption): void; showLevel?: boolean }) {
  const visible = filterOptions(options, query);
  return <section><div className="mb-3 flex items-end gap-3"><label className="min-w-0 flex-1 text-xs text-zinc-500">搜索{title}<input value={query} onChange={event => onQuery(event.target.value)} placeholder={`按中文、英文或来源搜索${title}`} className={inputClass()} /></label><span className="pb-2 text-xs text-zinc-500">已选 {selectedIds.size}</span></div><div className="grid max-h-[55vh] gap-2 overflow-y-auto">{visible.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${selectedIds.has(option.id) ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'}`}><input type="checkbox" checked={selectedIds.has(option.id)} onChange={() => onToggle(option)} className="mt-0.5 accent-amber-500" /><span className="min-w-0"><strong className="block truncate text-sm text-zinc-200">{option.name}</strong><span className="block truncate text-[11px] text-zinc-500">{option.nameEn} · {option.source}{showLevel && option.level !== undefined ? ` · ${option.level}环` : ''}</span></span></label>)}</div>{visible.length === 0 && <Empty>已启用规则中没有匹配的{title}。</Empty>}</section>;
}

function FeatList({ title, count, emptyText, options, selectedIds, onToggle }: { title: string; count: number; emptyText: string; options: CharacterRuleOption[]; selectedIds: ReadonlySet<string>; onToggle(option: CharacterRuleOption): void }) {
  return <section>
    <h3 className="mb-2 text-xs font-medium text-zinc-400">{title}（{count}）</h3>
    {options.length === 0 ? <Empty>{emptyText}</Empty> : <div className="grid gap-2">{options.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${selectedIds.has(option.id) ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'}`}><input type="checkbox" checked={selectedIds.has(option.id)} onChange={() => onToggle(option)} className="mt-0.5 accent-amber-500" /><span className="min-w-0"><strong className="block truncate text-sm text-zinc-200">{option.name}</strong><span className="block truncate text-[11px] text-zinc-500">{option.nameEn} · {option.source}</span></span></label>)}</div>}
  </section>;
}

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

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-200">{title}</h2>{children}</section>; }
function Summary({ label, value }: { label: string; value: React.ReactNode }) { return <div className="rounded-lg bg-zinc-950/60 px-2 py-2 text-center"><span className="block text-[10px] text-zinc-600">{label}</span><strong className="text-sm text-zinc-200">{value}</strong></div>; }
function StatBox({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) { return <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-center"><span className="block text-[10px] text-zinc-500">{label}</span><strong className={`${strong ? 'text-2xl text-emerald-300' : 'text-lg text-zinc-200'}`}>{value}</strong></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-600">{children}</p>; }
function ActionButton({ label, children, disabled, onClick }: { label: string; children: React.ReactNode; disabled?: boolean; onClick(): void }) { return <button type="button" onClick={onClick} disabled={disabled} title={label} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-30">{children}</button>; }
function DeathSaves({ label, value, danger, onChange }: { label: string; value: number; danger?: boolean; onChange(value: number): void }) { return <div className="rounded-lg border border-zinc-800 p-3"><span className="text-xs text-zinc-500">{label}</span><div className="mt-2 flex gap-2">{[1, 2, 3].map(index => <button key={index} type="button" onClick={() => onChange(value === index ? index - 1 : index)} className={`h-8 flex-1 rounded-full border ${index <= value ? danger ? 'border-red-400 bg-red-500/30' : 'border-emerald-400 bg-emerald-500/30' : 'border-zinc-700'}`} title={`设置${label}次数为 ${index}`} />)}</div></div>; }
function RuleSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: CharacterRuleOption[]; disabled?: boolean; onChange(value: string): void }) { return <label className="text-xs text-zinc-500">{label}<select value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className={inputClass()}><option value="">未选择</option>{options.map(option => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>; }
function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className="text-xs text-zinc-500">{label}<input value={value} onChange={event => onChange(event.target.value)} className={inputClass()} /></label>; }
function LabeledNumber({ label, value, min, max, compact, onChange }: { label: string; value: number; min: number; max: number; compact?: boolean; onChange(value: number): void }) { return <label className={`text-xs text-zinc-500 ${compact ? 'w-20' : ''}`}>{label}<input type="number" value={value} min={min} max={max} onChange={event => onChange(clamp(Number(event.target.value), min, max))} className={inputClass()} /></label>; }
function TextArea({ label, value, compact, onChange }: { label: string; value: string; compact?: boolean; onChange(value: string): void }) { return <label className="block text-xs text-zinc-500">{label}<textarea value={value} maxLength={16000} onChange={event => onChange(event.target.value)} className={`mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm leading-6 text-zinc-100 outline-none focus:border-amber-500 ${compact ? 'min-h-28' : 'min-h-48'}`} /></label>; }
function ProficiencyGroup({ label, values }: { label: string; values: string[] }) { return <div className="mb-3"><span className="text-[10px] text-zinc-600">{label}</span><p className="text-xs leading-5 text-zinc-300">{values.length ? values.join('、') : '无'}</p></div>; }
function ListField({ label, values, onChange }: { label: string; values: string[]; onChange(value: string[]): void }) { return <label className="mb-2 block text-xs text-zinc-500">{label}<input value={values.join('、')} onChange={event => onChange(event.target.value.split(/[、,，]/u).map(value => value.trim()).filter(Boolean))} placeholder="用逗号分隔" className={inputClass()} /></label>; }

function filterOptions(options: CharacterRuleOption[], query: string) { const normalized = query.trim().toLocaleLowerCase(); return options.filter(option => !normalized || `${option.name} ${option.nameEn} ${option.source}`.toLocaleLowerCase().includes(normalized)); }
function normalizeSkill(value: string) { return value.trim().toLocaleLowerCase().replaceAll('_', ' '); }
function inputClass() { return 'mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-40'; }
function signed(value: number) { return value >= 0 ? `+${value}` : String(value); }
function formatNumber(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function clamp(value: number, minimum: number, maximum: number) { return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : minimum; }
function tabLabel(value: EditorTab): string { return ({ play: '游玩', build: '身份与构筑', abilities: '属性', training: '熟练项', features: '特性', spells: '法术', inventory: '装备', story: '背景' } as Record<EditorTab, string>)[value]; }
