import presets from '../../../../shared/waterdeep/deployment.json';
import hdPresets from '../../../../shared/waterdeep/deployment-hd.json';
import type { Token } from '../../../../shared/types';
import { type PersistedRoomState, type RoomActor, isRoomModerator, DomainError } from '../../domain';

/** Composite Tych Maps images that replaced the book maps; campaigns made earlier keep the book maps. */
const HD_MAP = /map-waterdeep-\d+-[0-9a-f]{12}$/;

/** Additive and idempotent: manual tokens count toward each template's roster. */
export function deployWaterdeep(state: PersistedRoomState, actor: RoomActor, apply = false) {
  if (!isRoomModerator(actor.role)) throw new DomainError('FORBIDDEN', '只有主持人可以部署场景');
  const rows = presets.map((preset, presetIndex) => {
    const matches = Object.values(state.scenes).filter(s => s.name.includes(preset.match));
    if (matches.length !== 1) return { scene: preset.match, existing: 0, added: 0, total: 0, hidden: 0, note: matches.length ? '多个同名地图，未自动修改' : '没有对应地图，未自动修改' };
    const scene = matches[0];
    const existing = scene.tokens.length;
    const counts = new Map<string, number>();
    for (const token of scene.tokens) if (token.entryId) counts.set(token.entryId, (counts.get(token.entryId) ?? 0) + 1);
    let added = 0;
    // Same roster in the same order; only the positions differ between the two map editions.
    const placements = HD_MAP.test(scene.mapImage ?? '') ? hdPresets[presetIndex].tokens : preset.tokens;
    placements.forEach((spec, index) => {
      const count = counts.get(spec.entryId) ?? 0;
      if (count > 0) { counts.set(spec.entryId, count - 1); return; }
      const id = `wd-preset-v1-${scene.id}-${index}`;
      if (scene.tokens.some(t => t.id === id)) return;
      added++;
      if (!apply) return;
      const width = scene.mapImage ? scene.mapSize[0] * (scene.mapScale ?? 1) : scene.playArea.w;
      const height = scene.mapImage ? scene.mapSize[1] * (scene.mapScale ?? 1) : scene.playArea.h;
      const token: Token = {
        id, kind: 'monster', entryId: spec.entryId, name: spec.name,
        x: (scene.mapImage ? 0 : scene.playArea.x) + spec.x * width,
        y: (scene.mapImage ? 0 : scene.playArea.y) + spec.y * height,
        size: 100, avatar: `/api/token/${encodeURIComponent(spec.entryId)}`, color: '#ffffff',
        hidden: true, hp: { current: spec.hp, max: spec.hp }, initiativeBonus: spec.initiativeBonus,
        number: Math.max(0, ...scene.tokens.filter(t => t.entryId === spec.entryId).map(t => t.number ?? 0)) + 1,
      };
      scene.tokens.push(token);
    });
    return { scene: scene.name, existing, added, total: existing + added, hidden: scene.tokens.filter(t => t.hidden).length, note: preset.note };
  });
  return { applied: apply, rows, added: rows.reduce((n, r) => n + r.added, 0) };
}
