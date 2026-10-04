import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { generateDeck } from '../deckgen/generateDeck'
import { colourBases, settleBase } from '../deckgen/bases'

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

/**
 * One base to build on per colour, chosen as a generated deck's is (`colourBases`), in aspect order so
 * deck indices (and the matrix) are reproducible. Each deck is settled on its base after it is built.
 */
function basesByAspect(pool: SwuCard[], seed: number): SwuCard[] {
  return colourBases(pool.filter(c => c.Type === 'Base'), seed)
    .sort((a, b) => (a.Aspects?.[0] ?? '').localeCompare(b.Aspects?.[0] ?? ''))
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
export function buildMatchupDecks(pool: SwuCard[] = POOL, basesPerLeader = 4, seed = 1): MatchupDeck[] {
  const leaders = pool.filter(c => c.Type === 'Leader').sort((a, b) => Number(a.Number) - Number(b.Number))
  const allBases = basesByAspect(pool, seed)
  const out: MatchupDeck[] = []
  leaders.forEach((leader, i) => {
    /**
     * A base must not double an aspect the leader already supplies: a single colour rarely yields
     * enough playables to fill a deck. In ASH that takes the full set from 72 to 52: most leaders lose
     * one base, and the two carrying two colour aspects lose two.
     *
     * Kept as a filter with a fallback rather than an assumption, so a leader covering every aspect
     * would still get a deck instead of vanishing from the grid.
     */
    const leaderAspects = new Set(leader.Aspects ?? [])
    const usable = allBases.filter(b => !(b.Aspects ?? []).some(a => leaderAspects.has(a)))
    const candidates = usable.length > 0 ? usable : allBases

    const take = Math.min(Math.max(1, basesPerLeader), candidates.length)
    // Rotate the window so a trimmed set still spans every aspect; a full set is unaffected.
    const bases = Array.from({ length: take }, (_, k) => candidates[(i + k) % candidates.length])
    for (const base of bases) {
      const baseAspect = base.Aspects?.[0] ?? '?'
      const label = `${leader.Name} (${baseAspect})`
      const deck = settleBase(generateDeck({ leader, base, pool, seed }).deck, pool, seed)
      out.push({ deck: { ...deck, name: label }, label, leaderName: leader.Name, baseAspect })
    }
  })
  return out
}
