import { describe, it, expect } from 'vitest';
import { selectEnemies, visibilityBatches } from './token-selection';
import type { Token } from '../types';
const token = (id: string, x: number, y: number, hidden?: boolean) => ({ id, x, y, hidden, hp: {current:7,max:7}, name: id, kind: 'monster', entryId:null, size:100, avatar:'', color:'#333' } as Token);
describe('enemy marquee and visibility', () => {
  it('selects centers in world coordinates in either drag direction, including hidden enemies', () => {
    const tokens = [token('a',100,200,true),token('b',200,300),token('outside',201,300)];
    expect(selectEnemies(tokens,{x:100,y:200},{x:200,y:300})).toEqual(['a','b']);
    expect(selectEnemies(tokens,{x:200,y:300},{x:100,y:200})).toEqual(['a','b']);
    expect(selectEnemies(tokens,{x:0,y:0},{x:10,y:10})).toEqual([]);
  });
  it('ignores stale/player IDs, avoids no-op writes, and changes only visibility', () => {
    const tokens = [token('a',0,0,true),token('b',0,0),token('c',0,0,false)];
    expect(visibilityBatches(tokens,['a','b','player','deleted'],false)).toEqual([[{op:'updateToken',tokenId:'a',patch:{hidden:false}}]]);
    expect(visibilityBatches(tokens,['a','b'],true)).toEqual([[{op:'updateToken',tokenId:'b',patch:{hidden:true}}]]);
    expect(tokens[0].hp).toEqual({current:7,max:7});
  });
  it('splits a large selection into bounded commands without loss or duplication', () => {
    const tokens = Array.from({length:61},(_,i) => token(String(i),i,i,true));
    const batches = visibilityBatches(tokens,tokens.map(t => t.id),false);
    expect(batches.map(b => b.length)).toEqual([20,20,20,1]);
    expect(new Set(batches.flat().map(op => 'tokenId' in op && op.tokenId)).size).toBe(61);
  });
});
