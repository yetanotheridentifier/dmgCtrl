import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower } from '../engine/stats'
import { reprintCanonicalId } from '../data/reprints'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * The When Played units and upgrades #454 left out, in the three groups this batch takes whole:
 *
 * - **Deck searches** (14): "search the top N for X, reveal it, and draw it", and the three that
 *   play what they find. Four also carry a constant ability, which is asserted here too, because
 *   shipping half a card would count it as implemented.
 * - **Hands and named cards** (6): looking at a hand, discarding from it under a filter or at
 *   random, and naming a card for a prohibition or a cost increase.
 * - **Resources** (4): putting the top card of the deck into play as a resource, and Leia's
 *   choice between readying a resource and exhausting a unit.
 *
 * Each ability runs directly from its source (the unit itself, or for an upgrade the unit it is
 * attached to), so a table can state per card what it looks at, what qualifies, and whether the
 * card's "may" lets it be declined. A search moves cards between zones, so the tests that answer
 * one also assert **card conservation**: nothing may be duplicated or silently deleted, which is
 * the failure mode that has bitten this code before (a search that left its window in the deck
 * duplicated it; one with no skip branch deleted up to 8 cards).
 */

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 5, power: 2, hp: 6, ...over })
const upg = (id: string) => card({ id, type: 'upgrade', cost: 2, power: 0, hp: 0 })
const deckUnit = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 3, power: 2, hp: 3, ...over })
const deckEvent = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'event', cost: 3, ...over })

const F = {
  ...CARDS,
  // Board furniture.
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  HERO: card({ id: 'HERO', arena: 'ground', cost: 2, power: 2, hp: 5, aspects: ['Heroism'] }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),

  // Deck fodder. The trait spellings match the card data, which is upper case.
  D_FILL: deckUnit('D_FILL'),
  D_FILL2: deckUnit('D_FILL2'),
  D_UW: deckUnit('D_UW', { traits: ['UNDERWORLD'] }),
  D_BH: deckUnit('D_BH', { traits: ['BOUNTY HUNTER'] }),
  D_HERO: deckUnit('D_HERO', { aspects: ['Heroism'] }),
  D_GAMBIT: deckEvent('D_GAMBIT', { traits: ['GAMBIT'] }),
  D_LAW: deckEvent('D_LAW', { traits: ['LAW'] }),
  D_CLONE: deckUnit('D_CLONE', { traits: ['CLONE'] }),
  D_REBEL: deckUnit('D_REBEL', { traits: ['REBEL'] }),
  D_IMP1: deckUnit('D_IMP1', { traits: ['IMPERIAL'] }),
  D_IMP2: deckUnit('D_IMP2', { traits: ['IMPERIAL'] }),
  D_TRICK: deckEvent('D_TRICK', { traits: ['TRICK'] }),
  D_UPG: card({ id: 'D_UPG', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  D_DROID2: deckUnit('D_DROID2', { traits: ['DROID'], cost: 2 }),
  D_DROID3: deckUnit('D_DROID3', { traits: ['DROID'], cost: 3 }),
  D_DROID6: deckUnit('D_DROID6', { traits: ['DROID'], cost: 6 }),
  D_VILL2: deckUnit('D_VILL2', { aspects: ['Villainy'], cost: 2 }),
  D_VILL1: deckUnit('D_VILL1', { aspects: ['Villainy'], cost: 1 }),
  D_UNIT5: deckUnit('D_UNIT5', { cost: 5 }),
  D_UNIT9: deckUnit('D_UNIT9', { cost: 9 }),
  // Cost fixtures for the constant abilities: a Gambit card, a Trick event and a Clone unit whose
  // aspects the test player's leader and base do NOT provide, so the penalty is visible.
  C_GAMBIT: deckEvent('C_GAMBIT', { traits: ['GAMBIT'], cost: 3 }),
  C_TRICK: deckEvent('C_TRICK', { traits: ['TRICK'], cost: 3 }),
  C_CLONE: deckUnit('C_CLONE', { traits: ['CLONE'], cost: 3, aspects: ['Cunning'] }),
  C_PLAIN: deckUnit('C_PLAIN', { cost: 3, aspects: ['Cunning'] }),

  // Deck searches
  LAW_145: src('LAW_145'), LAW_136: src('LAW_136'), LAW_138: src('LAW_138'), LAW_229: src('LAW_229'),
  SEC_112: src('SEC_112'), LOF_122: upg('LOF_122'), SHD_245: src('SHD_245'), SHD_198: src('SHD_198'),
  SOR_084: src('SOR_084'), SOR_181: src('SOR_181'), SOR_096: src('SOR_096'), LOF_100: src('LOF_100'),
  LAW_063: src('LAW_063'), SOR_087: src('SOR_087'),

  // Hands and named cards
  SEC_239: src('SEC_239'), SOR_228: src('SOR_228'), SOR_201: src('SOR_201'), SOR_190: src('SOR_190'),
  SHD_202: src('SHD_202'), SOR_062: src('SOR_062'),

  // Resources
  LAW_083: src('LAW_083'), JTL_164: src('JTL_164'), JTL_119: src('JTL_119'), SOR_189: src('SOR_189'),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)

const board = (mine: UnitState[], theirs: UnitState[] = [], over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ units: mine, resources: ready(6), deck: [], hand: [] }),
      opponent: player({ units: theirs, resources: ready(3), deck: ['D_FILL', 'D_FILL2'], hand: [] }),
    },
    ...over,
  })
