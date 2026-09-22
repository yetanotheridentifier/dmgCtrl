import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { cardTraits, unitTraits, unitHasTrait } from '../engine/keywords'
import { giveToken, giveTokens, createTokenUnit } from '../engine/effects'
import { TOKEN_SHIELD, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { TOKEN_BEAST } from '../engine/tokenUnits'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The one-off cards whose mechanic no other card shares, and the three engine additions they needed.
 *
 * - **Card-level traits** (`cardTraits`): every trait read over a card, in play or not, goes through
 *   one function, so a trait a card grants itself off-board (Zam Wesell) and a trait an effect has
 *   taken off a player's cards for the phase (The First Legion) are both seen wherever traits matter.
 * - **Token upgrades given this phase** (`tokenUpgradeGiven`): distinct from `tokensCreated`, which
 *   also counts token units and credits the unit's controller rather than the player who gave it.
 * - **Play a unit and defeat it** (`thenDefeatIt`): the defeat lands between collecting the play's
 *   triggers and draining them, which is what "When Played abilities resolve after the unit is
 *   defeated" means.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = ['HMW_005', 'HMW_016', 'HMW_108', 'HMW_134']

const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = poolFor([set]).find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  REBEL: src('REBEL', { traits: ['REBEL'] }),
  REBEL2: src('REBEL2', { traits: ['REBEL', 'TROOPER'] }),
  SPY: src('SPY', { traits: ['SPY'] }),
  CHEAP: src('CHEAP', { cost: 1, power: 1, hp: 1 }),
  // A hand unit with a When Played that would be visible on the board if it resolved before the defeat.
  SHIELDED_WP: src('SHIELDED_WP', { cost: 3, keywords: [{ name: 'Shielded' }] }),
  // Leaders whose traits Zam Wesell copies.
  FORCE_L: card({ id: 'FORCE_L', type: 'leader', cost: 5, power: 4, hp: 7, traits: ['FORCE', 'JEDI'] }),
  PLAIN_L: card({ id: 'PLAIN_L', type: 'leader', cost: 5, power: 4, hp: 7, traits: ['REBEL'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)!

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })

const moves = (s: GameState): Action[] => legalMoves(s)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId; traitName?: string }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const leaderUsable = (s: GameState) => moves(s).some(m => m.type === 'useLeaderAbility')
const useFront = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const traitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.traitName ? [m.traitName] : [])))]

describe('one-off cards: registration', () => {
  it('registers a definition for each card this batch ships', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
  })

  it('gives Maul and Jar Jar a leader-side action, which is the half that was missing', () => {
    for (const id of ['HMW_005', 'HMW_016']) {
      expect(getCardDefinition(id)?.leaderAbilities?.actions ?? [], id).toHaveLength(1)
    }
  })
})

describe('HMW_134 Zam Wesell: traits copied from the friendly leader, in play or not', () => {
  const zam = (leaderCardId: string, over: Side = {}) =>
    board({ leader: undeployed(leaderCardId), units: [unit('z1', 'HMW_134')], ...over })

  it('gains the undeployed leader\'s Traits while she is in play', () => {
    const s = zam('PLAIN_L')
    expect(unitHasTrait(s, U(s, 'z1'), 'Rebel')).toBe(true)
    // Printed traits are kept alongside the copied ones.
    expect(unitHasTrait(s, U(s, 'z1'), 'Bounty Hunter')).toBe(true)
  })

  it('leaves Force behind, which is the exception the card prints', () => {
    const s = zam('FORCE_L')
    expect(unitHasTrait(s, U(s, 'z1'), 'Jedi')).toBe(true)
    expect(unitHasTrait(s, U(s, 'z1'), 'Force')).toBe(false)
  })

  it('takes the leader\'s Traits from the deployed leader unit once it is on the board', () => {
    const s = board({
      leader: { cardId: 'PLAIN_L', deployed: true, epicActionUsed: true, exhausted: false },
      units: [unit('L', 'PLAIN_L', { isLeader: true }), unit('z1', 'HMW_134')],
    })
    expect(unitHasTrait(s, U(s, 'z1'), 'Rebel')).toBe(true)
  })

  it('has the copied Traits while she is in hand, deck or discard', () => {
    const s = zam('PLAIN_L', { units: [], hand: ['HMW_134'], discard: ['HMW_134'] })
    expect(cardTraits(s, 'HMW_134', 'player').map(t => t.toLowerCase())).toContain('rebel')
    // The copy is the controller's leader, so the opponent's copy of her reads their leader instead.
    expect(cardTraits(s, 'HMW_134', 'opponent').map(t => t.toLowerCase())).not.toContain('rebel')
  })

  it('copies nothing that is not there: a leader with no Traits leaves her printed set alone', () => {
    const s = zam('TST_L')
    expect(unitTraits(s, U(s, 'z1')).map(t => t.toLowerCase()).sort()).toEqual(['bounty hunter', 'underworld'])
  })
})

