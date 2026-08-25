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

  it('sends the selected room template when creating a room', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      room: { slug: 'dragon-heist-test', name: '周五团' },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('../api');
    await expect(api.createRoom('周五团', 'waterdeep-dragon-heist')).resolves.toMatchObject({
      slug: 'dragon-heist-test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rooms');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({
      roomName: '周五团',
      templateId: 'waterdeep-dragon-heist',
    });
  });

  it('deletes the selected room without depending on global room state', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { api, setCurrentRoomSlug } = await import('../api');
    setCurrentRoomSlug(null);
    await expect(api.deleteRoom('dragon room/测试')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rooms/dragon%20room%2F%E6%B5%8B%E8%AF%95',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
