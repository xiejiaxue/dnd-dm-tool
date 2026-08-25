/**
 * Extract the rules data needed by the tabletop from either a translated
 * 5etools record or an upstream English record. Keeping these calculations in
 * one pure module prevents the index builder and Cloudflare runtime from
 * drifting apart as the source schemas evolve.
 */
export function monsterInitiativeModifier(value: unknown): number {
  if (!isRecord(value)) return 0;

  const dexterityModifier = abilityModifier(value.dex);
  if (typeof value.initiative === 'number' && Number.isFinite(value.initiative)) {
    return clampModifier(value.initiative);
  }
  if (isRecord(value.initiative)) {
    if (typeof value.initiative.bonus === 'number' && Number.isFinite(value.initiative.bonus)) {
      return clampModifier(value.initiative.bonus);
    }
    if (typeof value.initiative.proficiency === 'number' && Number.isFinite(value.initiative.proficiency)) {
      return clampModifier(dexterityModifier + value.initiative.proficiency * proficiencyBonus(value.cr));
    }
  }
  return dexterityModifier;
}

export function monsterHitPoints(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.hp)) return undefined;
  const average = value.hp.average;
  return typeof average === 'number' && Number.isFinite(average) && average >= 0
    ? Math.round(average)
    : undefined;
}

export function monsterHasToken(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.hasToken === true || typeof value.tokenUrl === 'string' || isRecord(value.tokenHref);
}

function abilityModifier(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampModifier(Math.floor((value - 10) / 2))
    : 0;
}

function proficiencyBonus(value: unknown): number {
  const challengeRating = challengeRatingNumber(value);
  if (challengeRating === null) return 2;
  return Math.max(2, Math.min(9, Math.floor((Math.max(1, challengeRating) - 1) / 4) + 2));
}

function challengeRatingNumber(value: unknown): number | null {
  const raw = isRecord(value) && Object.hasOwn(value, 'cr') ? value.cr : value;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const fraction = /^(\d+)\/(\d+)$/u.exec(raw);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampModifier(value: number): number {
  return Math.max(-20, Math.min(30, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
