import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createApp, RouteDeps } from './routes';
import { GameServer } from './game';
import { attachWsServer } from './ws';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';
import { ROOT, PORT, HOST, SCENES_DIR, TOKEN_CACHE_DIR, UPLOADS_DIR, DB_DIR, DM_PASSWORD, IMAGE_BASE } from './config';

async function main() {
  const store = new SceneStore(SCENES_DIR);
  const search = new SearchService(DB_DIR);
  const entries = new EntryService(DB_DIR);
  const tokens = new TokenService(TOKEN_CACHE_DIR, entries, IMAGE_BASE);

  const game = new GameServer(store, { password: DM_PASSWORD });
  await game.init();

  let dataReady = false;

  const app = createApp({
    store,
    search,
    entries,
    tokens,
    uploadsDir: UPLOADS_DIR,
    online: () => game.clientsCount(),
    dataReady: () => dataReady,
    // Only a configured, non-empty DND_PASSWORD grants DM upgrade; matches roleFor.
    verifyPassword: (p: string) => DM_PASSWORD != null && DM_PASSWORD !== '' && p === DM_PASSWORD,
  } satisfies RouteDeps);

  // Production mode: host the built frontend (client/dist).
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  try {
    await search.load();
    await entries.warm();
    dataReady = true;
  } catch (e) {
    console.warn('[dnd-dm-tool] 数据未就绪，请运行 npm run data:update：', (e as Error).message);
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[dnd-dm-tool] http://${HOST}:${PORT}  （DM 用 localhost 打开，玩家用局域网 IP 打开）`);
  });
  attachWsServer(server, game);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
