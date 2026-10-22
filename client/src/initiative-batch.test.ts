import { describe, expect, it } from 'vitest';
import { batchInitiative, initiativeTokens, initiativeFromEntry, parseInitiativeBonus } from './initiative-batch';
import type { Scene, Token } from './types';
import cards from '../../shared/waterdeep/cards.json';

describe('batch initiative', () => {
  it('reads explicit initiative before Dexterity, and never treats unknown data as zero', () => {
    expect(initiativeFromEntry({ dex: 9 })).toEqual({ bonus: -1, source: '敏捷调整值' });
    expect(initiativeFromEntry({ dex: 14, initiative: 5 })?.bonus).toBe(5);
    expect(initiativeFromEntry({})).toBeNull();
    expect(initiativeFromEntry({ dex: 10 })?.bonus).toBe(0);
    expect(initiativeFromEntry({ campaignCard: { rows: [['力量/敏捷/体质', '10（+0）/ 14（+2）/ 12（+1）']] } })?.bonus).toBe(2);
    for (const card of cards) expect(initiativeFromEntry(card), card.name).not.toBeNull();
  });
  it('validates entered bonuses', () => {
    expect(parseInitiativeBonus('+5')).toBe(5);
    expect(parseInitiativeBonus('-2')).toBe(-2);
    for (const s of ['', ' ', 'abc', '1.5', '51', '-51']) expect(parseInitiativeBonus(s)).toBeNull();
  });
  it('rolls separately per token, saves bonuses, preserves existing initiatives and labels duplicates', () => {
    const tokens = ['a', 'b', 'existing'].map((id, i) => ({ id, kind: 'monster', name: '地精', number: i + 1 }) as Token);
    const scene = { tokens, players: [{ id: 'pc', kind: 'player', name: '游侠' }], initiative: [{ tokenId: 'existing' }] } as Scene;
    const dice = [1, 20, 10];
    const { ops, results } = batchInitiative(scene, new Map([['a', 2], ['b', -1], ['existing', 5], ['pc', 3]]), () => dice.shift()!);
    expect(ops.filter(o => o.op === 'addToInitiative').map(o => o.value)).toEqual([3, 19, 13]);
    expect(ops.some(o => 'tokenId' in o && o.tokenId === 'existing')).toBe(false);
    expect(ops[4]).toMatchObject({ op: 'updatePlayer', patch: { initiativeBonus: 3 } });
    expect(results[0]).toBe('地精 #1：1 + 2 = 3');
    expect(results[1]).toBe('地精 #2：20 − 1 = 19');
  });
});


describe('marquee initiative scope', () => {
  const tokens = ['first', 'second', 'later', 'existing'].map(id => ({ id, kind: 'monster', name: id, hidden: true, hp: {current:7,max:7}, x:100, y:200 }) as Token);
  const scene = { tokens, players: [{id:'pc',kind:'player',name:'游侠'}], initiative: [{tokenId:'existing',value:18,active:true}] } as Scene;
  it('limits even select-all to the selected enemies and ignores stale/player IDs', () => {
    expect(initiativeTokens(scene,['first','first','second','pc','deleted']).map(t => t.id)).toEqual(['first','second']);
    expect(initiativeTokens(scene,[])).toEqual([]);
    expect(initiativeTokens(scene).map(t => t.id)).toEqual(['first','second','later','existing','pc']);
  });
  it('adds only this wave, skips existing rows and leaves visibility and combat state untouched', () => {
    const before = JSON.stringify(scene);
    const candidates = initiativeTokens(scene,['first','second','existing']);
    const dice = [4,16];
    const {ops} = batchInitiative(scene,new Map(candidates.map(t => [t.id,2])),() => dice.shift()!);
    expect(ops.filter(op => op.op === 'addToInitiative').map(op => [op.tokenId,op.value])).toEqual([['first',6],['second',18]]);
    expect(ops.filter(op => op.op === 'updateToken').map(op => op.patch)).toEqual([{initiativeBonus:2},{initiativeBonus:2}]);
    expect(JSON.stringify(scene)).toBe(before);
    const updated = {...scene, initiative:[...scene.initiative,...ops.filter(op => op.op === 'addToInitiative')]} as Scene;
    expect(batchInitiative(updated,new Map(candidates.map(t => [t.id,2]))).ops).toEqual([]);
  });
});
