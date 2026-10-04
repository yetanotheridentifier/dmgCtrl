import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { generateDeck } from '../deckgen/generateDeck'
import { unpaidAspects } from '../deckgen/rules'
import { colourBases, settleBase } from '../deckgen/bases'

/**
 * Whole-pool coverage (#408): a set of legal, realistic decks whose union exercises every card in the
 * pool. Two passes: one deck per leader (so every leader appears), choosing the base that adds the
 * most new cards; then a top-up pass that keeps adding decks aimed at the remaining stragglers until
 * everything is covered. Each deck steers toward not-yet-covered cards via `prefer`, without breaking
 * its own legality (see the moderate PREFER_BONUS in the generator). Deterministic from `seed`.
 *
 * **A deck draws on one set.** The generator models a sealed pool, which is opened from one set, so a
 * pool spanning several sets is covered set by set, in pool order, and no deck mixes them. Copy limits
 * are per card id, which a cross-set reprint would slip past, so mixing sets needs rules of its own.
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

/** Every leader + base that pay each aspect icon on the card, in pool order. */
function combosFor(card: SwuCard, leaders: SwuCard[], bases: SwuCard[]): { leader: SwuCard; base: SwuCard }[] {
  return leaders.flatMap(leader => bases.filter(base => unpaidAspects(card, leader, base).length === 0).map(base => ({ leader, base })))
}

export function buildCoverageDecks(pool: SwuCard[], seed = 1): CoverageResult {
  const bySet = new Map<string, SwuCard[]>()
  for (const card of pool) {
    const cards = bySet.get(card.Set)
    if (cards) cards.push(card)
    else bySet.set(card.Set, [card])
  }
  const decks: ParsedDeck[] = []
  const uncovered: string[] = []
  for (const cards of bySet.values()) {
    const covered = coverOneSet(cards, seed)
    decks.push(...covered.decks)
    uncovered.push(...covered.uncovered)
  }
  return { decks, uncovered }
}

function coverOneSet(pool: SwuCard[], seed: number): CoverageResult {
  const leaders = pool.filter(c => c.Type === 'Leader')
  // One base to build on per colour, chosen as a generated deck's is; each deck is settled on its base after.
  const bases = colourBases(pool.filter(c => c.Type === 'Base'), seed)
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
    best = settleBase(best, pool, seed)
    decks.push(best)
    mark(best)
  }

  // Pass 2: top up until every deck-able card is covered, skipping any that no combo can reach.
  const unreachable = new Set<string>()
  for (let guard = 0; guard < 500; guard++) {
    const remaining = deckable.filter(c => !covered.has(id(c)) && !unreachable.has(id(c)))
    if (remaining.length === 0) break
    const target = remaining[0]
    const combos = combosFor(target, leaders, bases)
    if (combos.length === 0) { unreachable.add(id(target)); continue }
    const prefer = new Set(remaining.map(id))
    // Force the target in so this deck definitely covers it (Rare / bomb stragglers otherwise get
    // squeezed out by the caps). The rest of the deck still steers toward the other stragglers.
    // The first pairing that builds a clean deck wins: a card with a doubled aspect is paid only by a
    // leader and base of one colour, and the first such pair can be too thin to fill the curve.
    let best: { deck: ParsedDeck; violations: number } | undefined
    for (const { leader, base } of combos) {
      const { deck, report } = generateDeck({ leader, base, pool, seed: seed + guard + 1, prefer, require: new Map([[id(target), 1]]) })
      if (!best || report.violations.length < best.violations) best = { deck, violations: report.violations.length }
      if (report.ok) break
    }
    const settled = settleBase(best!.deck, pool, seed)
    decks.push(settled)
    mark(settled)
  }

  const uncovered = deckable.filter(c => !covered.has(id(c))).map(id)
  return { decks, uncovered }
}
