import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {makeDieGeometry,detectResult} from '../dice/geometry';
import {parseDiceExpression,physicalDice,percentileValue,summarizeDice,simpleRoll} from '../dice/rules';
describe('dice expressions and totals',()=>{
  it('parses mixed pools and signed modifiers without evaluating code',()=>{
    expect(parseDiceExpression('D20 + 2d6 - 3')).toEqual({terms:[{count:1,sides:20},{count:2,sides:6}],modifier:-3,normalized:'1d20+2d6-3',physicalCount:3});
    const e=parseDiceExpression('d20+d4+5');expect(summarizeDice(e,{'0':17,'1':3}).reduce((s,d)=>s+d.value,e.modifier)).toBe(25);
  });
  it.each(['','5','0d20','d7','25d6','13d100','d6++2','d20-d4','d6+10000','alert(1)','1.5d6'])('rejects invalid or excessive %s',input=>expect(()=>parseDiceExpression(input)).toThrow());
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

import {dieScale,insideSpace,spaceBounds,throwLaunches} from '../dice/tray';
describe('rectangular throwing space',()=>{
  it('adapts to portrait and landscape screens',()=>{
    expect(spaceBounds(350,320).halfDepth).toBeGreaterThan(spaceBounds(830,430).halfDepth);
    expect(spaceBounds(830,430).halfWidth).toBe(7);
  });
  it('keeps every spawn and its full collision radius inside the frame',()=>{
    for(const [width,height] of [[350,320],[830,430],[1200,430]])for(let count=1;count<=24;count++){
      const bounds=spaceBounds(width,height),radius=Math.sqrt(3)*.6*dieScale(count);
      for(const edge of [0,.999999]){
        for(const {position:[x,,z]} of throwLaunches(count,bounds,()=>edge))expect(insideSpace(x,z,bounds,radius)).toBe(true);
      }
    }
  });
  it('releases the hand near the front rail and throws towards the backstop',()=>{
    const bounds=spaceBounds(830,430);
    for(const edge of [0,.5,.999999])for(const count of [1,6,24]){
      const launches=throwLaunches(count,bounds,()=>edge);
      expect(Math.max(...launches.map(({position})=>position[2]))).toBeGreaterThan(bounds.halfDepth/2);
      for(const {velocity:[vx,vy,vz]} of launches){expect(vz).toBeLessThan(0);expect(Math.abs(vx)).toBeLessThan(-vz);expect(vy).toBeGreaterThan(0);}
    }
  });
  it('rejects points beyond the rectangular boundaries',()=>{
    const bounds=spaceBounds(830,430);expect(insideSpace(8,0,bounds)).toBe(false);expect(insideSpace(0,bounds.halfDepth+1,bounds)).toBe(false);
  });
});
