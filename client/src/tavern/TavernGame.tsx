import { recordedDateLabel } from './date';
import TavernDate from './TavernDate';
import { isSpecial, encounterLabel } from './game';
import { DRINKS, DRINK_SOURCE, orderLines, type Orders } from './drinks';
import { useEffect, useRef, useState } from 'react';
import { PATRONS, PREPARATIONS, STAFF, STAFF_JOBS, STAFF_SOURCE, STYLES, UPGRADES, type Choice } from './catalog';
import { SAVE_KEY, OPENING_COST, setAvailableCash, returnToSetup, advanceCalendarDay, currentCalendarDay, calendarElapsedDay, setCalendarDate, addOtherIncome, dismissStaff, styleUnlocked, changeStyle, beginDay, journalEntries, observeEncounter, continuePlaying, dailyTrade, getStory, money, newGame, nextDay, openTavern, parseGame, purchase, repayDebt, resolveEncounter, settleDay, skillBonus, type GameState, type Plan, type Settlement, type JournalEntry } from './game';
import { waterdeep } from '../music/catalog';
import Icon from '../components/Icon';
import './tavern-game.css';

const soundtrack = waterdeep.find(t => t.id === 'tavern')!;
const phases = { setup: '开业筹备', planning: '晨间准备', running: '营业中', report: '打烊结算', finished: '经营回顾' };
const tavernIllustration = {
  image: 'https://slyflourish.com/images/trollskull_manor.jpg',
  source: 'https://slyflourish.com/wdh_chapter_2.html',
};
function TavernScene() {
  const [failed, setFailed] = useState(false);
  return <figure className="tavern-illustration">
    {failed ? <div className="tavern-art-unavailable">插图暂时无法加载，可通过下方来源查看。</div> : <a href={tavernIllustration.image} target="_blank" rel="noreferrer" aria-label="查看完整的巨魔颅骨庄园插图"><img className="tavern-art-image" src={tavernIllustration.image} alt="深水城巨魔颅骨庄园修缮前的外观：绿瓦尖塔、木制阳台和临街的酒馆入口" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></a>}
    <figcaption>巨魔颅骨庄园与酒馆 <span>修缮前旧貌 · <a href={tavernIllustration.source} target="_blank" rel="noreferrer">图片来源：Sly Flourish ↗</a></span></figcaption>
  </figure>;
}

function Rules() {
  return <section className="tavern-rules" aria-label="游戏规则">
    <h2>经营规则与来源</h2><p>每位顾客以 d20 决定饮品档次、d6 决定档内品种。一笔一杯，另计餐食服务；开门时保存骰值，日终按最终客流结算。酒名取材于作者话题表，价格和点单机制为本游戏新增。</p>
    <p>每天选一个准备方向、决定宣传预算，接待 1d6 位重要访客。每晚有 1/6 概率发生特殊事件。特色经营风格需雇佣对应雇员解锁；未雇佣时仅可选择街边酒馆。已解锁风格可在每日营业前免费调整，按新风格计算当日客流和客单价。顾客依次带来尚未使用的话题，之后进入日常回访。可以回应，也可以记录后继续营业；后者不花费金币、不掷骰、不增减声望。</p>
    <p><strong>打烊账单：</strong>营业额 = 各杯饮品售价之和 + 点单数 × 餐食服务收入；净收益 = 营业额 + 日常经营调整 + 剧情收入 − 原料 − 日常费用 − 额外雇员工资 − 宣传 − 事件支出。开业与升级在购买时扣款，不重复记入每天的账单。</p>
    <p>初始可用资金 500 gp，作为雷纳的投资。本局将前期修缮视为另行处理，不再扣除示例开业预算。投资及玩家其他收益单独入账，不计入经营净收益；这是本局设定，并非重制版固定赠款。基础班组与日常费用合计 6 gp / 日，餐食原料 0.18 gp / 笔，饮品成本按酒单另计。无法支付的营业费用成为欠费；每欠 10 gp，客流减少 1 人，欠费达到 150 gp 停业。第 30 天以现金 800 gp、声望 60、无欠费为挑战目标，也可以继续自由经营。</p>
    <p><strong>版本区别：</strong>公会筹备、访客与事件参考 Alexandrian Remix 的酒馆配套。原版经济按每旬结算；本游戏新增逐日客流、客单价、检定、工资、升级和结局规则，使用明细账结算。基础费用 6 gp 是游戏将原版 60 gp / 旬均摊后的设定。</p>
    <p>来访与话题顺序参考作者 Tavern Time：本游戏每晚 1d3 位重要顾客、1/6 城市事件概率，另有两条普通顾客或经营日常记录，优先使用未谈过的话题。本游戏从 {PATRONS.length} 位顾客中等概率抽取且当晚不重复，未逐项复现原文 d20 及雷纳朋友子表。新增顾客按“初次见面、组织背景、立场与关系”逐次交谈；匿名联络人和日常事件是据设定补写的场景。传闻不等同于已证实事实。人物谈话为据设定编写的场景，交涉数值与经营奖励属于游戏扩展。<a href="https://thealexandrian.net/wordpress/43280/roleplaying-games/dragon-heist-a-night-in-trollskull-manor" target="_blank" rel="noreferrer">作者配套来源 ↗</a></p>
  </section>;
}
function OrderBook({ orders }: { orders: Orders }) {
  const lines = orderLines(orders);
  return <details className="tavern-orders"><summary>点单记录 · {lines.length} 笔</summary><p>每笔一杯饮品，另含 {money(orders.supplement)} gp 餐食与服务。重要访客计入总客流；街童一组按一笔茶饮记账。</p><ul>{orders.menu.map(d => { const count = lines.filter(l => l.drink.id === d.id).length; return count ? <li key={d.id}>{d.name} · {d.tier}<span>{count} 杯 × {money(d.price)} = {money(count * d.price)} gp</span></li> : null; })}</ul><details><summary>逐笔点单与骰值</summary><ol>{lines.map((line,i) => <li key={i}><strong>{line.guest} · {line.drink.name}</strong><span>d20 → {line.dice[0]}，d6 → {line.dice[1]}{line.nonAlcoholic ? ' · 无酒精替换' : ` · ${line.drink.tier}`}</span><span>饮品 {money(line.drink.price)} + 餐食服务 {money(orders.supplement)} = {money(line.total)} gp</span></li>)}</ol></details></details>;
}

