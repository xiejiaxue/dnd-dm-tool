import { useEffect, useRef, useState, type DragEvent } from 'react';
import { downloadCharacterFile, downloadCharacterTemplate, importCharacterCopy, MAX_CHARACTER_DRAFTS, readCharacterFile, type CharacterFile } from '../character-file';
import { integer } from '../quick-combat';
import { abilityNames, blankCharacter, detailFields, draftPdf, modifier, proficiency, signed, skills, type CharacterDraft } from '../character-draft';
const storageKey = 'dm-tools:character-drafts:v1';
function loadDrafts(): CharacterDraft[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(raw)) throw new Error('草稿格式无效');
    return raw.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').slice(0,100).map(c => {
      const base = blankCharacter();
      const draft = {...base};
      for (const key of ['id','name','species','className','background','alignment','experience','hitDice'] as const) draft[key] = typeof c[key] === 'string' ? c[key].slice(0,160) : base[key];
      draft.level=integer(c.level,1,20); draft.maxHp=integer(c.maxHp,1); draft.hp=integer(c.hp,0,draft.maxHp); draft.temporaryHp=integer(c.temporaryHp); draft.armorClass=integer(c.armorClass,0,100); draft.speed=integer(c.speed); draft.initiativeBonus=integer(c.initiativeBonus,-100,100); draft.spellAbility=integer(c.spellAbility,-1,5);
      draft.abilities=base.abilities.map((_,i)=>integer(c.abilities?.[i]??10,1,30)); draft.saves=base.saves.map((_,i)=>c.saves?.[i]===true); draft.ranks=base.ranks.map((_,i)=>integer(c.ranks?.[i],0,2));
      draft.details=Object.fromEntries(detailFields.map(key=>[key,typeof c.details?.[key]==='string'?c.details[key].slice(0,30000):'']));
      return draft;
    });
  } catch { throw new Error('无法读取本机草稿。原始数据已保留，当前修改请下载可编辑文件备份。'); }
}
export default function CharacterWorkshop() {
  const [initial] = useState(() => {try{return {drafts:loadDrafts(),error:''};}catch(e){return {drafts:[],error:e instanceof Error?e.message:'无法读取本机草稿'};}});
  const [drafts,setDrafts] = useState<CharacterDraft[]>(initial.drafts);
  const [selected,setSelected] = useState(() => {try{const id=localStorage.getItem(`${storageKey}:selected`);return drafts.some(d=>d.id===id)?id!:drafts[0]?.id||'';}catch{return drafts[0]?.id||'';}});
  const [error,setError] = useState(initial.error);
  const [notice,setNotice] = useState('');
  const [saveError,setSaveError] = useState(initial.error);
  const [reading,setReading] = useState(false);
  const [dragging,setDragging] = useState(false);
  const [pending,setPending] = useState<{file:CharacterFile;name:string;bytes:number}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const importButton=useRef<HTMLButtonElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const readSequence=useRef(0);
  const [busy,setBusy] = useState(false);
  const c = drafts.find(d => d.id === selected);
  useEffect(()=>{
    if(initial.error) return;
    try{localStorage.setItem(storageKey,JSON.stringify(drafts));setSaveError('');}
    catch{setSaveError('本机保存失败，请下载可编辑文件备份。');}
  },[drafts,initial.error]);
  useEffect(()=>{try{localStorage.setItem(`${storageKey}:selected`,selected);}catch{/* Draft persistence reports storage failures separately. */}},[selected]);
  useEffect(()=>{if(pending && dialog.current && !dialog.current.open)dialog.current.showModal();},[pending]);
  const receiveFile=async (files: FileList|null) => {
    if(!files?.length)return;
    const sequence=++readSequence.current;
    setError('');setNotice('');setPending(null);
    if(files.length!==1){setError('每次只能上传一张角色卡');return;}
    if(drafts.length>=MAX_CHARACTER_DRAFTS){setError('已达到 100 张角色卡上限');return;}
    const upload=files[0];setReading(true);
    try{const file=await readCharacterFile(upload);if(sequence===readSequence.current)setPending({file,name:upload.name,bytes:upload.size});}
    catch(e){if(sequence===readSequence.current)setError(e instanceof Error?e.message:'文件读取失败');}
    finally{if(sequence===readSequence.current)setReading(false);}
  };
  const dropFile=(event:DragEvent<HTMLElement>)=>{event.preventDefault();setDragging(false);void receiveFile(event.dataTransfer.files);};
  const closeImport=()=>{dialog.current?.close();setPending(null);importButton.current?.focus();};
  const confirmImport=()=>{
    if(!pending)return;
    if(drafts.length>=MAX_CHARACTER_DRAFTS){setError('已达到 100 张角色卡上限');closeImport();return;}
    const imported=importCharacterCopy(pending.file);
    setDrafts(old=>[...old,imported]);setSelected(imported.id);
    setNotice(`已导入「${imported.name||'未命名角色'}」，原有角色未被覆盖`);
    closeImport();
  };
  const downloadEditable=()=>{if(!c)return;try{downloadCharacterFile(c);setError('');setNotice('已生成可编辑文件，可再次上传修改');}catch(e){setError(e instanceof Error?e.message:'下载失败');}};
  const patch = (value: Partial<CharacterDraft>) => setDrafts(old => old.map(d => {
    if (d.id !== selected) return d;
    const next = {...d,...value};
    return {...next,hp:Math.min(next.hp,next.maxHp)};
  }));
  const add = () => {if(drafts.length>=MAX_CHARACTER_DRAFTS)return;setError('');setNotice('');const draft=blankCharacter();setDrafts([...drafts,draft]);setSelected(draft.id);};
  const exportPdf = async () => {if(!c)return;setBusy(true);setError('');try{const {downloadCharacterPdf}=await import('../character-pdf');await downloadCharacterPdf(draftPdf(c));setNotice('已生成 PDF 阅读版');}catch(e){setError(e instanceof Error?e.message:'PDF 导出失败');}finally{setBusy(false);}};
  const textField = (key: keyof CharacterDraft, label: string) => <label key={key}>{label}<input value={String(c?.[key]??'')} maxLength={160} onChange={e=>patch({[key]:e.target.value})}/></label>;
  const numberField = (key: keyof CharacterDraft,label: string,min=0,max=9999) => <label key={key}>{label}<input type="number" min={min} max={max} value={Number(c?.[key]??0)} onChange={e=>patch({[key]:Math.max(min,Math.min(max,Math.trunc(Number(e.target.value)||0)))})}/></label>;
  return <div className="tool-content">
    <header className="tool-heading"><div><span className="eyebrow">03 / CHARACTER</span><h1>角色卡</h1></div><span className={`tool-status ${saveError?'accent':''}`} role="status">{saveError?'本机未保存':'已保存到本机'}</span></header>
    <section className="character-transfer" aria-label="角色卡文件">
      <div className={`upload-card ${dragging?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setDragging(false);}} onDrop={dropFile}>
        <div className="file-type">01 / IMPORT</div><h2>上传角色卡</h2><p id="character-file-requirements">.dndcard.json / .json · v1 · 最大 1 MB</p>
        <div className="transfer-actions"><button ref={importButton} className="button-primary" disabled={reading||drafts.length>=MAX_CHARACTER_DRAFTS} aria-describedby="character-file-requirements" onClick={()=>fileInput.current?.click()}>{reading?'正在校验…':'选择文件'}</button><button className="text-link" onClick={downloadCharacterTemplate}>下载空白模板 ↓</button></div>
        <span className="transfer-note">支持拖入文件；导入前预览，创建独立副本。</span><details className="file-spec"><summary>文件规范</summary><p>使用本站导出的角色文件或空白模板。等级 1–20，属性 1–30，当前 HP 不超过上限。暂不支持其他工具的文件或 PDF。</p><a href="/schemas/character-file-v1.schema.json" download>下载 JSON Schema v1 ↓</a></details>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="上传可编辑角色文件" hidden onChange={e=>{void receiveFile(e.target.files);e.target.value='';}}/>
      </div>
      <div className="download-card"><div className="file-type">02 / EXPORT</div><h2>下载当前角色</h2><p className="export-target">{c ? c.name||'未命名角色' : '未选择角色'}</p>
        <div className="download-option"><div><strong>可编辑文件</strong><span>.dndcard.json · 备份 / 再次上传修改</span></div><button className="button-secondary" disabled={!c||reading} onClick={downloadEditable}>下载角色文件</button></div>
        <div className="download-option"><div><strong>PDF 阅读版</strong><span>.pdf · 阅读 / 打印，不支持重新导入</span></div><button className="button-secondary" disabled={!c?.name.trim()||busy} onClick={()=>void exportPdf()}>{busy?'正在导出…':'导出 PDF'}</button></div>
      </div>
    </section>
    <div className="character-actions"><label>本机角色 · {drafts.length}<select aria-label="选择角色" value={selected} onChange={e=>{setSelected(e.target.value);setNotice('');}}><option value="" disabled>选择角色</option>{drafts.map(d=><option key={d.id} value={d.id}>{d.name || '未命名角色'}{drafts.filter(other=>other.name===d.name).length>1?` · ${drafts.filter(other=>other.name===d.name).findIndex(other=>other.id===d.id)+1}`:''}</option>)}</select></label><button className="button-secondary" onClick={add} disabled={drafts.length>=MAX_CHARACTER_DRAFTS}>新建角色</button></div>
    {saveError && <p className="tool-error" role="alert">{saveError}</p>}
    {error && error!==saveError && <p className="tool-error" role="alert">{error}</p>}
    {notice && <p className="file-notice" role="status">{notice}<button aria-label="关闭文件提示" onClick={()=>setNotice('')}>×</button></p>}
    {c && <nav className="character-section-nav" aria-label="角色卡分区">{[['basic','基本信息'],['combat','战斗数据'],['abilities','属性 / 豁免'],['skills','技能'],['casting','施法'],['details','详细记录']].map(([id,label])=><a key={id} href={`#character-${id}`} onClick={e=>{e.preventDefault();const section=document.getElementById(`character-${id}`);section?.scrollIntoView({block:'start'});section?.focus({preventScroll:true});}}>{label}</a>)}</nav>}
    <dialog ref={dialog} className="character-import-dialog" aria-labelledby="import-title" onCancel={closeImport} onClick={e=>{if(e.target===e.currentTarget)closeImport();}}>
      {pending && <div className="import-preview"><header><span className="eyebrow">IMPORT / VALIDATED</span><button aria-label="关闭导入预览" onClick={closeImport}>×</button></header><h2 id="import-title">导入预览</h2><p className="import-filename">{pending.name} · {(pending.bytes/1024).toFixed(1)} KB</p><dl><div><dt>角色名称</dt><dd>{pending.file.character.name||'未命名角色'}</dd></div><div><dt>职业 / 等级</dt><dd>{pending.file.character.className||'—'} / {pending.file.character.level}</dd></div><div><dt>种族 / 物种</dt><dd>{pending.file.character.species||'—'}</dd></div><div><dt>HP / 上限</dt><dd>{pending.file.character.hp} / {pending.file.character.maxHp}</dd></div><div><dt>数据版本</dt><dd>D&D 5e 2014 · v{pending.file.version}</dd></div><div><dt>导出时间</dt><dd>{new Date(pending.file.exportedAt).toLocaleString('zh-CN')}</dd></div></dl><p className="transfer-note">将添加到本机角色列表，不覆盖现有角色。</p><footer><button className="button-secondary" onClick={closeImport}>取消</button><button className="button-primary" onClick={confirmImport}>导入为新角色</button></footer></div>}
    </dialog>
    {!c ? <div className="tool-empty">暂无角色卡</div> : <>
      <section id="character-basic" tabIndex={-1} className="tool-section character-editor-section"><h2><span>01</span> 基本信息</h2><div className="sheet-fields">{textField('name','角色名称')}{textField('species','种族 / 物种')}{textField('className','职业')}{numberField('level','等级',1,20)}{textField('background','背景')}{textField('alignment','阵营')}{textField('experience','经验值')}{textField('hitDice','生命骰')}</div></section>
      <section id="character-combat" tabIndex={-1} className="tool-section character-editor-section"><h2><span>02</span> 战斗数据</h2><div className="sheet-fields">{numberField('hp','当前 HP')}{numberField('maxHp','HP 上限',1)}{numberField('temporaryHp','临时 HP')}{numberField('armorClass','护甲等级',0,100)}{numberField('speed','速度（尺）')}{numberField('initiativeBonus','额外先攻加值',-100,100)}<div className="derived-stat"><span>先攻</span><strong>{signed(modifier(c.abilities[1])+c.initiativeBonus)}</strong></div><div className="derived-stat"><span>熟练加值</span><strong>{signed(proficiency(c.level))}</strong></div></div></section>
      <section id="character-abilities" tabIndex={-1} className="tool-section character-editor-section"><h2><span>03</span> 属性与豁免</h2><div className="ability-fields">{abilityNames.map((name,i)=><div className="ability-field" key={name}><label>{name}<input aria-label={name} type="number" min="1" max="30" value={c.abilities[i]} onChange={e=>patch({abilities:c.abilities.map((v,j)=>j===i?Math.max(1,Math.min(30,Number(e.target.value)||1)):v)})}/></label><strong>{signed(modifier(c.abilities[i]))}</strong><label className="check-label"><input type="checkbox" aria-label={`${name}豁免熟练`} checked={c.saves[i]} onChange={e=>patch({saves:c.saves.map((v,j)=>j===i?e.target.checked:v)})}/>豁免熟练</label></div>)}</div></section>
      <section id="character-skills" tabIndex={-1} className="tool-section character-editor-section"><h2><span>04</span> 技能</h2><div className="skill-fields">{skills.map(([name,ability],i)=><label key={name}>{name}<strong>{signed(modifier(c.abilities[ability])+c.ranks[i]*proficiency(c.level))}</strong><select aria-label={`${name}熟练`} value={c.ranks[i]} onChange={e=>patch({ranks:c.ranks.map((v,j)=>i===j?Number(e.target.value):v)})}><option value="0">未熟练</option><option value="1">熟练</option><option value="2">专精</option></select></label>)}</div></section>
      <section id="character-casting" tabIndex={-1} className="tool-section character-editor-section"><h2><span>05</span> 施法</h2><div className="sheet-fields"><label>施法属性<select value={c.spellAbility} onChange={e=>patch({spellAbility:Number(e.target.value)})}><option value="-1">无</option>{abilityNames.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label><div className="derived-stat"><span>法术攻击</span><strong>{c.spellAbility<0?'—':signed(modifier(c.abilities[c.spellAbility])+proficiency(c.level))}</strong></div><div className="derived-stat"><span>法术豁免 DC</span><strong>{c.spellAbility<0?'—':8+modifier(c.abilities[c.spellAbility])+proficiency(c.level)}</strong></div></div></section>
      <section id="character-details" tabIndex={-1} className="tool-section character-editor-section"><h2><span>06</span> 详细记录</h2><div className="detail-fields">{detailFields.map(label=><label key={label}>{label}<textarea rows={6} maxLength={30000} value={c.details[label]||''} onChange={e=>patch({details:{...c.details,[label]:e.target.value}})}/></label>)}</div></section>
    </>}
  </div>;
}
