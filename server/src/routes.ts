import express, { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';

export interface RouteDeps {
  store: SceneStore;
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
    res.json(await deps.store.list());
  });
  r.post('/scenes', async (req, res) => {
    const name = String(req.body.name ?? '未命名场景').slice(0, 60);
    const scene = await deps.store.create(name);
    res.status(201).json(scene);
  });
  r.get('/scenes/:id', async (req, res) => {
    try {
      res.json(await deps.store.get(req.params.id));
    } catch {
      res.status(404).json({ error: 'scene not found' });
    }
  });
  r.delete('/scenes/:id', async (req, res) => {
    await deps.store.delete(req.params.id);
    res.json({ ok: true });
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

  r.post('/verify-password', (req, res) => {
    const ok = deps.verifyPassword(String(req.body.password ?? ''));
    res.json({ ok });
  });

  app.use('/api', r);
  return app;
}
