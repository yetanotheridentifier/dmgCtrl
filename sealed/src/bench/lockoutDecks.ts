import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { generateDeck } from '../deckgen/generateDeck'
import { deckReport } from '../deckgen/rules'
import { buildCoverageDecks, distinctBases } from './coverageDecks'

/**
 * A deck population in which the shielded-Sentinel lockout actually happens.
 *
 * ## Why this exists
 *
 * The lockout is the longest-running open defect in the bot, and every attempt to measure it has hit
 * the same wall: it is a **human strategy**. A player builds it on purpose. Self-play over the
 * coverage decks produces a genuinely shut lane on **0.5%** of decisions and never for more than a
 * round, while play-testers hit it constantly and one filed game ran four consecutive rounds.
 *
 * That gap has already retired a candidate fix once. `blockedReach` was recorded as "invisible over
 * ~2,500 games", measured on the coverage decks. A term that speaks in 0.5% of positions cannot move
 * a win rate however right it is, so that number was a verdict on the population rather than on the
 * term. On eighteen real locked boards from the filed game the same term at an in-scale weight strips
 * on 10 where the shipped bot strips on 1.
 *
 * ## The pairing, and why it is not a mirror
 *
 * Every other deck source in the bench plays the same list on both sides, so deck strength cancels
 * and a win-rate difference is down to the AI. This one deliberately does not. **One side is an
 * ordinary coverage deck**, because the question is whether a bot can find its way THROUGH a wall,
 * and a mirror where both sides hold one cannot show that. It also keeps the whole-pool coverage
 * intact on the facing side: the wall decks are a narrow archetype, and a set built only from them
 * would measure a corner of the pool.
 *
 * **The cost of that choice is that an absolute win rate over this set is meaningless.** The pairing
 * has a favourite before either bot moves. Only a paired difference against a matched control on the
 * same seeds can be read here, and the ordinary coverage set remains the non-inferiority gate.
 *
 * ## The package
 *
 * Self-shielding Sentinels, so the wall needs no combination and no intent: `Shielded` grants the
 * token on arrival, so the bot plays a good body and the lane shuts by itself. Plus re-shield
 * support, because **duration is the reported defect**. A Shield absorbs one instance of damage and
 * is then spent, so without a way to put it back the wall falls the moment the bot finally strips it
 * and the bench reads a one-round lockout it can dismiss as noise.
 *
 * Vigilance is where this archetype genuinely lives: it holds both re-shield cards and a share of the
 * Sentinels, which is why every wall combo below covers it. That is a deck someone would build, not a
 * pile assembled to prove a point, and the generator's own curve, type and rarity rules still apply.
 */

const id = (c: SwuCard): string => `${c.Set}_${c.Number}`

/** The wall, and what keeps it standing. Ids rather than names, since names are not unique. */
export const WALL_PACKAGE = {
  /** Ground Sentinels carrying `Shielded`, so each one arrives as a shut lane. */
  sentinels: ['ASH_048', 'ASH_029', 'ASH_243'],
  /** Puts the Shield back after a strip, which is what turns one locked round into four. */
  reshield: ['ASH_086', 'ASH_089'],
  /**
   * Copies to force in. Three of the commons, because one copy in thirty is not a plan: the card has
   * to be **drawn** for the position to occur at all. `generateDeck` clamps Uniques to one, so Darth
   * Vader asking for more would be a silent illegality rather than a bigger wall.
   */
  copies: new Map<string, number>([
    ['ASH_048', 3], // Imperial Armored Commando: 4 cost, 4/3 ground, Sentinel + Shielded
    ['ASH_029', 3], // Scorpenek Annihilator Droid: 6 cost, 5/5 ground, Overwhelm + Sentinel + Shielded
    ['ASH_243', 1], // Darth Vader: 5 cost, 4/6 ground, Sentinel + Shielded, Unique
    ['ASH_086', 3], // Durasteel Plating: upgrade, gives a Shield to the attached unit
    ['ASH_089', 2], // Perserverance: event, heal 3 from a unit and give it a Shield
  ]),
}

/**
 * What a deck must hold to be a wall at all.
 *
 * Three Sentinel copies is roughly a four-in-five chance of drawing one across a game, and two
 * re-shields is enough for the lockout to survive being answered once. A combo that cannot reach both
 * is not a weaker wall, it is a deck that will not produce the position, and measuring over it would
 * quietly dilute every rate this set exists to read.
 */
const MIN_SENTINELS = 3
const MIN_RESHIELD = 2

/** One matchup: an ordinary deck trying to find a way through a purpose-built wall. */
export interface DeckPairing {
  /** The seat facing the wall. An unmodified coverage deck, so the pool is still exercised. */
  facing: ParsedDeck
  /** The wall. */
  wall: ParsedDeck
}

const copiesOf = (deck: ParsedDeck, cardId: string): number =>
  deck.cards.find(e => e.id === cardId)?.count ?? 0

const held = (deck: ParsedDeck, ids: string[]): number =>
  ids.reduce((n, cardId) => n + copiesOf(deck, cardId), 0)

/**
 * Every legal wall deck the pool can build, in a stable order.
 *
 * Searched over leader and base rather than named outright, so the set follows the card pool instead
 * of a hardcoded pair that a set rotation would silently invalidate. A combo that cannot hold the
 * package penalty-free simply fails the minimums and is dropped, which is also what makes the empty
 * case detectable rather than a set of zero walls nobody notices.
 */
function buildWallDecks(pool: SwuCard[], seed: number): ParsedDeck[] {
  const byId = new Map(pool.map(c => [id(c), c]))
  const bases = distinctBases(pool)
  const walls: ParsedDeck[] = []

  for (const leader of pool.filter(c => c.Type === 'Leader')) {
    for (const base of bases) {
      const { deck, report } = generateDeck({ leader, base, pool, seed, require: WALL_PACKAGE.copies })
      if (!report.ok) continue
      if (held(deck, WALL_PACKAGE.sentinels) < MIN_SENTINELS) continue
      if (held(deck, WALL_PACKAGE.reshield) < MIN_RESHIELD) continue
      // Re-checked rather than trusted: the forced cards bypass the curve and type caps on the way
      // in, so "the generator said ok" and "this deck is legal" are two different claims here.
      if (deckReport(deck, byId).violations.length > 0) continue
      walls.push(deck)
    }
  }

  if (walls.length === 0) throw new Error('lockout decks: no leader and base can hold the wall package')
  return walls
}

/**
 * The wall deck set: every coverage deck, paired with a wall.
 *
 * Walls are cycled across the coverage decks rather than matched one-to-one, because the archetype is
 * narrow (it needs Vigilance for the re-shields, and Villainy or Command for the Sentinels) while the
 * coverage set is the whole pool. Deterministic from `seed`, or nothing measured over it can be
 * re-read later.
 */
export function buildLockoutDecks(pool: SwuCard[], seed = 1): DeckPairing[] {
  const facing = buildCoverageDecks(pool, seed).decks
  const walls = buildWallDecks(pool, seed)
  return facing.map((deck, i) => ({ facing: deck, wall: walls[i % walls.length] }))
}
