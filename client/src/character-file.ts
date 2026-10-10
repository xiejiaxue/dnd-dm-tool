import { blankCharacter, detailFields, type CharacterDraft } from './character-draft';

export const CHARACTER_FILE_FORMAT = 'dm-tracker-character';
export const CHARACTER_FILE_VERSION = 1;
export const MAX_CHARACTER_FILE_BYTES = 1024 * 1024;
export const MAX_CHARACTER_DRAFTS = 100;
export interface CharacterFile {
  format: typeof CHARACTER_FILE_FORMAT;
  version: typeof CHARACTER_FILE_VERSION;
  ruleset: 'dnd5e-2014';
  exportedAt: string;
  character: CharacterDraft;
}
export class CharacterFileError extends Error {}
const labels: Record<string, string> = {
  id:'角色编号',name:'角色名称',species:'种族 / 物种',className:'职业',background:'背景',alignment:'阵营',experience:'经验值',hitDice:'生命骰',
  level:'等级',maxHp:'HP 上限',hp:'当前 HP',temporaryHp:'临时 HP',armorClass:'护甲等级',speed:'速度',initiativeBonus:'额外先攻加值',spellAbility:'施法属性',
  abilities:'属性',saves:'豁免熟练',ranks:'技能熟练',details:'详细记录',
};
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CharacterFileError(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new CharacterFileError(`${label}包含不支持的字段，请使用本站模板`);
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new CharacterFileError(`${label}必须是 ${max} 字以内的文本`);
  return value;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new CharacterFileError(`${label}必须是 ${min}–${max} 之间的整数`);
  return value;
}
function array(value: unknown, label: string, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length) throw new CharacterFileError(`${label}必须包含 ${length} 项`);
  return value;
}
export function validateCharacter(value: unknown): CharacterDraft {
  const c = record(value,'角色数据');
  keys(c,Object.keys(labels),'角色数据');
  const strings = Object.fromEntries(['id','name','species','className','background','alignment','experience','hitDice'].map(key => [key,text(c[key],labels[key],160)]));
  if (!strings.id.trim()) throw new CharacterFileError('缺少角色编号');
  const maxHp=number(c.maxHp,labels.maxHp,1,9999);
  const detail=record(c.details,labels.details);
  keys(detail,[...detailFields],labels.details);
  return {
    id:strings.id,name:strings.name,species:strings.species,className:strings.className,background:strings.background,alignment:strings.alignment,experience:strings.experience,hitDice:strings.hitDice,
    level:number(c.level,labels.level,1,20),maxHp,hp:number(c.hp,labels.hp,0,maxHp),temporaryHp:number(c.temporaryHp,labels.temporaryHp,0,9999),armorClass:number(c.armorClass,labels.armorClass,0,100),speed:number(c.speed,labels.speed,0,9999),initiativeBonus:number(c.initiativeBonus,labels.initiativeBonus,-100,100),spellAbility:number(c.spellAbility,labels.spellAbility,-1,5),
    abilities:array(c.abilities,labels.abilities,6).map((value,i)=>number(value,`第 ${i+1} 项属性`,1,30)),
    ranks:array(c.ranks,labels.ranks,18).map((value,i)=>number(value,`第 ${i+1} 项技能熟练`,0,2)),
    saves:array(c.saves,labels.saves,6).map(value=>{if(typeof value!=='boolean')throw new CharacterFileError('豁免熟练必须为 true 或 false');return value;}),
    details:Object.fromEntries(Object.entries(detail).map(([key,value])=>[key,text(value,key,30000)])),
  };
}
export function serializeCharacter(character: CharacterDraft, now = new Date()): string {
  const file: CharacterFile = {format:CHARACTER_FILE_FORMAT,version:CHARACTER_FILE_VERSION,ruleset:'dnd5e-2014',exportedAt:now.toISOString(),character:validateCharacter(character)};
  return JSON.stringify(file,null,2);
}
export function parseCharacterFile(source: string): CharacterFile {
  if (new TextEncoder().encode(source).byteLength > MAX_CHARACTER_FILE_BYTES) throw new CharacterFileError('文件超过 1 MB');
  let parsed: unknown;
  try { parsed=JSON.parse(source.replace(/^\uFEFF/,'')); } catch { throw new CharacterFileError('无法读取 JSON，请上传完整的角色文件'); }
  const file=record(parsed,'文件');
  if(file.format!==CHARACTER_FILE_FORMAT) throw new CharacterFileError('不是本站角色文件，请使用 .dndcard.json 文件或下载模板');
  if(file.version!==CHARACTER_FILE_VERSION) throw new CharacterFileError('不支持此文件版本，当前支持 v1');
  if(file.ruleset!=='dnd5e-2014') throw new CharacterFileError('规则版本不匹配，当前支持 D&D 5e 2014');
  keys(file,['format','version','ruleset','exportedAt','character'],'文件');
  const exportedAt=text(file.exportedAt,'导出时间',40);
  if(!/^\d{4}-\d\d-\d\dT/.test(exportedAt)||!Number.isFinite(Date.parse(exportedAt))) throw new CharacterFileError('导出时间无效');
  return {format:CHARACTER_FILE_FORMAT,version:1,ruleset:'dnd5e-2014',exportedAt,character:validateCharacter(file.character)};
}
export async function readCharacterFile(file: File): Promise<CharacterFile> {
  if(!/\.json$/i.test(file.name)) throw new CharacterFileError('请选择 .dndcard.json 或 .json 文件；PDF 仅用于阅读，不能重新导入');
  if(file.size>MAX_CHARACTER_FILE_BYTES) throw new CharacterFileError('文件超过 1 MB');
  return parseCharacterFile(await file.text());
}
export function importCharacterCopy(file: CharacterFile): CharacterDraft {
  return {...validateCharacter(file.character),id:crypto.randomUUID()};
}
export function downloadCharacterFile(character: CharacterDraft, template=false): void {
  const source=serializeCharacter(character);
  const blob=new Blob([source],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  const name=Array.from(character.name.trim()||'未命名角色').slice(0,60).join('').replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_');
  anchor.download=template?'角色卡模板.dndcard.json':`${name}.dndcard.json`;
  anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function downloadCharacterTemplate(): void { downloadCharacterFile(blankCharacter(),true); }
