import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {makeDieGeometry,detectResult} from '../dice/geometry';
import {naturalTwenties,parseDiceExpression,physicalDice,percentileValue,summarizeDice,simpleRoll} from '../dice/rules';
describe('dice expressions and totals',()=>{
  it('parses mixed pools and signed modifiers without evaluating code',()=>{
    expect(parseDiceExpression('D20 + 2d6 - 3')).toEqual({terms:[{count:1,sides:20},{count:2,sides:6}],modifier:-3,normalized:'1d20+2d6-3',physicalCount:3});
    const e=parseDiceExpression('d20+d4+5');expect(summarizeDice(e,{'0':17,'1':3}).reduce((s,d)=>s+d.value,e.modifier)).toBe(25);
  });
  it.each(['','5','0d20','d7','25d6','13d100','d6++2','d20-d4','d6+10000','alert(1)','1.5d6'])('rejects invalid or excessive %s',input=>expect(()=>parseDiceExpression(input)).toThrow());
  it('counts raw 20s on d20s only, not d100 or totals',()=>{
    expect(naturalTwenties([{sides:20,value:20},{sides:20,value:19},{sides:20,value:20}])).toBe(2);
    expect(naturalTwenties([{sides:100,value:20,components:[20,0]},{sides:12,value:12},{sides:20,value:1}])).toBe(0);
  });
  it('represents d100 as two physical d10 and handles 00 + 0',()=>{
    const e=parseDiceExpression('2d100');expect(physicalDice(e)).toHaveLength(4);
    expect(percentileValue(10,10)).toBe(100);expect(percentileValue(10,7)).toBe(7);expect(percentileValue(9,10)).toBe(90);
    expect(summarizeDice(e,{'0-tens':10,'0-units':10,'1-tens':4,'1-units':2}).map(d=>d.value)).toEqual([100,42]);
    expect(()=>summarizeDice(e,{'0-tens':10})).toThrow();
  });
  it('keeps simple fallback values within every die range',()=>{
    const e=parseDiceExpression('d4+d6+d8+d10+d12+d20+d100');for(let i=0;i<30;i++)for(const result of simpleRoll(e)){expect(result.value).toBeGreaterThanOrEqual(1);expect(result.value).toBeLessThanOrEqual(result.sides);}
  });
});
describe('physical dice geometry and orientation',()=>{
  it.each([4,6,8,10,12,20] as const)('has exactly %i closed, outward, planar numbered faces',sides=>{
    const shape=makeDieGeometry(sides);expect(shape.faces).toHaveLength(sides);
    expect(shape.faces.map(f=>f.value).sort((a,b)=>a-b)).toEqual(Array.from({length:sides},(_,i)=>i+1));
    const edges=new Map<string,number>();
    for(const face of shape.faces){expect(face.normal.dot(face.center)).toBeGreaterThan(0);
      for(const v of face.vertices)expect(Math.abs(face.normal.dot(v.clone().sub(face.center)))).toBeLessThan(1e-5);
      face.vertices.forEach((v,i)=>{const next=face.vertices[(i+1)%face.vertices.length];const key=[v.toArray().map(n=>n.toFixed(5)).join(','),next.toArray().map(n=>n.toFixed(5)).join(',')].sort().join('|');edges.set(key,(edges.get(key)||0)+1);});
    }
    expect([...edges.values()].every(count=>count===2)).toBe(true);
    expect(shape.vertices.length-edges.size+shape.faces.length).toBe(2);
    if(sides!==4)for(const face of shape.faces){const q=new Quaternion().setFromUnitVectors(face.normal,new Vector3(0,1,0));expect(detectResult(shape,q).value).toBe(face.value);expect(detectResult(shape,q).alignment).toBeCloseTo(1);}
    else for(const [index,v] of shape.vertices.entries()){const q=new Quaternion().setFromUnitVectors(v.clone().normalize(),new Vector3(0,1,0));expect(detectResult(shape,q).value).toBe(index+1);}
    shape.geometry.dispose();
  });
});

