import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameServer } from './game';
import { SceneStore } from './store';

let game: GameServer;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  const store = new SceneStore(path.join(dir, 'scenes'));
  game = new GameServer(store, { password: 'pw' });
  await game.init();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GameServer.roleFor', () => {
  it('treats localhost addresses as dm', () => {
    expect(game.roleFor('127.0.0.1')).toBe('dm');
    expect(game.roleFor('::1')).toBe('dm');
    expect(game.roleFor('::ffff:127.0.0.1')).toBe('dm');
  });

  it('treats remote addresses as player', () => {
    expect(game.roleFor('192.168.1.50')).toBe('player');
  });

  it('upgrades a player to dm with a valid dmToken', () => {
    expect(game.roleFor('192.168.1.50', 'pw')).toBe('dm');
  });

  it('rejects a wrong dmToken', () => {
    expect(game.roleFor('192.168.1.50', 'wrong')).toBe('player');
  });

  it('gives localhost priority over a wrong dmToken', () => {
    expect(game.roleFor('127.0.0.1', 'wrong')).toBe('dm');
  });
});
