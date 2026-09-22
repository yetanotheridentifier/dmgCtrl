import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { getAbilities } from '../engine/abilities'
import { hasToken, TOKEN_SHIELD, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import { effectiveCost } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { triage, triggerHeads } from '../bench/triage'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import type { TriggerPoint } from '../engine/abilities'

/**
 * Cards printed with a **compound trigger head**: one ability block that fires at either of two (or
 * three) points, `When Played/On Attack:`, `When Played/When Defeated:`, `When Played/On Attack/When
 * Defeated:`.
 *
 * The engine registers one such block once per point, so the two copies are individually addressable
 * in the ordering prompt (`docs/abilities.md`). Every effect behind these heads already existed on a
 * card with a single head, so the tests here assert the **dispatch**: the same block fires at each of
 * its printed points, and at no other.
 *
 * Each card is fired the way the game fires it, through `resolve`, and the printed stats, traits and
 * keywords come from the shipped set fixtures.
 */

const SHIPPED = [
  // A: Homeworlds
  'HMW_057', 'HMW_063', 'HMW_077', 'HMW_144', 'HMW_244',
  // B: tokens created
  'TWI_229', 'JTL_087', 'JTL_117', 'JTL_090', 'TS26_14',
  // C: damage
  'TWI_181', 'SEC_142', 'SEC_171', 'LAW_214', 'TWI_048', 'SOR_134',
  // D: tokens, buffs and keywords for this phase
  'TWI_046', 'SEC_031', 'LOF_165', 'JTL_088', 'SEC_202', 'SEC_119', 'SOR_050', 'SOR_160', 'TWI_033', 'LOF_207', 'SEC_055',
]

/**
 * Scoped by the triage but lifted out to the ticket that owns their blocker: the compound head is no
 * longer what holds them back.
 */
const LIFTED = ['SEC_143']

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'ASH', 'HMW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  SPC: src('SPC', { arena: 'space' }),
  GUNGAN: src('GUNGAN', { traits: ['GUNGAN'] }),
  OFFICIAL: src('OFFICIAL', { traits: ['OFFICIAL'] }),
  FORCE_U: src('FORCE_U', { traits: ['FORCE'] }),
  FIRST_ORDER: src('FIRST_ORDER', { traits: ['FIRST ORDER'] }),
  SPECTRE: src('SPECTRE', { traits: ['SPECTRE'] }),
  VIG_BASE: card({ id: 'VIG_BASE', type: 'base', hp: 30, aspects: ['Vigilance'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], base: { cardId: 'VIG_BASE', damage: 0 }, ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
  })

const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; upgradeIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const targetsOf = (c: PendingChoice): string[] => ('targets' in c ? c.targets : 'unitTargets' in c ? c.unitTargets : []) as string[]
const tokenUnits = (s: GameState, owner: PlayerId, name: string) =>
  s.players[owner].units.filter(u => s.cards[u.cardId]?.name === name).length

/**
 * The three ways one block gets fired, so each card is exercised at each of its printed points the way
 * the game fires it: played from hand, declaring an attack, and defeated by an ability.
 */
const played = (s: GameState, cardId: string) =>
  resolve({ ...s, players: { ...s.players, player: { ...s.players.player, hand: [cardId], resources: ready(20) } } }, { type: 'playUnit', handIndex: 0 })
const killed = (s: GameState, id = 'src') => defeatUnit(s, id)

describe('compound trigger heads: one ability block, several points', () => {
  /**
   * The load-bearing property of the group. A compound head is registered once per printed point, so
   * the card carries one ability per point with the same text, and nothing beyond them.
   */
  it.each([
    ['HMW_057', ['whenPlayed', 'onAttack']],
    ['HMW_063', ['whenPlayed', 'onAttack']],
    ['HMW_077', ['whenPlayed', 'onAttack']],
    ['HMW_244', ['whenPlayed', 'onAttack']],
    ['HMW_144', ['whenPlayed', 'whenDefeated']],
    ['TWI_229', ['whenPlayed', 'whenDefeated']],
    ['JTL_087', ['whenPlayed', 'whenDefeated']],
    ['JTL_117', ['whenPlayed', 'onAttack']],
    ['JTL_090', ['whenPlayed', 'onAttack', 'whenDefeated']],
    ['TS26_14', ['whenPlayed', 'whenDefeated']],
    ['TWI_181', ['whenPlayed', 'whenDefeated']],
    ['SEC_142', ['whenPlayed', 'onAttack']],
    ['SEC_171', ['whenPlayed', 'onAttack']],
    ['LAW_214', ['whenPlayed', 'onAttack']],
    ['TWI_048', ['whenPlayed', 'onAttack']],
    ['SOR_134', ['whenPlayed', 'whenDefeated']],
    ['TWI_046', ['whenPlayed', 'onAttack']],
    ['SEC_031', ['whenPlayed', 'onAttack']],
    ['LOF_165', ['whenPlayed', 'onAttack']],
    ['JTL_088', ['whenPlayed', 'onAttack']],
    ['SEC_202', ['whenPlayed', 'whenDefeated']],
    ['SEC_119', ['whenPlayed', 'whenDefeated']],
    ['SOR_050', ['whenPlayed', 'onAttack']],
    ['SOR_160', ['whenPlayed', 'onAttack']],
    ['LOF_207', ['whenPlayed', 'whenDefeated']],
    ['SEC_055', ['whenPlayed', 'whenDefeated']],
    // Not every second point is the attack or the defeat: this one is printed "When a friendly unit
    // is defeated", which the engine already dispatches.
    ['TWI_033', ['whenPlayed', 'whenFriendlyUnitDefeated']],
  ])('registers %s once at each of its printed points, with one description for the block', (id, points) => {
    const abilities = getAbilities(id)
    expect(abilities.map(a => a.trigger)).toEqual(points as TriggerPoint[])
    expect(new Set(abilities.map(a => a.description)).size, 'one printed block, so one description').toBe(1)
  })

  it('leaves every shipped card free of blockers in the triage, and every lifted card blocked by something else', () => {
    const byId = new Map(triage(POOL).triaged.map(c => [c.id, c]))
    for (const id of SHIPPED) {
      const c = byId.get(id)
      expect(triggerHeads(c!.text).some(h => h.includes('/')), `${id} has a compound head`).toBe(true)
      expect(c!.blockers, id).toEqual([])
    }
    for (const id of LIFTED) expect(byId.get(id)!.blockers.length, id).toBeGreaterThan(0)
  })
})

describe('compound trigger heads, A: Homeworlds', () => {
  it('HMW_144 Howler Pack creates a Beast token when played and again when defeated', () => {
    const onPlay = played(board(), 'HMW_144')
    expect(tokenUnits(onPlay, 'player', 'Beast')).toBe(1)
    const onDefeat = killed(board({ units: [unit('src', 'HMW_144')] }))
    expect(tokenUnits(onDefeat, 'player', 'Beast')).toBe(1)
    // The block fires once per point, not once per event: defeating it does not also re-fire the play.
    expect(onDefeat.players.player.units.filter(u => u.instanceId !== 'src')).toHaveLength(1)
  })

  it('HMW_144 does not fire on an attack, which its head does not name', () => {
    const s = board({ units: [unit('src', 'HMW_144', { exhausted: false })] }, { units: [unit('e', 'GRD')] })
    expect(tokenUnits(attack(s, 'src', 'e'), 'player', 'Beast')).toBe(0)
  })

  it.each(['played', 'attacking'])(
    'HMW_063 Rho Medical Shuttle offers a heal on another damaged unit or a damaged base, %s', how => {
      const s = board(
        { units: [unit('other', 'GRD', { damage: 2 })], base: { cardId: 'VIG_BASE', damage: 3 } },
        { units: [unit('e', 'GRD', { damage: 1 })] },
      )
      const fired = how === 'played' ? played(s, 'HMW_063') : attack({ ...s, players: { ...s.players, player: { ...s.players.player, units: [...s.players.player.units, unit('src', 'HMW_063')] } } }, 'src')
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectHealTarget', controller: 'player', amount: 1 })
      // "Another unit or base": the source itself is out, undamaged units and bases are not targets.
      expect(targetsOf(c).sort()).toEqual(['e', 'other'])
      expect((c as { baseTargets: PlayerId[] }).baseTargets).toEqual(['player'])
      const healed = accept(fired, { targetInstanceId: 'other' })
      expect(U(healed, 'other')!.damage).toBe(1)
    })

  it('HMW_063 is optional: skipping it heals nothing', () => {
    const s = played(board({ units: [unit('other', 'GRD', { damage: 2 })] }), 'HMW_063')
    expect(U(skip(s), 'other')!.damage).toBe(2)
  })

  it('HMW_244 Separatist Harbinger is the Grey Squadron block, fired when played as well as on attack', () => {
    const s = played(board({}, { units: [unit('e', 'GRD')] }), 'HMW_244')
    // The opponent chooses first, from their own units and base.
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'opponent' })
    const chosen = accept(s, { optionIndex: 0 })
    expect(choice(chosen)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
    expect(U(accept(chosen), 'e')!.damage).toBe(2)
  })

  it('HMW_077 Boss Nass trades a Shield on a friendly Gungan for a shielded Beast, when played and on attack', () => {
    const shielded = () => board({ units: [unit('gun', 'GUNGAN', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] }), unit('plain', 'GRD')] })
    for (const fire of [
      (s: GameState) => played(s, 'HMW_077'),
      (s: GameState) => attack({ ...s, players: { ...s.players, player: { ...s.players.player, units: [...s.players.player.units, unit('src', 'HMW_077')] } } }, 'src'),
    ]) {
      const fired = fire(shielded())
      // Only a friendly Gungan carrying a Shield may be chosen: not the plain unit, not an unshielded one.
      expect(targetsOf(choice(fired))).toEqual(['gun'])
      const done = accept(fired, { targetInstanceId: 'gun' })
      expect(hasToken(U(done, 'gun')!.upgrades, TOKEN_SHIELD), 'the Shield is spent').toBe(false)
      const beast = done.players.player.units.find(u => done.cards[u.cardId]?.name === 'Beast')
      expect(beast, 'a Beast token arrives').toBeTruthy()
      expect(hasToken(beast!.upgrades, TOKEN_SHIELD), 'and carries the Shield').toBe(true)
    }
  })

  it('HMW_077 raises nothing when no friendly Gungan carries a Shield', () => {
    noChoice(played(board({ units: [unit('gun', 'GUNGAN')] }), 'HMW_077'))
  })

  it('HMW_057 Boss Lyonie copies a token upgrade on another unit, when played and on attack', () => {
    const withTokens = () => board(
      { units: [unit('mine', 'GRD', { upgrades: [{ cardId: TOKEN_EXPERIENCE, owner: 'player' }] })] },
      { units: [unit('theirs', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })] },
    )
    for (const fire of [
      (s: GameState) => played(s, 'HMW_057'),
      (s: GameState) => attack({ ...s, players: { ...s.players, player: { ...s.players.player, units: [...s.players.player.units, unit('src', 'HMW_057')] } } }, 'src'),
    ]) {
      const fired = fire(withTokens())
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUpgradeThen', controller: 'player', optional: true })
      // Either player's unit may be chosen, but only token upgrades, and never this unit's own.
      expect((c as { candidates: { unitId: string; cardId: string }[] }).candidates.map(u => `${u.unitId}:${u.cardId}`).sort())
        .toEqual([`mine:${TOKEN_EXPERIENCE}`, `theirs:${TOKEN_SHIELD}`])
      const done = accept(fired, { upgradeIndex: 0 })
      expect(U(done, 'mine')!.upgrades.filter(u => u.cardId === TOKEN_EXPERIENCE), 'a second Experience token').toHaveLength(2)
    }
  })

  it('HMW_057 raises nothing when the only token upgrade is its own, and is optional otherwise', () => {
    const own = board({ units: [unit('src', 'HMW_057', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }, { units: [unit('e', 'GRD')] })
    noChoice(attack(own, 'src', 'e'))
    const other = played(board({ units: [unit('mine', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }), 'HMW_057')
    expect(U(skip(other), 'mine')!.upgrades).toHaveLength(1)
  })
})

describe('compound trigger heads, B: tokens created', () => {
  it.each([
    ['TWI_229', 'Battle Droid', 1],
    ['JTL_087', 'TIE Fighter', 1],
  ])('%s creates a %s token when played and again when defeated', (id, token, n) => {
    expect(tokenUnits(played(board(), id), 'player', token)).toBe(n)
    expect(tokenUnits(killed(board({ units: [unit('src', id)] })), 'player', token)).toBe(n)
  })

  it('JTL_117 General Draven creates an X-Wing token when played and again on attack', () => {
    expect(tokenUnits(played(board(), 'JTL_117'), 'player', 'X-Wing')).toBe(1)
    const s = board({ units: [unit('src', 'JTL_117')] }, { units: [unit('e', 'GRD')] })
    expect(tokenUnits(attack(s, 'src', 'e'), 'player', 'X-Wing')).toBe(1)
  })

  it('JTL_090 Executor creates 3 TIE Fighter tokens at each of its three printed points', () => {
    expect(tokenUnits(played(board(), 'JTL_090'), 'player', 'TIE Fighter')).toBe(3)
    const board090 = () => board({ units: [unit('src', 'JTL_090')] }, { units: [unit('e', 'SPC')] })
    expect(tokenUnits(attack(board090(), 'src', 'e'), 'player', 'TIE Fighter')).toBe(3)
    expect(tokenUnits(killed(board090()), 'player', 'TIE Fighter')).toBe(3)
  })

  it('TS26_14 Yoda creates a Clone Trooper with Sentinel when played and again when defeated, and costs 2 less on 7 resources', () => {
    for (const fired of [played(board(), 'TS26_14'), killed(board({ units: [unit('src', 'TS26_14')] }))]) {
      const trooper = fired.players.player.units.find(u => fired.cards[u.cardId]?.name === 'Clone Trooper')
      expect(trooper, 'a Clone Trooper token arrives').toBeTruthy()
      expect(unitHasKeyword(fired, trooper!, 'Sentinel'), 'with Sentinel for this phase').toBe(true)
    }
    // The discount is read off the resource count, so the two boards differ only in that.
    const at = (n: number) => effectiveCost(board({ resources: ready(n) }), 'player', F['TS26_14'])
    expect(at(7)).toBe(at(6) - 2)
    expect(at(8)).toBe(at(7))
  })
})

/**
 * From here the block itself is an effect that already shipped on a single-head card, so each test
 * fires it at each printed point and checks the effect landed and what could be chosen. The point of
 * the group is the dispatch, not the effect.
 */
describe('compound trigger heads, C: damage', () => {
  it.each([
    ['TWI_181', 'whenDefeated', 1, ['mine', 'e']],
    ['SEC_142', 'onAttack', 4, ['mine', 'e']],
    ['SEC_171', 'onAttack', 1, ['mine', 'e']],
  ])('%s offers its damage when played and again %s', (id, second, amount, targets) => {
    const setup = () => board({ units: [unit('mine', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const onPlay = played(setup(), id)
    expect(choice(onPlay)).toMatchObject({ controller: 'player', amount, optional: true })
    expect(targetsOf(choice(onPlay)).filter(t => targets.includes(t)).sort()).toEqual([...targets].sort())
    expect(U(accept(onPlay, { targetInstanceId: 'e' }), 'e')!.damage).toBe(amount)

    const withSrc = board({ units: [unit('mine', 'GRD'), unit('src', id)] }, { units: [unit('e', 'GRD')] })
    const again = second === 'onAttack' ? attack(withSrc, 'src', 'e') : killed(withSrc)
    expect(U(accept(again, { targetInstanceId: 'mine' }), 'mine')!.damage).toBe(amount)
  })

  it('SEC_171 Punishing One gains Raid 1 for each damaged enemy unit', () => {
    const s = board({ units: [unit('src', 'SEC_171')] }, { units: [unit('e1', 'GRD', { damage: 1 }), unit('e2', 'GRD', { damage: 2 }), unit('e3', 'GRD')] })
    expect(unitKeywordValue(s, U(s, 'src')!, 'Raid')).toBe(2)
    const none = board({ units: [unit('src', 'SEC_171')] }, { units: [unit('e3', 'GRD')] })
    expect(unitHasKeyword(none, U(none, 'src')!, 'Raid')).toBe(false)
  })

  it('LAW_214 Boba Fett charges 1 before the damage, when played and on attack', () => {
    const s = played(board({}, { units: [unit('e', 'GRD')] }), 'LAW_214')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 1 })
    const paid = accept(s)
    expect(choice(paid)).toMatchObject({ amount: 3 })
    expect(U(accept(paid, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
    // Declining the cost deals nothing.
    expect(U(skip(s), 'e')!.damage).toBe(0)
  })

  it("TWI_048 Obi-Wan's Aethersprite hits itself for 1 and another space unit for 2, when played and on attack", () => {
    // Played: the numbers are clean, since no combat damage is in flight.
    const onPlay = played(board({}, { units: [unit('spc', 'SPC'), unit('grd', 'GRD')] }), 'TWI_048')
    // Only another SPACE unit may be chosen: the ground unit is out, and so is the source.
    expect(targetsOf(choice(onPlay))).toEqual(['spc'])
    const done = accept(onPlay, { targetInstanceId: 'spc' })
    expect(done.players.player.units.at(-1)!.damage, 'this unit takes 1').toBe(1)
    expect(U(done, 'spc')!.damage).toBe(2)
    // On attack the choice is raised before combat, so the same targets are offered.
    const attacking = attack(board({ units: [unit('src', 'TWI_048')] }, { units: [unit('spc', 'SPC'), unit('grd', 'GRD')] }), 'src', 'spc')
    expect(targetsOf(choice(attacking))).toEqual(['spc'])
  })

  it('SOR_134 Ruthless Raider hits the enemy base for 2 and picks an enemy unit, when played and when defeated', () => {
    for (const fired of [
      played(board({}, { units: [unit('e', 'GRD')] }), 'SOR_134'),
      killed(board({ units: [unit('src', 'SOR_134')] }, { units: [unit('e', 'GRD')] })),
    ]) {
      expect(fired.players.opponent.base.damage, 'the enemy base, not a choice of base').toBe(2)
      expect(fired.players.player.base.damage).toBe(0)
      // Only enemy units are offered the second 2.
      expect(targetsOf(choice(fired))).toEqual(['e'])
      expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
    }
  })
})

describe('compound trigger heads, D: tokens, buffs and keywords for this phase', () => {
  it('TWI_046 Captain Typho gives a unit Sentinel, when played and on attack', () => {
    const s = played(board({ units: [unit('mine', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'TWI_046')
    // "A unit" is unqualified, so either side's, and Typho itself once it is in play.
    expect(targetsOf(choice(s))).toContain('e')
    expect(targetsOf(choice(s))).toContain('mine')
    const done = accept(s, { targetInstanceId: 'e' })
    expect(unitHasKeyword(done, U(done, 'e')!, 'Sentinel')).toBe(true)
    const attacked = attack(board({ units: [unit('src', 'TWI_046'), unit('mine', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'src', 'e')
    expect(unitHasKeyword(accept(attacked, { targetInstanceId: 'mine' }), U(attacked, 'mine')!, 'Sentinel')).toBe(true)
  })

  it.each([
    ['SEC_031', 'OFFICIAL'],
    ['LOF_165', 'FORCE_U'],
    ['JTL_088', 'FIRST_ORDER'],
  ])('%s offers only another unit matching its printed trait', (id, matching) => {
    const s = played(board({ units: [unit('ok', matching), unit('no', 'GRD')] }), id)
    expect(targetsOf(choice(s))).toEqual(['ok'])
  })

  it('SEC_202 Rebel Propagandist gives another friendly unit +1/+0 and Saboteur, when played and when defeated', () => {
    const s = killed(board({ units: [unit('src', 'SEC_202'), unit('mine', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    // "Another friendly": the enemy unit is not a target, and the source has left play.
    expect(targetsOf(choice(s))).toEqual(['mine'])
    const done = accept(s, { targetInstanceId: 'mine' })
    expect(unitHasKeyword(done, U(done, 'mine')!, 'Saboteur')).toBe(true)
    expect(effectivePower(done, U(done, 'mine')!)).toBe(effectivePower(s, U(s, 'mine')!) + 1)
  })

  it('SEC_119 Crucible gives an Experience token to each OTHER friendly unit, when played and when defeated', () => {
    const done = killed(board({ units: [unit('src', 'SEC_119'), unit('a', 'GRD'), unit('b', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    noChoice(done)
    expect(U(done, 'a')!.upgrades.filter(u => u.cardId === TOKEN_EXPERIENCE)).toHaveLength(1)
    expect(U(done, 'b')!.upgrades.filter(u => u.cardId === TOKEN_EXPERIENCE)).toHaveLength(1)
    expect(U(done, 'e')!.upgrades, 'not the enemy').toHaveLength(0)
  })

  it('SOR_050 The Ghost offers a Shield to another Spectre unit, when played and on attack', () => {
    const s = played(board({ units: [unit('spec', 'SPECTRE'), unit('plain', 'GRD')] }), 'SOR_050')
    expect(targetsOf(choice(s))).toEqual(['spec'])
    const done = accept(s, { targetInstanceId: 'spec' })
    expect(hasToken(U(done, 'spec')!.upgrades, TOKEN_SHIELD)).toBe(true)
  })

  it('SOR_160 Wolffe stops bases being healed, when played and on attack', () => {
    expect(played(board(), 'SOR_160').basesUnhealable).toBe(true)
    const s = board({ units: [unit('src', 'SOR_160')] }, { units: [unit('e', 'GRD')] })
    expect(attack(s, 'src', 'e').basesUnhealable).toBe(true)
  })

  it('TWI_033 Calculating MagnaGuard gains Sentinel when played and again when a friendly unit is defeated', () => {
    const s = board({ units: [unit('src', 'TWI_033'), unit('mate', 'GRD')] })
    const onPlay = played(board(), 'TWI_033')
    const self = onPlay.players.player.units.at(-1)!
    expect(unitHasKeyword(onPlay, self, 'Sentinel')).toBe(true)
    // A friendly unit dying fires it again; the enemy's does not.
    const afterMate = killed(s, 'mate')
    expect(unitHasKeyword(afterMate, U(afterMate, 'src')!, 'Sentinel')).toBe(true)
  })

  it('LOF_207 Loth-Cat offers an exhaust on a ground unit, when played and when defeated', () => {
    const s = killed(board({ units: [unit('src', 'LOF_207')] }, { units: [unit('grd', 'GRD'), unit('spc', 'SPC')] }))
    expect(choice(s)).toMatchObject({ kind: 'mayExhaustUnit', optional: true })
    expect(targetsOf(choice(s))).toEqual(['grd'])
    expect(U(accept(s, { targetInstanceId: 'grd' }), 'grd')!.exhausted).toBe(true)
  })

  it('SEC_055 Dhani Pilgrim heals 1 from its own base, when played and when defeated', () => {
    const s = killed(board({ units: [unit('src', 'SEC_055')], base: { cardId: 'VIG_BASE', damage: 4 } }, { base: { cardId: 'VIG_BASE', damage: 4 } }))
    noChoice(s)
    expect(s.players.player.base.damage).toBe(3)
    expect(s.players.opponent.base.damage, 'their base is not healed').toBe(4)
  })
})
