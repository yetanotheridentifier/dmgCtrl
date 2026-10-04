import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { seededUnit } from '../engine/rng'
import { isRareBase, RARE_BASE_CHANCE } from './rules'

/**
 * Which base a generated deck is built on, for the setup screen's decks and the bench's suites alike.
 *
 * A deck reads three things from its base: its aspects, the deck size it sets, and whether it is
 * rare. Bases agreeing on all three build the same deck, so the choice is made in two steps:
 * {@link colourBases} picks what to build on, and {@link settleBase} picks which of the equivalent
 * bases the built deck sits on.
 */

const id = (c: SwuCard): string => `${c.Set}_${c.Number}`
const colourOf = (b: SwuCard): string => (b.Aspects ?? []).join(',')

/** A seeded unit for one seed and one string, so each colour rolls independently. */
function roll(seed: number, salt: string): number {
  let h = (seed * 2246822519) >>> 0
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0
  return seededUnit(h || 1)
}

/**
 * One base to build on per colour, in the order the bases first appear.
 *
 * Common unless the colour's roll lands inside {@link RARE_BASE_CHANCE} and the colour prints a rare
 * base: a rare base is a rare a pool has to open. A colour printing only rare bases (JTL's colourless
 * Lake Country) appears only on such a roll, and a pool with no common base at all uses its rare ones.
 * Which base of the class is returned does not matter, since {@link settleBase} chooses among them.
 */
export function colourBases(bases: SwuCard[], seed: number): SwuCard[] {
  const anyCommon = bases.some(b => !isRareBase(b))
  const colours = [...new Set(bases.map(colourOf))]
  return colours.flatMap(colour => {
    const inColour = bases.filter(b => colourOf(b) === colour)
    const rare = inColour.find(isRareBase)
    const common = inColour.find(b => !isRareBase(b))
    if (!anyCommon) return rare ? [rare] : []
    if (rare && roll(seed, colour) < RARE_BASE_CHANCE) return [rare]
    return common ? [common] : []
  })
}

/**
 * How many copies in a deck name one of a base's traits, which is how a card asks for a world base
 * ("if you control a TATOOINE base"). Zero for a base with no traits, which is most of them.
 */
function traitMentions(base: SwuCard, deck: ParsedDeck, byId: Map<string, SwuCard>): number {
  const traits = (base.Traits ?? []).map(t => t.toUpperCase())
  if (traits.length === 0) return 0
  return deck.cards.reduce((n, e) => {
    const card = byId.get(e.id)
    const text = `${card?.FrontText ?? ''} ${card?.BackText ?? ''}`.toUpperCase()
    return traits.some(t => text.includes(t)) ? n + e.count : n
  }, 0)
}

/**
 * Put a built deck on the base its cards want, among those that build the same deck: same colour,
 * size and rarity. The one whose traits the cards name most (a Homeworlds world) wins, and among equals
 * a seeded pick, which is what spreads decks across every base of a colour.
 */
export function settleBase(deck: ParsedDeck, pool: SwuCard[], seed: number): ParsedDeck {
  const byId = new Map(pool.map(c => [id(c), c]))
  const built = byId.get(deck.base)
  if (!built) return deck
  const size = minimumDeckSize(deck.base)
  const equivalent = pool.filter(b =>
    b.Type === 'Base' && colourOf(b) === colourOf(built) && isRareBase(b) === isRareBase(built) && minimumDeckSize(id(b)) === size)
  const mentions = equivalent.map(b => traitMentions(b, deck, byId))
  const most = equivalent.filter((_, i) => mentions[i] === Math.max(...mentions))
  // Salted by the leader's name rather than its id, so a set builds the same decks whatever it is called.
  const pick = most[Math.floor(roll(seed, `${byId.get(deck.leader)?.Name ?? ''}|${colourOf(built)}`) * most.length)]
  return { ...deck, base: id(pick) }
}