const withDeck = (s: GameState, deck: string[], who: PlayerId = 'player'): GameState =>
  ({ ...s, players: { ...s.players, [who]: { ...s.players[who], deck } } })
const withHand = (s: GameState, hand: string[], who: PlayerId = 'player'): GameState =>
  ({ ...s, players: { ...s.players, [who]: { ...s.players[who], hand } } })

const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})
const played = (...cardIds: string[]) => ({ phaseEvents: phaseEvents({ played: { player: cardIds, opponent: [] } }) })

/** Run `cardId`'s When Played as the player, sourced from `host` (the unit itself, or an upgrade's host). */
const fire = (s: GameState, cardId: string, host = 'src'): GameState => {
  const ability = getCardDefinition(cardId)?.abilities?.find(a => a.trigger === 'whenPlayed')
  if (!ability) throw new Error(`${cardId} has no When Played ability`)
  return ability.effect(s, { owner: 'player', cardId, sourceInstanceId: host })
}
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices ?? [], 'a choice is raised').toHaveLength(1)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const accept = (s: GameState, extra: { targetInstanceId?: string; deckIndex?: number; optionIndex?: number; handIndex?: number; cardName?: string } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })

/** Every card the player can account for: deck + hand + discard + resources + cards on the board. */
const cardCount = (s: GameState, who: PlayerId = 'player'): number => {
  const p = s.players[who]
  return p.deck.length + p.hand.length + p.discard.length + p.resources.length + p.units.length
}
const revealedOf = (c: PendingChoice): string[] => ('revealed' in c ? c.revealed : [])
const eligibleOf = (c: PendingChoice): number[] => ('eligibleIndices' in c ? c.eligibleIndices : [])

// ── Deck searches ───────────────────────────────────────────────────────────────────────────────

