// Default placements for the Alexandrian remix template. The reset map notes
// and adversary rosters are authoritative; the original catalog is reused for
// unchanged floor plans and supplies exact room coordinates where compatible.
import { WATERDEEP_ENCOUNTERS } from './waterdeep-encounters.mjs';

const monster = (key, count = 1) => ({ kind: 'monster', key, count });
const npc = (name, statEntryId = 'MM__Commoner', count = 1) => ({ kind: 'npc', name, statEntryId, count });
const room = (label, x, y, occupants, layout = {}) => ({ label, anchor: [x, y], occupants, ...layout });
const original = (mapName, keep = () => true) => (WATERDEEP_ENCOUNTERS[mapName] ?? [])
  .filter(keep)
  .map(placement => ({
    ...placement,
    anchor: [...placement.anchor],
    occupants: placement.occupants.map(occupant => ({ ...occupant })),
  }));

const trollskullLane = original('地图2.1 巨魔颅骨巷（北区）');
const gralhundNight = [
  room('G2·夜间庭院', 800, 995, [npc('赫尔夫·塔雷德', 'MM__Cult Fanatic'), monster('mastiff', 2)]),
  room('G3·马车房卧室', 955, 1360, [npc('艾克')]),
  room('G8·大厅', 360, 1300, [monster('thug', 2)]),
  room('G13·二层门厅', 205, 500, [monster('thug', 4), monster('guard', 4)], { columns: 4 }),
  room('G15a·客房', 200, 575, [npc('乌斯图尔·夫罗钦', 'MM__Assassin')]),
  room('G15b·客房', 190, 660, [npc('欧朗德·格拉汉德', 'MM__Noble')]),
  room('G16·主卧室', 355, 555, [npc('雅拉·格拉汉德', 'MM__Noble'), npc('赫巴兹', 'MM__Veteran'), monster('nimblewright')]),
  room('G18·儿童房', 325, 665, [npc('扎尔坦'), npc('托玛馨')]),
  room('G19·仆人房', 505, 605, [monster('commoner', 9)], { columns: 3 }),
  room('宅邸外围·珊娜萨监视点', 1090, 1420, [monster('gazer')]),
  room('宅邸外围·布雷根达瑟监视点', 1040, 1350, [npc('费尔雷克·拉芬', 'WDH__Drow Gunslinger'), monster('drow', 2)]),
];

