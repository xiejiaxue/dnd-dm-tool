import type { Token } from './types';

/**
 * One 5-ft battle-grid square of a module map, in original image pixels, keyed by the image hash
 * that ends the map asset id (a module and its remix share it). Curse of Strahd squares were
 * measured on the maps (each says "one square = 5 feet"); Hoard and Phandelver maps were already
 * calibrated so a square is `medium` board pixels at the preset map scale. Regional, town and
 * isometric castle maps have no combat grid and are absent.
 */
const MAP_GRIDS: Record<string, { square: number; medium?: number }> = {
  // 施特拉德的诅咒
  '18ad23c83ea7': { square: 39.7 }, // 02 塔瑟水潭营地
  '9f303e9ae226': { square: 35.7 }, // 04 巴洛维亚村教堂
  '923dee9c64da': { square: 36.75 }, // 16 蓝水旅店
  '5f742b882ff3': { square: 31.4 }, // 17 镇长官邸
  'a78fb8b86b55': { square: 37.65 }, // 18 瓦赫特宅邸
  'ca33e6e5d88d': { square: 62.5 }, // 19 棺材铺
  '917de4097c59': { square: 17.07 }, // 20 维斯塔尼营地
  '80eb98db783e': { square: 28.8 }, // 21 碾骨老磨坊
  '9ee60cd73821': { square: 17.82 }, // 22 银龙宅邸一层与二层
  '415708dc7c5e': { square: 17.86 }, // 23 银龙宅邸三层屋顶与灯塔
  '042c10a3243b': { square: 17.08 }, // 25 圣玛柯维娅修道院一层
  'a841b84a265d': { square: 24.16 }, // 26 圣玛柯维娅修道院二层与地窖
  '682b761fc36b': { square: 16.88 }, // 27 索伦卡山道
  '2fb1c1dbccde': { square: 14.7 }, // 29 柏瑞兹废墟
  '9b93b774ee5c': { square: 18.4 }, // 30 范里希腾之塔
  '7a03f0b12ec3': { square: 18.0 }, // 31 美酒巫师庄园
  'cb0bd7a7ee87': { square: 18.93 }, // 32 琥珀神殿二层
  'b2f58c735d3c': { square: 18.9 }, // 33 琥珀神殿一层
  '58d8f2078fbe': { square: 16.43 }, // 34 往日山丘
  '94db603d52fc': { square: 31.4 }, // 35 狼人巢穴
  '1429ddc431f5': { square: 35.9 }, // 36 死亡之屋
  // 龙后的宝山
  '7a977e30944c': { square: 15.674, medium: 100 }, // 03 育龙场
  '4a17abb0025b': { square: 27.248, medium: 100 }, // 04 卡纳特客栈
  '6225af01ca41': { square: 9.346, medium: 100 }, // 05 涅瑞塔堡外围与一层
  'cc04c5f1a7b9': { square: 18.382, medium: 100 }, // 06 涅瑞塔堡二层
  'c8071baa7868': { square: 18.382, medium: 100 }, // 07 涅瑞塔堡三层
  'ba0f3b94f8c9': { square: 14.006, medium: 100 }, // 08 涅瑞塔堡地下层
  '2de388f59f9f': { square: 30.96, medium: 100 }, // 09 狩猎旅舍外围与一层
  '3ff97435c966': { square: 40, medium: 100 }, // 10 狩猎旅舍上层
  '40ba898be95c': { square: 14.347, medium: 100 }, // 11 帕纳斯特村庄
  'cacea50f3b02': { square: 8.85, medium: 100 }, // 12 通天堡
  // 凡戴尔的失落矿坑
  '0a8c7238e562': { square: 26.603, medium: 100 }, // 01 克拉摩窝点
  '46964a76d9ec': { square: 30, medium: 60 }, // 02 凡达林镇
  'e8ade41c7790': { square: 33.003, medium: 100 }, // 03 红标帮窝点
  '7248e249939c': { square: 29.797, medium: 100 }, // 04 克拉摩堡
  'd223b5c7a8ea': { square: 16.25, medium: 100 }, // 05 雷树镇废墟
  '97d4db9ada15': { square: 13.3, medium: 100 }, // 06 潮音洞穴
};

// Preset creature widths in squares; any other stored size (a hand-placed 100px token) is one square.
const CREATURE_SQUARES = [0.5, 1, 2, 3, 4];

/** Image hash of a module map URL, which ends with its `map-<module>-<nn>-<hash>` asset id. */
function mapHash(mapImage: string | null) {
  return mapImage?.match(/map-[a-z]+-\d+-([0-9a-f]{12})$/)?.[1] ?? null;
}

/**
 * Board diameter that makes a token cover its squares of the printed grid at the current map
 * scale, so it follows the DM's map zoom. Null when the map has no known grid.
 */
export function gridTokenDiameter(mapImage: string | null, mapScale: number, token: Pick<Token, 'kind' | 'size'>): number | null {
  const hash = mapHash(mapImage);
  const grid = hash ? MAP_GRIDS[hash] : undefined;
  if (!grid) return null;
  const ratio = grid.medium && token.kind === 'monster' ? token.size / grid.medium : 1;
  const squares = CREATURE_SQUARES.find(n => Math.abs(ratio - n) < 0.01) ?? 1;
  return grid.square * mapScale * squares;
}
