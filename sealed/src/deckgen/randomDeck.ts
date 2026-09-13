import type { SwuCard } from '../data/cards'
import type { SavedDeck } from '../data/deckStore'
import { seededUnit } from '../engine/rng'
import { buildDeckForLeader } from './generateDeck'
import { deckReport } from './rules'
import type { DeckReport } from './rules'

/**
 * A generated deck to play with or against, built from a cached set.
 *
 * The point is validating the **generator**, not convenience: a deck you can look at card by card,
 * play, and judge against what a real pool would give you. That is why the report travels with it
 * rather than being discarded, since a deck that violates the shape rules is exactly the thing worth
 * seeing.
 *
 * It is a `SavedDeck` so it can go straight into `onPlay` beside imported decks, but it is **never
 * persisted**: the id is marked so nothing mistakes it for one of the player's own, and regenerating
 * simply replaces it.
 */
/** One line of the deck list: enough to judge the deck without opening every card. */
export interface GeneratedDeckEntry {
  id: string
  count: number
  name: string
  cost: number
  rarity: string
  /** `Unit`, `Upgrade` or `Event`: the deck list is grouped by it, the way a decklist is read. */
  type: string
}

export interface GeneratedDeck {
  deck: SavedDeck
  report: DeckReport
  leaderName: string
  /**
   * The deck's cards resolved against the pool and **ordered by increasing cost**, which is the
   * order a curve is read in: too many cheap cards or too few is visible at a glance, where an
   * id-ordered list hides it. Ties break by name so the list is stable between regenerations of the
   * same deck.
   */
  entries: GeneratedDeckEntry[]
}

export const GENERATED_DECK_ID = 'generated'

/** Leaders a deck can be built around: every leader in the pool. */
function leadersIn(pool: SwuCard[]): SwuCard[] {
  return pool.filter(c => c.Type === 'Leader')
}

/**
 * Build one deck around a leader chosen by `seed`.
 *
 * Seeded rather than `Math.random` so a deck that looks wrong can be reproduced from its seed, which
 * is the difference between a bug report and an anecdote. Returns `null` when the pool holds no
 * leader, which is what an empty or partial cache looks like.
 */
export function generateRandomDeck(pool: SwuCard[], seed: number): GeneratedDeck | null {
  const leaders = leadersIn(pool)
  if (leaders.length === 0) return null

  const leader = leaders[Math.floor(seededUnit(seed || 1) * leaders.length) % leaders.length]
  const { deck } = buildDeckForLeader(leader, pool, seed)
  const byId = new Map(pool.map(c => [`${c.Set}_${c.Number}`, c]))

  const entries: GeneratedDeckEntry[] = deck.cards.map(c => {
    const card = byId.get(c.id)
    return {
      id: c.id,
      count: c.count,
      // The id is the honest fallback for a card the pool does not hold, which is what a partial
      // cache looks like. Silently dropping the row would hide a short deck.
      name: card?.Name ?? c.id,
      cost: Number(card?.Cost ?? 0),
      rarity: card?.Rarity ?? '?',
      type: card?.Type ?? '?',
    }
  }).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))

  return {
    deck: {
      ...deck,
      name: `${leader.Name} (generated)`,
      id: GENERATED_DECK_ID,
      importedAt: Date.now(),
    },
    report: deckReport(deck, byId),
    leaderName: leader.Name,
    entries,
  }
}
