import { useEffect, useState } from 'react';
import { DAYS, type CalendarEvent } from '../../../shared/calendar/model';
import { CAMPAIGN_START_DAY, DEFAULT_OPENING_DAY, tavernDate, todayPublicEvents } from './date';
type Payload = { canManage: boolean; events: CalendarEvent[] };
function DateStory({ event, dm = false }: { event: CalendarEvent; dm?: boolean }) {
  const flavor = event.flavor;
  return <>{flavor ? <><blockquote className="tavern-date-quote"><p>“{flavor.text}”</p><cite>—— {flavor.speaker}</cite></blockquote><details className="tavern-date-lore"><summary>城中掌故</summary><p>{flavor.background}</p></details></> : <p>{event.detail}</p>}{dm && flavor && <p className="tavern-inline-note">主持人备忘：{event.detail}</p>}</>;
}
type Campaign = { slug: string; name: string; role: string; templateId?: string };
/** The tavern belongs to Waterdeep: Dragon Heist; other campaigns have no Trollskull Manor. */
const TAVERN_MODULE = 'waterdeep-dragon-heist';
export default function TavernDate({ day, businessDay, phase, onNextDay, onSetDate, startDay = DEFAULT_OPENING_DAY, onStartDay }: { day: number; businessDay: number; phase: string; onNextDay: () => void; onSetDate: (day: number) => void; startDay?: number; onStartDay: (day: number) => void }) {
  const [campaign, setCampaign] = useState(new URLSearchParams(location.search).get('campaign') ?? '');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (location.pathname === '/calendar') history.replaceState(null, '', `/tavern${location.search}`);
    const recheck = () => { setData(null); setRevision(n => n + 1); };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, []);
  useEffect(() => {
    fetch('/api/campaigns', { cache: 'no-store' }).then(r => r.ok ? r.json() : { campaigns: [] }).then(d => setCampaigns(d.campaigns ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    fetch(`/api/calendar${campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error('活动暂时无法读取，请确认已加入所选桌团，或选择公共活动。'); return r.json(); })
      .then(value => { if (!controller.signal.aborted) setData(value); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [campaign, revision]);
  const current = tavernDate(day, startDay);
  const [chosenDate, setChosenDate] = useState(Math.min(365, current.absoluteDay));
  useEffect(() => { setChosenDate(Math.min(365, current.absoluteDay)); }, [current.absoluteDay]);
  const events = todayPublicEvents(data?.events ?? [], day, startDay);
  const secrets = data?.canManage ? data.events.filter(e => !e.public && e.status === '待处理') : [];
  return <section className="tavern-date" aria-label="今日深水城" id="tavern-calendar">
    <div className="tavern-date-heading">
      <div className="tavern-date-current">
        <span className="eyebrow">01 / 今日深水城</span>
        <h2 aria-label={`${current.year} DR · ${current.date.label}`}><span className="tavern-date-number">{current.date.day ? String(current.date.day).padStart(2, '0') : '✦'}</span><span className="tavern-date-month">{current.date.day ? current.date.label.replace(/ \d+日$/, '') : current.date.label}<small>{current.year} DR</small></span></h2>
        <span className="tavern-date-phase">{phase === 'setup' ? '开业筹备中' : `营业第 ${businessDay} 天`}</span>
      </div>
      <div className="tavern-date-controls">
    <div className="tavern-date-toolbar">
      <div className="tavern-date-actions"><button className="button-secondary" disabled={current.absoluteDay === 0} onClick={() => onSetDate(current.absoluteDay - 1)}>← 前一日</button><button className="button-primary" disabled={!['setup', 'planning'].includes(phase)} onClick={onNextDay}>下一日 →</button></div>
      <details className="tavern-date-adjust"><summary>选择 / 重置日期</summary><div className="tavern-date-adjust-body">
      <div className="tavern-date-picker"><label htmlFor="tavern-date-select">跳转日期 <small>1492 DR</small></label><select id="tavern-date-select" aria-label="选择当前日期" value={chosenDate} onChange={e => setChosenDate(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d.key} value={i}>{d.label}</option>)}</select><button className="button-secondary" onClick={() => onSetDate(chosenDate)}>设为今天</button></div>
      <div className="tavern-date-reset"><button className="button-secondary" disabled={current.absoluteDay === CAMPAIGN_START_DAY} onClick={() => onSetDate(CAMPAIGN_START_DAY)}>回到开团日期</button><span>1492 DR · 彻斯1日 · 保留营业记录与收支</span></div>
      </div></details>
    </div>
    <p className="tavern-date-sync">{['setup', 'planning'].includes(phase) ? '下一日：筹备／休业一天，不产生收支。' : phase === 'report' ? '结算完成后，点击下方“进入下一天”，日期自动前进一天。' : phase === 'finished' ? '继续自由经营时，日期自动前进一天。' : '营业与打烊不跳日；进入下一营业日时，日期同步前进。'}<span>手动改期仅调整日历，不回滚账本。</span></p>
      </div>
    </div>
    <details className="tavern-date-events" key={`${current.absoluteDay}-${campaign}`}>
      <summary><span className="eyebrow">城市见闻</span><span className="tavern-date-event-title">{error ? '活动暂时无法读取' : !data ? '正在读取城市活动…' : events.length ? events.map(e => e.title).join(' · ') : current.date.day === 0 ? current.date.label : '今日无特别庆典'}</span></summary>
      <div className="tavern-date-event-body">
        {error ? <p role="alert">{error}</p> : !data ? <p role="status">正在读取城市活动…</p> : events.length ? events.map(e => <article key={e.id}><h3>{e.title}</h3><DateStory event={e} /></article>) : <p>{current.date.day === 0 ? `今天是${current.date.label}。` : '街巷照常迎来送往。'}</p>}
      </div>
    </details>
    <details className="tavern-date-settings"><summary>桌团与日期提示</summary><p>人物引语与便笺为依据模组设定创作的跑团文案，并非出版物原文；主持人场记不代表玩家已获知线索。</p><label>关联桌团 <select aria-label="日历所属桌团" value={campaign} onChange={e => { setData(null); setCampaign(e.target.value); history.replaceState(null, '', e.target.value ? `/tavern?campaign=${encodeURIComponent(e.target.value)}` : '/tavern'); }}><option value="">仅公共活动</option>{campaigns.filter(c => c.templateId === TAVERN_MODULE || c.slug === campaign).map(c => <option key={c.slug} value={c.slug}>{c.name} · {['host', 'dm', 'assistant_dm'].includes(c.role) ? '主持人' : '玩家'}</option>)}</select></label>
    <p>默认从彻斯20日起计。日期随本机酒馆存档保存；关联桌团用于验证主持人权限。</p>
    {data?.canManage && <div className="tavern-dm-dates"><h3>主持人专属日期</h3><label>起始日期 <select aria-label="酒馆开业日期" value={startDay} onChange={e => onStartDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d.key} value={i}>{d.label}</option>)}</select></label><p>筹备与休业日同样计入日期；营业结算仍按营业天数计算。只调整日期对应关系，不改变营业进度、账本或剧情结果。以下为重置版预定日期，是否发生由主持人裁定。</p>
    <ul>{secrets.map(e => <li key={e.id}><strong>{DAYS[e.day].label} · {e.title}</strong><small>{e.day === current.absoluteDay ? '今天' : e.day > current.absoluteDay ? `还有 ${e.day - current.absoluteDay} 天` : `已过 ${current.absoluteDay - e.day} 天`}</small><DateStory event={e} dm />{e.condition && <p>{e.condition}</p>}</li>)}</ul></div>}
    </details>
  </section>;
}
