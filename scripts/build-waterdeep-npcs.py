"""Build campaign cards from the user's checked-in Chinese NPC dossiers.
Usage: python3 scripts/build-waterdeep-npcs.py /path/to/深水城：龙金劫
No online dependencies. Source text is retained; no encounter scaling is applied.
"""
import json, pathlib, re, sys, hashlib
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(__file__).resolve().parents[1]/'shared/waterdeep'
manifest=json.loads((root/'NPC/_资料/人物清单.json').read_text())
clean=lambda s: re.sub(r'\[([^]]+)\]\([^)]*\)',r'\1',s).replace('**','').strip()
supplements=json.loads((out/'supplements.json').read_text())
entries=[]; index=[]; skipped=[]
noncombat={'平民','贵族','食人鱼','乘用马','驮用马','猫'}
for npc in manifest:
 text=(root/npc['path']).read_text(); data=text.split('## 数据',1)[1].split('## 来源',1)[0].strip()
 if npc['name'] in supplements:
  extra=supplements[npc['name']]
  data=extra['data']
  npc={**npc,'template':extra['template']}
 if npc['name']=='曼松拟像':
  # The spell itself halves the original's hit point maximum. Keep the original's spell list through level 5.
  base=next(n for n in manifest if n['name']=='曼松')
  data=(root/base['path']).read_text().split('## 数据',1)[1].split('### 曼松拟像',1)[0]
  data=data.replace('19（大法师法袍，威力法杖）','12').replace('126（23d8+23）','63（本体生命值上限的一半）').replace('13（10000 XP）','8（3900 XP）')
  data=re.sub(r'^.*(?:\*\*特殊装备|\*\*魔法抗性|\*\*威力法杖 Staff).*\n','',data,flags=re.M)
  data=re.sub(r'；6 环——[^\n]+','。',data)
  data=data.replace('DC21，法术攻击命中+15','DC19，法术攻击命中+11').replace('力量 +2，敏捷 +4，体质 +3，智力 +13，感知 +9，魅力 +5', '智力 +11，感知 +7')
  data+='\n\n拟像限制：没有特殊装备、魔法抗性或威力法杖动作；没有6环及以上法术位。拟像不能恢复已消耗的法术位；生命值上限按拟像术减半。\n'
 if '护甲等级' not in data or not re.search(r'生命值[^\d\n]*(\d+)',data):
  skipped.append({'name':npc['name'],'reason':'未确认完整战斗数据','path':npc['path']});continue
 # A base-template details section can contain lore before its actual stat block.
 # Retain lair rules separately and remove only the preceding descriptive lore.
 def trim_base(m):
  s=re.sub(r'<summary>.*?</summary>','',m.group(1),flags=re.S)
  ac=s.find('护甲等级'); start=s.rfind('\n\n',0,max(0,ac-2)); prefix=s[:start]
  lair=''
  if '巢穴动作Lair Action' in prefix:
   lair=prefix[prefix.index('巢穴动作Lair Action'):]
   lair=lair.split('“每只眼魔')[0]
  return '\n\n### 基础模板（角色明确调整优先）\n'+s[start:].strip()+'\n\n'+lair
 data=re.sub(r'<details>(.*?)</details>',trim_base,data,flags=re.S)
 # Separate the NPC's primary numbers from its variant/secondary creature notes.
 primary=data.split('### 曼松拟像')[0]
 rows=[]
 for line in primary.splitlines():
  if re.match(r'^\|[^|]+\|[^|]+\|',line):
   cells=[clean(x) for x in line.strip('|').split('|')]
   if cells[0] not in ('属性','---') and not cells[0].startswith('-'):rows.append(cells[:2])
 if not rows:
  for line in primary.splitlines():
   m=re.match(r'^(护甲等级|生命值|速度|豁免|技能|伤害抗性|伤害免疫|伤害易伤|状态免疫|感官|语言|挑战等级)[：:]\s*(.*)',line)
   if m and not any(x[0]==m[1] for x in rows):rows.append([m[1],clean(m[2])])
  for label in ['力量','敏捷','体质','智力','感知','魅力']:
   m=re.search(label+r'\s*(\d+\s*[（(][^）)]+[）)])',primary)
   if m:rows.append([label,m[1]])
 hp=int(re.search(r'生命值[^\d\n]*(\d+)',primary)[1])
 cr=re.search(r'挑战等级[^\d\n]*(\d+(?:/\d+)?)',primary)
 faction=npc['path'].split('/')[1].split('_',1)[1]
 ident='WDNPC__'+hashlib.sha256(npc['name'].encode()).hexdigest()[:16]
 body=[]
 for p in re.split(r'\n\s*\n',data):
  if p.strip().startswith('|'):continue
  if p.strip().startswith('[基础数据与来源]'):continue
  body.append(clean(p))
 body.append('数据来源：'+npc['path']+'。依据本地NPC档案及2014版模板；角色明确调整优先，未做等级缩放。')
 # Source path is relative to the local module, never a filesystem disclosure.
 entry={'id':ident,'name':npc['name'],'hp':{'average':hp},'cr':cr[1] if cr else '',
  'campaignCard':{'name':npc['name'],'meta':f'深水城 · {faction} · 2014版','rows':rows,'body':body},
  'provenance':{'path':npc['path'],'sources':npc['sources']}}
 row={'id':ident,'type':'monster','nameZh':npc['name'],'nameEn':' / '.join(npc['aliases']),
  'source':'深水城 NPC','bookFile':'builtin/waterdeep','cr':entry['cr'],'faction':faction,
  'category':npc['category'],'location':npc['location'],'hp':hp,
  'combat':npc['template'] not in noncombat or npc['group']=='06',
  'template':npc['template'] or '独立数据'}
 entries.append(entry);index.append(row)
out.mkdir(parents=True,exist_ok=True)
for name,value in [('cards.json',entries),('index.json',index),('unverified.json',skipped)]:
 (out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(f'{len(entries)} cards, {sum(x["combat"] for x in index)} combat NPCs, {len(skipped)} unverified')
