import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { generateDeck } from '../deckgen/generateDeck'
import { coveredAspects } from '../deckgen/rules'

/**
 * Whole-pool coverage (#408): a set of legal, realistic decks whose union exercises every card in the
 * set. Two passes: one deck per leader (so every leader appears), choosing the base that adds the
 * most new cards; then a top-up pass that keeps adding decks aimed at the remaining stragglers until
 * everything is covered. Each deck steers toward not-yet-covered cards via `prefer`, without breaking
 * its own legality (see the moderate PREFER_BONUS in the generator). Deterministic from `seed`.
 *
 * Any card that no leader + base can include penalty-free is reported in `uncovered` rather than
 * dropped silently, so it can be handled deliberately.
 */

const id = (c: SwuCard): string => `${c.Set}_${c.Number}`

export interface CoverageResult {
  decks: ParsedDeck[]
  /** Deck-able card ids that no leader + base could include without an aspect penalty. */
  uncovered: string[]
}

/** One representative base per distinct aspect (bases are mechanically identical, aspect aside). */
function distinctBases(pool: SwuCard[]): SwuCard[] {
  const byAspect = new Map<string, SwuCard>()
  for (const b of pool.filter(c => c.Type === 'Base')) {
    const key = (b.Aspects ?? []).join(',')
    if (!byAspect.has(key)) byAspect.set(key, b)
  }
  return [...byAspect.values()]
}

/** A leader + base whose covered aspects include the card's aspects, or null if none exists. */
function comboFor(card: SwuCard, leaders: SwuCard[], bases: SwuCard[]): { leader: SwuCard; base: SwuCard } | null {
  const need = card.Aspects ?? []
  for (const leader of leaders) {
    for (const base of bases) {
      const covered = coveredAspects(leader, base)
      if (need.every(a => covered.has(a))) return { leader, base }
    }
  }
  return null
}

export function buildCoverageDecks(pool: SwuCard[], seed = 1): CoverageResult {
  const leaders = pool.filter(c => c.Type === 'Leader')
  const bases = distinctBases(pool)
  const deckable = pool.filter(c => c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade')

  const covered = new Set<string>()
  const decks: ParsedDeck[] = []
  const mark = (deck: ParsedDeck): void => {
    covered.add(deck.leader)
    for (const e of deck.cards) covered.add(e.id)
  }
  const preferUncovered = (): Set<string> => new Set(deckable.filter(c => !covered.has(id(c))).map(id))

  // Pass 1: one valid deck per leader, base picked to add the most new cards.
  for (const leader of leaders) {
    const prefer = preferUncovered()
    let best: ParsedDeck | undefined
    let bestNew = -1
    for (const base of bases) {
      const { deck, report } = generateDeck({ leader, base, pool, seed, prefer })
      if (!report.ok) continue
      const newCards = deck.cards.filter(e => !covered.has(e.id)).length
      if (newCards > bestNew) { bestNew = newCards; best = deck }
    }
    // Fall back to any base if none produced a clean deck (keeps the leader represented).
    if (!best) best = generateDeck({ leader, base: bases[0], pool, seed, prefer }).deck
    decks.push(best)
    mark(best)
  }

  // Pass 2: top up until every deck-able card is covered, skipping any that no combo can reach.
  const unreachable = new Set<string>()
  for (let guard = 0; guard < 500; guard++) {
    const remaining = deckable.filter(c => !covered.has(id(c)) && !unreachable.has(id(c)))
    if (remaining.length === 0) break
    const target = remaining[0]
    const combo = comboFor(target, leaders, bases)
    if (!combo) { unreachable.add(id(target)); continue }
    const prefer = new Set(remaining.map(id))
    // Force the target in so this deck definitely covers it (Rare / bomb stragglers otherwise get
    // squeezed out by the caps). The rest of the deck still steers toward the other stragglers.
    const { deck } = generateDeck({ leader: combo.leader, base: combo.base, pool, seed: seed + guard + 1, prefer, require: new Set([id(target)]) })
    decks.push(deck)
    mark(deck)
  }

  const uncovered = deckable.filter(c => !covered.has(id(c))).map(id)
  return { decks, uncovered }
}
