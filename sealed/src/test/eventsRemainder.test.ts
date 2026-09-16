import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit, defeatUnits } from '../engine/combat'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * The events #453 left out, in the two groups this batch takes whole:
 *
 * - **Defeating several units as one event**: five cards whose wipe has to be ONE event, so the
 *   whenDefeated abilities of everything it kills form a single batch (CR 1.9.10). Looping
 *   `defeatUnit` gives each defeat its own batch instead, which is the defect these guard.
 * - **TS26 and IBH**: the two sets under the 200-card sealed minimum. `--sweep` refuses them, so
 *   these tests are the ONLY coverage those 28 cards have — there is no play-coverage evidence to
 *   fall back on, which is why each card asserts its eligible targets and its effect rather than
 *   just that a choice appeared.
 */

const ev = (id: string, cost: number) => card({ id, type: 'event', cost })
const F = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SPACE: card({ id: 'SPACE', arena: 'space', cost: 3, power: 2, hp: 6 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 6, power: 5, hp: 8 }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 4, power: 2, hp: 20 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),
  CLONE: card({ id: 'CLONE', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['CLONE', 'TROOPER'] }),
  UNIQ: card({ id: 'UNIQ', arena: 'ground', cost: 3, power: 2, hp: 4, unique: true }),
  STRONGP: card({ id: 'STRONGP', arena: 'ground', cost: 5, power: 7, hp: 6 }),
  SENTINEL: card({ id: 'SENTINEL', arena: 'ground', cost: 2, power: 1, hp: 9, keywords: [{ name: 'Sentinel' }] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  // Ant Droid: "When Defeated: Draw a card". A real registered whenDefeated, used to show that a
  // multi-unit defeat is ONE event rather than several.
  ASH_116: card({ id: 'ASH_116', arena: 'ground', cost: 1, power: 1, hp: 2 }),

  // Defeating several units as one event
  LAW_096: ev('LAW_096', 7), LAW_044: ev('LAW_044', 8), SEC_078: ev('SEC_078', 7),
  JTL_080: ev('JTL_080', 9), SOR_043: ev('SOR_043', 8),

  // TS26 and IBH
  TS26_68: ev('TS26_68', 2), TS26_70: ev('TS26_70', 3), TS26_82: ev('TS26_82', 3), TS26_84: ev('TS26_84', 4),
  TS26_72: ev('TS26_72', 5), TS26_56: ev('TS26_56', 2), TS26_33: ev('TS26_33', 3), TS26_81: ev('TS26_81', 2),
  TS26_32: ev('TS26_32', 2), TS26_69: ev('TS26_69', 2), TS26_80: ev('TS26_80', 1), TS26_71: ev('TS26_71', 3),
  TS26_83: ev('TS26_83', 3), TS26_47: ev('TS26_47', 3), TS26_64: ev('TS26_64', 2), TS26_48: ev('TS26_48', 4),
  IBH_18: ev('IBH_18', 1), IBH_74: ev('IBH_74', 2), IBH_5: ev('IBH_5', 3), IBH_9: ev('IBH_9', 2),
  IBH_21: ev('IBH_21', 2), IBH_13: ev('IBH_13', 3), IBH_59: ev('IBH_59', 2), IBH_104: ev('IBH_104', 6),
  IBH_66: ev('IBH_66', 1), IBH_52: ev('IBH_52', 6), IBH_61: ev('IBH_61', 3), IBH_95: ev('IBH_95', 4),
}

/** The fixture helper reads a unit's arena from the shared pool, which does not hold these cards. */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const ids = (s: GameState) => all(s).map(u => u.instanceId).sort()
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState): PendingChoice => s.pendingChoices![0]
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (c: PendingChoice): string[] => {
  const t = 'unitTargets' in c ? c.unitTargets : 'targets' in c ? c.targets : []
  return [...t].sort()
}
const accept = (s: GameState, extra: { targetInstanceId?: string; baseTarget?: PlayerId; optionIndex?: number; handIndex?: number; deckIndex?: number } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const skippable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')

/** Play `eventId` with these boards. */
const board = (eventId: string, mine: UnitState[], theirs: UnitState[], over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich({ hand: [eventId], units: mine }), opponent: player({ units: theirs }) }, ...over })

// ── Defeating several units as one event ────────────────────────────────────────────────────────

