import type { EntryType, IndexEntry, Scene } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string, type: EntryType | 'all' = 'all') =>
    json<IndexEntry[]>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),
  entry: (type: EntryType, id: string) => json<any>(`/api/entry/${type}/${encodeURIComponent(id)}`),
  scenes: () => json<{ id: string; name: string }[]>('/api/scenes'),
  createScene: (name: string) =>
    json<Scene>('/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteScene: (id: string) => json<{ ok: boolean }>(`/api/scenes/${id}`, { method: 'DELETE' }),
  verifyPassword: async (password: string): Promise<boolean> => {
    const r = await fetch('/api/verify-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const b = await r.json();
    return Boolean(b.ok);
  },
};
