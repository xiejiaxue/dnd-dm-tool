import { useEffect, useRef } from 'react';
import { api } from '../../api';
import { actorSystemJson, normalizeActorSystem, tickActiveEffects } from '../../types';
import { useScene } from '../../ws';
import { useActionLog } from '../action-log/ActionLogContext';

/** Duration belongs to Actor effects, while Round belongs to the room DO.
 * This small coordinator reacts only to authoritative round changes and writes
 * idempotent decremented Actor documents back through their normal API. */
export default function EffectRoundSynchronizer({ roomSlug }: { roomSlug: string }) {
  const { role, encounter } = useScene();
  const { record } = useActionLog();
  const running = useRef(false);
  useEffect(() => {
    if (role !== 'dm' || !encounter || encounter.status !== 'active' || running.current) return;
    const key = `dndboard:effect-round:${roomSlug}:${encounter.id}`;
    const previous = Number(localStorage.getItem(key));
    localStorage.setItem(key, String(encounter.round));
    if (!Number.isInteger(previous) || encounter.round <= previous) return;
    running.current = true;
    const tick = async () => {
      const directory = await api.actors();
      let changed = 0;
      for (const actor of directory.actors) {
        const system = normalizeActorSystem(actor.system);
        const effects = tickActiveEffects(system.effects);
        const items = system.items.map(item => ({ ...item, effects: tickActiveEffects(item.effects) }));
        if (JSON.stringify(effects) === JSON.stringify(system.effects) && JSON.stringify(items) === JSON.stringify(system.items)) continue;
        await api.updateActor(actor.id, { system: actorSystemJson({ ...system, effects, items }) });
        changed += 1;
      }
      if (changed) await record('effect', `第 ${encounter.round} 轮：更新 ${changed} 个 Actor 的持续效果`, { round: encounter.round, actorCount: changed });
    };
    void tick().catch(() => {}).finally(() => { running.current = false; });
  }, [encounter?.id, encounter?.round, encounter?.status, record, role, roomSlug]);
  return null;
}

