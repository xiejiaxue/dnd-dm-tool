import { describe, expect, it } from 'vitest';
import { abilityModifier, effectiveActorSystem, emptyActorSystem, normalizeActorSystem, tickActiveEffects } from '../../../shared/actor-system';
import { rollFormulaExpression } from '../features/dice/formula';
import { drawWeighted } from '../features/tools/RollTablePanel';
import { eventMatchesBinding } from '../features/settings/TabletopSettingsContext';

describe('FVTT-inspired tabletop tools', () => {
  it('normalizes actor system values and calculates D&D ability modifiers', () => {
    const system = normalizeActorSystem({ level: 99, armorClass: -4, abilities: { str: 17, dex: 8 } });
    expect(system.level).toBe(30);
    expect(system.armorClass).toBe(0);
    expect(system.abilities).toMatchObject({ str: 17, dex: 8, con: 10 });
    expect(abilityModifier(17)).toBe(3);
    expect(abilityModifier(8)).toBe(-1);
  });

  it('applies equipped item and actor effects without mutating the source', () => {
    const system = emptyActorSystem();
    system.armorClass = 12;
    system.effects = [{ id: 'bless', name: '护盾', enabled: true, remainingRounds: 2, changes: [{ path: 'armorClass', mode: 'add', value: 2 }] }];
    system.items = [{ id: 'ring', sourceItemId: null, name: '防护戒指', itemType: 'equipment', image: '', quantity: 1, equipped: true, description: '', system: {}, actions: [], effects: [{ id: 'ring-effect', name: '戒指', enabled: true, remainingRounds: null, changes: [{ path: 'armorClass', mode: 'upgrade', value: 18 }] }] }];
    const effective = effectiveActorSystem(system);
    expect(effective.armorClass).toBe(18);
    expect(system.armorClass).toBe(12);
    expect(tickActiveEffects(system.effects)[0].remainingRounds).toBe(1);
  });

  it('rolls mixed signed formulas and d20 advantage safely', () => {
    const samples = [0, .95, .5, .25];
    const result = rollFormulaExpression('1d20 + 2d6 - 3', 'advantage', () => samples.shift() ?? 0);
    expect(result.groups[0].rolls).toEqual([20]);
    expect(result.groups[1].rolls).toEqual([4, 2]);
    expect(result.total).toBe(23);
    expect(() => rollFormulaExpression('globalThis.alert(1)')).toThrow('骰子公式无效');
  });

  it('draws weighted table entries at deterministic boundaries', () => {
    const entries = [
      { id: 'common', text: '普通', weight: 3, drawn: false },
      { id: 'rare', text: '稀有', weight: 1, drawn: false },
    ];
    expect(drawWeighted(entries, () => 0)?.id).toBe('common');
    expect(drawWeighted(entries, () => .99)?.id).toBe('rare');
    expect(drawWeighted(entries.map(entry => ({ ...entry, weight: 0 })), () => 0)).toBeNull();
  });

  it('maps Mod to Meta on macOS and Ctrl elsewhere without double-counting modifiers', () => {
    const keyboard = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
      key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides,
    }) as KeyboardEvent;
    expect(eventMatchesBinding(keyboard('k', { metaKey: true }), 'Mod+K', 'MacIntel')).toBe(true);
    expect(eventMatchesBinding(keyboard('k', { ctrlKey: true }), 'Mod+K', 'Linux x86_64')).toBe(true);
    expect(eventMatchesBinding(keyboard('k', { ctrlKey: true }), 'Mod+K', 'MacIntel')).toBe(false);
    expect(eventMatchesBinding(keyboard('D', { shiftKey: true }), 'Shift+D', 'MacIntel')).toBe(true);
  });
});
