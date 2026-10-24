import { describe, expect, it } from 'vitest';
import { visibleTabs } from '../QueryPanel';

describe('query panel tabs', () => {
  it('never shows module NPC libraries to players or spectators', () => {
    for (const role of ['player', 'spectator']) {
      expect(visibleTabs(role, 'waterdeep-dragon-heist')).not.toContain('waterdeep');
      expect(visibleTabs(role, undefined)).not.toContain('waterdeep');
      expect(visibleTabs(role, undefined)).not.toContain('strahd');
    }
  });

  it('shows the DM only the campaign module, or both for a blank campaign', () => {
    expect(visibleTabs('dm', 'curse-of-strahd')).toContain('strahd');
    expect(visibleTabs('dm', 'curse-of-strahd')).not.toContain('waterdeep');
    expect(visibleTabs('dm', 'waterdeep-dragon-heist')).not.toContain('strahd');
    expect(visibleTabs('dm', undefined)).toEqual(expect.arrayContaining(['waterdeep', 'strahd']));
  });
});
