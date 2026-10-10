import type { CharacterPdf } from './character-pdf';
export const abilityNames = ['力量','敏捷','体质','智力','感知','魅力'] as const;
export const skills: [string, number][] = [['运动',0],['体操',1],['巧手',1],['隐匿',1],['奥秘',3],['历史',3],['调查',3],['自然',3],['宗教',3],['驯兽',4],['洞悉',4],['医药',4],['察觉',4],['求生',4],['欺瞒',5],['威吓',5],['表演',5],['游说',5]];
export const detailFields = ['攻击与伤害','法术与施法说明','法术位与资源','装备与货币','职业与种族特性','语言与工具熟练','性格与背景故事','笔记'] as const;
export interface CharacterDraft {
  id: string; name: string; species: string; className: string; level: number; background: string; alignment: string; experience: string;
  maxHp: number; hp: number; temporaryHp: number; armorClass: number; speed: number; initiativeBonus: number; hitDice: string;
  abilities: number[]; saves: boolean[]; ranks: number[]; spellAbility: number; details: Record<string,string>;
}
export const blankCharacter = (): CharacterDraft => ({id:crypto.randomUUID(),name:'',species:'',className:'',level:1,background:'',alignment:'',experience:'0',maxHp:10,hp:10,temporaryHp:0,armorClass:10,speed:30,initiativeBonus:0,hitDice:'1d8',abilities:[10,10,10,10,10,10],saves:[false,false,false,false,false,false],ranks:Array(18).fill(0),spellAbility:-1,details:{}});
export const modifier = (value: number) => Math.floor((value-10)/2);
export const signed = (value: number) => value >= 0 ? `+${value}` : `${value}`;
export const proficiency = (level: number) => 2 + Math.floor((level-1)/4);
export function draftPdf(c: CharacterDraft): CharacterPdf {
  const prof = proficiency(c.level);
  return {name:c.name,subtitle:`D&D 5e · ${c.className || '未填写职业'} · ${c.level} 级`,sections:[
    {title:'角色信息',rows:[['种族 / 物种',c.species],['背景',c.background],['阵营',c.alignment],['经验值',c.experience]]},
    {title:'战斗数据',rows:[['生命值',`${c.hp} / ${c.maxHp}　临时 HP ${c.temporaryHp}`],['护甲等级 / AC',String(c.armorClass)],['速度',`${c.speed} 尺`],['先攻',signed(modifier(c.abilities[1])+c.initiativeBonus)],['熟练加值',signed(prof)],['被动察觉',String(10+modifier(c.abilities[4])+c.ranks[12]*prof)],['生命骰',c.hitDice]]},
    {title:'属性与豁免',rows:abilityNames.map((name,i)=>[name,`${c.abilities[i]}　调整值 ${signed(modifier(c.abilities[i]))}　豁免 ${signed(modifier(c.abilities[i])+(c.saves[i]?prof:0))}${c.saves[i]?'（熟练）':''}`])},
    {title:'技能',rows:skills.map(([name,ability],i)=>[name,`${signed(modifier(c.abilities[ability])+c.ranks[i]*prof)}　${['未熟练','熟练','专精'][c.ranks[i]]}`])},
    {title:'施法',rows:c.spellAbility<0?[['施法属性','无']]:[['施法属性',abilityNames[c.spellAbility]],['法术攻击',signed(modifier(c.abilities[c.spellAbility])+prof)],['法术豁免 DC',String(8+modifier(c.abilities[c.spellAbility])+prof)]]},
    ...detailFields.filter(title=>c.details[title]?.trim()).map(title=>({title,paragraphs:[c.details[title]]})),
  ]};
}
