import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';

function makeApp() {
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
