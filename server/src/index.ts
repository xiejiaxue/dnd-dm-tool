import express from 'express';
import { PORT, HOST } from './config';

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(PORT, HOST, () => {
  console.log(`[dnd-dm-tool] server listening on http://${HOST}:${PORT}`);
});
