import { FACTION_PATRONS, FACTION_EVENTS } from './faction-content';
import { CITY_PATRONS } from './city-patrons';
export type Skill = 'social' | 'craft' | 'watch';
export type Effect = { reputation?: number; guests?: number; ticket?: number; income?: number };
export type Choice = { id: string; label: string; cost: number; skill?: Skill; dc?: number; success: Effect; failure?: Effect; successText: string; failureText?: string };
export type Lore = { title: string; text: string; source: string };
export type Story = { lore?: Lore; title: string; text: string; choices: Choice[] };
export type Patron = { id: string; name: string; role: string; color: string; initial: string; chapters: Story[]; returnVisit: Story };

const choice = (id: string, label: string, cost: number, success: Effect, successText: string, skill?: Skill, dc?: number, failure: Effect = { reputation: -1 }, failureText = '这次尝试没有完成，谈话到此结束。'): Choice => ({ id, label, cost, success, successText, skill, dc, failure, failureText });
const story = (title: string, text: string, a: Choice, b: Choice): Story => ({ title, text, choices: [a, b] });

// Original game dialogue, inspired by the Remix's recurring patrons and neighborhood.
export const PATRONS: Patron[] = [
  { id: 'tally', name: '塔利', role: '弯钉木工铺', color: '#ad7c4f', initial: '木', chapters: [
    story('门口的木招牌', '塔利摸了摸门口的旧木板：“客人远远看见什么，就会记住什么。这块木料还可以重新雕刻。”', choice('carve', '一起雕一块新招牌', 400, { reputation: 3, guests: 5 }, '木屑落在肩上，新招牌引来一圈围观的人。', 'craft', 11), choice('listen', '先听听他的设计', 0, { reputation: 1 }, '塔利留下草图，答应下次带样品来。')),
    story('有地方放下工具', '下班的木工们在门外踌躇。塔利问你，能否在角落留一张不怕弄脏的桌子。', choice('table', '准备一张工匠长桌', 300, { reputation: 3, guests: 7 }, '工匠们坐了下来，身后还跟着几个朋友。'), choice('share', '邀请他们与客人拼桌', 0, { reputation: 2, guests: 3 }, '两桌陌生人聊起了深水城的老房子。', 'social', 10)),
    story('街坊的聚会', '塔利提着一块雕好的木牌。街坊正在找地方办一个小聚会，他想把机会留给你。', choice('host', '承接街坊聚会', 500, { reputation: 5, guests: 10, income: 1800 }, '聚会很成功，街坊结清订金，还把你的名字写进了下一次邀请。', 'craft', 12), choice('small', '安排一场简单的聚餐', 0, { reputation: 2, guests: 4, income: 500 }, '小聚餐温暖而安静，塔利把木牌挂在门边。')),
  ], returnVisit: story('木工们的老位置', '塔利推门进来，熟门熟路地走向那张桌子：“今天还有几位刚下工的朋友。”', choice('round', '请他们尝一杯新品', 200, { reputation: 2, guests: 5 }, '新酒很受欢迎，工匠们又带来了下一桌客人。'), choice('welcome', '照常招待老朋友', 0, { guests: 2 }, '有人把外套挂好，终于放松下来。')) },
  { id: 'fala', name: '法拉', role: '科瑞隆之冠', color: '#718c64', initial: '叶', chapters: [
    story('一壶不同的茶', '法拉递来一小包草叶：“不是每个推门进来的人都想喝酒。有些人只是需要一张安静的椅子。”', choice('tea', '试做一款花草茶', 300, { reputation: 3, ticket: 4 }, '一壶清香的茶让几位不喝酒的客人留下了。', 'craft', 10), choice('talk', '听法拉介绍草叶', 0, { reputation: 1 }, '你把那包草叶收进了干燥的柜子。')),
    story('窗边的小花园', '法拉想把几盆植物放在酒馆窗边，试试这里的阳光，也让客人有个好心情。', choice('garden', '整理窗台种下植物', 400, { reputation: 3, guests: 5 }, '绿色在窗边铺开，有人专程来坐那个位置。'), choice('lend', '腾出一个小角落', 0, { reputation: 2 }, '法拉留下两盆小苗，约好下次来看。')),
    story('以酒馆命名的香草', '新长出的香草可以收获了。法拉提议把一份寄给朋友，让他们知道这间酒馆。', choice('blend', '配好香草礼盒', 500, { reputation: 5, guests: 7, income: 1200 }, '礼盒被带去了几个街区，订单也跟着回来。', 'craft', 12), choice('menu', '把香草加入今日菜单', 0, { reputation: 2, ticket: 3 }, '客人在菜单上看到了一个熟悉的地名。')),
  ], returnVisit: story('雨后的新芽', '法拉来检查窗边的植物，顺手带来了一小把新鲜香草。', choice('special', '做一份当日限定', 200, { reputation: 2, ticket: 3 }, '香气从厨房一直飘到门口。'), choice('save', '收好香草，聊聊近况', 0, { reputation: 1 }, '植物长得很好，话也慢慢聊开了。')) },
  ...CITY_PATRONS,
  ...FACTION_PATRONS,
  { id: 'mattrim', name: '三弦', role: '吟游诗人', color: '#ae725c', initial: '弦', chapters: [
    story('今晚还缺一首歌', '三弦抱着乐器坐在吧台旁。他敲出一段轻快的节奏，脚边已经有人跟着打拍子。', choice('stage', '为他腾出表演的位置', 300, { reputation: 3, guests: 6 }, '节奏把街上的人吸引进来，今晚比平时热闹。'), choice('join', '跟着唱一小段', 0, { reputation: 2, guests: 3 }, '歌声有些生涩，笑声却很真诚。', 'social', 10)),
    story('一段属于酒馆的旋律', '三弦正在写一首新曲。他说这里的茶香、幽灵和木椅子，都是旋律的好材料。', choice('write', '一起写下酒馆的故事', 200, { reputation: 4, ticket: 3 }, '客人边听边点头，有人说下次还想听。', 'social', 12), choice('observe', '让他自己寻找灵感', 0, { reputation: 1, guests: 2 }, '纸上的音符慢慢有了方向。')),
    story('摇摆之夜', '三弦找到了几个乐手，想在这里办一场热闹的摇摆爵士之夜。邻居们已经开始打听时间。', choice('jazz', '筹办完整的演出', 700, { reputation: 6, guests: 15, income: 1500 }, '音乐一直响到打烊，这一晚成了很多人的共同回忆。', 'social', 12), choice('duo', '先做一场小型演出', 0, { reputation: 2, guests: 5 }, '两把乐器也撑起了一个漂亮的夜晚。')),
  ], returnVisit: story('老歌的新听众', '三弦在桌边调弦，今晚有一些第一次来听歌的人。', choice('show', '请他多演一段', 200, { reputation: 2, guests: 5 }, '老客人也愿意留下来再听一首。'), choice('break', '让他歇一歇', 0, { reputation: 1 }, '乐器靠在椅边，谈话接过了音乐的位置。')) },
  { id: 'broxley', name: '布罗克斯利', role: '旅店业公会', color: '#9b8a5e', initial: '会', chapters: [
    story('公会代表的第一杯酒', '布罗克斯利先检查门口，再看了看厨房。他更关心你能否把酒馆稳稳地经营下去。', choice('inspect', '带他检查各处', 0, { reputation: 3 }, '整洁的厨房让他放心，也让你多了一个能请教的人。', 'craft', 10), choice('ask', '请他分享经营经验', 200, { reputation: 2, guests: 2 }, '他留下了一页实用的供应名单。')),
    story('可靠的供货渠道', '一位供货商突然涨了价。布罗克斯利可以帮你联系另一家，但需要你先说清楚需求。', choice('negotiate', '谈一份稳定的合作', 300, { reputation: 3, ticket: 4 }, '新供货商带来了质量更稳定的饮品。', 'social', 11), choice('wait', '暂时维持现有供应', 0, { reputation: 1 }, '你没有贸然改约，布罗克斯利留下了联系方法。')),
    story('公会的推荐名单', '公会在整理适合外来旅客的小酒馆名单。布罗克斯利想给你留一个位置。', choice('sample', '安排试餐', 500, { reputation: 5, guests: 9, income: 1000 }, '你的名字进入名单，几位旅客当天就找了过来。', 'craft', 12), choice('register', '提交酒馆的介绍', 0, { reputation: 2, guests: 3 }, '一张简洁的介绍卡放进了公会的柜子。')),
  ], returnVisit: story('账本上的小习惯', '布罗克斯利来看你，也提醒你把今晚的账目算清。', choice('review', '与他核对招待流程', 100, { reputation: 2, guests: 3 }, '一处小疏漏被补上，服务变得顺畅。'), choice('thank', '感谢他的关照', 0, { reputation: 1 }, '他喝完酒，约好下次再来。')) },
  { id: 'urchins', name: '纳特与街童们', role: '巨魔颅骨巷的邻居', color: '#b59c5d', initial: '巷', chapters: [
    story('门外的小小冒险队', '三个孩子正拿木剑与玩具魔杖练习“守护酒馆”。他们把门口扫得比平时干净。', choice('snack', '给他们准备一份点心', 200, { reputation: 3, guests: 3 }, '孩子们郑重答应，把好消息告诉整条巷子。'), choice('task', '请他们帮忙引路', 0, { reputation: 2, guests: 2 }, '他们把第一位迷路的客人带到了门口。')),
    story('丢失的玩具伙伴', '孩子们的一只玩具枭熊不见了。他们怀疑在酒馆的旧箱子里，却不敢打扰客人。', choice('search', '仔细检查储物间', 0, { reputation: 3, guests: 3 }, '枭熊从一堆软布里冒出来，孩子们开心地跑了出去。', 'watch', 10), choice('replace', '买一只新的玩具', 400, { reputation: 2 }, '新玩具被抱得紧紧的，旧的还会继续寻找。')),
    story('小冒险队的庆功宴', '街童们想请邻居来参加一场“庆功宴”。菜单写在一张皱巴巴的纸上，末尾还有你的名字。', choice('feast', '提供聚餐', 500, { reputation: 6, guests: 10, income: 1000 }, '桌边的故事越讲越大，街坊们悄悄替孩子付清了餐费。'), choice('toast', '办一场点心小聚会', 0, { reputation: 3, guests: 4 }, '木剑靠在墙边，今晚大家都是英雄。')),
  ], returnVisit: story('巷口的好消息', '孩子们跑来告诉你，街口又有旅客在问哪里可以歇歇脚。', choice('treat', '给引路人留些点心', 100, { reputation: 2, guests: 4 }, '他们领着一小队旅客回来，认真介绍了这盏灯。'), choice('wave', '在门口挥手欢迎', 0, { guests: 2 }, '旅客循着招呼声走进酒馆。')) },
];

