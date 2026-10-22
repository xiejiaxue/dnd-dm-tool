// Original everyday scenes; net adjustments are in copper pieces and settle once at closing.
export const EVERYDAY_EVENTS = [
  { id: 'dock-break', group: 'customer', name: '下工的搬运工', title: '多添的一盘面包', text: '几位搬运工卸完最后一车货，在角落分食热汤。面包很快见底，他们又添了一盘，收桌时盘子干干净净。', delta: 40 },
  { id: 'rain-coats', group: 'customer', name: '避雨的路人', title: '等雨停的一壶茶', text: '雨水从斗篷滴到门边。两位路人坐下来等天放晴，原本只歇脚，后来又续了一壶热茶。', delta: 30 },
  { id: 'market-change', group: 'customer', name: '赶集的夫妇', title: '留下的零钱', text: '一对夫妇把菜篮搁在脚边。结账时，他们将几枚零钱留在杯垫下，谢过店里替他们看着的东西。', delta: 25 },
  { id: 'late-supper', group: 'customer', name: '晚归的车夫', title: '打包的夜宵', text: '一位车夫赶在收炉前进门，用干净的布包带走一份夜宵。门外马蹄响了几声，随后渐渐远去。', delta: 50 },
  { id: 'shared-table', group: 'customer', name: '拼桌的街坊', title: '分出来的一小碟', text: '拼桌的街坊把两份菜分成三份，厨房另添了一小碟酱汁。大家坐得久了些，最后一张桌子才收空。', delta: -20 },
  { id: 'wrong-order', group: 'customer', name: '一桌普通客人', title: '换回来的餐盘', text: '两份相似的菜送错了桌。服务生核对餐牌，将其中一份重新做过；客人重新拿起了餐具。', delta: -50 },
  { id: 'short-change', group: 'customer', name: '匆忙的信差', title: '少收的几个铜币', text: '信差喝完便赶去送信。收桌时，柜台才发现零钱少了几枚，门外已经看不到那件沾灰的披风。', delta: -15 },
  { id: 'birthday-table', group: 'customer', name: '庆生的一家人', title: '额外的小点心', text: '窗边一桌低声唱起生日歌。厨房在最后一盘点心上多放了几块果干，孩子小心地把它们分给家人。', delta: -30 },
  { id: 'broken-mug', group: 'operation', name: '收桌记录', title: '裂开的杯把', text: '洗杯时，一只杯把裂开了。杯子被挪出餐具架，替换用的新杯从储物箱里取了出来。', delta: -40 },
  { id: 'fresh-herbs', group: 'operation', name: '厨房记录', title: '用完的香草', text: '厨师将剩下的香草配进晚汤，免去了另一份调料的开销。空纸包叠好后放在采购单旁边。', delta: 20 },
  { id: 'loose-tap', group: 'operation', name: '酒窖记录', title: '滴漏的桶龙头', text: '桶下积了一小圈酒。换好垫圈后滴漏停住，擦地的布带着淡淡麦香，损耗记进了酒窖账。', delta: -60 },
  { id: 'dry-firewood', group: 'operation', name: '炉火记录', title: '干燥的劈柴', text: '这一捆柴比前几日干燥，炉火烧得稳。收工时还剩几根，照常放回明早的柴筐。', delta: 30 },
  { id: 'linen-mend', group: 'operation', name: '布草记录', title: '补上的桌布', text: '旧桌布边角脱了线。空闲时补好几针，它又铺回了窗边，原定替换的新桌布留在柜里。', delta: 40 },
  { id: 'extra-oil', group: 'operation', name: '灯火记录', title: '多点的一盏灯', text: '阴云让大厅早早暗下来。服务生点亮了墙角平时不用的油灯，添油时在账上留下一笔。', delta: -25 },
  { id: 'supplier-rounding', group: 'operation', name: '收货记录', title: '抹去的零头', text: '供货人核对完空箱，在送货单上划去零头。柜台将实付金额重新写了一遍，纸条压在账本里。', delta: 50 },
  { id: 'spoiled-fruit', group: 'operation', name: '备料记录', title: '挑出的软果', text: '备料时发现几颗果子已经变软。它们被挑出，剩下的重新洗净，今日损耗表多添了一行。', delta: -45 },
] as const;

// Favor small gains while retaining occasional losses: 75% positive in each group.
export const everydayPool = (group: 'customer' | 'operation') =>
  EVERYDAY_EVENTS.filter(e => e.group === group).flatMap(e => Array.from({ length: e.delta > 0 ? 3 : 1 }, () => e));
