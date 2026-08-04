import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameServer } from './game';

export function attachWsServer(server: http.Server, game: GameServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    game.attach(ws);
  });
}
