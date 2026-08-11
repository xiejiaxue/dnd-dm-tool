import { env, reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeOnlineEntryId,
  onlineSearchResults,
  parseOnlineEntryId,
  parseOnlineSearchRequest,
} from '../src/online-compendium-data';

const SEARCH_INDEX_FIXTURE = {
  x: [
    { c: 1, n: 'Goblin', cn: '地精', s: 0 },
    { c: 2, n: 'Fireball', cn: '火球术', s: 1 },
    { c: 4, n: 'Bag of Holding', cn: '次元袋', s: 2 },
    { c: 7, n: 'Alert', cn: '警觉', s: 1 },
    { c: 6, n: 'Poisoned', cn: '中毒', s: 1 },
    // A category outside the tabletop's entry model must never be surfaced.
    { c: 10, n: 'Human', cn: '人类', s: 1 },
    // A malformed document must not poison the complete response.
    { c: 1, n: 42, s: 0 },
  ],
  m: { s: { MM: 0, XPHB: 1, XDMG: 2 } },
};

afterEach(async () => {
  await reset();
});

describe('online 5etools compendium index', () => {
  it('maps only supported categories and produces opaque, round-trippable entry ids', () => {
    const results = onlineSearchResults(SEARCH_INDEX_FIXTURE, { query: '地精', type: 'all' });

    expect(results).toEqual([expect.objectContaining({
      type: 'monster', nameZh: '地精', nameEn: 'Goblin', source: 'MM', online: true,
    })]);
    expect(parseOnlineEntryId('monster', results[0].id)).toEqual({ type: 'monster', source: 'MM', nameEn: 'Goblin' });
  });

  it('searches Chinese and English fields while honoring an entry type filter', () => {
    expect(onlineSearchResults(SEARCH_INDEX_FIXTURE, { query: 'fire', type: 'spell' }))
      .toEqual([expect.objectContaining({ nameZh: '火球术', source: 'XPHB', type: 'spell' })]);
    expect(onlineSearchResults(SEARCH_INDEX_FIXTURE, { query: '火', type: 'monster' })).toEqual([]);
  });

  it('rejects malformed online identifiers rather than treating them as a fetch path', () => {
    const id = makeOnlineEntryId('spell', 'PHB', 'Misty Step');
    expect(parseOnlineEntryId('spell', id)).toEqual({ type: 'spell', source: 'PHB', nameEn: 'Misty Step' });
    expect(parseOnlineEntryId('spell', 'online:spell:PHB:%E0%A4%A')).toBeNull();
    expect(parseOnlineEntryId('spell', 'online:spell:../../internal:Fireball')).toBeNull();
    expect(parseOnlineEntryId('monster', id)).toBeNull();
  });

  it('limits and validates public query parameters before the rate limiter is consulted', () => {
    expect(parseOnlineSearchRequest(new URL('https://table.test/api/search/online?q=%E5%9C%B0%E7%B2%BE&type=monster')))
      .toEqual({ query: '地精', type: 'monster' });
    expect(parseOnlineSearchRequest(new URL('https://table.test/api/search/online?q=ok&type=class')))
      .toEqual({ query: 'ok', type: 'class' });
    expect(() => parseOnlineSearchRequest(new URL('https://table.test/api/search/online?q=ok&type=unknown'))).toThrow('资料类型无效');
    expect(() => parseOnlineSearchRequest(new URL(`https://table.test/api/search/online?q=${'a'.repeat(101)}`))).toThrow('查询关键词过长');
  });

  it('enforces the online lookup budget in an isolated Durable Object', async () => {
    const limiter = env.COMPENDIUM_RATE_LIMIT.getByName('online-compendium:test-budget');
    const rejected = await limiter.fetch('https://rate-limit/consume');
    expect(rejected.status).toBe(404);

    for (let count = 0; count < 24; count += 1) {
      const response = await limiter.fetch('https://rate-limit/consume', {
        method: 'POST', headers: { 'x-dnd-internal-rate-limit': '1' },
      });
      expect(response.status).toBe(204);
    }
    const limited = await limiter.fetch('https://rate-limit/consume', {
      method: 'POST', headers: { 'x-dnd-internal-rate-limit': '1' },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });
});
