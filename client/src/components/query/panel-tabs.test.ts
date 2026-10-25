import { describe, expect, it } from 'vitest';
import { visibleTabs } from '../QueryPanel';

describe('query panel tabs', () => {
  it('never shows module NPC libraries to players or spectators', () => {
    for (const role of ['player', 'spectator']) {
      expect(visibleTabs(role, 'waterdeep-dragon-heist')).not.toContain('waterdeep');
      expect(visibleTabs(role, undefined)).not.toContain('waterdeep');
      expect(visibleTabs(role, undefined)).not.toContain('strahd');
      expect(visibleTabs(role, 'lost-mine-of-phandelver')).not.toContain('phandelver');
      expect(visibleTabs(role, 'hoard-of-the-dragon-queen')).not.toContain('hoard');
      expect(visibleTabs(role, 'hoard-of-the-dragon-queen-remix')).not.toContain('hoardRemix');
    }
  });

  it('shows the DM only the campaign module, or all of them for a blank campaign', () => {
    expect(visibleTabs('dm', 'curse-of-strahd')).toContain('strahd');
    expect(visibleTabs('dm', 'curse-of-strahd')).not.toContain('waterdeep');
    expect(visibleTabs('dm', 'waterdeep-dragon-heist')).not.toContain('strahd');
    expect(visibleTabs('dm', 'lost-mine-of-phandelver')).toContain('phandelver');
    expect(visibleTabs('dm', 'lost-mine-of-phandelver')).not.toContain('strahd');
    expect(visibleTabs('dm', 'hoard-of-the-dragon-queen')).toContain('hoard');
    expect(visibleTabs('dm', 'hoard-of-the-dragon-queen')).not.toContain('phandelver');
    expect(visibleTabs('dm', 'hoard-of-the-dragon-queen-remix')).toContain('hoardRemix');
    expect(visibleTabs('dm', 'hoard-of-the-dragon-queen-remix')).not.toContain('hoard');
    expect(visibleTabs('dm', 'hoard-of-the-dragon-queen')).not.toContain('hoardRemix');
    expect(visibleTabs('dm', undefined)).toEqual(expect.arrayContaining(['waterdeep', 'strahd', 'phandelver', 'hoard', 'hoardRemix']));
  });
});
