import { useEffect, useRef } from 'react';
import { monsterHitPoints } from '../../../../shared/compendium';
import { api } from '../../api';
import type { Op, Token } from '../../types';
import { connection } from '../../ws';
import { initialHitPoints } from './model';

const UPDATE_BATCH_SIZE = 20;

/** Backfill old or indirectly placed monster tokens from the compendium once. */
export function useMonsterHitPointHydration(sceneId: string | undefined, tokens: readonly Token[], enabled: boolean): void {
  const attempted = useRef(new Set<string>());
  const activeSceneId = useRef(sceneId);
  activeSceneId.current = sceneId;

  useEffect(() => {
    if (!enabled || !sceneId) return;
    const missing = tokens.filter(token => token.kind === 'monster' && token.entryId && !token.hp && !attempted.current.has(`${sceneId}:${token.id}`));
    if (missing.length === 0) return;
    for (const token of missing) attempted.current.add(`${sceneId}:${token.id}`);

    void Promise.all(missing.map(async token => {
      try {
        const entry = await api.entry('monster', token.entryId!);
        const hp = initialHitPoints(monsterHitPoints(entry));
        return hp ? { op: 'updateToken' as const, tokenId: token.id, patch: { hp } } : null;
      } catch {
        return null;
      }
    })).then(results => {
      if (activeSceneId.current !== sceneId) return;
      const operations: Op[] = [];
      for (const operation of results) {
        if (operation) operations.push(operation);
      }
      for (let offset = 0; offset < operations.length; offset += UPDATE_BATCH_SIZE) {
        connection.sendOps(operations.slice(offset, offset + UPDATE_BATCH_SIZE));
      }
    });
  }, [enabled, sceneId, tokens]);
}
