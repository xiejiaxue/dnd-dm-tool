import fs from 'node:fs';
import path from 'node:path';
import { waterdeepIndex, getWaterdeepCard, waterdeepToken } from '../shared/waterdeep';
const root = process.argv[2];
if (!root) throw new Error('Usage: npx tsx scripts/export-waterdeep-npcs.ts OUTPUT_DIRECTORY');
fs.mkdirSync(root, { recursive: true });
for (const npc of waterdeepIndex.filter(n => n.combat)) {
  const dir = path.join(root, npc.faction);
  fs.mkdirSync(dir, { recursive: true });
  const name = npc.nameZh.replace(/[\/\\:*?"<>|]/g, '_');
  const card = getWaterdeepCard(npc.id)!;
  fs.writeFileSync(path.join(dir, `${name}.svg`), waterdeepToken(npc.id)!);
  fs.writeFileSync(path.join(dir, `${name}.md`), `# ${npc.nameZh}\n\n![${npc.nameZh} Token](${name}.svg)\n\n${card.campaignCard.meta}\n\n| 属性 | 数值 |\n| --- | --- |\n${card.campaignCard.rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n\n${card.campaignCard.body.join('\n\n')}\n`);
}
fs.writeFileSync(path.join(root, 'README.md'), `# 深水城战斗 NPC：Token 与数据卡\n\n共 ${waterdeepIndex.filter(n => n.combat).length} 名，按派系分类。每人提供 SVG Token 与中文 Markdown 数据卡。网页入口：战役 → 资料 → 深水城，可按派系、姓名筛选并放置到地图。\n\n数据沿用本地 NPC 档案的 2014 版模板和人物明确调整，没有按玩家等级强化。普通 NPC 也可能参与战斗；这里不以“剧情核心”判断战斗能力。Token 为姓名与派系配色的圆形标记。\n\n网站另外收录 ${waterdeepIndex.filter(n => !n.combat).length} 名有数据的平民、贵族和动物，取消“仅显示战斗 NPC”即可查看。无完整战斗数据的人物未生成推测数据。\n\n曼松拟像单独列卡：应用无装备与法术位限制；按拟像术将生命值上限减半，移除装备加值。\n\n生成工具位于网站项目 scripts/build-waterdeep-npcs.py 与 scripts/export-waterdeep-npcs.ts。\n`);
console.log(`Exported to ${root}`);
