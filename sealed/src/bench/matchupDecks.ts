import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildDeckFromPool } from '../deckgen/generateDeck'
import { openPool } from '../deckgen/packs'

/**
 * The EVEN matchup deck set: each leader paired with each base aspect it does not already carry
 * (Aggression, Cunning, Command, Vigilance). Every leader is represented equally and across several
 * playstyles, so a leader gets a fair chance to shine rather than being drowned out by however many
 * coverage decks happened to use it.
 *
 * **Each deck is built from its own sealed pool**, six packs opened around its leader (`openPool` with
 * the leader swapped in) and built by the pool deck builder (`buildDeckFromPool`) with its leader and
 * aspect fixed: its scorer picks the base among the aspect's Common bases and any rare one the pool
 * opened. So a deck holds what a player could have opened, not the pick of the set. The builder's
 * turn-1 veto does not drop a cell: a pairing below it is still built.
 *
 * Deterministic from `seed`. Separate from `coverageDecks` (which optimises for touching every card,
 * for the fuzzing sweep, and so builds from the whole set); this optimises for an even, comparable
 * grid, for tuning and the matchup matrix.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface MatchupDeck {
  deck: ParsedDeck
  label: string
  leaderName: string
  baseAspect: string
}

/** The seed of one deck's pool: the suite's seed, the leader and the aspect, so every deck opens its own. */
function poolSeed(seed: number, leader: number, aspect: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(leader * 8 + aspect + 1, 0x85ebca6b)) >>> 0 || 1
}

/**
 * `basesPerLeader` trims the grid: the full 4 gives the even set for deck-strength work, and 1 gives
 * a set of one deck per leader. The small set exists for the AI-vs-AI matchup breakdown, where every
 * ORDERED pair must be played and the full set would mean thousands of cells.
 *
 * A trimmed set ROTATES the aspect across leaders rather than taking the first aspect every time.
 * Taking the first would hand every deck an Aggression base, which is a badly biased sample to judge
 * "does this AI beat that one across matchups" on.
 */
export function buildMatchupDecks(cards: SwuCard[] = POOL, basesPerLeader = 4, seed = 1): MatchupDeck[] {
  const leaders = cards.filter(c => c.Type === 'Leader').sort((a, b) => Number(a.Number) - Number(b.Number))
  const aspects = [...new Set(cards.filter(c => c.Type === 'Base').flatMap(b => b.Aspects ?? []))].sort()
  const out: MatchupDeck[] = []
  leaders.forEach((leader, i) => {
    /**
     * A base must not double an aspect the leader already supplies: a single colour rarely yields
     * enough playables to fill a deck. In ASH that takes the full set from 72 to 52: most leaders lose
     * one aspect, and the two carrying two colour aspects lose two.
     *
     * Kept as a filter with a fallback rather than an assumption, so a leader covering every aspect
     * would still get a deck instead of vanishing from the grid.
     */
    const usable = aspects.filter(a => !(leader.Aspects ?? []).includes(a))
    const candidates = usable.length > 0 ? usable : aspects

    const take = Math.min(Math.max(1, basesPerLeader), candidates.length)
    // Rotate the window so a trimmed set still spans every aspect; a full set is unaffected.
    for (let k = 0; k < take; k++) {
      const baseAspect = candidates[(i + k) % candidates.length]
      const deckSeed = poolSeed(seed, i, aspects.indexOf(baseAspect))
      const pool = openPool(cards, deckSeed, { leader })
      const label = `${leader.Name} (${baseAspect})`
      const { deck } = buildDeckFromPool(pool, cards, deckSeed, { leader, baseAspect })
      out.push({ deck: { ...deck, name: label }, label, leaderName: leader.Name, baseAspect })
    }
  })
  return out
}
