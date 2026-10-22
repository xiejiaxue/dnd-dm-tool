import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import type { ActionLogEntry, ActionLogType, JsonValue, Token } from '../../types';
import { useScene } from '../../ws';
import { useBoardCommands } from '../history/BoardCommandContext';
import { rollFormulaExpression, type D20Mode, type FormulaRollResult } from '../dice/formula';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

interface RollRequest {
  label: string;
  formula: string;
  actorId?: string | null;
  mode?: D20Mode;
  visibility?: 'all' | 'gm';
}

interface ActionLogApi {
  entries: ActionLogEntry[];
  loading: boolean;
  selectedTokenIds: string[];
  refresh(): Promise<void>;
  roll(request: RollRequest): Promise<FormulaRollResult>;
  applyAmount(type: 'damage' | 'healing', amount: number, label: string, targetIds?: string[]): Promise<number>;
  record(type: ActionLogType, label: string, details?: Record<string, JsonValue>): Promise<void>;
  clear(): Promise<void>;
}

const Context = createContext<ActionLogApi | null>(null);

export function ActionLogProvider({ selectedTokenIds, children }: { selectedTokenIds: string[]; children: ReactNode }) {
  const { scene } = useScene();
  const { performOps } = useBoardCommands();
  const { settings } = useTabletopSettings();
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setEntries(await api.actionLog(200)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, scene?.id]);

  const append = useCallback(async (input: Parameters<typeof api.logAction>[0]) => {
    const entry = await api.logAction(input);
    setEntries(current => [entry, ...current].slice(0, 200));
  }, []);

  const roll = useCallback(async (request: RollRequest) => {
    const result = rollFormulaExpression(request.formula, request.mode);
    await append({
      type: 'roll', label: request.label, sceneId: scene?.id ?? null,
      actorId: request.actorId ?? null, targetTokenIds: selectedTokenIds,
      formula: result.formula, total: result.total, visibility: request.visibility ?? settings.defaultRollMode,
      details: {
        mode: request.mode ?? 'normal',
        groups: result.groups as unknown as JsonValue,
        modifier: result.modifier,
      },
    });
    return result;
  }, [append, scene?.id, selectedTokenIds, settings.defaultRollMode]);

  const applyAmount = useCallback(async (type: 'damage' | 'healing', amount: number, label: string, targetIds = selectedTokenIds) => {
    if (!scene || !Number.isFinite(amount) || amount < 0) return 0;
    const targets = [...scene.tokens, ...scene.players].filter(token => targetIds.includes(token.id) && token.hp);
    const operations = targets.map(token => hpOperation(token, type, amount));
    if (operations.length) performOps(`${type === 'damage' ? '造成伤害' : '恢复生命'}：${label}`, operations);
    if (operations.length && settings.showFloatingText) {
      window.dispatchEvent(new CustomEvent('dndboard:hp-floating-text', { detail: {
        tokenIds: targets.map(token => token.id), text: `${type === 'damage' ? '−' : '+'}${amount}`,
        color: type === 'damage' ? '#f87171' : '#34d399',
      } }));
    }
    await append({
      type, label, sceneId: scene.id, targetTokenIds: targets.map(token => token.id), total: amount,
      details: { targetNames: targets.map(token => token.name) },
    });
    return operations.length;
  }, [append, performOps, scene, selectedTokenIds, settings.showFloatingText]);

  const record = useCallback(async (type: ActionLogType, label: string, details: Record<string, JsonValue> = {}) => {
    await append({ type, label, sceneId: scene?.id ?? null, targetTokenIds: selectedTokenIds, details });
  }, [append, scene?.id, selectedTokenIds]);

  const clear = useCallback(async () => {
    await api.clearActionLog();
    setEntries([]);
  }, []);

  const value = useMemo<ActionLogApi>(() => ({ entries, loading, selectedTokenIds, refresh, roll, applyAmount, record, clear }),
    [entries, loading, selectedTokenIds, refresh, roll, applyAmount, record, clear]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useActionLog(): ActionLogApi {
  const value = useContext(Context);
  if (!value) throw new Error('Action log requires ActionLogProvider');
  return value;
}

function hpOperation(token: Token, type: 'damage' | 'healing', amount: number) {
  const hp = token.hp!;
  const current = type === 'damage' ? Math.max(0, hp.current - amount) : Math.min(hp.max, hp.current + amount);
  if (token.kind === 'player') return { op: 'updatePlayer' as const, tokenId: token.id, patch: { hp: { ...hp, current } } };
  return { op: 'updateToken' as const, tokenId: token.id, patch: { hp: { ...hp, current } } };
}