describe('events that defeat several units at once', () => {
  it('Superlaser Blast (SOR_043) defeats every unit, leaders included', () => {
    const done = play(board('SOR_043', [unit('a', 'GRD'), unit('L', 'TST_L', { isLeader: true })], [unit('e', 'TOUGH')]))
    expect(all(done)).toHaveLength(0)
    expect(done.players.player.discard).toContain('GRD')
    expect(done.players.opponent.discard).toContain('TOUGH')
  })

  it('Hyperspace Disaster (SEC_078) defeats every space unit and leaves the ground alone', () => {
    const done = play(board('SEC_078', [unit('g', 'GRD'), unit('s', 'SPACE')], [unit('es', 'SPACE'), unit('eg', 'GRD')]))
    expect(ids(done)).toEqual(['eg', 'g'])
  })

  it('Nebula Ignition (JTL_080) defeats each unit that is not upgraded', () => {
    const upgraded = unit('b', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })
    const done = play(board('JTL_080', [unit('a', 'GRD'), upgraded], [unit('e', 'GRD')]))
    expect(ids(done)).toEqual(['b'])
  })

  it('Single Reactor Ignition (LAW_044) defeats all units and damages the enemy base once per enemy unit', () => {
    const done = play(board('LAW_044', [unit('a', 'GRD')], [unit('e1', 'GRD'), unit('e2', 'CHEAP')]))
    expect(all(done)).toHaveLength(0)
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.base.damage).toBe(0)
  })

  it('Rhydonium Detonation (LAW_096) lets each player save a unit first, then wipes the non-leaders', () => {
    const mine = [unit('a', 'GRD'), unit('L', 'TST_L', { isLeader: true })]
    const played = play(board('LAW_096', mine, [unit('b', 'CHEAP'), unit('c', 'BIG')]))
    // The text says "a non-leader unit", not "a non-leader unit you control", and sends it to its
    // OWNER's hand — so either player's unit is a legal save.
    expect(choice(played)).toMatchObject({ kind: 'selectUnitToReturn', controller: 'player', optional: true })
    expect(targetsOf(choice(played))).toEqual(['a', 'b', 'c'])
    const mineSaved = accept(played, { targetInstanceId: 'a' })
    expect(choice(mineSaved)).toMatchObject({ kind: 'selectUnitToReturn', controller: 'opponent', optional: true })
    const done = accept(mineSaved, { targetInstanceId: 'c' })
    expect(ids(done)).toEqual(['L'])
    expect(done.players.player.hand).toContain('GRD')
    expect(done.players.opponent.hand).toContain('BIG')
  })

  it('declining both saves still wipes every non-leader', () => {
    const played = play(board('LAW_096', [unit('a', 'GRD')], [unit('b', 'CHEAP')]))
    expect(ids(skip(skip(played)))).toEqual([])
  })

  /**
   * The point of the primitive, asserted on the primitive rather than through a card. Two Ant Droids
   * on opposite sides defeated together owe their "When Defeated: draw a card" on BOTH sides at once:
   * one batch, and so one CR 7.6.10 question about who resolves first. Defeating them one at a time
   * drains each separately and never asks, which is the defect `defeatUnits` exists to avoid.
   */
  it('defeatUnits makes one batch across both sides; defeating one at a time does not', () => {
    const s = board('SOR_043', [unit('a', 'ASH_116')], [unit('e', 'ASH_116')])

    const together = defeatUnits(s, ['a', 'e'])
    expect((together.pendingTriggers ?? []).map(t => t.controller).sort()).toEqual(['opponent', 'player'])
    expect(choice(together).kind).toBe('chooseTriggerOrder')

    const oneByOne = defeatUnit(defeatUnit(s, 'a'), 'e')
    expect(oneByOne.pendingChoices ?? []).toHaveLength(0)
  })

  it('Superlaser Blast fires the whenDefeated of everything it takes, on both sides', () => {
    const done = play(board('SOR_043', [unit('a', 'ASH_116')], [unit('e', 'ASH_116')]))
    expect(all(done)).toHaveLength(0)
    // Both Ant Droids drew. Played as an event the pair resolve inside the event's own batch, which
    // has already settled whose abilities go first, so no further ordering question is raised.
    expect(done.players.player.hand).toHaveLength(1)
    expect(done.players.opponent.hand).toHaveLength(1)
  })
})

// ── TS26 and IBH ────────────────────────────────────────────────────────────────────────────────