export const WATERDEEP_REMIX_ENCOUNTERS = {
  // The overview is generated from the complete NPC archive below so every
  // record receives one stable city navigation marker.
  '01-深水城城区总览': [],

  '01-散塔林仓库（蜡烛巷）': original('地图1.1 散塔林会藏身处（码头区）'),
  '02-珊娜萨下水道藏身处（一）': original('地图1.2 珊娜萨公会藏身处（南港区）'),
  '01-巨魔颅骨巷': [
    ...trollskullLane,
    room('哼唱妖精酒馆', 1110, 600, [npc('埃梅克·弗雷恩')]),
    room('巨魔颅骨巷·巡访', 650, 185, [npc('乌柯莉亚·石髓', 'MM__Mage')]),
    room('巷内三顽童', 650, 500, [npc('娜特'), npc('詹克斯'), npc('乌贼')]),
  ],
  '02-巨魔颅骨大宅与酒馆': [
    ...original('巨魔颅骨庄园与酒馆平面图（附录C）'),
    room('一层·酒馆大厅', 405, 985, [npc('雷纳·无烬', 'MM__Noble')]),
  ],

  '01-火球犯罪现场（巨魔颅骨巷）': [
    room('爆炸中心', 650, 440, [npc('达拉哈尔', 'MM__Spy'), npc('乌斯图尔·夫罗钦', 'MM__Assassin')]),
    room('屋顶发射点', 785, 190, [monster('nimblewright')]),
    room('费拉的花店', 745, 555, [npc('费拉·勒法里尔', 'MM__Druid')]),
    room('塔利的木工店', 1035, 440, [npc('塔利索瓦纳尔「塔利」·费尔布兰奇')]),
    room('翻页者书店', 205, 320, [npc('翻页者里沙尔', 'MM__Mage')]),
    room('巷口目击者', 480, 350, [npc('洁兹琳·角鸦'), npc('马尔特姆·特雷克'), npc('埃梅克·弗雷恩')]),
    room('巷内三顽童', 610, 520, [npc('娜特'), npc('詹克斯'), npc('乌贼')]),
    room('城市警戒者调查队', 850, 500, [npc('城市警戒者', 'MM__Veteran', 6)], { columns: 3 }),
    room('赶到现场', 960, 560, [npc('雷纳·无烬', 'MM__Noble'), npc('乌柯莉亚·石髓', 'MM__Mage')]),
  ],
  '02-卡兰之塔（改装风车底图）': [
    room('W8·卡兰工作室', 560, 375, [npc('九水之卡兰', 'VGM__Bard'), monster('animatedArmor', 3)]),
  ],
  '01-格拉汉德宅邸': gralhundNight,

  '01-费内鲁斯·风暴之城的屋子（小巷F区）': [
    room('F区住宅·前屋', 440, 360, [npc('费内鲁斯·风暴之城', 'MM__Bandit')]),
    room('F区住宅·取件点', 650, 360, [npc('克雷贝格·马斯基尔', 'WDH__Drow Gunslinger')]),
  ],
  '02-七面具剧院': [
    room('剧院会面点', 505, 390, [npc('贾拉索·班瑞')]),
    room('舞台与后台', 520, 530, [npc('布里赞之光', 'MM__Ghost'), monster('commoner', 8)], { columns: 3 }),
  ],
  '03-阿斯蒙蒂斯圣所（阿文街）': [
    room('冥河圣堂', 265, 220, [monster('cultFanatic', 2), monster('apprenticeWizard'), monster('imp', 2)]),
  ],
  '04-改装风车（车灯巷）': [
    room('W7·安全房', 510, 460, [npc('阿恩·萨隆达', 'MM__Cult Fanatic')]),
    room('W8·占卜仪式间', 650, 330, [npc('塞菲亚·奈利克', 'MM__Cult Fanatic')]),
  ],
  '05-特莱莎之屋': [
    room('治疗室', 1030, 750, [npc('凯恩·特里戈斯', 'MM__Priest'), monster('bandit', 6)]),
    room('角斗观众集合点', 1420, 920, [monster('commoner', 8)], { columns: 4 }),
  ],
  '06-雾滩—格琳达·加洛思的住所': [
    room('格琳达的住所', 535, 375, [npc('格琳达·加洛斯'), monster('bandit', 3)]),
  ],
  '07-眼球糖果店与珊娜萨下水道藏身处（二）': [
    room('B1·眼球糖果店入口', 165, 260, [monster('thug', 3)]),
    room('B9b·克鲁格斯德房间', 610, 305, [npc('克鲁格斯德·乌克斯古姆', 'MM__Duergar')]),
    room('地窖防线', 440, 370, [monster('mimic'), monster('beholderZombie')]),
  ],
  '08-散塔林会审讯室（小巷L1）': [
    room('L1·前屋安全屋', 430, 360, [npc('阿瓦琳·御风者', 'MM__Spy'), npc('扎伯格·加考斯', 'MM__Thug')]),
    room('L1·后屋审讯室', 660, 370, [npc('奥特·钢趾', 'MM__Duergar'), monster('flyingSnake', 3)]),
  ],
  '09-黄色尖顶': [
    room('旧塔·常驻', 520, 410, [npc('阿玛丝·塞尔森特', 'MM__Priest'), monster('cultist', 4)]),
    room('旧塔·可能到访', 660, 410, [npc('阿贡·焰火'), npc('卡拉达', 'MM__Spy')]),
  ],

  '01-海洋少女嘉年华船只': original('地图7.1 海洋少女嘉年华船只'),
  '02-猩红落叶号': original('地图7.2 猩红落叶号'),
  '03-卡萨兰特庄园': original('地图6.1 卡萨兰特庄园', placement => !placement.label.startsWith('A')),
  '04-庄园下的阿斯蒙蒂斯神庙': original('地图6.2 阿斯莫德神庙'),
  '05-珊娜萨巢穴': original('地图5.1 珊娜萨巢穴'),
  '06-克拉特之塔': original('地图8.1 克拉特之塔'),
  '07-曼松异次元圣所': original('地图8.2 异次元圣所'),

  '01-布兰达斯家族墓穴': [
    room('墓园入口', 3500, 6750, [npc('安布罗斯·永晓', 'MM__Knight')]),
    room('布兰达斯墓园', 4300, 4300, [monster('treant'), npc('雷纳·无烬', 'MM__Noble'), monster('crawlingClaw', 4)]),
  ],
  '02-古墓室（陵墓底图）': [],
  '03-龙之宝库': [
    room('核心宝库', 560, 390, [npc('奥瑞纳克斯 AURINAX（金库守护金龙）', 'MM__Adult Gold Dragon')]),
    room('终局介入点', 860, 590, [npc('莱拉·银手', 'MM__Archmage')]),
  ],
  '01-造船匠之家舞会示意图': [
    room('舞厅', 185, 250, [npc('雷纳·无烬', 'MM__Noble'), npc('米尔特'), npc('奥芭娅·乌黛', 'MM__Priest'), monster('noble', 6)], { columns: 3 }),
  ],
  '02-海洋少女嘉年华游行路线': [
    room('游行队伍前列', 260, 470, [npc('贾拉索·班瑞'), monster('nimblewright'), monster('griffon')]),
    room('演员与沿途市民', 610, 500, [monster('bard', 6), monster('commoner', 12)], { columns: 6 }),
  ],
};

