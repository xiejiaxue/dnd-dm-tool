import { api } from './api';
import { waterdeepHp } from './waterdeep';
import type { Op, Scene } from './types';

type Hp = { current: number; max: number };
export function monsterHp(entry: unknown): Hp | undefined {
  if (!entry || typeof entry !== 'object') return;
  const hp = (entry as { hp?: unknown }).hp;
  const average = typeof hp === 'object' && hp !== null ? (hp as { average?: unknown }).average : hp;
  if (typeof average !== 'number' || !Number.isSafeInteger(average) || average < 1) return;
  return { current: average, max: average };
}

export function createMonsterHpLoader(fetchEntry: (id: string) => Promise<unknown>) {
  const cache = new Map<string, { promise: Promise<Hp | undefined>; expires: number }>();
  return (id: string): Promise<Hp | undefined> => {
    const builtin = waterdeepHp(id);
    if (builtin) return Promise.resolve(builtin);
    const hit = cache.get(id);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const record = { promise: Promise.resolve<Hp | undefined>(undefined), expires: Infinity };
    record.promise = fetchEntry(id).then(entry => {
      const hp = monsterHp(entry);
      if (!hp) record.expires = Date.now() + 60_000;
      return hp;
    }).catch(() => { record.expires = Date.now() + 60_000; return undefined; });
    cache.set(id, record);
    return record.promise;
  };
}
export const loadMonsterHp = createMonsterHpLoader(id => api.entry('monster', id));

/** Re-read the live scene after each lookup: never restore damage, overwrite an
 * edited HP value, or apply a response to a different scene/token. */
export async function fillMissingMonsterHp(
  scene: Scene,
  currentScene: () => Scene | null,
  send: (ops: Op[]) => void,
  load = loadMonsterHp,
) {
  const ids = [...new Set(scene.tokens.filter(t => t.kind === 'monster' && t.entryId && t.hp == null).map(t => t.entryId!))];
  const queue = [...ids];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const entryId = queue.shift()!;
      if (currentScene()?.id !== scene.id) return;
      const hp = await load(entryId);
      const live = currentScene();
      if (!hp || !live || live.id !== scene.id) continue;
      const ops: Op[] = live.tokens.filter(t => t.kind === 'monster' && t.entryId === entryId && t.hp == null)
        .map(t => ({ op: 'updateToken', tokenId: t.id, patch: { hp: { ...hp } } }));
      if (ops.length) send(ops);
    }
  }));
}