export const EVENTS: (Story & { id: string; role: string; initial: string; color: string })[] = [
  { id: 'contest', role: '酒馆事件', initial: '赛', color: '#a98a57', ...story('即兴扳手腕比赛', '两位客人争论谁能赢，周围的桌子都围了过来。比赛可以很热闹，也可能撞翻杯子。', choice('judge', '划好场地，主持比赛', 200, { reputation: 3, guests: 8, income: 400 }, '比赛结束，所有人都愿意为下一轮再点一杯。', 'social', 11), choice('quiet', '请他们回座位聊天', 0, { reputation: 1, guests: -2 }, '客人收起袖子，把较量留给了下次。')) },
  { id: 'windows', role: '酒馆事件', initial: '窗', color: '#987b69', ...story('被划坏的窗户', '门外传来响声。有人趁忙碌划坏了窗框，附近的影子一闪而过。', choice('repair', '修好窗框，安顿客人', 800, { reputation: 2, guests: 2 }, '窗框恢复了原样，客人记住了你的从容。', 'craft', 11), choice('cover', '先遮住损坏的地方', 0, { reputation: -2, guests: -4 }, '酒馆继续营业，但这件事需要以后处理。')) },
  { id: 'pickpocket', role: '酒馆事件', initial: '影', color: '#78838a', ...story('人群里的一只手', '有客人低声说钱袋不见了。你看见门口有人挤过人群。', choice('watch', '留意出口，找回钱袋', 0, { reputation: 4, income: 300 }, '钱袋回到了主人手里，感谢的小费留在了吧台。', 'watch', 13, { reputation: -2, guests: -3 }, '影子溜出了门，客人叹了口气。'), choice('help', '为失主补一份餐饮', 400, { reputation: 2 }, '没有找回钱袋，但客人没有独自面对这个糟糕的夜晚。')) },
  { id: 'portal', role: '酒馆事件', initial: '门', color: '#8a79a0', ...story('买酒的传送门', '一扇泛着微光的门出现在厅里。一个法师探出头，礼貌地问：“这里还有热的东西吗？”', choice('welcome', '把他当作普通客人招待', 100, { reputation: 3, ticket: 4, income: 500 }, '法师结清了账，还夸你对奇怪的客人也很周到。'), choice('boundary', '请他把门移到院子里', 0, { reputation: 1, guests: 2 }, '传送门移开了，围观的人放心坐下来。')) },
  { id: 'signing', role: '酒馆事件', initial: '书', color: '#a67954', ...story('沃洛临时的签售', '沃洛抱着一摞书走进来。他说只要一张桌子，实际已经有一群读者跟到了门口。', choice('organize', '安排一场有序的签售', 400, { reputation: 4, guests: 12, income: 700 }, '签售比预想顺利，读者们留了下来用餐。', 'social', 12), choice('corner', '借他一个不打扰客人的角落', 0, { guests: 4 }, '书页沙沙翻动，角落里多了一些新面孔。')) },
  { id: 'horse', role: '酒馆事件', initial: '马', color: '#9a8165', ...story('厅内的马匹', '一匹马安静地站在酒馆中央。没有人知道它从哪里来，它倒是很喜欢门边的草料。', choice('lead', '把马领到院子', 0, { reputation: 3, guests: 3 }, '失主赶来道谢，围观者为你鼓起了掌。', 'watch', 10), choice('carrots', '用胡萝卜引它出去', 200, { reputation: 1, guests: 2 }, '马终于跟着胡萝卜走了，桌椅毫发无伤。')) },
  ...FACTION_EVENTS,
];