describe('TS26 and IBH: no-target effects', () => {
  it('Arms Deal (TS26_68) draws 2 for both players', () => {
    const done = play(board('TS26_68', [], []))
    expect(done.players.player.hand).toHaveLength(2)
    expect(done.players.opponent.hand).toHaveLength(2)
  })

  it('Galactic Escalation (TS26_56) resources the top card of each deck', () => {
    const done = play(board('TS26_56', [], []))
    expect(done.players.player.resources).toHaveLength(21)
    expect(done.players.opponent.resources).toHaveLength(1)
    expect(done.players.player.deck).toHaveLength(2)
    expect(done.players.opponent.deck).toHaveLength(2)
  })

  it('Urgent Mission (TS26_64) deals 2 to your own base and draws 2', () => {
    const done = play(board('TS26_64', [], []))
    expect(done.players.player.base.damage).toBe(2)
    expect(done.players.opponent.base.damage).toBe(0)
    expect(done.players.player.hand).toHaveLength(2)
  })

  it('Vanquish the Legion (TS26_48) gives each enemy ground unit -2/-2', () => {
    const done = play(board('TS26_48', [unit('a', 'GRD')], [unit('e', 'GRD'), unit('s', 'SPACE'), unit('x', 'FRAIL')]))
    expect(effectivePower(done, U(done, 'e')!)).toBe(0)
    expect(effectivePower(done, U(done, 's')!)).toBe(2)
    expect(effectivePower(done, U(done, 'a')!)).toBe(2)
    expect(U(done, 'x')).toBeUndefined() // -2/-2 takes a 1 HP unit off the board
  })
})

describe('TS26 and IBH: one target', () => {
  it('Go for the Legs (IBH_18) exhausts an enemy ground unit, and must', () => {
    const played = play(board('IBH_18', [unit('a', 'GRD')], [unit('e', 'GRD'), unit('s', 'SPACE')]))
    expect(choice(played).kind).toBe('mayExhaustUnit')
    expect(targetsOf(choice(played))).toEqual(['e'])
    expect(skippable(played)).toBe(false)
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it.each([
    ['IBH_13', 'Recovery', 5],
    ['IBH_66', 'Too Strong for Blasters', 2],
  ])('%s %s heals a unit and no base', (id, _label, amount) => {
    const played = play(board(id, [unit('a', 'GRD', { damage: 5 })], [unit('e', 'GRD', { damage: 5 })]))
    expect(choice(played)).toMatchObject({ kind: 'selectHealTarget', amount, baseTargets: [] })
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(U(accept(played, { targetInstanceId: 'a' }), 'a')!.damage).toBe(Math.max(0, 5 - amount))
  })

  it('Target the Main Generator (IBH_59) deals 2 to a base and never to a unit', () => {
    const played = play(board('IBH_59', [unit('a', 'GRD')], [unit('e', 'GRD')]))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
    expect(accept(played, { baseTarget: 'opponent' }).players.opponent.base.damage).toBe(2)
  })

  it("We're In Trouble (IBH_61) deals 3 to any unit", () => {
    const played = play(board('IBH_61', [unit('a', 'GRD')], [unit('e', 'TOUGH')]))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 3, baseTargets: [] })
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
  })

  it('I Want Proof, Not Leads (IBH_74) draws 2 and then discards one, mandatorily', () => {
    const played = play(board('IBH_74', [], []))
    expect(played.players.player.hand).toHaveLength(2)
    expect(choice(played)).toMatchObject({ kind: 'selectDiscard', count: 1 })
    expect(skippable(played)).toBe(false)
    const done = accept(played, { handIndex: 0 })
    expect(done.players.player.hand).toHaveLength(1)
    expect(done.players.player.discard).toContain('TST_U1')
  })
})

