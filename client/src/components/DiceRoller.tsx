import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DIE_SIDES, naturalTwenties, parseDiceExpression, physicalDice, simpleRoll, summarizeDice, type DiceExpression, type DiceResult, type DieSides, type PhysicalDie, type RollRecord } from '../dice/rules';
import Icon from './Icon';
import DiceSymbol from '../dice/DiceSymbol';
import SimpleDiceTray from '../dice/SimpleDiceTray';
import { DICE_OPTIONS, RAIL_OPTIONS, SHAPE_OPTIONS, SIZE_OPTIONS, THEME_OPTIONS, VIEW_OPTIONS, parseTraySettings, type TraySettings } from '../dice/settings';
const DiceTray=lazy(()=>import('../dice/DiceTray'));
const historyKey='dm-tools:dice-history:v1';
const trayKey='dm-tools:dice-tray:v1';
function loadTraySettings():TraySettings{try{return parseTraySettings(JSON.parse(localStorage.getItem(trayKey)||'{}'));}catch{return parseTraySettings({});}}
interface RollSession {id:string;expression:DiceExpression;dice:PhysicalDie[]}
function loadHistory():RollRecord[]{try{const value=JSON.parse(localStorage.getItem(historyKey)||'[]');if(!Array.isArray(value))return [];return value.filter(r=>r&&typeof r.id==='string'&&typeof r.expression==='string'&&r.expression.length<=120&&Number.isFinite(r.total)&&Number.isFinite(r.createdAt)&&Array.isArray(r.results)&&r.results.length<=24&&r.results.every((d:DiceResult)=>DIE_SIDES.includes(d.sides)&&Number.isInteger(d.value)&&d.value>=1&&d.value<=d.sides)).slice(0,20);}catch{return [];}}
function TrayChoice<T extends string>({label,options,value,onChange,disabled}:{label:string;options:readonly {value:T;label:string}[];value:T;onChange:(value:T)=>void;disabled?:boolean}){
  return <div className="dice-tray-choice" role="group" aria-label={label}><span>{label}</span><div>{options.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} disabled={disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div></div>;
}
export default function DiceRoller(){
  const [expression,setExpression]=useState('1d20');
  const [mode,setMode]=useState<'physics'|'simple'>(()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'simple':'physics');
  const [session,setSession]=useState<RollSession|null>(null);
  const [phase,setPhase]=useState<'idle'|'rolling'|'done'|'error'>('idle');
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [values,setValues]=useState<Record<string,number>>({});
  const [record,setRecord]=useState<RollRecord|null>(null);
  const [history,setHistory]=useState<RollRecord[]>(loadHistory);
  const [storageError,setStorageError]=useState(false);
  const [tray,setTray]=useState<TraySettings>(loadTraySettings);
  const rolling=useRef(false);
  const activeRollId=useRef<string|null>(null);
  useEffect(()=>{try{localStorage.setItem(historyKey,JSON.stringify(history));setStorageError(false);}catch{setStorageError(true);}},[history]);
  useEffect(()=>{if(mode==='simple'||ready)return;const timer=setTimeout(()=>setError('3D 引擎尚未就绪，可切换简洁模式'),15000);return()=>clearTimeout(timer);},[mode,ready]);
  useEffect(()=>{try{localStorage.setItem(trayKey,JSON.stringify(tray));}catch{/* Settings simply reset next visit. */}},[tray]);
  const updateTray=useCallback((change:Partial<TraySettings>)=>setTray(old=>({...old,...change})),[]);
  // A new frame size or shape needs an empty tray; the last result stays in the panel.
  const reshapeTray=(change:Partial<TraySettings>)=>{if(phase==='rolling')return;updateTray(change);setSession(null);setValues({});};
  const onViewChange=useCallback((view:TraySettings['view'])=>updateTray({view}),[updateTray]);
  const onReady=useCallback(()=>{setReady(true);setError('');},[]);
  const onError=useCallback((message:string)=>{if(activeRollId.current!==(session?.id??null))return;rolling.current=false;activeRollId.current=null;setPhase('error');setError(message);},[session]);
  const finish=(parsed:DiceExpression,results:DiceResult[],id:string,rollMode:'physics'|'simple')=>{
    if(activeRollId.current!==id)return;
    activeRollId.current=null;
    const next:RollRecord={id,expression:parsed.normalized,results,modifier:parsed.modifier,total:results.reduce((sum,die)=>sum+die.value,parsed.modifier),createdAt:Date.now(),mode:rollMode};
    rolling.current=false;setRecord(next);setPhase('done');setHistory(old=>[next,...old].slice(0,20));
  };
  const onComplete=useCallback((result:Record<string,number>)=>{
    if(!session||!rolling.current||activeRollId.current!==session.id)return;
    try{setValues(result);finish(session.expression,summarizeDice(session.expression,result),session.id,'physics');}catch(e){onError(e instanceof Error?e.message:'无法读取结果');}
  },[session,onError]);
  const roll=(event?:FormEvent)=>{
    event?.preventDefault();
    try{
      const parsed=parseDiceExpression(expression);
      if(mode==='physics'&&!ready){setError('3D 引擎尚未就绪');return;}
      const id=crypto.randomUUID();activeRollId.current=id;setExpression(parsed.normalized);setError('');setRecord(null);setValues({});
      if(mode==='simple'){setSession(null);finish(parsed,simpleRoll(parsed),id,'simple');return;}
      rolling.current=true;setPhase('rolling');setSession({id,expression:parsed,dice:physicalDice(parsed)});
    }catch(e){setError(e instanceof Error?e.message:'骰式无效');}
  };
  const addDie=(sides:DieSides)=>{
    const next=expression.trim()?`${expression}+1d${sides}`:`1d${sides}`;
    try{const parsed=parseDiceExpression(next);const counts=new Map<DieSides,number>();parsed.terms.forEach(t=>counts.set(t.sides,(counts.get(t.sides)||0)+t.count));setExpression([...counts].map(([sides,count])=>`${count}d${sides}`).join('+')+(parsed.modifier?`${parsed.modifier>0?'+':''}${parsed.modifier}`:''));setError('');}catch(e){setError(e instanceof Error?e.message:'骰式无效');}
  };
  const changeMode=(value:'physics'|'simple')=>{if(phase==='rolling'||value===mode)return;setMode(value);setSession(null);setValues({});setRecord(null);setPhase('idle');setError('');if(value==='physics')setReady(false);};
  const poolCounts = new Map<DieSides, number>();
  try { for (const term of parseDiceExpression(expression).terms) poolCounts.set(term.sides, (poolCounts.get(term.sides) ?? 0) + term.count); } catch { /* Invalid input is reported on submit. */ }
  const natural=record?.results.length===1&&record.results[0].sides===20?record.results[0].value:null;
  const twenties=record?naturalTwenties(record.results):0;
  return <div className="tool-content dice-page">
    <header className="tool-heading"><div><span className="eyebrow">04 / DICE</span><h1>掷骰</h1></div><span className="tool-status">本机掷骰</span></header>
    <div className="dice-layout">
      <section className="dice-workspace" aria-label="掷骰工作区">
        <form className="dice-roll-controls" onSubmit={roll}>
          <div className="dice-expression-row"><label>骰式<input aria-label="骰式" maxLength={120} value={expression} disabled={phase==='rolling'} autoComplete="off" spellCheck={false} onChange={e=>{setExpression(e.target.value);setError('');}} placeholder="2d6+3 / d20+d4+5" aria-describedby="dice-expression-error"/></label><button className="button-primary dice-roll-button" disabled={!expression.trim()||(mode==='physics'&&!ready)}><Icon name="dice"/><span>{phase==='rolling'?'重新掷骰':'掷骰'}</span></button></div>
          <div className="dice-palette" aria-label="添加骰子">{DIE_SIDES.map(sides=><button key={sides} type="button" disabled={phase==='rolling'} onClick={()=>addDie(sides)} aria-label={`添加一颗 d${sides}`} className={poolCounts.has(sides)?'has-dice':''}><span className="die-shape"><DiceSymbol sides={sides}/></span><span className="die-type">d{sides}</span><span className="die-quantity" aria-hidden="true">{poolCounts.has(sides)?`×${poolCounts.get(sides)}`:'+'}</span></button>)}</div>

          <div className="dice-presets"><span>常用</span>{['1d20','2d6+3','8d6','1d100'].map(value=><button key={value} type="button" disabled={phase==='rolling'} onClick={()=>{setExpression(value);setError('');}}>{value}</button>)}<button type="button" disabled={phase==='rolling'} className="dice-reset" onClick={()=>{setExpression('');setError('');}}>清空骰式</button></div>
          {error&&<p id="dice-expression-error" role="alert" className="tool-error">{error}</p>}
        </form>
        <div className="dice-stage-header"><div className="dice-mode" role="group" aria-label="掷骰模式"><button aria-pressed={mode==='physics'} disabled={phase==='rolling'} onClick={()=>changeMode('physics')}>3D 骰盘</button><button aria-pressed={mode==='simple'} disabled={phase==='rolling'} onClick={()=>changeMode('simple')}>简洁模式</button></div><span className="dice-status" role="status">{phase==='rolling'?'正在投掷':phase==='done'?'投掷完成':mode==='physics'&&!ready?'加载引擎…':'就绪'}</span></div>
        <div className={`dice-stage ${mode==='simple'?'is-simple':`theme-${tray.theme}`} ${tray.view==='free'?'is-free-view':''}`} aria-label={mode==='physics'?'三维物理骰盘':'简洁骰盘'}>
          {mode==='physics'?<Suspense fallback={<div className="dice-canvas-fallback">正在加载 3D 骰盘…</div>}><DiceTray settings={tray} onViewChange={onViewChange} rollId={session?.id||'preview'} dice={session?.dice||[]} results={values} complete={phase==='done'||phase==='error'} onComplete={onComplete} onError={onError} onReady={onReady}/></Suspense>:<SimpleDiceTray results={record?.results}/>}
          {record&&twenties>0&&<div key={record.id} className="dice-crit" aria-hidden="true"><span className="dice-crit-flash"/><span className="dice-crit-ring"/><span className="dice-crit-ring"/><strong>20</strong><span className="dice-crit-caption">{natural===20?'自然 20 · NATURAL TWENTY':`${twenties} 颗 d20 掷出 20`}</span></div>}
          {record&&<div className="dice-tray-total"><span>总和</span><strong>{record.total}</strong></div>}
          <div className="dice-stage-caption"><span>{session?.expression.normalized||'D4 / D6 / D8 / D10 / D12 / D20 / D100'}</span><span>{mode==='physics'?'PHYSICS / 3D':'RANDOM / 2D'}</span></div>
        </div>

        {mode==='physics'&&<fieldset className="dice-tray-settings" aria-label="骰盘设置">
          <TrayChoice label="视角" options={VIEW_OPTIONS} value={tray.view} onChange={view=>updateTray({view})}/>
          <TrayChoice label="底图" options={THEME_OPTIONS} value={tray.theme} onChange={theme=>updateTray({theme})}/>
          <TrayChoice label="骰子" options={DICE_OPTIONS} value={tray.dice} onChange={dice=>updateTray({dice})}/>
          <TrayChoice label="尺寸" options={SIZE_OPTIONS} value={tray.size} disabled={phase==='rolling'} onChange={size=>reshapeTray({size})}/>
          <TrayChoice label="形状" options={SHAPE_OPTIONS} value={tray.shape} disabled={phase==='rolling'} onChange={shape=>reshapeTray({shape})}/>
          <TrayChoice label="围栏" options={RAIL_OPTIONS} value={tray.rail} onChange={rail=>updateTray({rail})}/>
          <label className="dice-collider-toggle"><input type="checkbox" checked={tray.showColliders} onChange={e=>updateTray({showColliders:e.target.checked})}/>显示碰撞框</label>
          <p className="dice-tray-hint">拖动骰盘可自由旋转视角，自由视角下滚轮缩放。尺寸与形状改变碰撞边界，投掷中不可更改；骰子多时骰盘会自动放大以减少叠压。围栏上方有透明防护，骰子不会飞出盘外。</p>
        </fieldset>}
        <details className="dice-rules"><summary>读数规则与限制</summary><p>d4 按最高顶点的数字读取；d100 使用十位和个位两颗 d10，00 + 0 = 100。每次最多 24 颗实体骰。</p><p>3D 模式读取停稳后的实际姿态；简洁模式使用浏览器加密随机数。自然 20 / 1 仅标记单颗 d20 的原始结果，是否触发暴击由当前规则决定。本页结果不广播到房间。</p></details>
      </section>
      <aside className="dice-result-panel" aria-label="掷骰结果">
        <section className={`dice-result ${twenties?'is-critical':''}`} aria-live="polite" aria-atomic="true"><span className="eyebrow">RESULT / 总和</span><div className="dice-total">{phase==='rolling'?'…':record?.total??'—'}</div><div className="result-formula">{phase==='rolling'?session?.expression.normalized:record?.expression||'未投掷'}</div>{natural===20||natural===1?<span className={`natural-result ${natural===20?'is-twenty':''}`}>自然 {natural}</span>:twenties?<span className="natural-result is-twenty">d20 掷出 20 ×{twenties}</span>:null}
          {record&&<><div className="dice-result-breakdown">{record.results.map((die,index)=><div key={index}><span className="result-die-type"><DiceSymbol sides={die.sides}/><span>d{die.sides}</span><small>#{String(index+1).padStart(2,'0')}</small></span><strong>{die.value}</strong>{die.components&&<small>{String(die.components[0]).padStart(2,'0')} + {die.components[1]}</small>}</div>)}</div><div className="dice-modifier"><span>修正值</span><strong>{record.modifier>=0?'+':''}{record.modifier}</strong></div></>}
        </section>
        <section className="dice-history"><header><h2>历史记录 <span>{history.length}</span></h2><button type="button" disabled={!history.length||phase==='rolling'} onClick={()=>setHistory([])}>清空</button></header>{storageError&&<p className="tool-error">历史记录未能保存到本机</p>}{!history.length?<p className="dice-history-empty">暂无记录</p>:<ol>{history.map(item=><li key={item.id}><div><strong>{item.expression}</strong><small>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · {item.mode==='physics'?'3D':'简洁'}</small><span>[{item.results.map(d=>d.value).join(', ')}]{item.modifier?` ${item.modifier>0?'+':''}${item.modifier}`:''}</span></div><b>{item.total}</b></li>)}</ol>}</section>
      </aside>
    </div>
  </div>;
}