export const STAFF_SOURCE = 'https://thealexandrian.net/wordpress/43291/roleplaying-games/a-night-in-trollskull-manor-part-2-setting-up-trollskull-manor';
export const STAFF_JOBS = ['酒保', '服务生', '厨师'] as const;
export const STAFF = [
  { id: 'mosp', name: '莫斯普', job: '酒保', role: '狗头人酒保', cost: 1750, wage: 50, guests: 4, ticket: 0, skill: 'social' as Skill, bonus: 1, note: '龙族客群：客流 +4，交涉 +1。' },
  { id: 'lillian', name: '莉莉安', job: '酒保', role: '茶饮酒保', cost: 2250, wage: 75, guests: 1, ticket: 5, skill: 'social' as Skill, bonus: 2, note: '茶饮服务：客流 +1，每笔餐食服务 +0.05 gp，交涉 +2。' },
  { id: 'reynardo', name: '雷纳多', job: '厨师', role: '魔法料理厨师', cost: 3250, wage: 100, guests: -3, ticket: 10, skill: 'craft' as Skill, bonus: 2, note: '精致慢餐：每笔餐食服务 +0.10 gp，手艺 +2；出餐慢，客流 -3。' },
  { id: 'patric', name: '帕特里克·尼夫卡', job: '服务生', role: '初入行的服务生', cost: 750, wage: 25, guests: 2, ticket: 0, skill: 'watch' as Skill, bonus: 1, note: '日常接待：客流 +2，警戒 +1；低签约费与日薪。' },
  { id: 'triplets', name: '阿尔西娅、艾尔西娅、乌尔西娅', job: '服务生', role: '星精灵三胞胎 · 整组雇佣', cost: 4500, wage: 150, guests: 6, ticket: 3, skill: 'social' as Skill, bonus: 2, note: '念力送餐：客流 +6，每笔餐食服务 +0.03 gp，交涉 +2；费用为三人合计。' },
  { id: 'cook-pair', name: '伊斯格里格与杜佩尔', job: '厨师', role: '普通厨师搭档 · 整组雇佣', cost: 2000, wage: 80, guests: 3, ticket: 4, skill: 'craft' as Skill, bonus: 1, note: '稳定供餐：客流 +3，每笔餐食服务 +0.04 gp，手艺 +1；费用为两人合计。' },
  { id: 'turgattan', name: '图尔加坦·荆锤', job: '厨师', role: '前冒险者厨师', cost: 500, wage: 20, guests: 0, ticket: -5, skill: 'craft' as Skill, bonus: -1, note: '试菜欠佳：每笔餐食服务 -0.05 gp，手艺 -1；费用低，但厨艺不足。' },
] as const;
export const UPGRADES = [
  { id: 'kitchen', name: '整修厨房', cost: 7000, guests: 0, ticket: 5, note: '每笔餐食服务收入增加0.05 gp，手艺多2点。' },
  { id: 'stage', name: '小型演出台', cost: 5500, guests: 5, ticket: 0, note: '每天多5位顾客，交涉多1点。' },
  { id: 'locks', name: '门窗与照明', cost: 4000, guests: 0, ticket: 0, note: '警戒检定多3点。' },
] as const;
export const STYLES = [
  { id: 'ale', name: '街边酒馆', requiredStaff: null, ticket: 55, guests: 4, note: '基础经营，无需特色雇员。' },
  { id: 'tea', name: '花草茶馆', requiredStaff: 'lillian', ticket: 65, guests: 0, note: '莉莉安主持茶饮，餐食服务收入较高。' },
  // Keep the old jazz ID readable in saved games; background music is independent.
  { id: 'jazz', name: '龙息酒馆', requiredStaff: 'mosp', ticket: 60, guests: 2, note: '莫斯普主持吧台，接待龙族与街坊。' },
  { id: 'feast', name: '奥术食堂', requiredStaff: 'reynardo', ticket: 75, guests: -2, note: '雷纳多提供魔法料理，客流较少、餐食收入较高。' },
] as const;
export const PREPARATIONS = [
  { id: 'welcome', name: '热情迎客', note: '今天多4位普通顾客。' },
  { id: 'special', name: '打磨菜单', note: '每笔餐食服务收入增加0.06 gp，手艺多2点。' },
  { id: 'watch', name: '留意动静', note: '今天的警戒检定多3点。' },
] as const;