const CITY_DESTINATIONS = {
  lightsinger: { label: 'S56·滨海区颂光者剧院', anchor: [2355, 1450], columns: 2 },
  blackstaff: { label: 'C6·黑杖塔', anchor: [2435, 2005], columns: 3 },
  palace: { label: 'C75·皮尔盖伦宫', anchor: [2590, 2690], columns: 3 },
  cityWatch: { label: 'C76·深水堡与城市治安总部', anchor: [2960, 2885], columns: 4 },
  hallsOfJustice: { label: 'C5·正义大厅', anchor: [2500, 1860], columns: 3 },
  ulbrinter: { label: 'N18·乌尔布林特庄园', anchor: [3300, 1470], columns: 3 },
  phaulkonmere: { label: 'S44·翠绿闲庭／法尔孔米尔庄园', anchor: [3630, 3700], columns: 3 },
  trollskull: { label: 'N77·巨魔颅骨巷', anchor: [3370, 1280], columns: 5 },
  yawningPortal: { label: 'C48·哈欠之门', anchor: [3150, 3030], columns: 5 },
  inspiredHands: { label: 'S38·奇械之手神殿', anchor: [2680, 990], columns: 3 },
  cassalanter: { label: 'S48·卡萨兰特庄园', anchor: [2580, 1290], columns: 4 },
  gralhund: { label: 'N20·格拉汉德庄园', anchor: [3520, 1340], columns: 4 },
  seaWard: { label: '滨海区宅邸与法师住所', anchor: [2770, 1120], columns: 4 },
  market: { label: '城堡区大市场与行会区', anchor: [2890, 2050], columns: 5 },
  shipwrights: { label: 'D19·造船匠之家', anchor: [3030, 3590], columns: 3 },
  seaMaidens: { label: '深水港·海洋少女嘉年华船队', anchor: [2760, 3850], columns: 6 },
  sevenMasks: { label: '贸易区·七面具剧院', anchor: [3400, 2230], columns: 3 },
  fenerus: { label: '码头区·奎尔巷费内鲁斯住所', anchor: [2940, 3300], columns: 2 },
  kalanTower: { label: '滨海区·卡兰之塔', anchor: [2240, 1660], columns: 2 },
  yellowspire: { label: '码头区·黄色尖顶', anchor: [3430, 3260], columns: 3 },
  zhentInterrogation: { label: '码头区·散塔林会审讯室', anchor: [3180, 3300], columns: 3 },
  kolat: { label: 'D35·克拉特之塔入口', anchor: [3230, 3740], columns: 5 },
  xanathar: { label: '码头区下水道·珊娜萨据点入口', anchor: [3480, 3910], columns: 6 },
  mistshore: { label: '雾滩·格琳达住所', anchor: [2290, 3310], columns: 3 },
  terasse: { label: '码头区·特莱莎之屋', anchor: [3580, 3440], columns: 3 },
  eyeCandy: { label: '码头区·眼球糖果店', anchor: [3360, 3490], columns: 3 },
  cityOfDead: { label: '死者之城·布兰达斯墓穴与龙之宝库入口', anchor: [3580, 2450], columns: 4 },
  dockTaverns: { label: '码头区酒馆与碎币拒绝者活动点', anchor: [2820, 3190], columns: 4 },
};