describe('searches that reveal a card and draw it', () => {
  // A friendly Heroism unit, so R2-D2's "shares an aspect with a friendly unit" has something to match.
  const s = (id: string, deck: string[]) => withDeck(board([unit('src', id), unit('a', 'HERO')]), deck)

  // The deck is longer than every window here, so `revealed` is exactly the depth the card prints.
  const DECK = [
    'D_UW', 'D_BH', 'D_HERO', 'D_GAMBIT', 'D_LAW', 'D_CLONE', 'D_REBEL', 'D_IMP1',
    'D_TRICK', 'D_UPG', 'D_FILL', 'D_FILL2',
  ]

  it.each([
    ['LAW_136', 'Syndicate Spice Runner: top 3 for an Underworld unit', 3, ['D_UW']],
    ['LAW_138', 'Undercity Hunting Team: top 5 for a Bounty Hunter unit', 5, ['D_BH']],
    ['LAW_145', 'R2-D2: top 5 for a unit sharing an aspect with a friendly unit', 5, ['D_HERO']],
    ['LAW_229', 'The Master Codebreaker: top 8 for a Gambit card', 8, ['D_GAMBIT']],
    ['SEC_112', 'Orn Free Taa: top 10 for a Law card', 10, ['D_LAW']],
    ['SHD_198', 'Omega: top 5 for a Clone card', 5, []],
    ['SOR_096', 'Mon Mothma: top 5 for a Rebel card', 5, []],
    ['SOR_181', 'Jabba the Hutt: top 8 for a Trick event', 8, []],
    ['SHD_245', 'Greef Karga: top 5 for an upgrade', 5, []],
  ])('%s %s', (id, _label, depth, eligible) => {
    const fired = fire(s(id, DECK), id)
    const c = choice(fired)
    expect(c.kind).toBe('searchDraw')
    expect(revealedOf(c)).toEqual(DECK.slice(0, depth))
    expect(eligibleOf(c).map(i => revealedOf(c)[i])).toEqual(eligible)
  })

  it('Pillio Star Compass (LOF_122) searches the top 3 for a unit from its host', () => {
    const fired = fire(withDeck(board([unit('src', 'GRD')]), DECK), 'LOF_122')
    const c = choice(fired)
    expect(c.kind).toBe('searchDraw')
    expect(revealedOf(c)).toEqual(DECK.slice(0, 3))
    // D_UW and D_BH are units; D_HERO is too. All three qualify for a bare "a unit".
    expect(eligibleOf(c)).toEqual([0, 1, 2])
  })

  it('draws the chosen card and bottoms the rest, keeping every card', () => {
    const before = s('LAW_136', DECK)
    const fired = fire(before, 'LAW_136')
    const after = accept(fired, { deckIndex: 0 })
    expect(after.players.player.hand).toEqual(['D_UW'])
    // The two it passed over go to the bottom, in the order revealed; the rest is untouched.
    expect(after.players.player.deck).toEqual([...DECK.slice(3), 'D_BH', 'D_HERO'])
    expect(cardCount(after)).toBe(cardCount(before))
  })

  it('still reveals when nothing matches, and acknowledging bottoms them', () => {
    const before = s('LAW_136', ['D_FILL', 'D_FILL2', 'D_REBEL', 'D_UW'])
    const fired = fire(before, 'LAW_136')
    expect(eligibleOf(choice(fired))).toEqual([])
    expect(declinable(fired), 'the only move is to acknowledge the reveal').toBe(true)
    const after = skip(fired)
    expect(after.players.player.hand).toEqual([])
    expect(after.players.player.deck).toEqual(['D_UW', 'D_FILL', 'D_FILL2', 'D_REBEL'])
    expect(cardCount(after)).toBe(cardCount(before))
  })

  it('a search cannot be declined while something matches', () => {
    expect(declinable(fire(s('LAW_136', DECK), 'LAW_136'))).toBe(false)
  })

  it('raises nothing on an empty deck', () => {
    noChoice(fire(s('LAW_136', []), 'LAW_136'))
  })

  it('reveals only what is there when the deck is shorter than the window', () => {
    const c = choice(fire(s('SEC_112', ['D_LAW', 'D_FILL']), 'SEC_112'))
    expect(revealedOf(c)).toEqual(['D_LAW', 'D_FILL'])
  })
})

