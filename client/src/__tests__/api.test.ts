import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('API errors', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves the Worker error code and nested message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'ROOM_NOT_FOUND', message: '找不到该房间，或你尚未加入' },
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })));

    const { ApiError, api, setCurrentRoomSlug } = await import('../api');
    setCurrentRoomSlug('private-room');

    await expect(api.bootstrap()).rejects.toEqual(expect.objectContaining({
      name: 'ApiError',
      status: 404,
      code: 'ROOM_NOT_FOUND',
      message: '找不到该房间，或你尚未加入',
    }));
    await expect(api.bootstrap()).rejects.toBeInstanceOf(ApiError);
  });

  it('permanently deletes a campaign with DELETE on its own path', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);

    const { api } = await import('../api');

    await expect(api.deleteCampaign('lost mine')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/campaigns/lost%20mine', expect.objectContaining({ method: 'DELETE' }));
  });
});
