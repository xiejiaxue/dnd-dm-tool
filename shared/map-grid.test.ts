import { describe, expect, it } from 'vitest';
import strahd from './strahd/scenes.json';
import strahdRemix from './strahd-remix/scenes.json';
import hoard from './hoard/scenes.json';
import phandelver from './phandelver/scenes.json';
import waterdeep from './waterdeep/maps.json';
import { gridTokenDiameter } from './map-grid';

const url = (assetId: string) => `/api/campaigns/room/assets/campaign-x-${assetId}`;
const monster = (size: number) => ({ kind: 'monster' as const, size });

describe('gridTokenDiameter', () => {
  it('covers one printed square at the current map scale', () => {
    expect(gridTokenDiameter(url('map-cosr-16-923dee9c64da'), 3, monster(85))).toBeCloseTo(110.25);
    expect(gridTokenDiameter(url('map-cos-16-923dee9c64da'), 2, { kind: 'player', size: 48 })).toBeCloseTo(73.5);
  });

  it('keeps calibrated module maps at their preset size and creature width', () => {
    for (const scene of [...hoard, ...phandelver].filter(s => (s.tokenSize ?? 0) >= 60)) {
      const map = url(scene.map.assetId);
      expect(gridTokenDiameter(map, scene.map.mapScale, monster(scene.tokenSize!))).toBeCloseTo(scene.tokenSize!, 1);
      expect(gridTokenDiameter(map, scene.map.mapScale, monster(scene.tokenSize! * 2))).toBeCloseTo(scene.tokenSize! * 2, 1);
      expect(gridTokenDiameter(map, scene.map.mapScale, { kind: 'player', size: 48 })).toBeCloseTo(scene.tokenSize!, 1);
    }
    // A hand-placed 100px monster on a 60px-square map is one square, not 1⅔.
    expect(gridTokenDiameter(url('map-lmop-02-46964a76d9ec'), 2, monster(100))).toBeCloseTo(60);
  });

  it('leaves maps without a known grid to the stored size', () => {
    expect(gridTokenDiameter(url('map-cos-01-92d591bfc4ae'), 3, monster(85))).toBeNull();
    expect(gridTokenDiameter('/uploads/my-map.png', 1, monster(100))).toBeNull();
    expect(gridTokenDiameter(null, 1, monster(100))).toBeNull();
  });

  it('calibrates the gridded Strahd scenes in both editions', () => {
    const gridded = (scenes: { map: { assetId: string } }[]) =>
      scenes.filter(s => gridTokenDiameter(url(s.map.assetId), 3, monster(85)) !== null).length;
    expect(gridded(strahd)).toBe(21);
    expect(gridded(strahdRemix)).toBe(9);
  });

  it('sizes Dragon Heist tokens to one Tych square at the preset map scale', () => {
    expect(waterdeep).toHaveLength(21);
    for (const map of waterdeep) {
      expect(gridTokenDiameter(url(map.assetId), map.mapScale, monster(100))).toBeCloseTo(100, 0);
      expect(gridTokenDiameter(url(map.assetId), map.mapScale, monster(200))).toBeCloseTo(200, 0);
    }
  });
});
