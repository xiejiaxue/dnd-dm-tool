import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.ROOM_TEMPLATE_ID ||= 'waterdeep-dragon-heist-remix';
process.env.ROOM_TEMPLATE_NAME ||= '深水城重置版';
process.env.ROOM_TEMPLATE_DESCRIPTION ||= 'Alexandrian 重置版跑团模板，含深水城总览、八组章节场景，以及补全原版规则数据、身份和背景的阵营 NPC 档案。';
process.env.ROOM_TEMPLATE_VERSION ||= '7';
process.env.ROOM_TEMPLATE_MAP_SUBDIR ||= '04-地图/按场景';
process.env.ROOM_TEMPLATE_NPC_SUBDIR ||= '03-NPC';
process.env.ROOM_TEMPLATE_ENCOUNTERS ||= '1';
process.env.ROOM_TEMPLATE_ENCOUNTER_MODE ||= 'remix';
process.env.ROOM_TEMPLATE_STRIP_ORDERING ||= '1';
process.env.ROOM_TEMPLATE_MAP_SCALE_MODE ||= 'auto';
process.env.ROOM_TEMPLATE_BASE_MANIFEST ||= path.join(ROOT, 'output', 'room-templates', 'waterdeep-dragon-heist', 'manifest.json');

await import('./build-waterdeep-template.mjs');