describe('TS26 and IBH: two effects in sequence', () => {
  it('Fervor (TS26_72) readies a unit, then deals 3 to a unit', () => {
    const played = play(board('TS26_72', [unit('a', 'GRD', { exhausted: true })], [unit('e', 'TOUGH')]))
    expect(choice(played).kind).toBe('selectUnitToReady')
    expect(skippable(played)).toBe(false)
    const readied = accept(played, { targetInstanceId: 'a' })
    expect(U(readied, 'a')!.exhausted).toBe(false)
    expect(choice(readied)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    expect(U(accept(readied, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
  })

  it('Mislead (TS26_81) shields a unit, then gives a unit -3/-0', () => {
    const played = play(board('TS26_81', [unit('a', 'GRD')], [unit('e', 'GRD')]))
    expect(choice(played)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, optional: false })
    const shielded = accept(played, { targetInstanceId: 'a' })
    expect(U(shielded, 'a')!.upgrades).toEqual([{ cardId: TOKEN_SHIELD, owner: 'player' }])
    expect(choice(shielded)).toMatchObject({ kind: 'mayLastingBuff', power: -3 })
    const done = accept(shielded, { targetInstanceId: 'e' })
    expect(effectivePower(done, U(done, 'e')!)).toBe(0)
  })

  it('Remove the Chip (TS26_69) deals 2, and readies the target only if it is a Clone', () => {
    const clone = play(board('TS26_69', [], [unit('c', 'CLONE', { exhausted: true }), unit('e', 'GRD', { exhausted: true })]))
    expect(choice(clone)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    const onClone = accept(clone, { targetInstanceId: 'c' })
    expect(U(onClone, 'c')!.damage).toBe(2)
    expect(U(onClone, 'c')!.exhausted).toBe(false)
    const onOther = accept(clone, { targetInstanceId: 'e' })
    expect(U(onOther, 'e')!.exhausted).toBe(true)
  })

  it("I'll Cover For You (IBH_5) deals 1 to an enemy and 1 to another enemy", () => {
    const played = play(board('IBH_5', [unit('a', 'GRD')], [unit('e1', 'GRD'), unit('e2', 'TOUGH')]))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(targetsOf(choice(played))).toEqual(['e1', 'e2'])
    const first = accept(played, { targetInstanceId: 'e1' })
    // The second pick is "another" enemy, so the first one is no longer eligible.
    expect(targetsOf(choice(first))).toEqual(['e2'])
    const done = accept(first, { targetInstanceId: 'e2' })
    expect(U(done, 'e1')!.damage).toBe(1)
    expect(U(done, 'e2')!.damage).toBe(1)
  })

  it('I\'ll Cover For You (IBH_5) asks only once when the opponent has a single unit', () => {
    const done = accept(play(board('IBH_5', [], [unit('e1', 'GRD')])), { targetInstanceId: 'e1' })
    noChoice(done)
    expect(U(done, 'e1')!.damage).toBe(1)
  })

  it('Backed by Black Sun (TS26_70) deals 1 to an enemy, then may deal damage equal to the damaged enemies', () => {
    const played = play(board('TS26_70', [unit('a', 'GRD')], [unit('e1', 'TOUGH'), unit('e2', 'TOUGH', { damage: 1 })]))
    expect(targetsOf(choice(played))).toEqual(['e1', 'e2'])
    const first = accept(played, { targetInstanceId: 'e1' })
    // e1 and e2 are now both damaged enemies, so the follow-up deals 2, and it may target any unit.
    expect(choice(first)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, optional: true })
    expect(targetsOf(choice(first))).toEqual(['a', 'e1', 'e2'])
    expect(skippable(first)).toBe(true)
    expect(U(accept(first, { targetInstanceId: 'a' }), 'a')!.damage).toBe(2)
  })

  it('You Have Failed Me (IBH_95) defeats a friendly unit, then readies a friendly unit of 5 or less power', () => {
    const mine = [unit('a', 'GRD', { exhausted: true }), unit('p', 'STRONGP', { exhausted: true }), unit('w', 'CHEAP', { exhausted: true })]
    const played = play(board('IBH_95', mine, [unit('e', 'GRD')]))
    expect(choice(played).kind).toBe('selectUnitToDefeat')
    expect(targetsOf(choice(played))).toEqual(['a', 'p', 'w']) // friendly only
    expect(skippable(played)).toBe(false)
    const defeated = accept(played, { targetInstanceId: 'a' })
    expect(U(defeated, 'a')).toBeUndefined()
    expect(choice(defeated).kind).toBe('selectUnitToReady')
    expect(targetsOf(choice(defeated))).toEqual(['w']) // 7 power is too much
    expect(U(accept(defeated, { targetInstanceId: 'w' }), 'w')!.exhausted).toBe(false)
  })

  it('Watch This (IBH_52) returns a unit costing 6 or less, then exhausts the other enemies in its arena', () => {
    const theirs = [unit('e1', 'GRD'), unit('e2', 'GRD'), unit('es', 'SPACE'), unit('big', 'BIG')]
    const played = play(board('IBH_52', [unit('a', 'GRD')], theirs))
    expect(choice(played).kind).toBe('selectUnitToReturn')
    expect(targetsOf(choice(played))).toEqual(['a', 'big', 'e1', 'e2', 'es']) // BIG costs 6, so it qualifies
    const done = accept(played, { targetInstanceId: 'e1' })
    expect(U(done, 'e1')).toBeUndefined()
    expect(U(done, 'e2')!.exhausted).toBe(true) // same arena, enemy
    expect(U(done, 'big')!.exhausted).toBe(true)
    expect(U(done, 'es')!.exhausted).toBe(false) // other arena
    expect(U(done, 'a')!.exhausted).toBe(false) // friendly units are untouched
  })

  it('Kouhun Assassination (TS26_33) lets the opponent decline the discard, which cancels the debuff', () => {
    const s = board('TS26_33', [unit('a', 'GRD')], [unit('e', 'GRD'), unit('v', 'VEH')])
    s.players.opponent.hand = ['GRD']
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1, optional: true })
    expect(skippable(played)).toBe(true)
    noChoice(skip(played))

    const discarded = accept(played, { handIndex: 0 })
    expect(discarded.players.opponent.hand).toHaveLength(0)
    expect(choice(discarded)).toMatchObject({ kind: 'mayLastingBuff', controller: 'player', power: -8, hp: -8 })
    expect(targetsOf(choice(discarded))).toEqual(['a', 'e']) // the Vehicle is not eligible
  })

  it('Reckless Landing (TS26_32) plays a unit 4 cheaper and deals 4 damage to it', () => {
    const s = board('TS26_32', [], [])
    s.players.player.hand = ['TS26_32', 'BIG']
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'playUnitFromHand', costDelta: -4 })
    const before = played.players.player.resources.filter(r => !r.exhausted).length
    const done = accept(played, { handIndex: 0 })
    const entered = done.players.player.units[0]
    expect(entered).toBeDefined()
    expect(entered.cardId).toBe('BIG')
    expect(entered.damage).toBe(4)
    expect(done.players.player.resources.filter(r => !r.exhausted).length).toBe(before - 2) // 6 less 4
  })

  it('Reveal Intentions (TS26_80) has each player discard from the other hand, then each draws', () => {
    const s = board('TS26_80', [], [])
    s.players.player.hand = ['TS26_80', 'GRD']
    s.players.opponent.hand = ['CHEAP', 'TOUGH']
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'lookAtHand', controller: 'player', target: 'opponent', mayDiscard: true })
    expect(skippable(played)).toBe(false)
    const first = accept(played, { handIndex: 0 })
    expect(first.players.opponent.discard).toContain('CHEAP')
    expect(choice(first)).toMatchObject({ kind: 'lookAtHand', controller: 'opponent', target: 'player', mayDiscard: true })
    const done = accept(first, { handIndex: 0 })
    expect(done.players.player.discard).toContain('GRD')
    // Each player drew one to replace what was taken.
    expect(done.players.player.hand).toHaveLength(1)
    expect(done.players.opponent.hand).toHaveLength(2)
  })
})

