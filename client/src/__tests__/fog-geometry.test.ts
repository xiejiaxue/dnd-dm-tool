import { describe, expect, it } from 'vitest';
import { fogGeometry, fogGridSize, resolveFogBasisScale, type Scene } from '../types';
import { fogCellAtPoint, fogSelectionRectangle, fogRectangles } from '../components/fog-geometry';
import { applyOptimisticOps } from '../optimistic';

function mapScene(): Scene {
  return { id: 's', name: 'map', mapImage: '/api/campaigns/c/assets/map', mapSize: [523, 377], mapScale: 1, fogBasisScale: 1, grid: { size: 100, offset: [0, 0], color: '#fff', snap: false }, playArea: { x: 0, y: 0, w: 523, h: 377 }, tokens: [], players: [], walls: [], initiative: [], favorites: [] };
}

describe('map-local fog geometry', () => {
  it('clips a non-multiple-sized image without rounding out to the next cell', () => {
    const scene = mapScene();
    expect(fogGridSize(scene)).toEqual({ cols: 11, rows: 8 });
    expect(fogRectangles(scene)).toEqual([{ x: 0, y: 0, width: 523, height: 377 }]);
    expect(fogCellAtPoint(scene, 522.9, 376.9)).toBe(87);
    expect(fogCellAtPoint(scene, 523, 100)).toBe(-1);
    expect(fogCellAtPoint(scene, 100, 377)).toBe(-1);
  });
  it('keeps revealed indices and image-relative shapes stable through repeated calibration', () => {
    let scene = mapScene();
    scene.fog = Array(88).fill(false);scene.fog![25] = true;
    const rectangles = fogRectangles(scene), originalFog = scene.fog;
    for (const scale of [0.1, 1.37, 8, 0.75, 1]) {
      scene = applyOptimisticOps({ scene, campaign: null }, [{ op: 'updateMapScale', mapScale: scale, fogBasisScale: 1 }])!.scene;
      expect(scene.fog).toBe(originalFog);
      expect(fogGridSize(scene)).toEqual({ cols: 11, rows: 8 });
      expect(fogRectangles(scene)).toEqual(rectangles);
      expect(fogCellAtPoint(scene, 175 * scale, 125 * scale)).toBe(25);
      const geometry = fogGeometry(scene);
      expect(geometry.width * geometry.scale).toBeCloseTo(523 * scale);
    }
  });
  it('uses the local image preview transform when hit-testing an in-progress resize', () => {
    const scene = mapScene();
    expect(fogCellAtPoint(scene, 350, 250, 2)).toBe(25);
    expect(fogCellAtPoint(scene, 1046, 250, 2)).toBe(-1);
  });
  it('preserves legacy raster density and recovers a prior native stride after an old zoom', () => {
    const legacy = { ...mapScene(), fogBasisScale: undefined, mapScale: 2, fog: Array(21 * 16).fill(false) };
    expect(resolveFogBasisScale(legacy)).toBe(2);
    const recovered = { ...legacy, fog: Array(11 * 8).fill(false) };
    expect(resolveFogBasisScale(recovered)).toBe(1);
    const frozen = applyOptimisticOps({ scene: legacy, campaign: null }, [{ op: 'updateMapScale', mapScale: 0.5 }])!.scene;
    expect(frozen.fogBasisScale).toBe(2);
    expect(fogGridSize(frozen)).toEqual({ cols: 21, rows: 16 });
  });
  it('merges covered regions and never paints outside the map', () => {
    const scene = mapScene();scene.fog = Array(88).fill(false);scene.fog![25] = true;
    const rects = fogRectangles(scene);
    expect(rects.length).toBeLessThan(10);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(523.000001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(377.000001);
      expect(175 >= rect.x && 175 < rect.x + rect.width && 125 >= rect.y && 125 < rect.y + rect.height).toBe(false);
    }
  });
  it('honours play-area offsets without a map and rejects stale brush coordinates', () => {
    const scene = { ...mapScene(), mapImage: null, playArea: { x: 100, y: 200, w: 523, h: 377 } };
    expect(fogCellAtPoint(scene, 125, 225)).toBe(0);
    expect(fogCellAtPoint(scene, 99, 225)).toBe(-1);
    expect(applyOptimisticOps({ scene, campaign: null }, [{ op: 'setFog', cells: [0], revealed: true, basisScale: 2 }])).toBeNull();
  });
});

