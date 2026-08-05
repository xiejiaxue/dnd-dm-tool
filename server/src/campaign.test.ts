import { describe, it, expect } from 'vitest';
import { createCampaign } from './campaign';

describe('campaign factory', () => {
  it('creates a campaign with unique id and empty collections', () => {
    const c = createCampaign('地牢冒险');
    expect(c.id).toMatch(/^campaign-/);
    expect(c.name).toBe('地牢冒险');
    expect(c.sceneIds).toEqual([]);
    expect(c.enemies).toEqual([]);
  });
});
