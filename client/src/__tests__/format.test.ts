import { describe, it, expect } from 'vitest';
import { renderMarkup } from '../format';

describe('renderMarkup', () => {
  it('strips 5etools inline tags to inner text', () => {
    expect(renderMarkup('受 {@damage 8d6} 点火焰伤害，{@hit +4} 命中，{@dc 13} 豁免。')).toBe('受 8d6 点火焰伤害，+4 命中，13 豁免。');
  });
  it('handles italic/bold tags', () => {
    expect(renderMarkup('{@i 灵巧逃脱}。')).toBe('灵巧逃脱。');
  });
  it('keeps plain text', () => {
    expect(renderMarkup('普通文本')).toBe('普通文本');
  });
  it('removes link pipe suffixes', () => {
    expect(renderMarkup('见 {@condition 中毒}。')).toBe('见 中毒。');
  });
});