describe('exact fog rectangle selection', () => {
  it('retains fractional edges at every zoom and in either drag direction', () => {
    for (const zoom of [.1, 1, 1.37, 8]) {
      const start = { x: 113.25*zoom, y: 117.5*zoom }, end = { x: 289.75*zoom, y: 243.25*zoom };
      for (const [a,b] of [[start,end],[end,start]]) {
        const rect = fogSelectionRectangle(mapScene(), a, b, zoom)!;
        expect(rect.x).toBeCloseTo(113.25, 10);expect(rect.y).toBeCloseTo(117.5, 10);
        expect(rect.width).toBeCloseTo(176.5, 10);expect(rect.height).toBeCloseTo(125.75, 10);
      }
    }
  });
  it('clips bounds, respects play-area offsets and discards empty drags', () => {
    expect(fogSelectionRectangle(mapScene(), {x:500,y:350}, {x:1000,y:1000})).toEqual({x:500,y:350,width:23,height:27});
    expect(fogSelectionRectangle(mapScene(), {x:-100,y:-100}, {x:-10,y:-10})).toBeNull();
    expect(fogSelectionRectangle(mapScene(), {x:50,y:50}, {x:50,y:60})).toBeNull();
    const scene = {...mapScene(), mapImage:null, playArea:{x:100,y:200,w:523,h:377}};
    expect(fogSelectionRectangle(scene, {x:113,y:217}, {x:119,y:223})).toEqual({x:13,y:17,width:6,height:6});
  });
  it('reveals exactly the selected area, including a sub-cell selection, after zoom', () => {
    let scene = mapScene();
    const rect = {x:113.25,y:117.5,width:6.5,height:5.25};
    scene = applyOptimisticOps({scene,campaign:null}, [{op:'revealFogRect',rect}])!.scene;
    const covered = fogRectangles(scene);
    expect(covered.reduce((sum,r)=>sum+r.width*r.height,0)).toBeCloseTo(523*377-6.5*5.25, 8);
    const obscured = (x:number,y:number) => covered.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
    expect(obscured(113.249,120)).toBe(true);expect(obscured(119.751,120)).toBe(true);
    expect(obscured(116,117.499)).toBe(true);expect(obscured(116,122.751)).toBe(true);
    expect(obscured(116,120)).toBe(false);
    for (const mapScale of [.1, 1.37, 8]) {
      scene=applyOptimisticOps({scene,campaign:null}, [{op:'updateMapScale',mapScale}])!.scene;
      expect(fogRectangles(scene)).toEqual(covered);
    }
  });
  it('covers only requested cells inside a precise reveal and deduplicates repeat reveals', () => {
    const rect={x:40,y:40,width:30,height:30};
    let scene=applyOptimisticOps({scene:mapScene(),campaign:null},[{op:'revealFogRect',rect},{op:'revealFogRect',rect}])!.scene;
    expect(scene.fogReveals).toHaveLength(1);
    scene=applyOptimisticOps({scene,campaign:null},[{op:'setFog',cells:[0],revealed:false,basisScale:1}])!.scene;
    expect(fogRectangles(scene).reduce((sum,r)=>sum+r.width*r.height,0)).toBe(523*377-800);
    scene=applyOptimisticOps({scene,campaign:null},[{op:'coverAllFog'}])!.scene;
    expect(fogRectangles(scene)).toEqual([{x:0,y:0,width:523,height:377}]);
  });
  it('unions overlapping selections and brush holes without revealing their bounding box', () => {
    const scene = mapScene();scene.fog=Array(88).fill(false);scene.fog[0]=true;
    scene.fogReveals=[{x:40,y:40,width:20,height:20},{x:50,y:50,width:20,height:20}];
    const covered=fogRectangles(scene);
    expect(covered.reduce((sum,r)=>sum+r.width*r.height,0)).toBe(523*377-(2500+400-100+400-100));
    expect(covered.some(r=>65>=r.x&&65<r.x+r.width&&45>=r.y&&45<r.y+r.height)).toBe(true);
  });
});
