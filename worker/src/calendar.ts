import { DATE_FLAVOR } from "./calendar-flavor";
import { dayIndex, type CalendarEvent } from "../../client/src/calendar/model";
export function seedEvents(): CalendarEvent[] {
  const start = '07-GM工具/04-战役何时开始.md'; const carnival = '05-派系大本营/01-海洋少女嘉年华.md'; const cass = '05-派系大本营/02-卡萨兰特庄园.md'; const clues = '07-GM工具/02-线索与时间线.md';
  const e = (id: string, month: number, day: number, title: string, kind: CalendarEvent['kind'], visible: boolean, detail: string, source: string, condition = ''): CalendarEvent => ({ id, title, day: dayIndex(month, day), minute: null, kind, public: visible, detail, source, condition, status: '待处理', flavor: DATE_FLAVOR[id] });
  return [
    e('arrival', 3, 1, '抵达哈欠之门 · 营救佛伦', '剧情', false, '建议开团日。留出近三周用于安家、装修与派系任务。', start),
    e('carnival-arrival', 3, 10, '海洋少女嘉年华抵达游行', '节庆', true, '嘉年华宣布抵达深水城。', carnival),
    e('opening', 3, 20, '巨魔颅骨大宅盛大开业', '剧情', false, '重置版建议开业日，可依照本团装修进度调整。', start),
    e('stone-theft', 3, 20, '达拉哈尔盗走戈罗尔之石', '派系', false, '达拉哈尔从珊娜萨手中偷走石头。此为幕后事件，不代表玩家已经获知。', clues),
    e('parades', 3, 21, '双塞节 · 双游行', '节庆', true, '陆地与海上游行，嘉年华和贡德神庙参与表演。', '01-开场与安家/05-双游行.md'),
    e('parade-clue', 3, 21, '灵巧莱特表演与派系任务', '剧情', false, '可让玩家亲眼见到灵巧莱特，并安排偷取手帕等派系任务；这是后续调查的伏笔。', '01-开场与安家/05-双游行.md'),
    e('fireball', 3, 22, '火球案', '剧情', false, '达拉哈尔撤离失败，在前往巨魔颅骨大宅与雷纳碰头前遇害。由主持人决定触发时机。', `${start}；${clues}`),
    e('shipwright', 3, 25, '造船匠之家舞会', '节庆', true, '海洋少女嘉年华以表演者身份参加。', carnival),
    e('noble-ball', 3, 30, '卡萨兰特贵族舞会', '节庆', true, '上流社会的社交舞会，需要邀请或其他入场途径。', cass),
    e('caravance', 4, 1, '商队节 · 嘉年华游行', '节庆', true, '送礼与游行的节日。', `${cass}；${carnival}`),
    e('manor-window', 4, 1, '庄园仆人休假与夜间邪教仪式', '派系', false, '多数工作人员放假，是侦察和潜入机会；孩子睡下后邪教徒在圣所举行仪式。', cass),
    e('goldenight', 4, 5, '金色之夜 · 午夜游行', '节庆', true, '海洋少女嘉年华参加特殊的午夜游行。', carnival),
    e('ships-window', 4, 5, '嘉年华关停 · 船上守备空窗', '派系', false, '游行期间嘉年华关停、船上人员减少，可作为登船侦察或劫掠机会。', carnival),
    e('leiruin', 4, 10, '莱拉受难日 · 公会缴费日', '节庆', true, '公会缴纳年费、续签租约的日子。', '90-原版资料/文案/全文.txt：深水城节庆'),
    e('feast', 4, 10, '猩红盛宴', '期限', false, '采用后出的开团附录：塔斯10日（莱拉受难日）。庄园章节另记塔斯9日；本团选用10日。', `${start}；${cass}`, '只有卡萨兰特取得所需金钱并继续执行计划才会举行。未满足条件时手动取消；推进日期不会自动执行献祭。'),
    e('souls', 4, 11, '双胞胎生日 · 灵魂契约期限', '期限', false, '重置版核心期限：若契约未被解决，阿斯蒙蒂斯将夺走孩子灵魂。', `${start}；${cass}`, '根据玩家行动与契约是否被解除，由主持人裁定结果并标记完成或取消。'),
    e('departure', 4, 20, '海洋少女嘉年华离港', '剧情', true, '嘉年华整装离开深水城港口。', carnival),
    e('jarlaxle-stays', 4, 20, '贾拉索可能留在深水城', '派系', false, '若大博弈仍未结束，贾拉索很可能带一支队伍留下。', carnival, '大博弈尚未结束。'),
  ];
}

export function calendarPayload(role: string | null) {
  const canManage = role !== null && ["host", "dm", "assistant_dm"].includes(role);
  const events = seedEvents();
  return { canManage, events: canManage ? events : events.filter(e => e.public).map(e => ({ ...e, source: "", condition: "" })) };
}