describe('Grand Moff Tarkin (SOR_084): up to 2 Imperial units', () => {
  const DECK = ['D_IMP1', 'D_IMP2', 'D_FILL', 'D_FILL2', 'D_REBEL', 'D_UW']
  const before = () => withDeck(board([unit('src', 'SOR_084')]), DECK)

  it('offers both Imperial units from the top 5', () => {
    const c = choice(fire(before(), 'SOR_084'))
    expect(c.kind).toBe('searchDraw')
    expect(revealedOf(c)).toEqual(DECK.slice(0, 5))
    expect(eligibleOf(c).map(i => revealedOf(c)[i])).toEqual(['D_IMP1', 'D_IMP2'])
  })

  it('re-offers the second draw after the first, then bottoms the rest', () => {
    const start = before()
    const one = accept(fire(start, 'SOR_084'), { deckIndex: 0 })
    expect(one.players.player.hand).toEqual(['D_IMP1'])
    const again = choice(one)
    expect(again.kind, 'the second of the two draws').toBe('searchDraw')
    expect(eligibleOf(again).map(i => revealedOf(again)[i])).toEqual(['D_IMP2'])
    const two = accept(one, { deckIndex: eligibleOf(again)[0] })
    expect(two.players.player.hand).toEqual(['D_IMP1', 'D_IMP2'])
    expect(two.pendingChoices ?? [], 'two is the limit').toHaveLength(0)
    expect(cardCount(two)).toBe(cardCount(start))
  })

  it('"up to" lets the second draw be declined, and the held cards go back', () => {
    const start = before()
    const one = accept(fire(start, 'SOR_084'), { deckIndex: 0 })
    expect(declinable(one), '"up to 2" may stop at one (CR 8.30.1)').toBe(true)
    const stopped = skip(one)
    expect(stopped.players.player.hand).toEqual(['D_IMP1'])
    expect(cardCount(stopped)).toBe(cardCount(start))
    // Nothing revealed may be lost: the four it did not take are still in the deck.
    for (const id of ['D_IMP2', 'D_FILL', 'D_FILL2', 'D_REBEL']) {
      expect(stopped.players.player.deck, id).toContain(id)
    }
  })

  it('"up to 2" may take none at all, and the whole window goes back', () => {
    // "Up to N" stops at any point, including before the first draw (CR 8.30.1). That is what
    // separates it from a plain search, which is mandatory while anything matches, and from a
    // "you may", which declines only before the first pick.
    const start = before()
    const fired = fire(start, 'SOR_084')
    expect(declinable(fired)).toBe(true)
    const none = skip(fired)
    expect(none.players.player.hand).toEqual([])
    expect(cardCount(none)).toBe(cardCount(start))
  })

  it('stops at one when only one Imperial unit is in the window', () => {
    const start = withDeck(board([unit('src', 'SOR_084')]), ['D_IMP1', 'D_FILL', 'D_FILL2'])
    const one = accept(fire(start, 'SOR_084'), { deckIndex: 0 })
    expect(one.pendingChoices ?? [], 'nothing left to draw').toHaveLength(0)
    expect(cardCount(one)).toBe(cardCount(start))
  })
})

