import { describe, expect, it } from 'vitest';
import { resolveHpInput } from './hp-input';

describe('resolveHpInput', () => {
  it('sets absolute values', () => {
    expect(resolveHpInput('12', 5, 20)).toBe(12);
    expect(resolveHpInput(' 0 ', 5, 20)).toBe(0);
  });
  it('applies damage and healing within 0..max', () => {
    expect(resolveHpInput('-7', 10, 20)).toBe(3);
    expect(resolveHpInput('-30', 10, 20)).toBe(0);
    expect(resolveHpInput('+5', 18, 20)).toBe(20);
    expect(resolveHpInput('+4', undefined, 20)).toBe(20);
  });
  it('rejects non-numbers', () => {
    for (const bad of ['', 'abc', '1.5', '--3', '+']) expect(resolveHpInput(bad, 5, 20)).toBeNull();
  });
});
