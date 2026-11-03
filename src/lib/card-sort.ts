import type { CardStats } from '@/db/queries';
import type { DueCard } from '@/db/types';

export type CardSortKey = 'due' | 'streak' | 'accuracy' | 'reviews' | 'name';

export const CARD_SORT_OPTIONS: { key: CardSortKey; label: string }[] = [
  { key: 'due', label: 'Due order' },
  { key: 'streak', label: 'Highest combo' },
  { key: 'accuracy', label: 'Highest accuracy' },
  { key: 'reviews', label: 'Most practiced' },
  { key: 'name', label: 'A → Z' },
];

/** Default direction per key so "highest" wins first for streak/accuracy. */
export const CARD_SORT_DEFAULT_ASC: Record<CardSortKey, boolean> = {
  due: true,
  streak: false,
  accuracy: false,
  reviews: false,
  name: true,
};

/**
 * Re-order only the cards that are already due. Never pulls non-due cards
 * into the rotation, so nothing is forced to reappear before its time.
 * Unreviewed cards sink to the bottom for accuracy (no evidence yet).
 */
export function sortCards(
  cards: DueCard[],
  stats: Map<string, CardStats>,
  key: CardSortKey,
  asc: boolean,
): DueCard[] {
  const dir = asc ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (key) {
      case 'due':
        return dir * (new Date(a.due).getTime() - new Date(b.due).getTime());
      case 'name':
        return dir * a.lemma.localeCompare(b.lemma);
      case 'streak': {
        const sa = stats.get(a.id)?.streak ?? 0;
        const sb = stats.get(b.id)?.streak ?? 0;
        return dir * (sa - sb);
      }
      case 'accuracy': {
        const sa = stats.get(a.id);
        const sb = stats.get(b.id);
        const aa = sa && sa.review_count > 0 ? sa.accuracy : null;
        const ab = sb && sb.review_count > 0 ? sb.accuracy : null;
        if (aa === null && ab === null) return 0;
        if (aa === null) return 1;
        if (ab === null) return -1;
        return dir * (aa - ab);
      }
      case 'reviews': {
        const sa = stats.get(a.id)?.review_count ?? 0;
        const sb = stats.get(b.id)?.review_count ?? 0;
        return dir * (sa - sb);
      }
    }
  });
}