describe('searches that play what they find', () => {
  it('L3-37 (LAW_063): any number of Droid units with combined cost 5 or less, free', () => {
    const start = withDeck(board([unit('src', 'LAW_063')]), ['D_DROID2', 'D_DROID3', 'D_DROID6', 'D_FILL'])
    const fired = fire(start, 'LAW_063')
    const c = choice(fired)
    expect(c.kind).toBe('searchPlayFree')
    // The 6-cost Droid is over budget and the filler is not a Droid.
    expect(eligibleOf(c).map(i => revealedOf(c)[i])).toEqual(['D_DROID2', 'D_DROID3'])
    const after = accept(fired, { deckIndex: 0 })
    expect(after.players.player.units.some(u => u.cardId === 'D_DROID2'), 'it entered play').toBe(true)
    expect(after.players.player.resources.every(r => !r.exhausted), 'played for free').toBe(true)
    // 5 - 2 = 3 left, so the 3-cost Droid is still on offer.
    expect(eligibleOf(choice(after)).map(i => revealedOf(choice(after))[i])).toEqual(['D_DROID3'])
  })

  it('Darth Vader (SOR_087): Villainy units with combined cost 3 or less', () => {
    const start = withDeck(board([unit('src', 'SOR_087')]), ['D_VILL2', 'D_VILL1', 'D_DROID6', 'D_FILL'])
    const c = choice(fire(start, 'SOR_087'))
    expect(c.kind).toBe('searchPlayFree')
    expect(eligibleOf(c).map(i => revealedOf(c)[i])).toEqual(['D_VILL2', 'D_VILL1'])
  })

  it('the play-free search filters by its own card, not Ackbar’s space units', () => {
    // Every eligible card here is a GROUND Droid: a filter hardcoded to space would offer nothing.
    const start = withDeck(board([unit('src', 'LAW_063')]), ['D_DROID2', 'D_FILL'])
    expect(eligibleOf(choice(fire(start, 'LAW_063')))).toEqual([0])
  })

  it('stopping returns the held cards to the deck', () => {
    const start = withDeck(board([unit('src', 'LAW_063')]), ['D_DROID2', 'D_FILL'])
    const stopped = skip(fire(start, 'LAW_063'))
    expect(cardCount(stopped)).toBe(cardCount(start))
    expect(stopped.players.player.deck).toContain('D_DROID2')
    expect(stopped.players.player.deck).toContain('D_FILL')
  })

  it('Kelleran Beq (LOF_100): plays a unit from the top 7 for 3 less, and pays', () => {
    const start = withDeck(board([unit('src', 'LOF_100')]), ['D_UNIT5', 'D_FILL'])
    const fired = fire(start, 'LOF_100')
    const c = choice(fired)
    expect(c.kind).toBe('searchPlayFree')
    expect(eligibleOf(c).map(i => revealedOf(c)[i])).toEqual(['D_UNIT5', 'D_FILL'])
    const after = accept(fired, { deckIndex: 0 })
    expect(after.players.player.units.some(u => u.cardId === 'D_UNIT5')).toBe(true)
    // 5 - 3 = 2 paid out of 6 ready resources.
    expect(after.players.player.resources.filter(r => r.exhausted)).toHaveLength(2)
    expect(after.pendingChoices ?? [], 'exactly one unit').toHaveLength(0)
    expect(cardCount(after)).toBe(cardCount(start))
  })

  it('Kelleran Beq offers only what the player can still afford', () => {
    // 9 - 3 = 6, with only 4 ready resources left.
    const start = withDeck(state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'LOF_100')], resources: ready(4), deck: [] }),
        opponent: player({}),
      },
    }), ['D_UNIT9', 'D_UNIT5'])
    expect(eligibleOf(choice(fire(start, 'LOF_100'))).map(i => ['D_UNIT9', 'D_UNIT5'][i])).toEqual(['D_UNIT5'])
  })
})

