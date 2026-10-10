import { describe, expect, it } from 'vitest';
import { blankCharacter, detailFields } from '../character-draft';
import { importCharacterCopy, MAX_CHARACTER_FILE_BYTES, parseCharacterFile, readCharacterFile, serializeCharacter, validateCharacter } from '../character-file';
const character = () => ({...blankCharacter(),name:'艾琳·霜语',details:{笔记:'第一行\n第二行 <script>alert(1)</script>'}});
const envelope = () => JSON.parse(serializeCharacter(character()));
describe('portable character files', () => {
  it('round-trips every field including Chinese, multiline text and expertise', () => {
    const c=character(); c.level=20;c.abilities=[8,16,14,20,12,10];c.ranks[4]=2;c.saves[3]=true;c.spellAbility=3;
    expect(parseCharacterFile(serializeCharacter(c)).character).toEqual(c);
  });
  it('imports copies with independent arrays and a fresh identity', () => {
    const file=parseCharacterFile(serializeCharacter(character()));
    const copy=importCharacterCopy(file);
    expect(copy.id).not.toBe(file.character.id);
    copy.abilities[0]=30;copy.details.笔记='修改';
    expect(file.character.abilities[0]).toBe(10);
    expect(file.character.details.笔记).toContain('第一行');
  });
  it('accepts BOM and empty templates', () => {
    expect(parseCharacterFile('\uFEFF'+serializeCharacter(blankCharacter())).character.name).toBe('');
  });
  it.each([['version',2,'版本'],['format','other','不是本站'],['ruleset','dnd5e-2024','规则版本'],['exportedAt','yesterday','导出时间']])('rejects unsupported %s', (key,value,message) => {
    const file=envelope();file[key]=value;expect(()=>parseCharacterFile(JSON.stringify(file))).toThrow(message);
  });
  it.each([['level',21],['hp',11],['maxHp',0],['armorClass',101],['spellAbility',6],['initiativeBonus',1.5],['speed','30'],['name',42]])('rejects invalid %s without clamping', (key,value) => {
    const file=envelope();file.character[key]=value;expect(()=>parseCharacterFile(JSON.stringify(file))).toThrow();
  });
  it('rejects missing fields, malformed arrays and unrecognized content', () => {
    const c=character();
    expect(()=>validateCharacter({...c,abilities:[10]})).toThrow();
    expect(()=>validateCharacter({...c,ranks:Array(18).fill(3)})).toThrow();
    expect(()=>validateCharacter({...c,saves:Array(6).fill('false')})).toThrow();
    expect(()=>validateCharacter({...c,details:{unknown:'cannot silently discard'}})).toThrow();
    const file=envelope();delete file.character.hitDice;
    expect(()=>parseCharacterFile(JSON.stringify(file))).toThrow('生命骰');
    const injection=serializeCharacter(c).replace('"character": {','"character": {"__proto__": {},');
    expect(()=>parseCharacterFile(injection)).toThrow('不支持的字段');
  });
  it('rejects invalid JSON and oversized UTF-8 input', () => {
    expect(()=>parseCharacterFile('{')).toThrow('无法读取 JSON');
    expect(()=>parseCharacterFile('中'.repeat(MAX_CHARACTER_FILE_BYTES/3+1))).toThrow('1 MB');
    expect(()=>validateCharacter({...character(),details:{笔记:'中'.repeat(30001)}})).toThrow('30000');
  });
  it('rejects a PDF and an oversized file before reading it', async () => {
    await expect(readCharacterFile(new File(['%PDF'],'角色.pdf'))).rejects.toThrow('PDF');
    await expect(readCharacterFile(new File([' '.repeat(MAX_CHARACTER_FILE_BYTES+1)],'角色.json'))).rejects.toThrow('1 MB');
    await expect(readCharacterFile(new File([serializeCharacter(character())],'角色.dndcard.json'))).resolves.toMatchObject({character:{name:'艾琳·霜语'}});
  });
  it('allows the maximum detailed record within the 1 MB budget', () => {
    const c={...character(),details:Object.fromEntries(detailFields.map(field=>[field,'中'.repeat(30000)]))};
    expect(parseCharacterFile(serializeCharacter(c)).character.details).toEqual(c.details);
  });
});