describe('TS26 and IBH: several targets at once', () => {
  it('Evade Arrest (TS26_82) exhausts any number of non-unique units, on either side', () => {
    const played = play(board('TS26_82', [unit('a', 'GRD'), unit('u', 'UNIQ')], [unit('e', 'GRD')]))
    expect(choice(played)).toMatchObject({ kind: 'multiPick', spec: { mode: 'exhaust' } })
    expect(targetsOf(choice(played))).toEqual(['a', 'e']) // the unique unit is not eligible
    expect(skippable(played)).toBe(true) // "any number" may be none
    const one = accept(played, { targetInstanceId: 'e' })
    expect(U(one, 'e')!.exhausted).toBe(true)
    const both = accept(one, { targetInstanceId: 'a' })
    expect(U(both, 'a')!.exhausted).toBe(true)
  })

  it('The Desolation of Hoth (IBH_104) defeats up to 2 enemy units costing 3 or less', () => {
    const theirs = [unit('e1', 'CHEAP'), unit('e2', 'UNIQ'), unit('e3', 'CHEAP'), unit('big', 'BIG')]
    const played = play(board('IBH_104', [unit('a', 'CHEAP')], theirs))
    expect(choice(played)).toMatchObject({ kind: 'multiPick', spec: { mode: 'defeat', remaining: 2 } })
    expect(targetsOf(choice(played))).toEqual(['e1', 'e2', 'e3']) // enemy only, cost 3 or less
    expect(skippable(played)).toBe(true) // "up to"
    const one = accept(played, { targetInstanceId: 'e1' })
    expect(U(one, 'e1')).toBeUndefined()
    const two = accept(one, { targetInstanceId: 'e3' })
    expect(U(two, 'e3')).toBeUndefined()
    noChoice(two) // the budget of 2 is spent
  })

  it("I've Found Them (IBH_9) reveals 3, draws a revealed unit and discards the rest", () => {
    const s = board('IBH_9', [], [])
    s.players.player.deck = ['TS26_64', 'GRD', 'CHEAP', 'TOUGH']
    const played = play(s)
    // Only the two units are eligible; the event is revealed but cannot be drawn.
    expect(choice(played)).toMatchObject({ kind: 'searchDraw', revealed: ['TS26_64', 'GRD', 'CHEAP'], eligibleIndices: [1, 2] })
    const done = accept(played, { deckIndex: 1 })
    expect(done.players.player.hand).toEqual(['GRD'])
    // The two revealed cards it did not draw are discarded rather than bottomed. The event itself is
    // in the discard too, having just been played.
    expect(done.players.player.discard).toContain('TS26_64')
    expect(done.players.player.discard).toContain('CHEAP')
    expect(done.players.player.discard).not.toContain('GRD')
    expect(done.players.player.deck).toEqual(['TOUGH'])
  })
})

