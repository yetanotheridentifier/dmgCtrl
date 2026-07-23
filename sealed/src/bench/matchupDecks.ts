import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { generateDeck } from '../deckgen/generateDeck'

/**
 * The EVEN matchup deck set (#392 follow-up): each of the 18 leaders paired with each of the 4 base
 * aspects (Aggression, Cunning, Command, Vigilance) = 72 decks. Every leader is represented equally
 * and across four playstyles, so a leader gets a fair chance to shine rather than being drowned out
 * by however many coverage decks happened to use it.
 *
 * Deterministic. Separate from `coverageDecks` (which optimises for touching every card, for the
 * fuzzing sweep); this optimises for an even, comparable grid, for tuning and the matchup matrix.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface MatchupDeck {
  deck: ParsedDeck
  label: string
  leaderName: string
  baseAspect: string
}

/** One representative base per distinct aspect (bases are mechanically identical, aspect aside). */
function distinctBases(pool: SwuCard[]): SwuCard[] {
  const byAspect = new Map<string, SwuCard>()
  for (const b of pool.filter(c => c.Type === 'Base')) {
    const key = (b.Aspects ?? [])[0] ?? '?'
    if (!byAspect.has(key)) byAspect.set(key, b)
  }
  // Stable order so deck indices (and the matrix) are reproducible.
  return [...byAspect.values()].sort((a, b) => (a.Aspects?.[0] ?? '').localeCompare(b.Aspects?.[0] ?? ''))
}

export function buildMatchupDecks(pool: SwuCard[] = POOL): MatchupDeck[] {
  const leaders = pool.filter(c => c.Type === 'Leader').sort((a, b) => Number(a.Number) - Number(b.Number))
  const bases = distinctBases(pool)
  const out: MatchupDeck[] = []
  for (const leader of leaders) {
    for (const base of bases) {
      const baseAspect = base.Aspects?.[0] ?? '?'
      const label = `${leader.Name} (${baseAspect})`
      const { deck } = generateDeck({ leader, base, pool, seed: 1 })
      out.push({ deck: { ...deck, name: label }, label, leaderName: leader.Name, baseAspect })
    }
  }
  return out
}
