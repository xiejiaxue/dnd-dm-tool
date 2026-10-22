import presets from '../../shared/strahd/scenes.json';
import type { Scene, Token } from '../../shared/types';
import type { StrahdEncounter, StrahdScene } from '../../shared/strahd-types';
export const strahdScenes: StrahdScene[] = presets;
export function strahdSceneFor(scene: Scene) {
  return strahdScenes.find(p => scene.mapImage?.endsWith(`-${p.map.assetId}`));
}
/** Room anchors are visually checked on the supplied maps. Unlocated extras use the map centre. */
export function strahdTokens(scene: Scene, spec: StrahdEncounter, count: number, offset = 0, total = count + offset): Token[] {
  const width = scene.mapSize[0] * (scene.mapScale ?? 1), height = scene.mapSize[1] * (scene.mapScale ?? 1);
  const [x,y] = spec.position ?? [0.5,0.5];
  const columns = Math.min(6, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);
  const size = Math.max(12, Math.min(85, width * 0.019, width * 0.05 / columns, height * 0.05 / rows));
  return Array.from({ length: count }, (_, i) => ({
    id: `cos-${scene.id}-${spec.key}-${i+offset}`, kind: 'monster', entryId: spec.entryId,
    name: `${spec.name} · ${spec.region}`, hidden: true,
    x: Math.max(size/2, Math.min(width-size/2, x*width+((i+offset)%columns-(columns-1)/2)*size)),
    y: Math.max(size/2, Math.min(height-size/2, y*height+(Math.floor((i+offset)/columns)-(rows-1)/2)*size)),
    size, avatar: `/api/token/${spec.entryId}`, color: '#ffffff', number: i+offset+1,
    ...(spec.hp ? { hp: { current: spec.hp, max: spec.hp } } : {}),
    ...(spec.initiativeBonus !== null ? { initiativeBonus: spec.initiativeBonus } : {}),
  }));
}
export function initializeStrahdTokens(scene: Scene, preset: StrahdScene) {
  const occupied = new Map<string,number>();
  const specs = preset.encounters.filter(e => e.automatic && e.count);
  for (const spec of specs) {
    const position = JSON.stringify(spec.position), offset = occupied.get(position) ?? 0;
    scene.tokens.push(...strahdTokens(scene,spec,spec.count!,offset,specs.filter(e => JSON.stringify(e.position) === position).reduce((n,e)=>n+e.count!,0)));
    occupied.set(position,offset+spec.count!);
  }
}
