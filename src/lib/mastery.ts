export const MAX_MASTERY_TIER = 10;
export const MASTERY_DEMOTION_TIERS = 2;
export const MASTERY_FREE_REVIEW_TIER = 3;
export const MASTERY_INTERVAL_MS = [
  0,
  0,
  0,
  0,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  90 * 24 * 60 * 60 * 1000,
] as const;

export const MASTERY_TIER_COLORS = [
  '#64748B',
  '#94A3B8',
  '#60A5FA',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#A855F7',
  '#D946EF',
  '#F97316',
  '#EAB308',
  '#22A06B',
] as const;

export function masteryTierAfterQuiz(currentTier: number, correct: boolean): number {
  const tier = Number.isFinite(currentTier)
    ? Math.max(0, Math.min(MAX_MASTERY_TIER, Math.trunc(currentTier)))
    : 0;
  return correct
    ? Math.min(MAX_MASTERY_TIER, tier + 1)
    : Math.max(0, tier - MASTERY_DEMOTION_TIERS);
}

export function masteryIntervalMs(tier: number): number {
  const safeTier = Number.isFinite(tier)
    ? Math.max(0, Math.min(MAX_MASTERY_TIER, Math.trunc(tier)))
    : 0;
  return MASTERY_INTERVAL_MS[safeTier];
}

export function masteryIntervalLabel(tier: number): string {
  const intervalMs = masteryIntervalMs(tier);
  if (intervalMs === 0) return 'no cooldown';
  if (intervalMs < 24 * 60 * 60 * 1000) {
    return `${intervalMs / (60 * 60 * 1000)} hours`;
  }
  const days = intervalMs / (24 * 60 * 60 * 1000);
  return `${days} day${days === 1 ? '' : 's'}`;
}
