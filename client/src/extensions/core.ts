import type { JsonValue } from '../types';
import { extensionRegistry } from './registry';

let registered = false;

/** Registers the stable commands that persisted macros may reference. */
export function registerCoreExtension(): void {
  if (registered) return;
  registered = true;
  extensionRegistry.registerExtension({
    id: 'core',
    title: '桌面核心',
    version: '1.0.0',
    requiredCore: '>=0.1.0',
  }, api => {
    api.command({
      id: 'core.dice.roll',
      title: '掷骰',
      capability: 'dice.roll',
      parse(args) {
        const formula = typeof args.formula === 'string' ? args.formula.trim() : '';
        if (!/^\d{1,2}d(?:4|6|8|10|12|20|100)(?:[+-]\d{1,3})?$/u.test(formula)) throw new Error('骰子公式无效');
        return { formula };
      },
      execute(context, args) {
        const result = context.roll(String(args.formula));
        context.notify(`${result.formula}：${result.rolls.join(' + ')}${result.modifier ? ` ${result.modifier > 0 ? '+' : '-'} ${Math.abs(result.modifier)}` : ''} = ${result.total}`);
      },
    });
    api.command({
      id: 'core.encounter.next-turn',
      title: '下一行动',
      capability: 'board.write',
      parse: noArgs,
      execute(context) { context.sendOps([{ op: 'nextTurn' }]); },
    });
    api.command({
      id: 'core.fog.reveal-all',
      title: '揭示全部迷雾',
      capability: 'board.write',
      parse: noArgs,
      execute(context) { context.sendOps([{ op: 'revealAllFog' }]); },
    });
    api.command({
      id: 'core.ui.select-tool',
      title: '切换地图工具',
      capability: 'ui.tool',
      parse(args) {
        const tool = typeof args.tool === 'string' ? args.tool : '';
        // Placement modes require an object already picked up from a directory,
        // so persisted macros may only select tools that always have an action.
        if (!['select', 'multi', 'wall', 'erase', 'zoom'].includes(tool)) throw new Error('地图工具无效');
        return { tool };
      },
      execute(context, args) { context.selectTool?.(String(args.tool)); },
    });
  });
}

function noArgs(): Record<string, JsonValue> {
  return {};
}

export function rollFormula(formula: string, random: () => number = Math.random): { formula: string; rolls: number[]; modifier: number; total: number } {
  const match = /^(\d{1,2})d(4|6|8|10|12|20|100)(?:([+-])(\d{1,3}))?$/u.exec(formula.trim());
  if (!match) throw new Error('骰子公式无效');
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
  const rolls = Array.from({ length: count }, () => {
    const sample = Math.max(0, Math.min(0.9999999999999999, random()));
    return Math.floor(sample * sides) + 1;
  });
  return { formula, rolls, modifier, total: rolls.reduce((sum, roll) => sum + roll, modifier) };
}
