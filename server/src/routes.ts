import express, { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { SceneStore } from './store';
import { CampaignStore } from './campaign-store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';

export interface RouteDeps {
  store: SceneStore;
  campaigns: CampaignStore;
  search: SearchService;
  entries: EntryService;
  tokens: TokenService;
  uploadsDir: string;
  online: () => number;
  dataReady: () => boolean;
  verifyPassword: (p: string) => boolean;
}

export function createApp(deps: RouteDeps): express.Express {
  const app = express();
  app.use(express.json());
  fs.mkdirSync(deps.uploadsDir, { recursive: true });
  app.use('/uploads', express.static(deps.uploadsDir));

  const upload = multer({
    storage: multer.diskStorage({
      destination: deps.uploadsDir,
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.get('/meta', (_req, res) => res.json({ ok: true, dataReady: deps.dataReady(), online: deps.online() }));

  r.get('/scenes', async (_req, res) => {
    try {
      const list = await deps.store.list();
      const out = await Promise.all(list.map(async ({ id }) => {
        try {
          const s = await deps.store.get(id);
          return { id, name: s.name, unlocked: Boolean(s.unlocked) };
        } catch {
          return { id, name: '(未知)', unlocked: false };
        }
      }));
      res.json(out);
    } catch { res.status(500).json({ error: 'server error' }); }
  });
  r.post('/scenes', async (req, res) => {
    try {
      const name = String(req.body.name ?? '未命名场景').slice(0, 60);
      const scene = await deps.store.create(name);
      res.status(201).json(scene);
    } catch {
      res.status(500).json({ error: 'server error' });
    }
  });
  r.get('/scenes/:id', async (req, res) => {
    try {
      res.json(await deps.store.get(req.params.id));
    } catch {
      res.status(404).json({ error: 'scene not found' });
    }
  });
  r.delete('/scenes/:id', async (req, res) => {
    try {
      const id = req.params.id;
      await deps.store.delete(id);
      // A deleted scene must not stay referenced by any campaign's sceneIds —
      // otherwise the 战役库 tab would render it and switchScene would fail.
      for (const c of await deps.campaigns.all()) {
        if (c.sceneIds.includes(id)) {
          c.sceneIds = c.sceneIds.filter(s => s !== id);
          deps.campaigns.save(c);
        }
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'server error' });
    }
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q ?? '');
    const type = (req.query.type as any) ?? 'all';
    res.json(deps.search.query(q, type));
  });

  r.get('/entry/:type/:id', async (req, res) => {
    try {
      const entry = await deps.entries.get(req.params.type as any, req.params.id);
      res.json(entry);
    } catch {
      res.status(404).json({ error: 'entry not found' });
    }
  });

  r.get('/token/:entryId', async (req, res) => {
    try {
      const { buffer, contentType } = await deps.tokens.get(req.params.entryId);
      res.setHeader('content-type', contentType);
      res.setHeader('cache-control', 'public, max-age=604800');
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'token error' });
    }
  });

  r.post('/upload/map', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  r.post('/upload/token', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  r.get('/campaigns', async (_req, res) => {
    try { res.json(await deps.campaigns.list()); }
    catch { res.status(500).json({ error: 'server error' }); }
  });
  r.post('/campaigns', async (req, res) => {
    try {
      const name = String(req.body.name ?? '未命名战役').slice(0, 60);
      res.status(201).json(await deps.campaigns.create(name));
    } catch { res.status(500).json({ error: 'server error' }); }
  });
  r.get('/campaigns/:id', async (req, res) => {
    try { res.json(await deps.campaigns.get(req.params.id)); }
    catch { res.status(404).json({ error: 'campaign not found' }); }
  });
  r.delete('/campaigns/:id', async (req, res) => {
    try {
      await deps.campaigns.get(req.params.id); // missing -> CampaignNotFoundError -> 404
      await deps.campaigns.delete(req.params.id);
      res.json({ ok: true });
    } catch { res.status(404).json({ error: 'campaign not found' }); }
  });
  r.post('/campaigns/:id/scenes', async (req, res) => {
    try {
      await deps.campaigns.get(req.params.id); // missing -> CampaignNotFoundError -> 404
      const sceneId = String(req.body.sceneId ?? '');
      if (!sceneId) return res.status(400).json({ error: 'sceneId required' });
      await deps.campaigns.assignScene(req.params.id, sceneId);
      res.json({ ok: true });
    } catch { res.status(404).json({ error: 'campaign not found' }); }
  });

  r.post('/verify-password', (req, res) => {
    const ok = deps.verifyPassword(String(req.body.password ?? ''));
    res.json({ ok });
  });

  app.use('/api', r);
  return app;
}
