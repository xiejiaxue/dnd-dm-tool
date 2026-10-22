import { describe, expect, it, vi } from 'vitest';
import { RoomStore } from '../realtime/RoomStore';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene-1', name: 'Scene', mapImage: null, mapSize: [1600, 1200],
  grid: { size: 100, color: '#fff', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1600, h: 1200 },
  tokens: [], players: [], walls: [], initiative: [], favorites: [],
};

describe('RoomStore', () => {
  it('reconciles an optimistic command after its acknowledgement and patch', () => {
    const onSnapshot = vi.fn();
    const requestResync = vi.fn();
    const store = new RoomStore({ onSnapshot, requestResync });

    store.acceptState({ type: 'state', scene, role: 'dm', revision: 0 });
    store.pushCommand('command-1', [{ op: 'updateMapScale', mapScale: 1.25 }]);
    expect(store.lastState?.scene.mapScale).toBe(1.25);

    store.acceptAck({ type: 'ack', commandId: 'command-1', revision: 1 });
    store.acceptPatch({
      type: 'patch',
      revision: 1,
      ops: [{ op: 'updateMapScale', mapScale: 1.25 }],
    });

    expect(store.lastState?.revision).toBe(1);
    expect(store.lastState?.scene.mapScale).toBe(1.25);
    expect(store.pendingCommands).toHaveLength(0);
    expect(requestResync).not.toHaveBeenCalled();
  });

  it('requests a snapshot when a patch revision is not contiguous', () => {
    const requestResync = vi.fn();
    const store = new RoomStore({ onSnapshot: vi.fn(), requestResync });
    store.acceptState({ type: 'state', scene, role: 'dm', revision: 2 });

    store.acceptPatch({ type: 'patch', revision: 4, ops: [] });

    expect(requestResync).toHaveBeenCalledOnce();
    expect(store.lastState?.revision).toBe(2);
  });

  it('views an inactive scene locally without changing the authoritative active scene', () => {
    const store = new RoomStore({ onSnapshot: vi.fn(), requestResync: vi.fn() });
    const inactive = { ...scene, id: 'scene-2', name: 'Preview' };
    store.acceptState({ type: 'state', scene, role: 'dm', revision: 0 });

    store.setViewedScene(inactive);

    expect(store.lastState?.scene.id).toBe('scene-2');
    expect(store.lastState?.activeSceneId).toBe('scene-1');
    expect(store.lastState?.viewingInactive).toBe(true);
    expect(store.lastState?.role).toBe('spectator');

    store.setViewedScene(null);
    expect(store.lastState?.scene.id).toBe('scene-1');
    expect(store.lastState?.viewingInactive).toBe(false);
    expect(store.lastState?.role).toBe('dm');
  });

  it('returns to the active scene when the table activates another scene', () => {
    const store = new RoomStore({ onSnapshot: vi.fn(), requestResync: vi.fn() });
    store.acceptState({ type: 'state', scene, role: 'dm', revision: 0 });
    store.setViewedScene({ ...scene, id: 'scene-preview' });

    store.acceptState({ type: 'state', scene: { ...scene, id: 'scene-2' }, role: 'dm', revision: 1 });

    expect(store.lastState?.scene.id).toBe('scene-2');
    expect(store.lastState?.activeSceneId).toBe('scene-2');
    expect(store.lastState?.viewingInactive).toBe(false);
  });
});
