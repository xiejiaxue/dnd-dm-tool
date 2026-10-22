import type { JsonValue } from './documents';
import type {
  AbilityKey,
  ActiveEffect,
  ActiveEffectChange,
  Dnd5eActorSystem,
  EffectChangeMode,
} from './tabletop-tools';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function emptyActorSystem(): Dnd5eActorSystem {
  return {
    level: 1,
    proficiency: 2,
    armorClass: 10,
    speed: 30,
    hitPoints: { current: 1, max: 1, temporary: 0 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    resources: [],
    biography: '',
    notes: '',
    actions: [],
    items: [],
    effects: [],
  };
}

export function normalizeActorSystem(value: Record<string, JsonValue> | undefined): Dnd5eActorSystem {
  const fallback = emptyActorSystem();
  if (!value) return fallback;
  const abilities = isRecord(value.abilities) ? value.abilities : {};
  const hitPoints = isRecord(value.hitPoints) ? value.hitPoints : {};
  return {
    level: integer(value.level, fallback.level, 0, 30),
    proficiency: integer(value.proficiency, fallback.proficiency, -20, 20),
    armorClass: integer(value.armorClass, fallback.armorClass, 0, 100),
    speed: integer(value.speed, fallback.speed, 0, 1000),
    hitPoints: {
      current: integer(hitPoints.current, fallback.hitPoints.current, 0, 100000),
      max: integer(hitPoints.max, fallback.hitPoints.max, 1, 100000),
      temporary: integer(hitPoints.temporary, fallback.hitPoints.temporary, 0, 100000),
    },
    abilities: Object.fromEntries(ABILITIES.map(key => [key, integer(abilities[key], 10, 0, 40)])) as Record<AbilityKey, number>,
    skills: numberRecord(value.skills),
    resources: Array.isArray(value.resources) ? value.resources.flatMap((entry, index) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return [];
      return [{
        id: typeof entry.id === 'string' ? entry.id : `resource-${index}`,
        name: entry.name.slice(0, 80),
        current: integer(entry.current, 0, 0, 100000),
        max: integer(entry.max, 0, 0, 100000),
      }];
    }) : [],
    biography: typeof value.biography === 'string' ? value.biography : '',
    notes: typeof value.notes === 'string' ? value.notes : '',
    actions: Array.isArray(value.actions) ? value.actions as unknown as Dnd5eActorSystem['actions'] : [],
    items: Array.isArray(value.items) ? value.items as unknown as Dnd5eActorSystem['items'] : [],
    effects: Array.isArray(value.effects) ? value.effects as unknown as Dnd5eActorSystem['effects'] : [],
  };
}

export function actorSystemJson(system: Dnd5eActorSystem): Record<string, JsonValue> {
  return structuredClone(system) as unknown as Record<string, JsonValue>;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function effectiveActorSystem(system: Dnd5eActorSystem): Dnd5eActorSystem {
  const next = structuredClone(system);
  for (const effect of system.effects) {
    if (!effect.enabled || effect.remainingRounds === 0) continue;
    for (const change of effect.changes) applyEffectChange(next, change);
  }
  for (const item of system.items) {
    if (!item.equipped) continue;
    for (const effect of item.effects) {
      if (!effect.enabled || effect.remainingRounds === 0) continue;
      for (const change of effect.changes) applyEffectChange(next, change);
    }
  }
  return next;
}

export function tickActiveEffects(effects: ActiveEffect[]): ActiveEffect[] {
  return effects.map(effect => effect.remainingRounds === null || effect.remainingRounds <= 0
    ? effect
    : { ...effect, remainingRounds: effect.remainingRounds - 1 });
}

export function applyNumericMode(current: number, mode: EffectChangeMode, value: number): number {
  if (mode === 'add') return current + value;
  if (mode === 'multiply') return current * value;
  if (mode === 'upgrade') return Math.max(current, value);
  if (mode === 'downgrade') return Math.min(current, value);
  return value;
}

function applyEffectChange(system: Dnd5eActorSystem, change: ActiveEffectChange): void {
  const parts = change.path.split('.').filter(Boolean);
  if (parts.length < 1 || parts.length > 3) return;
  let owner: Record<string, unknown> = system as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = owner[part];
    if (!isRecord(next)) return;
    owner = next;
  }
  const key = parts.at(-1)!;
  const current = owner[key];
  if (typeof current !== 'number') return;
  owner[key] = applyNumericMode(current, change.mode, change.value);
}

function numberRecord(value: JsonValue | undefined): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => typeof entry === 'number' && Number.isFinite(entry) ? [[key, entry]] : []));
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
