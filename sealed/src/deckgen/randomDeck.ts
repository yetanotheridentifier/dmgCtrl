import type { SwuCard } from '../data/cards'
import type { SavedDeck } from '../data/deckStore'
import { seededUnit } from '../engine/rng'
import { buildDeckForLeader } from './generateDeck'
import { DECK_SIZE, deckReport } from './rules'
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

/** What a generated deck is built around. Either one left out is picked at random. */
export interface GenerationChoice {
  leaderId?: string
  baseAspect?: string
}

/** The choices a pool offers, for a picker to list. */
export interface GenerationOptions {
  /** In card-number order, each with its aspects, since the aspects are what the pairing rule reads. */
  leaders: { id: string; name: string; aspects: string[] }[]
  aspects: string[]
}

const cardId = (c: SwuCard): string => `${c.Set}_${c.Number}`

export function generationOptions(pool: SwuCard[]): GenerationOptions {
  const leaders = leadersIn(pool)
    .sort((a, b) => a.Set.localeCompare(b.Set) || Number(a.Number) - Number(b.Number))
    .map(l => ({ id: cardId(l), name: l.Name, aspects: l.Aspects ?? [] }))
  const aspects = [...new Set(pool.filter(c => c.Type === 'Base').flatMap(b => b.Aspects ?? []))].sort()
  return { leaders, aspects }
}

/** Leaders a deck can be built around: every leader in the pool. */
function leadersIn(pool: SwuCard[]): SwuCard[] {
  return pool.filter(c => c.Type === 'Leader')
}

/**
 * Build one deck around a leader and a base aspect, each either chosen or picked by `seed`.
 *
 * Seeded rather than `Math.random` so a deck that looks wrong can be reproduced from its seed, which
 * is the difference between a bug report and an anecdote. Returns `null` when the pool holds no
 * leader, or cannot fill a whole deck, which is what an empty or partial cache looks like. Other shape
 * violations still come back in the report, but a short deck is not playable at all: the engine deals
 * a short opening hand from it and the setup AI has nothing to resource.
 *
 * **Only a deliberate choice pairs a leader with a base sharing its aspect.** A random base already
 * avoids the leader's aspects, and a random leader here avoids a chosen base aspect, so the pairing the
 * generator never builds by accident is still one a player can ask for by choosing both.
 */
export function generateRandomDeck(pool: SwuCard[], seed: number, choice: GenerationChoice = {}): GeneratedDeck | null {
  const leaders = leadersIn(pool)
  if (leaders.length === 0) return null

  const { baseAspect } = choice
  const named = leaders.find(l => cardId(l) === choice.leaderId)
  const avoiding = baseAspect === undefined ? leaders : leaders.filter(l => !(l.Aspects ?? []).includes(baseAspect))
  const from = avoiding.length > 0 ? avoiding : leaders
  const leader = named ?? from[Math.floor(seededUnit(seed || 1) * from.length) % from.length]
  const { deck } = buildDeckForLeader(leader, pool, seed, undefined, baseAspect)
  if (deck.cards.reduce((n, c) => n + c.count, 0) < DECK_SIZE) return null
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