describe('the constant abilities the search cards also carry', () => {
  const withUnit = (id: string, over: Partial<GameState> = {}) => ({ ...board([unit('src', id)]), ...over })

  it('The Master Codebreaker (LAW_229): the first Gambit card each phase costs 1 less', () => {
    const s = withUnit('LAW_229')
    expect(effectiveCost(s, 'player', F.C_GAMBIT)).toBe(2)
    // A second one is full price.
    expect(effectiveCost({ ...s, ...played('C_GAMBIT') }, 'player', F.C_GAMBIT)).toBe(3)
    // Only Gambit cards.
    expect(effectiveCost(s, 'player', F.C_TRICK)).toBe(3)
  })

  it('Jabba the Hutt (SOR_181): every Trick event costs 1 less', () => {
    const s = withUnit('SOR_181')
    expect(effectiveCost(s, 'player', F.C_TRICK)).toBe(2)
    // No once-per-phase limit on this one.
    expect(effectiveCost({ ...s, ...played('C_TRICK') }, 'player', F.C_TRICK)).toBe(2)
    expect(effectiveCost(s, 'player', F.C_GAMBIT)).toBe(3)
  })

  it('Orn Free Taa (SEC_112): +1/+0 for each Law card in your discard pile', () => {
    const base = board([unit('src', 'SEC_112')])
    expect(effectivePower(base, U(base, 'src')!)).toBe(2)
    const stocked = { ...base, players: { ...base.players, player: { ...base.players.player, discard: ['D_LAW', 'D_LAW', 'D_FILL'] } } }
    expect(effectivePower(stocked, U(stocked, 'src')!)).toBe(4)
  })

  it('Omega (SHD_198): the first Clone unit each phase ignores the aspect penalty', () => {
    const s = withUnit('SHD_198')
    // The test leader and base provide Command, Heroism and Vigilance, so a Cunning icon is unpaid.
    expect(effectiveCost(s, 'player', F.C_PLAIN)).toBe(5)
    expect(effectiveCost(s, 'player', F.C_CLONE), 'penalty waived').toBe(3)
    expect(effectiveCost({ ...s, ...played('C_CLONE') }, 'player', F.C_CLONE), 'only the first').toBe(5)
  })
})

// ── Hands and named cards ───────────────────────────────────────────────────────────────────────

describe('looking at a hand', () => {
  const theirHand = ['D_FILL', 'D_GAMBIT', 'D_UPG']
  const s = (id: string) => withHand(board([unit('src', id)], [unit('e', 'GRD')]), theirHand, 'opponent')

  it('Viper Probe Droid (SEC_239) looks at the opponent’s hand and nothing else', () => {
    const c = choice(fire(s('SEC_239'), 'SEC_239'))
    expect(c).toMatchObject({ kind: 'lookAtHand', target: 'opponent', controller: 'player' })
    expect('mayDiscard' in c && c.mayDiscard, 'it only looks').toBeFalsy()
  })

  it('SOR_228 is the same card as SEC_239', () => {
    expect(reprintCanonicalId('SOR_228')).toBe('SEC_239')
  })

  it('Bodhi Rook (SOR_201) discards a non-unit card from the hand he looked at', () => {
    const fired = fire(s('SOR_201'), 'SOR_201')
    expect(choice(fired)).toMatchObject({ kind: 'lookAtHand', target: 'opponent', mayDiscard: true })
    // D_FILL is a unit; the Gambit event and the upgrade are not.
    const offered = legalMoves(fired).filter(m => m.type === 'acceptChoice').map(m => m.handIndex)
    expect(offered).toEqual([1, 2])
    expect(declinable(fired), 'the discard is not optional').toBe(false)
    const after = accept(fired, { handIndex: 1 })
    expect(after.players.opponent.hand).toEqual(['D_FILL', 'D_UPG'])
    expect(after.players.opponent.discard).toEqual(['D_GAMBIT'])
  })

  it('Bodhi Rook can still be dismissed when the hand is all units', () => {
    const allUnits = withHand(board([unit('src', 'SOR_201')]), ['D_FILL', 'D_FILL2'], 'opponent')
    const fired = fire(allUnits, 'SOR_201')
    expect(declinable(fired), 'no legal discard, so it must not deadlock').toBe(true)
  })
})