// The city overview is a navigation aid, not an encounter map. Keep only a
// compact roster of friendly or neutral representatives; hostile NPCs and
// monsters remain available in their chapter scenes and the NPC archive.
export const WATERDEEP_CITY_OVERVIEW_NPCS = Object.freeze([
  '米尔特',
  '莱拉·银手',
  '瓦婕拉·萨法尔',
  '杜尔南',
  '瓦罗赞普「瓦罗」格达姆',
  '雷纳·无烬',
  '洁莉丝·法尔孔',
  '瓦莱塔',
  '巴尼布斯·爆风',
  '萨斯·克罗姆利',
  '奥芭娅·乌黛',
]);
const cityOverviewNpcNames = new Set(WATERDEEP_CITY_OVERVIEW_NPCS);

const exactCityDestination = new Map();
function cityHome(destination, names) {
  for (const name of names) exactCityDestination.set(name, destination);
}

cityHome('lightsinger', ['米尔特']);
cityHome('blackstaff', ['瓦婕拉·萨法尔', '梅伦·战龙', '深水城自走巨像']);
cityHome('palace', ['莱拉·银手', '达格特·无烬', '加莱斯特·银鬃', '杰琳·乌姆布斯克', '科里鲁斯·坦恩', '多加·阿达布伦特', '凯琳·西默褐芙', '塔多克·星盾']);
cityHome('cityWatch', ['巴尼布斯·爆风', '城市警戒者', '城市守卫', '城市守卫老兵', '柯蕾萨·戈拉瓦可', '萨斯·克罗姆利', '狮鹫骑兵骑手', '休斯图斯·斯塔吉特']);
cityHome('hallsOfJustice', ['哈姆', '萨夫拉·贝拉布兰塔']);
cityHome('ulbrinter', ['瑞玛莉亚·港树', '马提姆·梅雷格']);
cityHome('phaulkonmere', ['洁莉丝·法尔孔', '梅兰诺·费尔布兰奇']);
cityHome('trollskull', [
  '雷纳·无烬', '佛伦·布莱格玛', '埃梅克·弗雷恩', '埃斯隆·贝赞特', '翻页者里沙尔', '费拉·勒法里尔',
  '加克斯利·破舵', '利夫', '塔利索瓦纳尔「塔利」·费尔布兰奇', '文森特·特兰奇（瓦兰塔贾尔）',
  '乌柯莉亚·石髓', '舞扎·索利泽芙', '恩布里克', '阿维', '娜特', '乌贼', '詹克斯', '马尔特姆·特雷克',
]);
cityHome('yawningPortal', [
  '杜尔南', '邦妮', '瓦罗赞普「瓦罗」格达姆', '娅戈拉·石拳', '达维尔·星歌', '厄运掠夺者',
  '狩猎者泽拉', '斯基摩·怪瓶', '塔什林·雅菲拉', '伊丝垂德·号角', '奥芭娅·乌黛',
]);
cityHome('inspiredHands', ['尼姆', '瓦莱塔', '灵巧莱特', '勃艮特拉·萨摩塔恩']);
cityHome('sevenMasks', ['布里赞之光']);
cityHome('fenerus', ['费内鲁斯·风暴之城']);
cityHome('kalanTower', ['九水之卡兰']);
cityHome('yellowspire', ['阿玛丝·塞尔森特', '阿贡·焰火', '卡拉达']);
cityHome('zhentInterrogation', ['阿瓦琳·御风者', '扎伯格·加考斯', '奥特·钢趾']);
cityHome('mistshore', ['格琳达·加洛斯']);
cityHome('terasse', ['凯恩·特里戈斯']);
cityHome('eyeCandy', ['克鲁格斯德·乌克斯古姆']);
cityHome('cityOfDead', ['安布罗斯·永晓', '奥瑞纳克斯 AURINAX（金库守护金龙）']);
cityHome('shipwrights', ['拉巴达·阿达布伦特爵士']);
cityHome('seaMaidens', ['玛歌·维莉达', '卡菲塔·穆尔赞']);
cityHome('dockTaverns', [
  '贝尔卡', '布琳·丘覆', '达妮卡·琴芯', '达舍·斯诺贝德尔', '凯尔索·琴芯', '罗斯科·枝下',
]);
cityHome('seaWard', ['赫尔迈厄尼·德兹伦蒂尔', '科林', '黑蝰蛇', '阿泽丽雅·罗斯纳尔', '罗特米·罗斯纳尔']);

