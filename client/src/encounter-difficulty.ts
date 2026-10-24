// Encounter difficulty by the 2014 Dungeon Master's Guide (chapter 3): sum the
// monsters' XP, apply the group multiplier (shifted for small or large parties)
// and compare with the party's thresholds.

const CR_XP: Record<string, number> = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1_100, '5': 1_800,
  '6': 2_300, '7': 2_900, '8': 3_900, '9': 5_000, '10': 5_900, '11': 7_200, '12': 8_400, '13': 10_000,
  '14': 11_500, '15': 13_000, '16': 15_000, '17': 18_000, '18': 20_000, '19': 22_000, '20': 25_000,
};

// Per-character easy / medium / hard / deadly thresholds by level.
const THRESHOLDS: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500],
  5: [250, 500, 750, 1_100], 6: [300, 600, 900, 1_400], 7: [350, 750, 1_100, 1_700], 8: [450, 900, 1_400, 2_100],
  9: [550, 1_100, 1_600, 2_400], 10: [600, 1_200, 1_900, 2_800], 11: [800, 1_600, 2_400, 3_600], 12: [1_000, 2_000, 3_000, 4_500],
};

const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4];

export const DIFFICULTY_LABELS = ['轻松', '简单', '中等', '困难', '致命'] as const;
export type Difficulty = typeof DIFFICULTY_LABELS[number];

export function crXp(cr: string): number | undefined {
  return CR_XP[cr.trim()];
}

function multiplierIndex(monsters: number): number {
  if (monsters <= 1) return 1;
  if (monsters === 2) return 2;
  if (monsters <= 6) return 3;
  if (monsters <= 10) return 4;
  if (monsters <= 14) return 5;
  return 6;
}

export interface DifficultyResult { xp: number; adjusted: number; difficulty: Difficulty; thresholds: [number, number, number, number] }

/** null when no enemy has a known CR (scenery, or nothing to fight). */
export function encounterDifficulty(enemies: readonly { cr: string; count: number }[], partySize: number, level: number): DifficultyResult | null {
  let xp = 0;
  let monsters = 0;
  for (const enemy of enemies) {
    const value = crXp(enemy.cr);
    if (value === undefined) continue;
    xp += value * enemy.count;
    monsters += enemy.count;
  }
  if (!monsters) return null;
  const size = Math.max(1, Math.round(partySize));
  // Fewer than three characters use the next multiplier up; six or more the next one down.
  const shift = size < 3 ? 1 : size >= 6 ? -1 : 0;
  const multiplier = MULTIPLIERS[Math.min(MULTIPLIERS.length - 1, Math.max(0, multiplierIndex(monsters) + shift))];
  const adjusted = Math.round(xp * multiplier);
  const perCharacter = THRESHOLDS[Math.min(12, Math.max(1, Math.round(level)))];
  const thresholds = perCharacter.map(value => value * size) as [number, number, number, number];
  const reached = thresholds.filter(threshold => adjusted >= threshold).length;
  return { xp, adjusted, difficulty: DIFFICULTY_LABELS[reached], thresholds };
}