describe('HMW_108 The First Legion: enemy cards lose a named Trait for the phase', () => {
  const legion = (over: Side = {}, theirs: Side = {}) =>
    board({ units: [unit('a1', 'HMW_108')], ...over }, theirs)

  it('raises a name-a-Trait choice on attack, offering the Traits in the game', () => {
    const s = attack(legion({}, { units: [unit('e1', 'REBEL')] }), 'a1')
    expect(choice(s).kind).toBe('nameTrait')
    // The offers carry the card data's own casing, and each Trait appears once.
    expect(traitOffers(s).map(t => t.toLowerCase())).toContain('rebel')
    expect(traitOffers(s)).toHaveLength(new Set(traitOffers(s).map(t => t.toLowerCase())).size)
    // Naming is mandatory: the card has no "may".
    expect(declinable(s)).toBe(false)
  })

  it('takes the named Trait off enemy units in play and leaves friendly ones alone', () => {
    let s = legion({ units: [unit('a1', 'HMW_108'), unit('a2', 'REBEL')] }, { units: [unit('e1', 'REBEL')] })
    s = accept(attack(s, 'a1'), { traitName: 'Rebel' })
    expect(unitHasTrait(s, U(s, 'e1'), 'Rebel')).toBe(false)
    expect(unitHasTrait(s, U(s, 'a2'), 'Rebel')).toBe(true)
  })

  it('takes it off enemy cards that are not in play, which is the half the card spells out', () => {
    let s = legion({}, { units: [unit('e1', 'GRD')], hand: ['REBEL'], deck: ['REBEL2'], discard: ['REBEL'] })
    s = accept(attack(s, 'a1'), { traitName: 'Rebel' })
    expect(cardTraits(s, 'REBEL', 'opponent')).toHaveLength(0)
    // Only the named Trait goes: REBEL2's other trait stays.
    expect(cardTraits(s, 'REBEL2', 'opponent').map(t => t.toLowerCase())).toEqual(['trooper'])
    // The same card id in the player's own zones is untouched.
    expect(cardTraits(s, 'REBEL', 'player').map(t => t.toLowerCase())).toEqual(['rebel'])
  })

  it('lasts the phase and no longer', () => {
    let s = legion({}, { units: [unit('e1', 'REBEL')] })
    s = accept(attack(s, 'a1'), { traitName: 'Rebel' })
    expect(unitHasTrait(s, U(s, 'e1'), 'Rebel')).toBe(false)
    // Both players pass: the action phase ends and the regroup phase clears the phase's effects.
    s = resolve(resolve({ ...s, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(unitHasTrait(s, U(s, 'e1'), 'Rebel')).toBe(true)
  })
})

describe('HMW_005 Jar Jar Binks: "if you gave a token upgrade to a unit this phase"', () => {
  const jarJar = (mine: Side = {}, theirs: Side = {}) =>
    board({ leader: undeployed('HMW_005'), units: [unit('a1', 'GRD')], ...mine }, { units: [unit('e1', 'GRD')], ...theirs })

  it('leaves the front action unusable until a token upgrade has been given', () => {
    expect(leaderUsable(jarJar())).toBe(false)
    expect(leaderUsable(giveToken(jarJar(), 'a1', TOKEN_SHIELD))).toBe(true)
  })

  it('does not count a token UNIT being created, which `tokensCreated` does', () => {
    const s = createTokenUnit(jarJar(), 'player', TOKEN_BEAST)
    expect(s.phaseEvents?.tokensCreated ?? []).toContain('player')
    expect(leaderUsable(s)).toBe(false)
  })

  it('credits the player who gave the token, not the controller of the unit it landed on', () => {
    // The opponent gives a token to their own unit: that is not "you gave" for Jar Jar's player.
    expect(leaderUsable(giveToken(jarJar(), 'e1', TOKEN_SHIELD))).toBe(false)
    // Jar Jar's player gives one to an ENEMY unit: the card says "a unit", not "a friendly unit".
    expect(leaderUsable(giveTokens(jarJar(), 'e1', TOKEN_EXPERIENCE, 1, 'player'))).toBe(true)
  })

  it('deals 1 damage to a unit and heals 1 from the base, for a resource and an exhaust', () => {
    let s = giveToken(jarJar({ base: { cardId: 'TST_B', damage: 5 }, resources: ready(3) }), 'a1', TOKEN_SHIELD)
    s = useFront(s)
    expect(choice(s).kind).toBe('selectDamageTarget')
    s = accept(s, { targetInstanceId: 'e1' })
    expect(U(s, 'e1').damage).toBe(1)
    expect(s.players.player.base.damage).toBe(4)
    expect(s.players.player.leader.exhausted).toBe(true)
    expect(s.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('forgets the gift at the phase boundary', () => {
    let s = giveToken(jarJar(), 'a1', TOKEN_SHIELD)
    expect(leaderUsable(s)).toBe(true)
    s = resolve(resolve({ ...s, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(leaderUsable({ ...s, phase: 'action', activePlayer: 'player' })).toBe(false)
  })

  it('offers the deployed side\'s On Attack only under the same condition, and it may be declined', () => {
    const deployed = board({
      leader: { cardId: 'HMW_005', deployed: true, epicActionUsed: true, exhausted: false },
      units: [unit('L', 'HMW_005', { isLeader: true })],
    }, { units: [unit('e1', 'GRD')] })
    // No gift this phase: attacking raises nothing.
    expect(attack(deployed, 'L', 'e1').pendingChoices ?? []).toHaveLength(0)
    const given = giveToken(deployed, 'L', TOKEN_SHIELD)
    const s = attack(given, 'L', 'e1')
    expect(choice(s).kind).toBe('selectDamageTarget')
    expect(declinable(s)).toBe(true)
    expect(skip(s).players.player.base.damage).toBe(0)
  })
})

describe('HMW_016 Maul (front): play a unit from hand, 1 less, then defeat it', () => {
  const maul = (hand: string[], mine: Side = {}) =>
    board({ leader: undeployed('HMW_016'), hand, ...mine })

  it('offers the hand units at one resource less than printed', () => {
    // GRD costs 2, so two ready resources is one more than it needs and three is plenty; with one
    // ready resource the discounted cost of 1 is still affordable.
    const s = maul(['GRD'], { resources: ready(1) })
    expect(leaderUsable(s)).toBe(true)
    expect(leaderUsable(maul(['GRD'], { resources: [] }))).toBe(false)
  })

  it('puts the unit into play, then defeats it, leaving the card in the discard', () => {
    let s = useFront(maul(['GRD'], { resources: ready(4) }))
    expect(choice(s).kind).toBe('playUnitFromHand')
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.units).toHaveLength(0)
    expect(s.players.player.discard).toEqual(['GRD'])
    // One resource less than the printed cost of 2.
    expect(s.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('resolves the unit\'s When Played after the defeat, so what it does to itself is lost', () => {
    // Shielded gives the unit a Shield token as it enters; the unit is gone by the time anything
    // could read it, and the Shield goes with it rather than staying on the board.
    let s = useFront(maul(['SHIELDED_WP'], { resources: ready(4) }))
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.units).toHaveLength(0)
    expect(s.players.player.discard).toEqual(['SHIELDED_WP'])
  })

  it('is exhausted by the action and cannot be taken twice in a turn', () => {
    let s = useFront(maul(['GRD', 'CHEAP'], { resources: ready(4) }))
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.leader.exhausted).toBe(true)
    expect(leaderUsable({ ...s, activePlayer: 'player' })).toBe(false)
  })
})
