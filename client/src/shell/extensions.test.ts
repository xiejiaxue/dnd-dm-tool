import { describe, expect, it } from 'vitest';
import { extensionHref, extensionsFor, MODULE_EXTENSIONS } from './extensions';
import { DESTINATIONS, destinationFor } from './tools';
import { shellPageFor } from './navigation';

describe('module extensions', () => {
  const tavern = MODULE_EXTENSIONS.find(extension => extension.page === 'tavern')!;

  it('keeps the tavern out of the general tools but reachable from the shell', () => {
    expect(DESTINATIONS.map(destination => destination.page)).not.toContain('tavern');
    expect(shellPageFor('/tavern')).toBe('tavern');
    expect(shellPageFor('/calendar')).toBe('tavern');
    expect(destinationFor('tavern').label).toBe('酒馆经营');
  });

  it('offers the tavern only to Waterdeep: Dragon Heist campaigns', () => {
    expect(extensionsFor('waterdeep-dragon-heist')).toEqual([tavern]);
    expect(extensionsFor('curse-of-strahd')).toEqual([]);
    expect(extensionsFor(undefined)).toEqual([]);
  });

  it('links the tool to the campaign it was opened from', () => {
    expect(extensionHref(tavern)).toBe('/tavern');
    expect(extensionHref(tavern, '深水城 1')).toBe('/tavern?campaign=%E6%B7%B1%E6%B0%B4%E5%9F%8E%201');
  });
});