describe('Lothal Insurgent (SOR_190)', () => {
  // Its own play is already recorded when its When Played fires, so "another card" means a second entry.
  const s = (playedIds: string[]) => ({
    ...withDeck(withHand(board([unit('src', 'SOR_190')], [unit('e', 'GRD')]), ['D_UW', 'D_BH'], 'opponent'), ['D_FILL', 'D_FILL2'], 'opponent'),
    phaseEvents: phaseEvents({ played: { player: playedIds, opponent: [] } }),
  })

  it('does nothing when this unit is the only card played this phase', () => {
    const after = fire(s(['SOR_190']), 'SOR_190')
    expect(after.players.opponent.hand).toEqual(['D_UW', 'D_BH'])
    expect(after.players.opponent.discard).toEqual([])
  })

  it('makes the opponent draw then discard at random when another card was played', () => {
    const before = s(['D_FILL', 'SOR_190'])
    const after = fire(before, 'SOR_190')
    expect(after.players.opponent.hand, 'drew one, discarded one').toHaveLength(2)
    expect(after.players.opponent.discard).toHaveLength(1)
    expect(after.players.opponent.deck).toHaveLength(1)
    expect(cardCount(after, 'opponent')).toBe(cardCount(before, 'opponent'))
    // The discard came from the hand it held plus the card just drawn.
    expect(['D_UW', 'D_BH', 'D_FILL']).toContain(after.players.opponent.discard[0])
  })

  it('is deterministic for a given seed', () => {
    const before = s(['D_FILL', 'SOR_190'])
    expect(fire(before, 'SOR_190').players.opponent.discard).toEqual(fire(before, 'SOR_190').players.opponent.discard)
  })

  it('raises no choice: the discard is random, not chosen', () => {
    noChoice(fire(s(['D_FILL', 'SOR_190']), 'SOR_190'))
  })
})

describe('naming a card', () => {
  it('Regional Governor (SOR_062) forbids the named card to the opponent', () => {
    const s = withHand(board([unit('src', 'SOR_062')], [unit('e', 'GRD')]), ['D_UW'], 'opponent')
    // They could play it before it was named, so the prohibition is what stops them below.
    expect(legalMoves({ ...s, activePlayer: 'opponent' as PlayerId }).some(m => m.type === 'playUnit')).toBe(true)
    const fired = fire(s, 'SOR_062')
    expect(choice(fired)).toMatchObject({ kind: 'nameCard', unitId: 'src' })
    const named = accept(fired, { cardName: 'D_UW' })
    expect(U(named, 'src')!.namedCard).toBe('D_UW')
    // The opponent may not play it while the Governor is out.
    const theirTurn = { ...named, activePlayer: 'opponent' as PlayerId }
    expect(legalMoves(theirTurn).some(m => m.type === 'playUnit')).toBe(false)
  })

  it('Qi’ra (SHD_202) looks first, then names a card that costs the opponent 3 more', () => {
    // The opponent is given resources to spare, so the surcharge is what the test reads and not
    // some unrelated shortfall.
    const s = withHand(state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'SHD_202')], resources: ready(6) }),
        opponent: player({ units: [unit('e', 'GRD')], resources: ready(8) }),
      },
    }), ['D_UW'], 'opponent')
    const fired = fire(s, 'SHD_202')
    expect(choice(fired)).toMatchObject({ kind: 'lookAtHand', target: 'opponent' })
    const looked = skip(fired)
    expect(choice(looked), 'the naming follows the look').toMatchObject({ kind: 'nameCard', unitId: 'src' })
    const named = accept(looked, { cardName: 'D_UW' })
    expect(U(named, 'src')!.namedCard).toBe('D_UW')
    expect(effectiveCost(named, 'opponent', F.D_UW)).toBe(F.D_UW.cost + 3)
    // A surcharge is not a prohibition: they may still play it.
    const theirTurn = { ...named, activePlayer: 'opponent' as PlayerId }
    expect(legalMoves(theirTurn).some(m => m.type === 'playUnit')).toBe(true)
    // And it costs the owner nothing extra.
    expect(effectiveCost(named, 'player', F.D_UW)).toBe(F.D_UW.cost)
  })
})

// ── Resources ───────────────────────────────────────────────────────────────────────────────────

