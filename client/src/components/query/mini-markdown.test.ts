import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import MiniMarkdown, { parseBlocks } from './MiniMarkdown';

describe('MiniMarkdown', () => {
  it('splits the note subset into blocks', () => {
    const blocks = parseBlocks('**原文：** 雷纳推荐\n第二行\n\n> 米尔特：“你好”\n\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n### 第一幕\n| 任务 | 奖励 |\n|---|---:|\n| H1 车马 | 75gp |');
    expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'quote', 'list', 'list', 'heading', 'table']);
    expect(blocks[0]).toEqual({ kind: 'paragraph', lines: ['**原文：** 雷纳推荐', '第二行'] });
    expect(blocks[5]).toEqual({ kind: 'table', header: ['任务', '奖励'], rows: [['H1 车马', '75gp']] });
  });

  it('renders bold text without injecting HTML', () => {
    const html = renderToStaticMarkup(createElement(MiniMarkdown, { text: '**重点** <script>x</script>' }));
    expect(html).toContain('<strong');
    expect(html).toContain('重点');
    expect(html).not.toContain('<script>');
  });
});
