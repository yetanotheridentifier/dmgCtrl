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

/**
 * `basesPerLeader` trims the grid: the full 4 gives the even 72-deck set for deck-strength work, and
 * 1 gives an 18-deck set (one per leader). The small set exists for the AI-vs-AI matchup breakdown
 * (#319), where every ORDERED pair must be played and 72 decks would mean over 5000 cells.
 *
 * A trimmed set ROTATES the aspect across leaders rather than taking the first base every time.
 * Taking the first would hand all 18 decks an Aggression base, which is a badly biased sample to
 * judge "does this AI beat that one across matchups" on.
 */
export function buildMatchupDecks(pool: SwuCard[] = POOL, basesPerLeader = 4): MatchupDeck[] {
  const leaders = pool.filter(c => c.Type === 'Leader').sort((a, b) => Number(a.Number) - Number(b.Number))
  const allBases = distinctBases(pool)
  const take = Math.min(Math.max(1, basesPerLeader), allBases.length)
  const out: MatchupDeck[] = []
  leaders.forEach((leader, i) => {
    // Rotate the window so a trimmed set still spans every aspect; a full set is unaffected.
    const bases = Array.from({ length: take }, (_, k) => allBases[(i + k) % allBases.length])
    for (const base of bases) {
      const baseAspect = base.Aspects?.[0] ?? '?'
      const label = `${leader.Name} (${baseAspect})`
      const { deck } = generateDeck({ leader, base, pool, seed: 1 })
      out.push({ deck: { ...deck, name: label }, label, leaderName: leader.Name, baseAspect })
    }
  })
  return out
}
