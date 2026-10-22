"""Build Curse of Strahd from local Chinese maps and checked 2014 encounter cards.
python3 scripts/build-strahd.py /path/to/施特拉德的诅咒
Original assets are copied byte-for-byte; no network or invented combat statistics.
"""
from pathlib import Path
import json, re, sys, hashlib, struct, shutil, math
from urllib.parse import unquote
ROOT=Path(sys.argv[1]); REPO=Path(__file__).resolve().parents[1]
OUT=REPO/'shared/strahd'; ASSETS=REPO/'output/strahd/assets'
OUT.mkdir(parents=True,exist_ok=True); ASSETS.mkdir(parents=True,exist_ok=True)
anchors=json.loads((OUT/'anchors.json').read_text())
clean=lambda s: re.sub(r'\[([^]]+)\]\([^)]*\)',r'\1',re.sub(r'</?(?:details|summary|br)[^>]*>','',s)).replace('**','').strip()
ident=lambda s: hashlib.sha256(s.encode()).hexdigest()[:16]
cards={}; index={}; scenes=[]; unresolved=[]
for img in sorted((ROOT/'地图').glob('*/*.png'),key=lambda p:p.name):
 num=img.name[:2]; chapter=img.parent.name.replace('_',' '); title=re.sub(r'^\d+_|_P\d+$','',img.stem).replace('_',' · ')
 width,height=struct.unpack('>II',img.read_bytes()[16:24]); asset='map-cos-'+num+'-'+hashlib.sha256(img.read_bytes()).hexdigest()[:12]
 shutil.copyfile(img,ASSETS/asset)
 guide=img.with_name(img.stem+'_战斗资料')/'战斗速查.md'; text=guide.read_text(); encounters=[]; section=''
 # Stable name+combat-data identifiers preserve the same creature across maps, while retaining real variants.
 for line in text.splitlines():
  if line.startswith('## '):section=line[3:]
  if not (line.startswith('|') and '](' in line):continue
  cells=[c.strip() for c in line.strip('|').split('|')]
  if len(cells)!=7:continue
  link=re.search(r'\[([^]]+)\]\(([^)]+)\)',cells[1])
  if not link:continue
  name=link[1]; p=guide.parent/unquote(link[2]); raw=p.read_text()
  data=raw.split('## 数据',1)[-1].split('## 立绘')[0]
  # Keep full localized abilities and module adjustments; strip local navigation only.
  data=re.sub(r'译文来源：.*','',data)
  data=re.sub(r'<summary>.*?</summary>','',data,flags=re.S)
  rows=[]; lines=data.splitlines()
  for i,l in enumerate(lines):
   if l.startswith('|'):
    cs=[clean(c) for c in l.strip('|').split('|')]
    if len(cs)==2 and cs[0] not in ('项目','属性','---') and not cs[0].startswith('-'):rows.append(cs)
    if cs==['力量','敏捷','体质','智力','感知','魅力'] and i+2<len(lines):
     vals=[clean(c) for c in lines[i+2].strip('|').split('|')]
     rows.extend([k,v] for k,v in zip(cs,vals))
  # Scenario HP/AC overrides the base stat block, including damaged golems and named variants.
  hp_match=re.match(r'\s*(\d+)',cells[4]); hp=int(hp_match[1]) if hp_match else None
  if hp is None:
   v=next((v for k,v in rows if k=='生命值'),''); m=re.match(r'(\d+)',v); hp=int(m[1]) if m else None
  ac=cells[3]; key='COS__'+ident(name+'\n'+clean(data)+'\n'+str(hp)+'\n'+ac)
  if key not in cards:
   rows=[r for r in rows if r[0] not in ['护甲等级','生命值']]
   rows=[['护甲等级',ac],['生命值',cells[4]],*rows]
   dex=next((v for k,v in rows if k=='敏捷'),''); dm=re.match(r'(\d+)',dex)
   if not dm:dm=re.search(r'敏捷\s*(\d+)',clean(data))
   bonus=math.floor((int(dm[1])-10)/2) if dm else None
   cr=next((v for k,v in rows if k=='挑战等级'),''); cm=re.match(r'\d+(?:/\d+)?',cr)
   cr=cm[0] if cm else ''
   body=[clean(b) for b in re.split(r'\n\s*\n',data) if b.strip() and not b.strip().startswith('|')]
   body=[b for b in body if b and not b.startswith('[角色卡')]
   body.append('场景明确调整优先于基础模板；同一人物跨图出现时，请沿用其当前状态，不能重复复活。')
   cards[key]={'id':key,'name':name,'hp':{'average':hp} if hp else None,'cr':cr,'campaignCard':{'name':name,'meta':'施特拉德的诅咒 · 2014版','rows':rows,'body':body},'provenance':{'path':str(p.relative_to(ROOT))}}
   index[key]={'id':key,'type':'monster','nameZh':name,'nameEn':'','source':'施特拉德的诅咒','bookFile':'builtin/strahd','cr':cr,'hp':hp,'initiativeBonus':bonus,'chapters':[],'sceneKeys':[]}
  if chapter not in index[key]['chapters']:index[key]['chapters'].append(chapter)
  if num not in index[key]['sceneKeys']:index[key]['sceneKeys'].append(num)
  quantity=cells[2]; count=int(quantity) if quantity.isdigit() else None
  # Explicit totals with explanatory parentheses; never infer dice, per-unit spawns, or remaining pools.
  if count is None and re.match(r'^\d+（',quantity):count=int(re.match(r'\d+',quantity)[0])
  if quantity == '—' and name in {'莉迪娅·彼得洛夫娜','卡西米尔·维里科夫','鲁瓦斯','阿瑞加尔','阿列克谢','芭芭·莱萨迦','赫尔娃','司肯尼斯','施特拉德·冯·扎洛维奇','科亚','艾丝美拉达·德·阿维尼尔','安娜·克雷茨科娃','基里尔·斯托亚诺维奇'}: count=1
  if quantity == '3成人': count=3
  region=cells[0]
  point=next((v for k,v in sorted(anchors.get(num,{}).items(),key=lambda kv:-len(kv[0])) if region.startswith(k)),None)
  if point:
   scale=min(650/width,930/height); ox=(650-width*scale)/2; oy=30+(930-height*scale)/2
   xy=[round((point[0]-ox)/scale/width,5),round((point[1]-oy)/scale/height,5)]
   assert all(0<=v<=1 for v in xy),(num,region,xy)
  else:xy=None
  auto=section in ['固定遭遇','在场人物'] and count is not None and xy is not None
  if section in ['固定遭遇','在场人物'] and not auto:unresolved.append({'map':num,'region':region,'name':name,'quantity':quantity,'reason':'数量需要裁定' if count is None else '无战斗数据' if hp is None else '图外或未定位，按需放置'})
  encounters.append({'key':num+'-'+ident(section+region+name),'entryId':key,'name':name,'section':section,'region':region,'quantity':quantity,'count':count,'hp':hp,'initiativeBonus':index[key]['initiativeBonus'],'condition':clean(cells[5]),'source':clean(cells[6]),'position':xy,'automatic':auto})
 notes=text.split('## 机关、战术与避免重复计数',1)[-1].split('## 战斗现场记录')[0].strip() if '## 机关、战术与避免重复计数' in text else ''
 scenes.append({'key':num,'name':num+' · '+title,'chapter':chapter,'map':{'assetId':asset,'width':width,'height':height,'mapScale':3},'encounters':encounters,'notes':clean(notes)})
for name,value in [('cards.json',list(cards.values())),('index.json',list(index.values())),('scenes.json',scenes),('manual-review.json',unresolved)]:
 (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
manifest={'id':'curse-of-strahd','schemaVersion':1,'scenes':[{'key':s['key'],'name':s['name'],'map':s['map']} for s in scenes]}
(REPO/'output/strahd/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'scenes':len(scenes),'cards':len(cards),'encounters':sum(len(s['encounters']) for s in scenes),'automaticTokens':sum(e['count'] for s in scenes for e in s['encounters'] if e['automatic']),'manualReview':len(unresolved)},ensure_ascii=False))
