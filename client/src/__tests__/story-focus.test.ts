import { afterEach, describe, expect, it, vi } from 'vitest';
import { onBoardFocus, requestBoardFocus, takeBoardFocus } from '../board-focus';
import { areaExplored, areaQuestId, nextStage, sceneQuestId, sceneStage } from '../story';
import { rescalePieces } from '../../../shared/map-scale';

afterEach(() => { vi.useRealTimers(); takeBoardFocus('s1'); takeBoardFocus('s2'); });

describe('board focus requests', () => {
  it('waits for its scene, is taken once and notifies the board', () => {
    const listener = vi.fn();
    const stop = onBoardFocus(listener);
    requestBoardFocus({ sceneId: 's2', point: [0.2, 0.4], areaKey: 'K7' });
    expect(listener).toHaveBeenCalledOnce();
    expect(takeBoardFocus('s1')).toBeNull();
    expect(takeBoardFocus('s2')).toEqual({ sceneId: 's2', point: [0.2, 0.4], areaKey: 'K7' });
    expect(takeBoardFocus('s2')).toBeNull();
    stop();
  });
  it('drops a request that waited too long for its map', () => {
    vi.useFakeTimers();
    requestBoardFocus({ sceneId: 's1', point: [0.5, 0.5] });
    vi.advanceTimersByTime(30_000);
    expect(takeBoardFocus('s1')).toBeNull();
  });
});

describe('story progress', () => {
  it('reads scene stages and explored rooms from the DM quest tracking', () => {
    const campaign = { questProgress: { [sceneQuestId('a')]: 'done', [sceneQuestId('b')]: 'failed', [areaQuestId('a', 'K7')]: 'done' } as const };
    expect(sceneStage(campaign, 'a')).toBe('done');
    expect(sceneStage(campaign, 'b')).toBe('open');
    expect(sceneStage(null, 'a')).toBe('open');
    expect(areaExplored(campaign, 'a', 'K7')).toBe(true);
    expect(areaExplored(campaign, 'a', 'K8')).toBe(false);
    expect([nextStage('open'), nextStage('active'), nextStage('done')]).toEqual(['active', 'done', 'open']);
  });
});

describe('pieces follow the map picture', () => {
  it('scales positions but not sizes, and keeps identity when nothing moves', () => {
    const scene = { tokens: [{ id: 't', kind: 'monster', name: '', x: 10, y: 20, size: 100, avatar: '', color: '', hidden: false }], players: [], walls: [{ id: 'w', p1: [0, 0] as [number, number], p2: [10, 10] as [number, number] }], notes: undefined };
    expect(rescalePieces(scene as never, 1)).toBe(scene);
    const moved = rescalePieces(scene as never, 1.5);
    expect(moved.tokens[0]).toMatchObject({ x: 15, y: 30, size: 100 });
    expect(moved.walls[0].p2).toEqual([15, 15]);
    expect(moved.notes).toBeUndefined();
  });
});