function Statement({ report }: { report: Settlement }) {
  const rows: [string, number][] = [['营业额', report.sales], ['剧情收入 / 酬谢', report.storyIncome], ['日常经营调整', report.dailyNet ?? 0], ['原料成本', -report.ingredients], ['基础班组与日常费用', -report.upkeep], ['额外雇员工资', -report.wages], ['宣传支出', -report.marketing], ['人物与事件支出', -report.storyCost]];
  return <div className="tavern-statement"><p className="tavern-record-date">{recordedDateLabel(report.calendarDay)} <span>· 营业第 {report.day} 天</span></p><dl>{rows.map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount > 0 ? '+' : amount < 0 ? '−' : ''}{money(Math.abs(amount))}<small> gp</small></dd></div>)}<div className="statement-total"><dt>今日净收益</dt><dd className={report.net < 0 ? 'loss' : 'profit'}>{report.net >= 0 ? '+' : '−'}{money(Math.abs(report.net))}<small> gp</small></dd></div></dl>{report.orders ? <><p>{report.guests} 笔点单，营业额按各笔饮品与餐食服务汇总。平均消费约 {money(report.ticket)} gp。</p><OrderBook orders={report.orders} /></> : <p>{report.guests} 位普通顾客 × {money(report.ticket)} gp 客单价（旧版账单）。</p>}{report.payroll && report.payroll.length > 0 && <details className="tavern-payroll"><summary>雇员工资明细 · {money(report.wages)} gp</summary><ul>{report.payroll.map((p,i) => <li key={i}>{p.name} · {p.role}<span>{money(p.wage)} gp</span></li>)}</ul></details>}<p>期初 {money(report.openingCash)}{report.cashAdjustment ? ` + 手动余额调整 (${money(report.cashAdjustment)})` : ''} + 净收益 {money(report.net)} = {money(report.openingCash + (report.cashAdjustment ?? 0) + report.net)} gp。{report.newDebt > 0 ? `现金记为 0，新增欠费 ${money(report.newDebt)} gp。` : `期末现金 ${money(report.closingCash)} gp。`}</p></div>;
}
function choiceSummary(state: GameState, c: Choice) {
  const parts = [c.cost ? `花费 ${money(c.cost)} gp` : '无需花费'];
  if (c.skill) parts.push(`d20 + ${skillBonus(state, c.skill)} ≥ ${c.dc}`);
  
  return parts.join(' · ');
}

function Journal({ entries }: { entries: JournalEntry[] }) {
  return <ol className="tavern-journal-list">{entries.map((entry, i) => <li key={i} className={isSpecial(entry.kind) ? 'tavern-special' : ''}>
    <div className="tavern-entry-meta"><span>{encounterLabel(entry.kind)}</span><span>{entry.name}</span></div>
    <h4>{entry.title}</h4>{entry.text && <p>{entry.text}</p>}
    <p className="tavern-entry-result">{entry.action && `${entry.action}。`}{entry.result}</p>
    {entry.lore && <div className="tavern-lore"><strong>{entry.lore.title}</strong><p>{entry.lore.text}</p></div>}
  </li>)}</ol>;
}