describe('resources', () => {
  it('Broken Horn (LAW_083): draws behind on hand, resources behind on resources', () => {
    // Behind on both: three cards to their four, three resources to their four.
    const behind = withDeck(withHand(
      state({
        cards: F,
        players: {
          player: player({ units: [unit('src', 'LAW_083')], resources: ready(3), hand: ['D_FILL'] }),
          opponent: player({ resources: ready(4), hand: ['D_FILL', 'D_FILL2'] }),
        },
      }), ['D_FILL'], 'player'), ['D_UW', 'D_BH'], 'player')
    const after = fire(behind, 'LAW_083')
    expect(after.players.player.hand, 'drew one').toHaveLength(2)
    expect(after.players.player.resources, 'resourced one').toHaveLength(4)
    noChoice(after)
  })

  it('Broken Horn does nothing while ahead on both', () => {
    const ahead = withDeck(state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'LAW_083')], resources: ready(5), hand: ['D_FILL', 'D_FILL2'] }),
        opponent: player({ resources: ready(2), hand: [] }),
      },
    }), ['D_UW'], 'player')
    const after = fire(ahead, 'LAW_083')
    expect(after.players.player.hand).toHaveLength(2)
    expect(after.players.player.resources).toHaveLength(5)
  })

  it('Resupply Carrier (JTL_119) may resource the top card', () => {
    const start = withDeck(board([unit('src', 'JTL_119')]), ['D_UW', 'D_BH'])
    const fired = fire(start, 'JTL_119')
    expect(choice(fired).kind).toBe('mayResourceTop')
    expect(declinable(fired), 'it prints "you may"').toBe(true)
    const after = accept(fired)
    expect(after.players.player.resources).toHaveLength(7)
    expect(after.players.player.deck).toEqual(['D_BH'])
    expect(cardCount(after)).toBe(cardCount(start))
  })

  it('Resupply Carrier raises nothing on an empty deck', () => {
    noChoice(fire(withDeck(board([unit('src', 'JTL_119')]), []), 'JTL_119'))
  })

  it('Cham Syndulla (JTL_164) only offers it while behind on resources', () => {
    const behind = withDeck(state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'JTL_164')], resources: ready(2) }),
        opponent: player({ resources: ready(4) }),
      },
    }), ['D_UW'], 'player')
    expect(choice(fire(behind, 'JTL_164')).kind).toBe('mayResourceTop')

    const level = withDeck(state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'JTL_164')], resources: ready(4) }),
        opponent: player({ resources: ready(4) }),
      },
    }), ['D_UW'], 'player')
    noChoice(fire(level, 'JTL_164'))
  })

  it('Leia Organa (SOR_189): either ready a resource or exhaust a unit', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'SOR_189')], resources: [{ cardId: 'R0', exhausted: true }, { cardId: 'R1', exhausted: false }] }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const fired = fire(s, 'SOR_189')
    const c = choice(fired)
    expect(c).toMatchObject({ kind: 'chooseMode' })
    expect('modes' in c ? c.modes : []).toEqual(['readyResource', 'exhaustUnit'])
    expect(declinable(fired), '"either/or" is a choice, not an option').toBe(false)

    const readied = accept(fired, { optionIndex: 0 })
    expect(readied.players.player.resources.every(r => !r.exhausted)).toBe(true)

    const exhausting = accept(fired, { optionIndex: 1 })
    expect(choice(exhausting).kind).toBe('mayExhaustUnit')
    const done = accept(exhausting, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.exhausted).toBe(true)
  })

  it('Leia offers only the modes that can do something', () => {
    // Every resource ready and no unit but herself: readying is impossible, so only the exhaust remains.
    const noExhausted = state({
      cards: F,
      players: {
        player: player({ units: [unit('src', 'SOR_189')], resources: ready(2) }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const c = choice(fire(noExhausted, 'SOR_189'))
    expect('modes' in c ? c.modes : []).toEqual(['exhaustUnit'])
  })
})
