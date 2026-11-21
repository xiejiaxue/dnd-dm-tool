import { describe, expect, it } from 'vitest';
import { clampPanel } from '../hooks/useDraggablePanel';

const panel = { width: 300, height: 200 }, box = { width: 1000, height: 700 };

describe('clampPanel', () => {
  it('keeps a spot inside the board as is', () => {
    expect(clampPanel({ left: 120.4, top: 80.6 }, panel, box)).toEqual({ left: 120, top: 81 });
  });
  it('stops at the board edges', () => {
    expect(clampPanel({ left: 2000, top: 2000 }, panel, box)).toEqual({ left: 700, top: 500 });
    expect(clampPanel({ left: -900, top: -50 }, panel, box)).toEqual({ left: 0, top: 0 });
  });
  it('pulls a remembered spot back in after the board shrinks', () => {
    expect(clampPanel({ left: 900, top: 600 }, panel, { width: 400, height: 300 })).toEqual({ left: 100, top: 100 });
  });
});