export default function TavernGame() {
  const [initial] = useState(() => {
    try { const raw = localStorage.getItem(SAVE_KEY); const saved = parseGame(raw); return { game: saved ?? newGame(), error: raw && !saved ? '旧进度无法读取。可以重新开业或导入有效备份。' : '' }; }
    catch { return { game: newGame(), error: '当前浏览器无法读取本机存档。' }; }
  });
  const [game, setGame] = useState(initial.game);
  const current = useRef(game);
  const [error, setError] = useState(initial.error);
  const [name, setName] = useState(game.name);
  const [style, setStyle] = useState(game.style);
  const [plan, setPlan] = useState<Plan>({ preparation: 'welcome', marketing: 0 });
  const [reviewPlan, setReviewPlan] = useState(false);
  const reviewing = game.phase === 'running' && reviewPlan;
  const displayedPlan = reviewing && game.active ? { preparation: game.active.preparation, marketing: game.active.marketing } : plan;
  useEffect(() => { setReviewPlan(false); }, [game.phase]);
  const [editingCash, setEditingCash] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [cashError, setCashError] = useState('');
  const [incomeSource, setIncomeSource] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [rules, setRules] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (audio.current) audio.current.volume = .25; }, []);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const storyHeading = useRef<HTMLHeadingElement>(null);
  const resetPrompt = useRef<HTMLDivElement>(null);
  useEffect(() => { if (resetting) resetPrompt.current?.focus(); }, [resetting]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { current.current = game; try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch { setError('无法保存本机进度，请下载备份。'); } }, [game]);
  useEffect(() => { document.title = `${game.name} · 酒馆经营`; return () => { document.title = 'DM 追踪'; }; }, [game.name]);
  const previousPhase = useRef(game.phase);
  useEffect(() => { if (previousPhase.current !== game.phase) { stageHeading.current?.focus({ preventScroll: true }); previousPhase.current = game.phase; } }, [game.phase]);
  function act(change: (state: GameState) => GameState) {
    try { const next = change(current.current); current.current = next; setGame(next); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '操作未完成。'); }
  }
  const encounters = game.active?.encounters ?? [];
  const pending = encounters.filter(e => !e.resolved);
  const resolved = encounters.filter(e => e.resolved).sort((a, b) => (a.resolvedOrder ?? 0) - (b.resolvedOrder ?? 0));
  const encounter = pending.find(e => e.id === selected) ?? pending[0];
  const scene = encounter ? getStory(encounter) : null;
  const previousEncounter = useRef(encounter?.id);
  useEffect(() => { if (previousEncounter.current !== encounter?.id) { storyHeading.current?.focus({ preventScroll: true }); previousEncounter.current = encounter?.id; } }, [encounter?.id]);
  const report = game.ledger.at(-1);
  const trade = game.active ? dailyTrade(game) : null;
  const knownPatrons = PATRONS.filter(p => (game.progress[p.id] ?? 0) > 0);
  const learned = [...new Map([...game.ledger.flatMap(r => r.journal ?? []), ...journalEntries(resolved)].filter(e => e.lore).map(e => [e.lore!.title, e.lore!])).values()];
  const open = () => act(s => openTavern(s, name, style));
  const backup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `tavern-day-${game.day}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = async (file?: File) => {
    if (!file) return;
    if (file.size > 500000) { setError('备份超过 500 KB，无法读取。'); return; }
    try { const saved = parseGame(await file.text()); if (!saved) throw new Error('这不是有效的酒馆游戏备份。当前进度已保留。'); act(() => saved); setName(saved.name); setStyle(saved.style); setSelected(null); }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取备份。'); }
  };
  const toggleMusic = async () => {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else try { await audio.current.play(); } catch { setError('配乐未能播放，请再试一次或使用配乐页。'); }
  };
  return <div className="tool-content tavern-game">
    <header className="tool-heading tavern-heading"><div><span className="eyebrow">深水城龙金劫 / TROLLSKULL TAVERN</span><h1>酒馆经营</h1><p>巨魔颅骨巷 · 营业记录与每日收支</p></div><div className="tavern-header-actions"><button className="button-secondary" onClick={() => setRules(!rules)} aria-expanded={rules}>经营规则</button><button className="button-secondary tavern-music" onClick={() => void toggleMusic()} aria-pressed={playing}><Icon name="music" />{playing ? '暂停配乐' : 'Swing Jazz'}</button></div></header>
    <nav className="tavern-section-nav" aria-label="酒馆页面导航"><a href="#tavern-calendar">01 / 日期与见闻</a><a href="#tavern-business">02 / 今日营业</a><a href="#tavern-management">03 / 酒馆管理</a><a href="#tavern-records">04 / 往日记录</a></nav>
    <TavernDate day={calendarElapsedDay(game)} onSetDate={absoluteDay => act(s => setCalendarDate(s, absoluteDay))} businessDay={game.day} phase={game.phase} onNextDay={() => act(advanceCalendarDay)} startDay={game.calendarStartDay} onStartDay={calendarStartDay => act(s => ({ ...s, calendarStartDay, calendarAdjustment: 0 }))} />
    <audio ref={audio} src={soundtrack.audio} loop preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setError('配乐暂时无法加载。'); }} />
    {error && <p role="alert" className="tool-error">{error}</p>}
    {rules && <Rules />}
    {resetting && <div className="tavern-reset" role="alert" ref={resetPrompt} tabIndex={-1}><p>重新开业会替换当前浏览器的进度。可以先下载备份。</p><button className="button-secondary" onClick={backup}>下载备份</button><button className="button-primary" onClick={() => { act(() => newGame()); setName('巨魔颅骨酒馆'); setStyle('ale'); setResetting(false); setSelected(null); setPlan({ preparation: 'welcome', marketing: 0 }); }}>确定重新开业</button><button className="button-secondary" onClick={() => setResetting(false)}>取消</button></div>}
    {game.active?.style && game.active.style !== game.style && <p className="tavern-inline-note">旧存档的当日风格保留至打烊；下次营业按已雇佣人员解锁风格。</p>}
    <div className="tavern-stats" aria-label="经营状态"><div><span>第 {game.day} 天 <small>{game.freePlay ? '自由经营' : '/ 30 天'}</small></span><strong>{phases[game.phase]}</strong></div><div className="tavern-cash"><span>可用金币 <button type="button" className="tavern-cash-edit" aria-label="修改可用金币" onClick={() => { setCashInput((game.cash / 100).toFixed(2)); setCashError(''); setEditingCash(true); }}>修改</button></span>{editingCash ? <form className="tavern-cash-form" onSubmit={e => { e.preventDefault(); if (!/^\d+(\.\d{1,2})?$/.test(cashInput)) { setCashError('请输入非负金额，最多两位小数。'); return; } try { const next = setAvailableCash(current.current, Math.round(Number(cashInput) * 100)); act(() => next); setEditingCash(false); } catch (e) { setCashError(e instanceof Error ? e.message : '修改失败'); } }}><label htmlFor="tavern-cash-input">余额（gp）</label><input id="tavern-cash-input" type="number" min="0" max="1000000" step="0.01" required autoFocus value={cashInput} onChange={e => setCashInput(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingCash(false); }} /><div><button className="button-primary" type="submit">保存</button><button className="button-secondary" type="button" onClick={() => setEditingCash(false)}>取消</button></div><p>直接设置余额，不计入经营利润。</p>{cashError && <p role="alert">{cashError}</p>}</form> : <strong>{money(game.cash)}<small> gp</small></strong>}</div><div><span>街坊声望</span><strong>{game.reputation}<small> / 100</small></strong></div><div><span>经营累计净收益</span><strong className={game.totalProfit < 0 ? 'loss' : ''}>{money(game.totalProfit)}<small> gp</small></strong></div>{game.debt > 0 && <div className="tavern-debt"><span>未付经营费用</span><strong>{money(game.debt)}<small> gp</small></strong></div>}</div>
    <div className="tavern-layout"><section className="tavern-floor" aria-label="酒馆营业" id="tavern-business">

      <div className="tavern-stage">
        {game.phase === 'setup' && <><span className="eyebrow">开业登记</span><h2 tabIndex={-1} ref={stageHeading}>酒馆筹备</h2><p className="tavern-intro">巨魔颅骨庄园，利夫仍在吧台。雷纳投资 500 gp，作为本局的初始可用资金。</p><form onSubmit={e => { e.preventDefault(); open(); }}><label>酒馆名称<input value={name} onChange={e => setName(e.target.value)} maxLength={40} required /></label><fieldset className="tavern-styles"><legend>选择酒馆风格</legend>{STYLES.map(s => <label key={s.id} className={style === s.id ? 'selected' : ''}><input type="radio" name="tavern-style" disabled={!styleUnlocked(game, s.id)} checked={style === s.id} onChange={() => setStyle(s.id)} /><strong>{s.name}</strong><span>{s.requiredStaff ? `需雇佣${STAFF.find(p => p.id === s.requiredStaff)?.name}解锁` : s.note}</span></label>)}</fieldset><div className="tavern-opening"><span>前期预算参考（本局不扣款）<strong>{money(OPENING_COST)} gp</strong></span><span>修缮 650 + 服务押金 185 + 首批供应 103</span><small>前期修缮及产权事项视为另行处理。500 gp 全额用于后续经营。</small></div><button className="button-primary tavern-primary" type="submit">登记开业 <Icon name="arrow" /></button></form></>}
        {(game.phase === 'planning' || reviewing) && <><span className="eyebrow">{recordedDateLabel(reviewing ? game.active?.calendarDay : currentCalendarDay(game))} · 营业第 {game.day} 天 / {reviewing ? '当日安排' : '晨间'}</span><h2 tabIndex={-1} ref={stageHeading}>营业安排</h2>{!reviewing && <><button className="button-secondary tavern-return-setup" onClick={() => { setName(game.name); setStyle(game.style); act(returnToSetup); }}>← 返回筹备</button><p className="tavern-inline-note">返回可修改开业登记，资金、日期和经营记录都会保留。</p></>}<p className="tavern-intro">{reviewing ? '当天已开始营业。以下为开门时的安排；顾客、事件、骰值和收支均已保留，继续营业不会重新扣费。' : '利夫在吧台擦拭酒杯，基础班组已到岗。'}</p><fieldset disabled={reviewing} className="tavern-styles"><legend>经营风格</legend>{STYLES.map(s => <label key={s.id} className={(reviewing ? game.active?.style ?? game.style : game.style) === s.id ? 'selected' : ''}><input type="radio" name="daily-tavern-style" disabled={!styleUnlocked(game, s.id)} checked={(reviewing ? game.active?.style ?? game.style : game.style) === s.id} onChange={() => act(g => changeStyle(g, s.id))} /><strong>{s.name}</strong><span>{styleUnlocked(game, s.id) ? `已解锁 · 餐食服务 ${money(s.ticket - 35)} gp · 客流 ${s.guests >= 0 ? "+" : ""}${s.guests}` : `需雇佣${STAFF.find(p => p.id === s.requiredStaff)?.name}解锁`}</span></label>)}</fieldset><p className="tavern-inline-note">默认街边酒馆；雇佣对应雇员后可在营业前免费切换。</p><fieldset disabled={reviewing} className="tavern-preparation"><legend>今日准备</legend>{PREPARATIONS.map(p => <button key={p.id} className={displayedPlan.preparation === p.id ? 'selected' : ''} aria-pressed={displayedPlan.preparation === p.id} onClick={() => setPlan({ ...plan, preparation: p.id })}><strong>{p.name}</strong><span>{p.note}</span></button>)}</fieldset><fieldset disabled={reviewing} className="tavern-marketing"><legend>宣传预算</legend>{([0,300,600] as const).map(amount => <button key={amount} aria-pressed={displayedPlan.marketing === amount} className={displayedPlan.marketing === amount ? 'selected' : ''} onClick={() => setPlan({ ...plan, marketing: amount })}>{amount === 0 ? '靠街坊口碑' : `${money(amount)} gp`}<small>{amount ? `今日客流 +${amount / 300 * 8}` : '不额外花费'}</small></button>)}</fieldset><button className="button-primary tavern-primary" disabled={!reviewing && game.cash < plan.marketing} onClick={() => { if (reviewing) { setReviewPlan(false); stageHeading.current?.focus({ preventScroll: true }); } else { setSelected(null); act(s => beginDay(s, plan)); } }}>{reviewing ? '继续当天营业' : '开门营业'} <Icon name="arrow" /></button>{!reviewing && game.cash < displayedPlan.marketing && <p className="tavern-inline-note">当前金币不足，请降低宣传预算。</p>}</>}
        {game.phase === 'running' && !reviewing && <><div className="tavern-shift-heading"><div><span className="eyebrow">{recordedDateLabel(game.active?.calendarDay ?? currentCalendarDay(game))} · 营业第 {game.day} 天 / 营业中</span><h2 tabIndex={-1} ref={stageHeading}>营业日志</h2><button className="button-secondary" onClick={() => { setReviewPlan(true); requestAnimationFrame(() => stageHeading.current?.focus({ preventScroll: true })); }}>← 返回营业安排</button></div><span className="tavern-progress">{encounters.length - pending.length} / {encounters.length} 已记录</span></div>
          <div className="tavern-patrons" aria-label="今晚的访客、雇员与事件">{encounters.map(e => { const person = getStory(e); return <button key={e.id} className={`${isSpecial(e.kind) ? 'tavern-special' : ''} ${e.resolved ? 'resolved' : ''} ${encounter?.id === e.id ? 'selected' : ''}`} disabled={e.resolved} aria-pressed={encounter?.id === e.id} onClick={() => setSelected(e.id)}><span style={{ background: person.color }} className="patron-avatar">{person.initial}</span><span>{e.kind === 'event' ? '特殊事件' : person.name}<small>{e.resolved ? '已记录' : isSpecial(e.kind) ? '现场记录' : e.kind === 'everyday' ? '酒馆日常' : e.kind === 'staff' ? '雇员交谈' : e.chapter < 3 ? '本次话题' : '再次来访'}</small></span></button>; })}</div>
          {scene && encounter ? <article className={`tavern-story ${isSpecial(encounter.kind) ? 'tavern-special' : ''}`} key={encounter.id}><span className="tavern-entry-label">{encounterLabel(encounter.kind)}</span><div className="tavern-story-identity"><span style={{ background: scene.color }} className="patron-avatar">{scene.initial}</span><span>{scene.name}<small>{scene.role}</small></span></div><h3 tabIndex={-1} ref={storyHeading}>{scene.title}</h3><p>{scene.text}</p>{scene.lore && <div className="tavern-lore"><strong>{scene.lore.title}</strong><p>{scene.lore.text}</p></div>}{encounter.kind !== 'windfall' && encounter.kind !== 'everyday' && <details className="tavern-response"><summary>回应此事</summary><div className="tavern-choices">{scene.choices.map(c => <button key={c.id} disabled={game.cash < c.cost} onClick={() => act(s => resolveEncounter(s, encounter.id, c.id))}><strong>{c.label}</strong><span>{choiceSummary(game, c)}{game.cash < c.cost ? ' · 金币不足' : ''}</span><Icon name="arrow" /></button>)}</div><p className="tavern-inline-note">带检定的行动在失败时仍消耗所列费用。</p></details>}<button className="button-secondary tavern-observe" onClick={() => act(s => observeEncounter(s, encounter.id))}>{encounter.kind === 'windfall' ? '记录收入 +10 gp，继续营业' : '记录，继续营业'}</button></article> : <div className="tavern-ready"><span className="tavern-ready-mark">✦</span><h3>当日记录完毕</h3><p>营业结束后汇总当日收入和支出。</p></div>}
          <div className="tavern-resolution-log" aria-live="polite">{resolved.length > 0 && <details open><summary>今日已记 · {resolved.length} 条</summary><Journal entries={journalEntries(resolved)} /></details>}</div><button className="button-primary tavern-primary" disabled={pending.length > 0} onClick={() => act(settleDay)}>{pending.length ? `还有 ${pending.length} 条待记录` : '打烊，结算今日收益'} <Icon name="arrow" /></button></>}
        {game.phase === 'report' && report && <><span className="eyebrow">{recordedDateLabel(report.calendarDay)} · 营业第 {game.day} 天 / 今日账单</span><h2 tabIndex={-1} ref={stageHeading}>每日结算</h2><Statement report={report} /><button className="button-primary tavern-primary" onClick={() => act(nextDay)}>{game.debt >= 15000 || (!game.freePlay && game.day >= 30) ? '查看经营回顾' : `进入第 ${game.day + 1} 天`} <Icon name="arrow" /></button></>}
        {game.phase === 'finished' && <><span className="eyebrow">{game.debt >= 15000 ? '暂时熄灯' : '30 天经营回顾'}</span><h2 tabIndex={-1} ref={stageHeading}>{game.debt >= 15000 ? '暂停营业' : '经营汇总'}</h2><p className="tavern-intro">{game.debt >= 15000 ? '未付经营费用达到150 gp，酒馆暂时停业。下载账本，或重新尝试不同的经营方式。' : `已记录 ${knownPatrons.length} 位顾客的来访，当前声望 ${game.reputation}。`}</p><div className="tavern-goals"><span className={game.cash >= 80000 ? 'achieved' : ''}>现金 800 gp {game.cash >= 80000 ? '已达成' : '未达成'}</span><span className={game.reputation >= 60 ? 'achieved' : ''}>声望 60 {game.reputation >= 60 ? '已达成' : '未达成'}</span><span className={game.debt === 0 ? 'achieved' : ''}>无欠费 {game.debt === 0 ? '已达成' : '未达成'}</span></div>{game.debt < 15000 && <button className="button-primary tavern-primary" onClick={() => act(continuePlaying)}>继续自由经营 <Icon name="arrow" /></button>}<button className="button-secondary" onClick={() => setResetting(true)}>重新开业</button></>}
        {<section className="tavern-history" aria-label="往日日志" id="tavern-records"><h3>往日日志</h3>{game.ledger.length === 0 && <p className="tavern-inline-note">尚无营业记录。首次打烊结算后，账单与日志会保存在这里。</p>}<p className="tavern-inline-note">最近 {game.ledger.length} 个营业日，按发生顺序记录。日期在开门时记下，之后改期不会改变旧记录。</p>{[...game.ledger].reverse().map(r => <details key={r.day} open={game.phase === 'report' && r.day === game.day}><summary><span className="tavern-history-date">{recordedDateLabel(r.calendarDay)}<small>营业第 {r.day} 天 · {r.weather}</small></span><small>{r.journal?.length ?? r.notes.length} 条</small></summary>{r.journal ? <Journal entries={r.journal} /> : r.notes.map((n,i) => <p key={i}>{n}</p>)}</details>)}</section>}
        {game.phase === 'running' && trade?.orders && <OrderBook orders={trade.orders} />}
      </div>
    </section><aside className="tavern-sidebar" aria-label="酒馆管理" id="tavern-management">
      <details className="tavern-location"><summary>巨魔颅骨酒馆 · 查看插图</summary><div className="tavern-scene-wrap"><TavernScene /><div className="tavern-scene-label"><span>{game.name}</span><small>{game.active?.weather ?? (game.phase === 'setup' ? '巨魔颅骨巷 · 等待开业' : '巨魔颅骨巷 · 暖灯仍亮着')}</small></div></div></details>
      <details className="tavern-management tavern-drink-menu"><summary>酒单与点单骰</summary><p>d20：1–10 平价，11–16 精选，17–19 珍酿，20 典藏；再掷 d6，1–3 选该档第一款，4–6 选第二款。每杯价格如下。</p><ul>{DRINKS.map(d => <li key={d.id}><strong>{d.name}</strong><span>{d.tier} · {money(d.price)} gp / 杯</span><small>{d.origin}</small></li>)}</ul><p>酒名参考 <a href={DRINK_SOURCE} target="_blank" rel="noreferrer">Alexandrian 顾客话题</a>。售价、成本与点单骰为小游戏扩展。骰值在开门时保存，刷新不重掷；客流变化使用同一组骰值。</p></details><section className="tavern-sidebar-section"><span className="eyebrow">今日概况</span><h2>{game.phase === 'setup' ? '开业信息' : game.name}</h2><p>利夫与基础班组已经就位。<br />{STYLES.find(s => s.id === (game.active?.style ?? game.style))?.name} · {game.staff.length} 份额外雇佣</p>{trade && <dl className="tavern-preview"><div><dt>预计消费笔数</dt><dd>{trade.guests} 人</dd></div><div><dt>平均消费（约）</dt><dd>{money(trade.ticket)} gp</dd></div><div><dt>访客数量骰</dt><dd>d{game.active!.patronDie ?? 6} → {game.active!.visitorRoll}</dd></div><div><dt>事件检查骰</dt><dd>d6 → {game.active!.eventRoll}</dd></div></dl>}<p className="tavern-inline-note">经营周期：30 天，可在期末继续自由经营。</p>{game.debt > 0 && <button className="button-secondary" disabled={game.phase !== 'planning' || game.cash === 0} onClick={() => act(repayDebt)}>偿还欠费 {money(Math.min(game.cash, game.debt))} gp</button>}</section>
      {game.phase !== 'setup' && <><details className="tavern-management" open={game.phase === 'planning'}><summary>雇员与岗位 <small>{game.staff.length} 份雇佣</small></summary><p>利夫与基础班组维持日常营业，已包含在每日6 gp基础费用中。下列雇员为额外招聘，可组合雇佣，效果与日薪累加。</p><p><a href={STAFF_SOURCE} target="_blank" rel="noreferrer">原文雇员设定 ↗</a> · 签约费、工资、专属对白与事件为小游戏扩展。雇佣后每天随机记录一段雇员交谈，并有 1/6 概率出现雇员事件。</p>{STAFF_JOBS.map(job => <section className="tavern-job" key={job}><h3>{job}</h3>{STAFF.filter(s => s.job === job).map(s => <div key={s.id} className="tavern-shop-item"><strong>{s.name}<small>{s.role}</small></strong><p>{s.note}</p>{STYLES.some(style => style.requiredStaff === s.id) && <p>解锁：{STYLES.find(style => style.requiredStaff === s.id)?.name}</p>}<span>签约 {money(s.cost)} gp · 日薪 {money(s.wage)} gp</span><button className="button-secondary" disabled={game.phase !== 'planning' || game.staff.includes(s.id) || game.cash < s.cost} onClick={() => act(g => purchase(g, 'staff', s.id))}>{game.staff.includes(s.id) ? '已雇佣' : `雇佣 ${money(s.cost)} gp`}</button>{game.staff.includes(s.id) && <button className="tavern-dismiss" disabled={game.phase !== 'planning'} onClick={() => act(g => dismissStaff(g, s.id))}>结束雇佣</button>}</div>)}</section>)}<p>结束雇佣仅限营业前，签约费不退；对应风格会重新锁定，正在使用时恢复为街边酒馆。以后可重新签约。</p></details><details className="tavern-management"><summary>改善酒馆 <small>{game.upgrades.length} / {UPGRADES.length}</small></summary>{UPGRADES.map(u => <div key={u.id} className="tavern-shop-item"><strong>{u.name}</strong><p>{u.note}</p><button className="button-secondary" disabled={game.phase !== 'planning' || game.upgrades.includes(u.id) || game.cash < u.cost} onClick={() => act(g => purchase(g, 'upgrade', u.id))}>{game.upgrades.includes(u.id) ? '已完成' : `${money(u.cost)} gp`}</button></div>)}</details><details className="tavern-management"><summary>来访名录 <small>{knownPatrons.length} 人</small></summary>{!knownPatrons.length && <p>暂无来访记录。</p>}{knownPatrons.map(p => <div className="tavern-relationship" key={p.id}><span style={{ background: p.color }} className="patron-avatar">{p.initial}</span><div><strong>{p.name}</strong><small>{p.role}</small></div></div>)}</details><details className="tavern-management"><summary>深水城见闻 <small>{learned.length} 条</small></summary>{!learned.length && <p>顾客谈到的城市人物与地点会记录在这里。</p>}{learned.map(l => <div className="tavern-lore" key={l.title}><strong>{l.title}</strong><p>{l.text}</p><a href={l.source} target="_blank" rel="noreferrer">设定来源 ↗</a></div>)}</details></>}
      <details className="tavern-management tavern-income"><summary>其他收益与投资 <small>{game.funding?.length ?? 0} 条</small></summary><p>冒险报酬、出售战利品等收入加入可用金币，单独记账，不计入酒馆经营利润。</p><form onSubmit={e => { e.preventDefault(); act(g => { if (!/^\d+(\.\d{1,2})?$/.test(incomeAmount)) throw new Error('金额须为正数，最多两位小数。'); const funded = addOtherIncome(g, incomeSource, Math.round(Number(incomeAmount) * 100)); setIncomeSource(''); setIncomeAmount(''); return funded; }); }}><label>收入来源<input value={incomeSource} maxLength={80} required placeholder="例如：护送任务报酬" onChange={e => setIncomeSource(e.target.value)} /></label><label>金额（gp）<input type="number" min="0.01" max="1000000" step="0.01" value={incomeAmount} required onChange={e => setIncomeAmount(e.target.value)} /></label><button className="button-secondary" disabled={!['setup','planning','report'].includes(game.phase)}>登记入账</button></form><p>营业前或打烊后登记，入账后自动保存。打烊后的入账计入后续可用资金，不改写已结算账单。</p><ol>{[...(game.funding ?? [])].reverse().map((entry, i) => <li key={i}>第 {entry.day} 天 · {entry.source}<strong> +{money(entry.amount)} gp</strong></li>)}</ol></details>
      <details className="tavern-management tavern-ledger" open={game.phase === 'report' || game.phase === 'finished'}><summary>经营账本 <small>最近 {game.ledger.length} 天</small></summary>{!game.ledger.length ? <p>暂无结算记录。</p> : <ol>{[...game.ledger].reverse().map(r => <li key={r.day}><details><summary><span className="tavern-history-date">{recordedDateLabel(r.calendarDay)} <small>营业第 {r.day} 天 · {r.guests} 位顾客</small></span><strong className={r.net < 0 ? 'loss' : 'profit'}>{r.net >= 0 ? '+' : '−'}{money(Math.abs(r.net))} gp</strong></summary><Statement report={r} />{r.notes.map((n, i) => <p className="tavern-ledger-note" key={i}>{n}</p>)}</details></li>)}</ol>}</details>
    </aside></div>
    <footer className="tavern-footer"><span>进度自动保存在当前浏览器</span><div><button onClick={backup}>下载备份</button><label className="tavern-restore">导入备份<input type="file" accept=".json,application/json" aria-label="导入酒馆进度" onChange={e => { void restore(e.target.files?.[0]); e.target.value = ''; }} /></label><button onClick={() => setResetting(true)}>重新开业</button></div><p>配乐：{soundtrack.title} — {soundtrack.artist} · <a href={soundtrack.sourceUrl} target="_blank" rel="noreferrer">曲目来源</a> · <a href={soundtrack.licenseUrl} target="_blank" rel="noreferrer">{soundtrack.license}</a> · 原始音频未修改</p></footer>
  </div>;
}
