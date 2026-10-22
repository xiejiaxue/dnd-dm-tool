import { useEffect, useState } from 'react';
import { RoomConnection } from './realtime/RoomConnection';
import { asViewer, rawRole, uiRole, type SceneState } from './realtime/protocol';

/**
 * Stable UI facade for the realtime subsystem. Components keep importing this
 * module while transport, reconciliation and protocol concerns live behind it.
 */
const connection = new RoomConnection();

/** Returns the server-owned identity key used by existing token components. */
export function getMySessionId(): string {
  return connection.viewer?.userId ?? '';
}

export function useScene(): SceneState {
  const [state, setState] = useState<SceneState>(() => ({
    scene: connection.lastState?.scene ?? null,
    role: connection.lastState?.role ?? 'player',
    roomRole: connection.lastState?.roomRole ?? 'player',
    viewer: connection.lastState?.viewer ?? null,
    revision: connection.lastState?.revision ?? null,
    online: connection.lastOnline,
    connected: connection.connected,
    campaign: connection.lastState?.campaign ?? null,
    encounter: connection.lastState?.encounter ?? null,
    activeSceneId: connection.lastState?.activeSceneId ?? connection.lastState?.scene.id ?? null,
    viewingInactive: connection.lastState?.viewingInactive ?? false,
  }));

  useEffect(() => connection.onMessage((message) => {
    if (message.type === 'state' && message.scene) {
      const viewer = asViewer(message.viewer);
      const effectiveRole = viewer?.roomRole ?? message.roomRole ?? message.role;
      setState(current => ({
        ...current,
        scene: message.scene!,
        role: message.viewingInactive === true ? 'spectator' : uiRole(effectiveRole),
        roomRole: rawRole(effectiveRole),
        viewer,
        revision: typeof message.revision === 'number' ? message.revision : null,
        campaign: message.campaign ?? null,
        encounter: message.encounter ?? null,
        activeSceneId: typeof message.activeSceneId === 'string' ? message.activeSceneId : message.scene!.id,
        viewingInactive: message.viewingInactive === true,
        connected: true,
      }));
    } else if (message.type === 'meta') {
      setState(current => ({
        ...current,
        online: typeof message.online === 'number' ? message.online : 0,
        connected: true,
      }));
    } else if (message.type === 'reset' || message.type === 'disconnected') {
      setState({
        scene: null,
        role: 'player',
        roomRole: 'player',
        viewer: null,
        revision: null,
        online: 0,
        connected: false,
        campaign: null,
        encounter: null,
        activeSceneId: null,
        viewingInactive: false,
      });
    } else if (message.type === 'error') {
      console.warn('[ws]', typeof message.message === 'string' ? message.message : 'Room WebSocket error');
    }
  }), []);

  return state;
}

export { connection };
export type { SceneState, RoomViewRole, Viewer } from './realtime/protocol';