describe('TS26: events that cost less per friendly leader unit', () => {
  it.each([
    ['TS26_71', 'Take Action', 3],
    ['TS26_83', 'Take Aim', 3],
    ['TS26_47', 'Take Cover', 3],
  ])('%s %s costs 1 less for each friendly leader unit', (id, _label, printed) => {
    const none = board(id, [unit('a', 'GRD')], [])
    expect(effectiveCost(none, 'player', F[id as keyof typeof F] as EngineCard)).toBe(printed)
    const one = board(id, [unit('L', 'TST_L', { isLeader: true })], [])
    expect(effectiveCost(one, 'player', F[id as keyof typeof F] as EngineCard)).toBe(printed - 1)
  })

  it('Take Action (TS26_71) deals 3 damage to a unit', () => {
    const played = play(board('TS26_71', [unit('a', 'GRD')], [unit('e', 'TOUGH')]))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
  })

  it('Take Cover (TS26_47) heals up to 3 from a unit and shields the same unit', () => {
    const played = play(board('TS26_47', [unit('a', 'GRD', { damage: 5 })], []))
    expect(choice(played)).toMatchObject({ kind: 'selectHealTarget', amount: 3, thenShield: true, baseTargets: [] })
    const done = accept(played, { targetInstanceId: 'a' })
    expect(U(done, 'a')!.damage).toBe(2)
    expect(U(done, 'a')!.upgrades).toEqual([{ cardId: TOKEN_SHIELD, owner: 'player' }])
  })
})

describe('TS26 and IBH: attack events', () => {
  it('Improvised Detonation (IBH_21) attacks with +2/+0 for that attack only', () => {
    const played = play(board('IBH_21', [unit('a', 'GRD')], []))
    expect(choice(played)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(skippable(played)).toBe(false)
    const done = resolve(played, { type: 'attack', attackerId: 'a', choiceId: choice(played).id, target: { kind: 'base' } })
    expect(done.players.opponent.base.damage).toBe(4)
    expect(effectivePower(done, U(done, 'a')!)).toBe(2)
  })

  it('Fearless Attack (TS26_84) attacks with +1/+0 for each unit the defending player controls', () => {
    const played = play(board('TS26_84', [unit('a', 'GRD')], [unit('e1', 'GRD'), unit('e2', 'SPACE'), unit('e3', 'GRD')]))
    const done = resolve(played, { type: 'attack', attackerId: 'a', choiceId: choice(played).id, target: { kind: 'base' } })
    expect(done.players.opponent.base.damage).toBe(5) // 2 power + 3 enemy units, both arenas
  })

  it('Take Aim (TS26_83) attacks with +2/+0 and Saboteur, so past a Sentinel', () => {
    const played = play(board('TS26_83', [unit('a', 'GRD')], [unit('s', 'SENTINEL')]))
    const baseAttack = legalMoves(played).find(m => m.type === 'attack' && m.target.kind === 'base')
    expect(baseAttack).toBeDefined()
    const done = resolve(played, baseAttack!)
    expect(done.players.opponent.base.damage).toBe(4)
    expect(unitHasKeyword(done, U(done, 'a')!, 'Saboteur')).toBe(false) // only for that attack
  })
})