export function waterdeepCityNpcPlacements(npcs) {
  const occupantsByDestination = new Map(Object.keys(CITY_DESTINATIONS).map(key => [key, []]));
  const selectedRecords = npcs.filter(record => cityOverviewNpcNames.has(record.name));
  const selectedNames = new Set(selectedRecords.map(record => record.name));
  const missingNames = WATERDEEP_CITY_OVERVIEW_NPCS.filter(name => !selectedNames.has(name));
  if (missingNames.length) throw new Error(`深水城总览 NPC 档案缺失：${missingNames.join('、')}`);
  for (const record of selectedRecords) {
    const destination = cityDestinationFor(record);
    occupantsByDestination.get(destination).push({
      kind: 'npc',
      name: record.name,
      npcId: record.id,
      statEntryId: record.statReference?.kind === 'compendium' ? record.statReference.entryId : 'MM__Commoner',
      count: 1,
    });
  }
  return Object.entries(CITY_DESTINATIONS).flatMap(([key, destination]) => {
    const occupants = occupantsByDestination.get(key);
    if (!occupants?.length) return [];
    return [room(destination.label, destination.anchor[0], destination.anchor[1], occupants, {
      columns: destination.columns,
      spacing: 112,
    })];
  });
}

function cityDestinationFor(record) {
  const exact = exactCityDestination.get(record.name);
  if (exact) return exact;
  const group = (record.groupPath ?? []).join(' / ');
  if (group.startsWith('布雷根·达瑟佣兵团')) return 'seaMaidens';
  if (group.startsWith('格拉汉德家族')) return 'gralhund';
  if (group.startsWith('卡萨兰特家族')) return 'cassalanter';
  if (group.startsWith('珊娜萨公会') || group.includes('被绑架者与囚徒')) return 'xanathar';
  if (group.includes('散塔林会（暗黑情报网） / 曼松')) return 'kolat';
  if (group.includes('厄运掠夺者')) return 'yawningPortal';
  if (group.includes('城市治安')) return 'cityWatch';
  if (group.includes('灰色小队')) return 'blackstaff';
  if (group.includes('领主联盟')) return 'palace';
  if (group.includes('竖琴手同盟')) return 'ulbrinter';
  if (group.includes('翠绿闲庭')) return 'phaulkonmere';
  if (group.includes('铁手教团')) return 'hallsOfJustice';
  if (group.includes('商人工会代表') || group.includes('通用模板')) return 'market';
  if (group.includes('碎币拒绝者')) return 'dockTaverns';
  if (record.location === 'U2' || record.location === 'U7B' || record.location === 'U8') return 'seaMaidens';
  if (record.location.includes('改装风车')) return 'cassalanter';
  if (record.location.includes('黄色尖顶')) return 'yellowspire';
  if (record.location.includes('散塔林会审讯室')) return 'zhentInterrogation';
  if (record.location.includes('特莱莎之屋')) return 'terasse';
  if (record.location.includes('眼球糖果店')) return 'eyeCandy';
  return 'market';
}
