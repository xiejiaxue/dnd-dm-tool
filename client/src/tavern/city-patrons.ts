import type { Patron, Story } from './catalog';

export const CITY_SOURCES = {
  factions: 'https://thealexandrian.net/wordpress/41238/roleplaying-games/dragon-heist-remix-part-1c-player-character-factions',
  villains: 'https://thealexandrian.net/wordpress/41217/roleplaying-games/dragon-heist-remix-part-1-the-villains',
  events: 'https://thealexandrian.net/wordpress/43305/roleplaying-games/a-night-in-trollskull-manor-part-3-patron-tables-events',
  patrons: 'https://thealexandrian.net/wordpress/43319/roleplaying-games/a-night-in-trollskull-manor-part-5-patrons',
  friends: 'https://thealexandrian.net/wordpress/43320/roleplaying-games/a-night-in-trollskull-manor-part-6-renaer-friends',
  topics: 'https://thealexandrian.net/wordpress/43312/roleplaying-games/a-night-in-trollskull-manor-patron-topics-agendas',
} as const;

// Original scenes around brief, sourced public background; no hidden faction identities
// or campaign events are exposed. Lore is heard on arrival, never gated by a skill roll.
export function conversation(title: string, text: string, subject: string, note: string, source: string, label: string, result: string): Story {
  return { title, text, lore: { title: subject, text: note, source }, choices: [
    { id: 'talk', label, cost: 0, success: {}, successText: result },
    { id: 'serve', label: '续杯，听完这段谈话', cost: 0, success: {}, successText: '杯子重新斟满。客人说完这一段，谈话转回了桌上的餐点。' },
  ] };
}
export const CITY_PATRONS: Patron[] = [
  { id: 'renaer', name: '雷纳·奈维恩', role: '深水城贵族', color: '#788aa0', initial: '雷', chapters: [
    conversation('吧台上的姓氏', '雷纳点完酒，邻桌有人提起奈维恩这个姓。他把杯子放下：“达格特是我父亲。但有关他的事，我未必能替他回答。”邻桌换了一个话题。', '雷纳与达格特', '雷纳与父亲关系疏远。达格特曾任深水城公开领主，如今统治无冬城。', CITY_SOURCES.friends, '谈谈他在城里的生活', '雷纳说起几位常一起喝酒的朋友，没有继续谈父亲。'),
    conversation('海滨区的地址', '一封信随酒钱留在桌上，回信地址写着布兰达斯宅邸。雷纳说，那是母亲家族的名字；有熟人来访时，管家会认得。', '布兰达斯宅邸', '雷纳住在海滨区，将宅邸恢复为母亲家族的旧名。', CITY_SOURCES.friends, '记下回信地址', '你把地址记在订座簿内页，信另行收好。'),
    conversation('等朋友的一桌', '雷纳留了一个座位。等人时，他说起瓦婕拉，以及当年几位朋友与黑杖塔的往事。故事只讲到一半，门外就传来了招呼声。', '雷纳的交游', '雷纳与现任黑杖瓦婕拉相识。他的来往朋友也可能单独光顾酒馆。', CITY_SOURCES.friends, '给同行的客人添一套餐具', '空位摆好了餐具。雷纳在桌边介绍了酒馆的菜单。'),
  ], returnVisit: conversation('原来的座位', '雷纳今天一个人来，坐在靠墙的位置翻信。遇到熟人时，他便停下来聊几句。', '雷纳的交游', '雷纳与现任黑杖瓦婕拉相识。他的来往朋友也可能单独光顾酒馆。', CITY_SOURCES.friends, '在吧台与他聊近况', '没有新的委托。两人聊了聊近日的生意和天气。') },
  { id: 'eiruk', name: '埃鲁克·韦斯库尔', role: '安民法师会', color: '#777d96', initial: '法', chapters: [
    conversation('袖口的墨迹', '穿银纹黑袍的客人把几页笔记压在杯底，自报姓名为埃鲁克。谈起满页修改时，他说自己在安民法师会指导进阶学员，今天的课比预期长。', '安民法师会', 'Watchful Order of Magists and Protectors：城中的施法者组织。埃鲁克在会内负责进阶学员。', CITY_SOURCES.friends, '听他谈教学', '埃鲁克边说边把纸上的一处算式改好。邻桌的讨论声盖过了后半句话。'),
    conversation('约好的客人', '埃鲁克看了一眼门口，又低头喝茶。他和瓦婕拉约在这里见面。两人认识时，她还没有接过黑杖。', '法师会与黑杖', '瓦婕拉早年短暂加入过安民法师会，后来成为前任黑杖的学徒。', CITY_SOURCES.friends, '记下尚未到场的订座', '订座簿补上了名字。埃鲁克继续等候，暂未留下其他安排。'),
    conversation('一页留白的笔记', '埃鲁克这一晚话不多。他解释了一半纸上的术语，又划去一行：“这是课堂上的问题，先别拿酒馆做试验。”他把笔收回袖口。', '安民法师会', 'Watchful Order of Magists and Protectors：城中的施法者组织。埃鲁克在会内负责进阶学员。', CITY_SOURCES.friends, '收好桌上的空杯', '纸张归拢进皮套。埃鲁克按账付钱后离开。'),
  ], returnVisit: conversation('下课以后', '埃鲁克带着一叠批改过的笔记落座。谈话间偶尔提到法师会，更多时候只是在看菜单。', '安民法师会', 'Watchful Order of Magists and Protectors：城中的施法者组织。埃鲁克在会内负责进阶学员。', CITY_SOURCES.friends, '聊几句课后的近况', '桌上的谈话没有转成委托，晚餐照常上齐。') },
  { id: 'ulkoria', name: '乌尔科莉娅', role: '巨魔颅骨庄园的旧业主', color: '#847b6d', initial: '石', chapters: [
    conversation('辨认旧门框', '一位矮人法师在门边停住脚步，摸了摸木框。她说自己从前拥有这座庄园，还记得吧台原来的朝向。', '酒馆的旧业主', '乌尔科莉娅曾拥有巨魔颅骨庄园。她可以从亲历者的角度谈起这座房子的过去。', CITY_SOURCES.patrons, '听她回忆原来的布局', '她用指尖在桌上画出旧布局。有一面墙的位置与现在不同。'),
    conversation('门边的守卫', '乌尔科莉娅身旁的构装体停在过道边，没有找座位。她招了招手，让它挪到不挡路的位置。', '盾卫', '乌尔科莉娅身边常有一具盾卫随行。', CITY_SOURCES.patrons, '在过道旁留出空间', '端盘子的员工从空出的过道通过。盾卫没有再移动。'),
    conversation('墙上的旧痕', '乌尔科莉娅看着墙上一处修补过的裂痕，讲了几句房子的旧事。话头停下时，利夫刚把一只酒杯移回架子。', '巨魔颅骨庄园', '这座建筑经历过数次转手；现任经营者接手之前，利夫也曾经营这里。', CITY_SOURCES.patrons, '把旧布局记在账簿背页', '记录旁添了一个门框的草图。其余旧事留在了这场谈话里。'),
  ], returnVisit: conversation('午后的老位置', '乌尔科莉娅在常坐的位置歇脚。盾卫停在门边，桌上是一杯刚送来的热饮。', '酒馆的旧业主', '乌尔科莉娅曾拥有巨魔颅骨庄园。她可以从亲历者的角度谈起这座房子的过去。', CITY_SOURCES.patrons, '与她聊聊房屋修缮', '她看过修补的位置，喝完热饮才离开。') },
  { id: 'rishaal', name: '里沙尔', role: '书龙宝藏书店', color: '#9c8966', initial: '书', chapters: [
    conversation('留在桌角的书', '金龙裔客人把眼镜往鼻端推了推，在灯下翻书。他说巷子西端那家书店就是自己开的。茶杯送到时，他用手指压住了页码。', '书龙宝藏', '里沙尔经营巨魔颅骨巷西端的书龙宝藏书店。', CITY_SOURCES.patrons, '与他谈正在读的书', '他把书签移到下一页，简短介绍了书的内容。'),
    conversation('吧台前的旧相识', '里沙尔看见利夫挪动杯子，停下了翻书。他认得这位从前的酒馆主人，也记得这里曾放过的几架书。', '利夫的藏书', '里沙尔认识利夫；利夫去世后，他曾协助出售那批不多的藏书。', CITY_SOURCES.patrons, '让他在吧台坐一会儿', '一只空杯停在里沙尔手边。他向吧台点了点头。'),
    conversation('晚餐时的阅读', '里沙尔将书合上，等餐时说起巷子里的店铺。门外经过一辆送货车，车轮的声音打断了几句话。', '书龙宝藏', '里沙尔经营巨魔颅骨巷西端的书龙宝藏书店。', CITY_SOURCES.patrons, '记下书店的位置', '订货便笺的背面添了书店的名字和方向。'),
  ], returnVisit: conversation('靠灯的一桌', '里沙尔在灯下读书。桌边多了一张夹着字条的书签。', '书龙宝藏', '里沙尔经营巨魔颅骨巷西端的书龙宝藏书店。', CITY_SOURCES.patrons, '续一壶茶', '茶壶放下后，他继续读那一页。') },
];
