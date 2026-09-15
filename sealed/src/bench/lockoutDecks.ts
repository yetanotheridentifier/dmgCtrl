import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildCoverageDecks } from './coverageDecks'

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
 * intact on the facing side, and gives the wall many different decks to face.
 *
 * **The cost of that choice is that an absolute win rate over this set is meaningless.** The pairing
 * has a favourite before either bot moves. Only a paired difference against a matched control on the
 * same seeds can be read here, and the ordinary coverage set remains the non-inferiority gate.
 *
 * ## The wall
 *
 * **One fixed list, built the way a player would build it**, rather than generated. A generated wall
 * takes its filler from the generator, so it moves whenever the card data or the generator does:
 * correcting one printed cost took a Sentinel out of three generated walls and halved the lockout rate
 * they produced. A list does not drift, so a rate read over it stays comparable between runs.
 *
 * Moff Gideon on a Vigilance base: Imperial Sentinels from the first turn, self-shielding Sentinels
 * in the middle of the curve, and Shields put back by Durasteel Plating, Perserverance and Trexler
 * Armored Marauder, because **duration is the reported defect**. A Shield absorbs one instance of
 * damage and is then spent, so without a way to put it back the wall falls the moment the bot finally
 * strips it and the bench reads a one-round lockout it can dismiss as noise.
 *
 * It is held to the generator's own legality, curve, type and rarity rules (`deckReport`), so it is a
 * deck someone would play rather than a pile assembled to prove a point.
 */
export const WALL_DECK: ParsedDeck = {
  name: 'Wall: Moff Gideon (Vigilance)',
  leader: 'ASH_008', // Moff Gideon, Indomitable Warlord: Command, Villainy
  base: 'ASH_020', // Nevarro City, Restored: Vigilance
  cards: [
    { id: 'ASH_117', count: 2 }, // Outland Protector: 1 cost, Imperial space Sentinel
    { id: 'ASH_069', count: 1 }, // Noti Nomad: 1 cost, Shielded
    { id: 'ASH_239', count: 3 }, // Imperial Loyalist: 2 cost, Imperial Sentinel
    { id: 'ASH_073', count: 2 }, // Palace Chef Droid: 2 cost, Sentinel, +2/+0 while defending
    { id: 'ASH_093', count: 1 }, // Captain Pellaeon: 2 cost, Imperial
    { id: 'ASH_097', count: 3 }, // Moff Gideon, Remnant Commander: 3 cost, Sentinel, recurs an Imperial
    { id: 'ASH_096', count: 2 }, // Forest Patroller: 3 cost, Overwhelm, Restore 1
    { id: 'ASH_048', count: 3 }, // Imperial Armored Commando: 4 cost, Sentinel, Shielded
    { id: 'ASH_243', count: 1 }, // Darth Vader, Meet Your Destiny: 5 cost, Shielded, Sentinel while ready
    { id: 'ASH_099', count: 1 }, // Gozanti Assault Carrier: 5 cost, space Sentinel on attack
    { id: 'ASH_029', count: 2 }, // Scorpenek Annihilator Droid: 6 cost, Sentinel, Shielded, Overwhelm
    { id: 'ASH_082', count: 2 }, // Trexler Armored Marauder: 6 cost, gives a Shield to a unit costing 3 or less
    { id: 'ASH_101', count: 1 }, // The Great Mothers: 7 cost
    { id: 'ASH_133', count: 1 }, // Trask Walker: 8 cost, recurs a unit from the discard pile
    { id: 'ASH_086', count: 3 }, // Durasteel Plating: upgrade, gives a Shield
    { id: 'ASH_089', count: 2 }, // Perserverance: event, heal 3 and give a Shield
  ],
}

/** One matchup: an ordinary deck trying to find a way through a purpose-built wall. */
export interface DeckPairing {
  /** The seat facing the wall. An unmodified coverage deck, so the pool is still exercised. */
  facing: ParsedDeck
  /** The wall. */
  wall: ParsedDeck
}

/**
 * The wall deck set: every coverage deck, each paired with the wall. Deterministic from `seed`, which
 * chooses the coverage decks; the wall is the same in every pairing.
 */
export function buildLockoutDecks(pool: SwuCard[], seed = 1): DeckPairing[] {
  return buildCoverageDecks(pool, seed).decks.map(facing => ({ facing, wall: WALL_DECK }))
}