import {RAIL_THICKNESS,dieScale,insideSpace,spaceBounds,throwLaunches,trayOutline,wallSegments,type TrayShape,type TraySize} from '../dice/tray';
import {DEFAULT_TRAY_SETTINGS,parseTraySettings} from '../dice/settings';
describe('rectangular throwing space',()=>{
  it('adapts to portrait and landscape screens',()=>{
    expect(spaceBounds(350,320).halfDepth).toBeGreaterThan(spaceBounds(830,430).halfDepth);
    expect(spaceBounds(830,430).halfWidth).toBe(7);
  });
  it('keeps every spawn and its full collision radius inside the frame',()=>{
    for(const size of ['small','medium','large'] as TraySize[])for(const shape of ['square','octagon'] as TrayShape[])
    for(const [width,height] of [[350,320],[830,430],[1200,430]])for(let count=1;count<=24;count++){
      const bounds=spaceBounds(width,height,size,shape,count),radius=Math.sqrt(3)*.6*dieScale(count);
      for(const edge of [0,.999999]){
        for(const {position:[x,,z]} of throwLaunches(count,bounds,()=>edge))expect(insideSpace(x,z,bounds,radius)).toBe(true);
      }
    }
  });
  it('releases the hand by a side rail on the thrower\'s half and lobs every die inwards',()=>{
    for(const [width,height] of [[350,320],[830,430]])for(const size of ['small','large'] as TraySize[])
    for(const edge of [0,.5,.999999])for(const count of [1,6,24]){
      const bounds=spaceBounds(width,height,size,'octagon',count),launches=throwLaunches(count,bounds,()=>edge);
      const side=Math.sign(launches[0].position[0]),mean=(axis:number,of:'position'|'velocity')=>launches.reduce((sum,l)=>sum+l[of][axis],0)/count;
      expect(Math.max(...launches.map(({position})=>side*position[0]))).toBeGreaterThan(bounds.halfWidth/2);
      expect(mean(2,'position')).toBeGreaterThanOrEqual(0);
      for(const {velocity:[vx,vy]} of launches){expect(side*vx).toBeLessThan(0);expect(vy).toBeGreaterThan(0);}
      // The handful comes in at a slant, but it heads across the tray, not along the rail.
      expect(Math.abs(mean(2,'velocity'))).toBeLessThan(3*Math.abs(mean(0,'velocity')));
    }
  });
  it('rejects points beyond the rectangular boundaries',()=>{
    const bounds=spaceBounds(830,430);expect(insideSpace(8,0,bounds)).toBe(false);expect(insideSpace(0,bounds.halfDepth+1,bounds)).toBe(false);
  });
});
describe('tray frame',()=>{
  it('scales with the chosen size and cuts octagon corners',()=>{
    expect(spaceBounds(830,430,'large').halfWidth).toBeGreaterThan(spaceBounds(830,430,'small').halfWidth);
    // A big handful widens a small tray but leaves a large one alone.
    expect(spaceBounds(830,430,'small','octagon',24).halfWidth).toBeGreaterThan(spaceBounds(830,430,'small','octagon',2).halfWidth);
    expect(spaceBounds(830,430,'large','octagon',24)).toEqual(spaceBounds(830,430,'large','octagon'));
    expect(spaceBounds(830,430,'medium','square').chamfer).toBe(0);
    const octagon=spaceBounds(830,430,'medium','octagon');
    expect(octagon.chamfer).toBeGreaterThan(0);
    expect(trayOutline(octagon)).toHaveLength(8);
    expect(insideSpace(octagon.halfWidth-.1,octagon.halfDepth-.1,octagon)).toBe(false);
    expect(insideSpace(octagon.halfWidth-.1,0,octagon)).toBe(true);
  });
  it.each(['square','octagon'] as TrayShape[])('closes the %s rail with its inner faces on the outline',shape=>{
    const bounds=spaceBounds(830,430,'medium',shape),outline=trayOutline(bounds),walls=wallSegments(bounds);
    expect(walls).toHaveLength(outline.length);
    const ends=walls.map(wall=>{
      // Local +x maps to (cos, -sin) in xz; the outward normal is that turned right, (sin, cos).
      const dx=Math.cos(wall.angle),dz=-Math.sin(wall.angle),nx=-dz,nz=dx,half=wall.length/2,out=RAIL_THICKNESS/2;
      return {inner:wall.x*nx+wall.z*nz-out,start:[wall.x-dx*half+nx*out,wall.z-dz*half+nz*out],end:[wall.x+dx*half+nx*out,wall.z+dz*half+nz*out]};
    });
    walls.forEach((_,i)=>{
      const [ax,az]=outline[i],next=ends[(i+1)%walls.length];
      // The inner face sits on its outline edge, and outer faces of neighbours meet at the corner.
      const nx=Math.sin(walls[i].angle),nz=Math.cos(walls[i].angle);
      expect(ends[i].inner).toBeCloseTo(ax*nx+az*nz,6);
      expect(ends[i].end[0]).toBeCloseTo(next.start[0],6);expect(ends[i].end[1]).toBeCloseTo(next.start[1],6);
    });
  });
});
describe('tray settings',()=>{
  it('falls back to defaults for missing or unknown values',()=>{
    expect(parseTraySettings(null)).toEqual(DEFAULT_TRAY_SETTINGS);
    expect(parseTraySettings({theme:'dungeon',view:'sideways',showColliders:'yes',size:'large'})).toEqual({...DEFAULT_TRAY_SETTINGS,theme:'dungeon',size:'large'});
  });
});
