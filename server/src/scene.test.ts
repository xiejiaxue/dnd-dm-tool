import { describe, it, expect } from 'vitest';
import { createScene, newId } from './scene';

describe('scene factory', () => {
  it('creates a scene with unique id and empty collections', () => {
    const s = createScene('地牢');
    expect(s.id).toMatch(/^scene-/);
    expect(s.name).toBe('地牢');
    expect(s.tokens).toEqual([]);
    expect(s.initiative).toEqual([]);
    expect(s.grid.size).toBe(100);
  });

  it('newId produces unique ids', () => {
    const a = newId('t');
    const b = newId('t');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^t-/);
  });

  it('scene serializes and deserializes (round-trip)', () => {
    const s = createScene('测试');
    const copy = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(copy).toEqual(s);
  });
});
