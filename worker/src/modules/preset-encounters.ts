import type { Scene, Token } from '../../../shared/types';
import type { PresetEncounter, PresetScene } from '../../../shared/encounter-presets';
import type { ModuleRoute } from './types';

/** Module maps keep their asset id at the end of the campaign-scoped map URL. */
export function presetSceneFor<T extends PresetScene>(presets: readonly T[], scene: Scene) {
  return presets.find(p => scene.mapImage?.endsWith(`-${p.map.assetId}`));
}

/**
 * Hidden tokens for one encounter, tiled around its anchor. Room anchors are visually checked on
 * the supplied maps; unlocated extras use the map centre. `prefix` keeps token ids distinct per module.
 */
export function presetTokens(prefix: string, scene: Scene, spec: PresetEncounter, count: number, offset = 0, total = count + offset, tokenSize?: number): Token[] {
  const width = scene.mapSize[0] * (scene.mapScale ?? 1), height = scene.mapSize[1] * (scene.mapScale ?? 1);
  const [x,y] = spec.position ?? [0.5,0.5];
  const columns = Math.min(6, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);
  const size = tokenSize ? tokenSize * (spec.tokenScale ?? 1)
    : Math.max(12, Math.min(85, width * 0.019, width * 0.05 / columns, height * 0.05 / rows));
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${scene.id}-${spec.key}-${i+offset}`, kind: 'monster', entryId: spec.entryId,
    name: `${spec.name} · ${spec.region}`, hidden: true,
    x: Math.max(size/2, Math.min(width-size/2, x*width+((i+offset)%columns-(columns-1)/2)*size)),
    y: Math.max(size/2, Math.min(height-size/2, y*height+(Math.floor((i+offset)/columns)-(rows-1)/2)*size)),
    size, avatar: `/api/token/${spec.entryId}`, color: '#ffffff', number: i+offset+1,
    ...(spec.hp ? { hp: { current: spec.currentHp ?? spec.hp, max: spec.hp } } : {}),
    ...(spec.initiativeBonus !== null ? { initiativeBonus: spec.initiativeBonus } : {}),
  }));
}

/** Places every automatic encounter of a new module scene; groups sharing an anchor share one tiling. */
export function initializePresetTokens(prefix: string, scene: Scene, preset: PresetScene) {
  const occupied = new Map<string,number>();
  const specs = preset.encounters.filter(e => e.automatic && e.count);
  for (const spec of specs) {
    const position = JSON.stringify(spec.position), offset = occupied.get(position) ?? 0;
    scene.tokens.push(...presetTokens(prefix,scene,spec,spec.count!,offset,specs.filter(e => JSON.stringify(e.position) === position).reduce((n,e)=>n+e.count!,0),preset.tokenSize));
    occupied.set(position,offset+spec.count!);
  }
}

/**
 * A moderator-only `<path>/<sceneId>` route: GET returns the scene's preset (or null), POST adds
 * `count` hidden tokens of one encounter as an idempotent command without changing the active scene.
 */
export function presetSceneRoute(path: string, action: string, prefix: string, presets: readonly PresetScene[]): ModuleRoute {
  return {
    path, param: true, methods: ['GET', 'POST'], moderatorOnly: true,
    async handle({ method, param, state, body, mutate }) {
      const scene = state().scenes[param!];
      if (!scene) return { status: 404, body: { error: '找不到场景' } };
      const preset = presetSceneFor(presets, scene);
      if (method === 'GET') return { body: preset ?? null };
      const input = await body();
      const spec = preset?.encounters.find(e => e.key === input.encounterKey);
      const count = input.count;
      if (!spec || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 100)
        return { status: 400, body: { error: '请选择本场景遭遇，数量须为 1–100' } };
      return { body: mutate(input.id, action, next => {
        const target = next.scenes[scene.id];
        const offset = target.tokens.filter(t => t.entryId === spec.entryId).length;
        const tokens = presetTokens(prefix, target, spec, count, offset, undefined, preset!.tokenSize).map(t => ({ ...t, id: crypto.randomUUID() }));
        target.tokens.push(...tokens);
        return { added: tokens.length };
      }, [scene.id]) };
    },
  };
}
