import { describe, expect, it } from 'vitest';
import { blankCharacter, draftPdf, modifier, proficiency } from '../character-draft';
describe('character export data', () => {
  it('calculates negative ability modifiers and level proficiency boundaries', () => {
    expect(modifier(9)).toBe(-1);
    expect([1,4,5,9,13,17,20].map(proficiency)).toEqual([2,2,3,4,5,6,6]);
  });
  it('exports expertise, spell stats and complete multiline records', () => {
    const c=blankCharacter(); c.level=5; c.abilities[3]=18; c.ranks[4]=2; c.spellAbility=3;
    c.details['法术与施法说明']='法术第一行\n法术最后一行';
    const sections=draftPdf(c).sections;
    expect(sections.find(s=>s.title==='技能')?.rows).toContainEqual(['奥秘','+10　专精']);
    expect(sections.find(s=>s.title==='施法')?.rows).toContainEqual(['法术豁免 DC','15']);
    expect(sections.find(s=>s.title==='法术与施法说明')?.paragraphs).toEqual(['法术第一行\n法术最后一行']);
  });
});
