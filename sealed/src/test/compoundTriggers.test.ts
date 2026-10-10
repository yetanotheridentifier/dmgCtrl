import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { getAbilities } from '../engine/abilities'
import { hasToken, TOKEN_SHIELD, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { unitHasKeyword, unitKeywordValue, unitCannotBeAttacked } from '../engine/keywords'
import { healBase } from '../engine/effects'
import { TOKEN_BATTLE_DROID } from '../engine/tokenUnits'
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
  // E: decks and hands
  'SOR_147', 'SOR_031', 'SOR_236', 'SOR_119', 'SOR_238', 'LAW_237', 'TWI_146', 'JTL_154', 'JTL_041',
  // F: upgrades moved and taken
  'LAW_195', 'JTL_242', 'SHD_064', 'SHD_142', 'LAW_224',
  // G: units returned, readied and defeated
  'SOR_040', 'TWI_198', 'SHD_191', 'LAW_185', 'JTL_219',
  // H: targets chosen by a rule rather than by the player
  'SEC_244', 'TWI_151', 'LAW_101', 'LAW_178', 'SHD_171', 'SHD_091',
  // I: the rest
  'SHD_103', 'LOF_082', 'LAW_158', 'TS26_38', 'TS26_49',
]

/**
 * Scoped by the triage but lifted out to the ticket that owns their blocker: the compound head is no
 * longer what holds them back. None is left: SEC_143 The Elite Squad, whose second point is damage
 * dealt to it, is built and covered with the last one-offs in `oneOffCards4.test.ts`.
 */
const LIFTED: string[] = []

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
  // E to I
  ASH_181: real('ASH_181'), // Mark My Words: attaches only to a damaged unit
  TACTIC: card({ id: 'TACTIC', type: 'event', cost: 1, traits: ['TACTIC'] }),
  TWIN_A: src('TWIN_A', { name: 'Twin' }),
  TWIN_B: src('TWIN_B', { name: 'Twin' }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 2 }),
  UPG5: card({ id: 'UPG5', type: 'upgrade', cost: 5 }),
  UNDER: src('UNDER', { traits: ['UNDERWORLD'] }),
  BOUNTY: src('BOUNTY', { keywords: [{ name: 'Bounty' }] }),
  JABBA: src('JABBA', { name: 'Jabba the Hutt' }),
  SEP: src('SEP', { traits: ['SEPARATIST'] }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  SENT: src('SENT', { keywords: [{ name: 'Sentinel' }] }),
  WEAK: src('WEAK', { power: 1 }),
  STRONG: src('STRONG', { power: 9 }),
  AGG: src('AGG', { aspects: ['Aggression'], power: 4, hp: 8 }),
  CUN: src('CUN', { aspects: ['Cunning'], power: 4, hp: 8 }),
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
type Extra = { targetInstanceId?: string; optionIndex?: number; upgradeIndex?: number; baseTarget?: PlayerId; handIndex?: number; deckIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const targetsOf = (c: PendingChoice): string[] => ('targets' in c ? c.targets : 'unitTargets' in c ? c.unitTargets : []) as string[]
const tokenUnits = (s: GameState, owner: PlayerId, name: string) =>
  s.players[owner].units.filter(u => s.cards[u.cardId]?.name === name).length

/**
 * The three ways one block gets fired, so each card is exercised at each of its printed points the way
 * the game fires it: played from hand, declaring an attack, and defeated by an ability.
 */
const played = (s: GameState, cardId: string, rest: string[] = []) =>
  resolve({ ...s, players: { ...s.players, player: { ...s.players.player, hand: [cardId, ...rest], resources: ready(20) } } }, { type: 'playUnit', handIndex: 0 })
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
    ...(['SOR_147', 'SOR_031', 'TWI_146', 'JTL_154', 'JTL_041', 'LAW_195', 'JTL_242', 'LAW_185'] as const)
      .map(id => [id, ['whenPlayed', 'whenDefeated']] as [string, string[]]),
    ...(['SOR_236', 'SOR_119', 'SOR_238', 'LAW_237', 'SHD_064', 'SHD_142', 'LAW_224', 'SOR_040', 'TWI_198', 'SHD_191', 'JTL_219',
      'SEC_244', 'TWI_151', 'LAW_101', 'LAW_178', 'SHD_171', 'SHD_091', 'SHD_103', 'LOF_082', 'LAW_158', 'TS26_38', 'TS26_49'] as const)
      .map(id => [id, ['whenPlayed', 'onAttack']] as [string, string[]]),
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

/** Declares an attack on the enemy base with the card under test, added to the board as `src`. */
const attacking = (cardId: string, mine: Side = {}, theirs: Side = {}) =>
  attack(board({ ...mine, units: [...(mine.units ?? []), unit('src', cardId)] }, theirs), 'src')
const upgrade = (cardId: string, owner: PlayerId) => ({ cardId, owner })
const expCount = (u: UnitState | undefined) => (u?.upgrades ?? []).filter(x => x.cardId === TOKEN_EXPERIENCE).length

describe('compound trigger heads, E: decks and hands', () => {
  const DECK = ['TST_U3', 'TST_E1', 'TST_U1', 'TST_U4']

  it('SOR_147 Black One may discard the hand to draw 3, when played and when defeated', () => {
    const s = played(board({ deck: DECK }), 'SOR_147', ['TACTIC', 'TACTIC'])
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
    const done = accept(s)
    expect(done.players.player.hand).toEqual(DECK.slice(0, 3))
    expect(done.players.player.discard.filter(id => id === 'TACTIC')).toHaveLength(2)
    expect(skip(s).players.player.hand, 'declined: the hand is kept').toEqual(['TACTIC', 'TACTIC'])
    const onDefeat = killed(board({ units: [unit('src', 'SOR_147')], hand: ['TACTIC'], deck: DECK }))
    expect(accept(onDefeat).players.player.hand).toEqual(DECK.slice(0, 3))
  })

  it('SOR_147 offers nothing with an empty hand, since there is no hand to discard', () => {
    noChoice(played(board({ deck: DECK }), 'SOR_147'))
  })

  it('SOR_031 Inferno Four looks at the top 2 and puts any number on the bottom, when played and when defeated', () => {
    for (const fired of [played(board({ deck: DECK }), 'SOR_031'), killed(board({ units: [unit('src', 'SOR_031')], deck: DECK }))]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectCardThen', controller: 'player', optional: true })
      expect((c as { candidates: string[] }).candidates).toEqual(['TST_U3', 'TST_E1'])
      const bottomed = accept(fired, { optionIndex: 0 })
      expect(bottomed.players.player.deck).toEqual(['TST_E1', 'TST_U1', 'TST_U4', 'TST_U3'])
    }
  })

  it('SOR_236 R2-D2 may put the top card on the bottom, when played and on attack', () => {
    for (const fired of [played(board({ deck: DECK }), 'SOR_236'), attacking('SOR_236', { deck: DECK })]) {
      expect(choice(fired)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
      expect(accept(fired).players.player.deck).toEqual([...DECK.slice(1), DECK[0]])
      expect(skip(fired).players.player.deck).toEqual(DECK)
    }
  })

  it('SOR_119 Reinforcement Walker draws the top card, or discards it and heals 3 from your base, when played and on attack', () => {
    const damaged = { deck: DECK, base: { cardId: 'VIG_BASE', damage: 5 } }
    for (const fired of [played(board(damaged), 'SOR_119'), attacking('SOR_119', damaged)]) {
      expect(choice(fired)).toMatchObject({ kind: 'chooseMode', modes: ['draw', 'discard'] })
      const drew = accept(fired, { optionIndex: 0 })
      expect(drew.players.player.hand).toContain('TST_U3')
      expect(drew.players.player.base.damage).toBe(5)
      const binned = accept(fired, { optionIndex: 1 })
      expect(binned.players.player.discard).toContain('TST_U3')
      expect(binned.players.player.deck).toEqual(DECK.slice(1))
      expect(binned.players.player.base.damage).toBe(2)
    }
  })

  it('SOR_238 C-3P0 draws the top card only when its cost is the chosen number, when played and on attack', () => {
    for (const fired of [played(board({ deck: DECK }), 'SOR_238'), attacking('SOR_238', { deck: DECK })]) {
      expect(choice(fired)).toMatchObject({ kind: 'chooseNumber', controller: 'player' })
      // TST_U3 costs 2.
      const right = accept(fired, { optionIndex: 2 })
      expect(choice(right)).toMatchObject({ kind: 'mayPayThen' })
      expect(accept(right).players.player.hand).toContain('TST_U3')
      const wrong = accept(fired, { optionIndex: 1 })
      noChoice(wrong)
      expect(wrong.players.player.deck).toEqual(DECK)
    }
  })

  it('LAW_237 Qui-Gon Jinn looks at the top 3 and may discard 1, when played and on attack', () => {
    for (const fired of [played(board({ deck: DECK }), 'LAW_237'), attacking('LAW_237', { deck: DECK })]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectCardThen', optional: true })
      expect((c as { candidates: string[] }).candidates).toEqual(DECK.slice(0, 3))
      const done = accept(fired, { optionIndex: 1 })
      expect(done.players.player.discard).toContain('TST_E1')
      expect(done.players.player.deck).toEqual(['TST_U3', 'TST_U1', 'TST_U4'])
      expect(skip(fired).players.player.deck).toEqual(DECK)
    }
  })

  it('TWI_146 Steela Gerrera may deal 2 to your base to search the top 8 for a Tactic card, when played and when defeated', () => {
    const deck = ['TST_U1', 'TACTIC', 'TST_U3']
    for (const fired of [played(board({ deck }), 'TWI_146'), killed(board({ units: [unit('src', 'TWI_146')], deck }))]) {
      expect(choice(fired)).toMatchObject({ kind: 'mayPayThen' })
      const paid = accept(fired)
      expect(paid.players.player.base.damage).toBe(2)
      expect(choice(paid)).toMatchObject({ kind: 'searchDraw', eligibleIndices: [1] })
      expect(accept(paid, { deckIndex: 1 }).players.player.hand).toContain('TACTIC')
      expect(skip(fired).players.player.base.damage, 'declined: no damage').toBe(0)
    }
  })

  it('JTL_154 Profundity makes a chosen player discard, and again while they hold more cards than you', () => {
    const s = played(board({}, { hand: ['TST_E1', 'TST_E1'] }), 'JTL_154')
    expect(choice(s)).toMatchObject({ kind: 'choosePlayerThen', controller: 'player' })
    const chosen = accept(s, { optionIndex: 0 })
    expect(choice(chosen)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent' })
    // 1 left against your 0: a second discard.
    const once = accept(chosen, { handIndex: 0 })
    expect(choice(once)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent' })
    expect(accept(once, { handIndex: 0 }).players.opponent.hand).toHaveLength(0)
    // Level hands after the first discard: no second.
    const level = accept(accept(played(board({}, { hand: ['TST_E1', 'TST_E1', 'TST_E1'] }), 'JTL_154', ['TACTIC', 'TACTIC']), { optionIndex: 0 }), { handIndex: 0 })
    noChoice(level)
    expect(level.players.opponent.hand).toHaveLength(2)
    // When defeated too.
    expect(choice(killed(board({ units: [unit('src', 'JTL_154')] }, { hand: ['TST_E1'] })))).toMatchObject({ kind: 'choosePlayerThen' })
  })

  it("JTL_041 Annihilator may defeat an enemy unit and discard every card of its name from its controller's deck and hand", () => {
    const setup = () => board({ units: [unit('mine', 'TWIN_B')] }, { units: [unit('e', 'TWIN_A'), unit('o', 'GRD')], hand: ['TWIN_B', 'TST_E1'], deck: ['TWIN_A', 'TST_U1', 'TWIN_B'] })
    for (const fired of [played(setup(), 'JTL_041'), killed({ ...setup(), players: { ...setup().players, player: { ...setup().players.player, units: [...setup().players.player.units, unit('src', 'JTL_041')] } } })]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUnitThen', optional: true })
      expect(targetsOf(c).sort()).toEqual(['e', 'o'])
      const done = accept(fired, { targetInstanceId: 'e' })
      expect(U(done, 'e')).toBeUndefined()
      expect(done.players.opponent.hand).toEqual(['TST_E1'])
      expect(done.players.opponent.deck).toEqual(['TST_U1'])
      expect(done.players.opponent.discard.filter(id => done.cards[id]?.name === 'Twin')).toHaveLength(4)
      expect(U(done, 'mine'), 'your own copy is untouched').toBeDefined()
    }
  })
})

describe('compound trigger heads, F: upgrades moved and taken', () => {
  it('LAW_195 Overcharged Transport may defeat an upgrade on a space unit only, when played and when defeated', () => {
    const setup = (extra: UnitState[] = []) => board({ units: extra }, { units: [unit('sp', 'SPC', { upgrades: [upgrade('UPG', 'opponent')] }), unit('gr', 'GRD', { upgrades: [upgrade('UPG', 'opponent')] })] })
    for (const fired of [played(setup(), 'LAW_195'), killed(setup([unit('src', 'LAW_195')]))]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: true })
      expect((c as { candidates: { unitId: string }[] }).candidates.map(x => x.unitId)).toEqual(['sp'])
      expect(U(accept(fired, { optionIndex: 0 }), 'sp')!.upgrades).toHaveLength(0)
    }
  })

  it('JTL_242 Shuttle ST-149 may take a token upgrade and attach it to a different unit, when played and when defeated', () => {
    const setup = (extra: UnitState[] = []) => board({ units: [unit('mine', 'GRD'), ...extra] }, { units: [unit('e', 'GRD', { upgrades: [upgrade(TOKEN_EXPERIENCE, 'opponent'), upgrade('UPG', 'opponent')] })] })
    for (const fired of [played(setup(), 'JTL_242'), killed(setup([unit('src', 'JTL_242')]))]) {
      const c = choice(fired) as Extract<PendingChoice, { kind: 'selectUpgradeThen' }>
      expect(c).toMatchObject({ kind: 'selectUpgradeThen', optional: true })
      expect(c.candidates.every(x => x.cardId in { [TOKEN_EXPERIENCE]: 1, [TOKEN_SHIELD]: 1 }), 'only token upgrades').toBe(true)
      const at = c.candidates.findIndex(x => x.unitId === 'e' && x.cardId === TOKEN_EXPERIENCE)
      expect(at).toBeGreaterThanOrEqual(0)
      const picked = accept(fired, { optionIndex: at })
      expect(targetsOf(choice(picked))).not.toContain('e')
      const done = accept(picked, { targetInstanceId: 'mine' })
      expect(U(done, 'mine')!.upgrades).toEqual([upgrade(TOKEN_EXPERIENCE, 'player')])
      expect(U(done, 'e')!.upgrades).toEqual([upgrade('UPG', 'opponent')])
    }
  })

  it("SHD_064 Survivors' Gauntlet may move an upgrade to another unit its host's controller controls, when played and on attack", () => {
    const theirs = { units: [unit('e1', 'GRD', { upgrades: [upgrade('UPG', 'opponent')] }), unit('e2', 'GRD')] }
    for (const fired of [played(board({ units: [unit('mine', 'GRD')] }, theirs), 'SHD_064'), attacking('SHD_064', { units: [unit('mine', 'GRD')] }, theirs)]) {
      expect(choice(fired)).toMatchObject({ kind: 'selectUpgradeThen', optional: true })
      const picked = accept(fired, { optionIndex: 0 })
      expect(targetsOf(choice(picked))).toEqual(['e2'])
      const done = accept(picked, { targetInstanceId: 'e2' })
      expect(U(done, 'e2')!.upgrades).toEqual([upgrade('UPG', 'opponent')])
      expect(U(done, 'e1')!.upgrades).toHaveLength(0)
    }
  })

  it('SHD_142 Pre Vizsla may pay for an upgrade on another non-Vehicle unit and take it, when played and on attack', () => {
    const theirs = { units: [unit('e', 'GRD', { upgrades: [upgrade('UPG', 'opponent')] }), unit('v', 'VEH', { upgrades: [upgrade('UPG', 'opponent')] })] }
    for (const fired of [played(board({}, theirs), 'SHD_142'), attacking('SHD_142', { resources: ready(10) }, theirs)]) {
      const c = choice(fired) as Extract<PendingChoice, { kind: 'selectUpgradeThen' }>
      expect(c).toMatchObject({ kind: 'selectUpgradeThen', optional: true })
      expect(c.candidates.map(x => x.unitId)).toEqual(['e'])
      const readyBefore = fired.players.player.resources.filter(r => !r.exhausted).length
      const done = accept(fired, { optionIndex: 0 })
      const vizsla = done.players.player.units.find(u => u.cardId === 'SHD_142')!
      expect(vizsla.upgrades).toEqual([upgrade('UPG', 'player')])
      expect(U(done, 'e')!.upgrades).toHaveLength(0)
      expect(done.players.player.resources.filter(r => !r.exhausted).length, 'paid its cost').toBe(readyBefore - 2)
    }
  })

  it("SHD_142 defeats the taken upgrade when it can't attach to Pre Vizsla", () => {
    // Mark My Words attaches only to a damaged unit, and Pre Vizsla is undamaged as he is played.
    const s = played(board({}, { units: [unit('e', 'GRD', { damage: 1, upgrades: [upgrade('ASH_181', 'opponent')] })] }), 'SHD_142')
    const done = accept(s, { optionIndex: 0 })
    expect(U(done, 'e')!.upgrades).toHaveLength(0)
    expect(done.players.player.units.find(u => u.cardId === 'SHD_142')!.upgrades).toHaveLength(0)
    expect(done.players.opponent.discard).toContain('ASH_181')
  })

  it('LAW_224 Liberty exhausts an enemy unit and returns its upgrades that cost 4 or less, when played and on attack', () => {
    const theirs = () => ({ units: [unit('e', 'GRD', { upgrades: [upgrade('UPG', 'opponent'), upgrade('UPG5', 'opponent')] })] })
    for (const fired of [played(board({ units: [unit('mine', 'GRD')] }, theirs()), 'LAW_224'), attacking('LAW_224', { units: [unit('mine', 'GRD')] }, theirs())]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUnitThen' })
      expect(c).not.toMatchObject({ optional: true })
      expect(targetsOf(c)).toEqual(['e'])
      const done = accept(fired, { targetInstanceId: 'e' })
      expect(U(done, 'e')!.exhausted).toBe(true)
      expect(U(done, 'e')!.upgrades).toEqual([upgrade('UPG5', 'opponent')])
      expect(done.players.opponent.hand).toContain('UPG')
    }
  })
})

describe('compound trigger heads, G: units returned, readied and defeated', () => {
  it('SOR_040 Avenger has an opponent choose a non-leader unit they control to defeat, when played and on attack', () => {
    const theirs = { units: [unit('e', 'GRD'), unit('lead', 'GRD', { isLeader: true })] }
    for (const fired of [played(board({ units: [unit('mine', 'GRD')] }, theirs), 'SOR_040'), attacking('SOR_040', { units: [unit('mine', 'GRD')] }, theirs)]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUnitToDefeat', controller: 'opponent' })
      expect(targetsOf(c)).toEqual(['e'])
      expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')).toBeUndefined()
    }
  })

  it("TWI_198 Enfys Nest may return an enemy non-leader unit with less power than her, when played and on attack", () => {
    const theirs = { units: [unit('weak', 'WEAK'), unit('strong', 'STRONG'), unit('lead', 'WEAK', { isLeader: true })] }
    for (const fired of [played(board({ units: [unit('mine', 'WEAK')] }, theirs), 'TWI_198'), attacking('TWI_198', { units: [unit('mine', 'WEAK')] }, theirs)]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUnitToReturn', optional: true })
      expect(targetsOf(c)).toEqual(['weak'])
      expect(accept(fired, { targetInstanceId: 'weak' }).players.opponent.hand).toContain('WEAK')
    }
  })

  it('SHD_191 Xanadu Blood may return another friendly Underworld unit, then exhausts an enemy unit or resource', () => {
    for (const fired of [
      played(board({ units: [unit('u', 'UNDER'), unit('plain', 'GRD')] }, { units: [unit('e', 'GRD')], resources: ready(3) }), 'SHD_191'),
      attacking('SHD_191', { units: [unit('u', 'UNDER'), unit('plain', 'GRD')] }, { units: [unit('e', 'GRD')], resources: ready(3) }),
    ]) {
      const c = choice(fired)
      expect(c).toMatchObject({ kind: 'selectUnitThen', optional: true })
      expect(targetsOf(c)).toEqual(['u'])
      const returned = accept(fired, { targetInstanceId: 'u' })
      expect(returned.players.player.hand).toContain('UNDER')
      expect(choice(returned)).toMatchObject({ kind: 'chooseMode', modes: ['unit', 'resource'] })
      const unitMode = accept(returned, { optionIndex: 0 })
      expect(targetsOf(choice(unitMode))).toEqual(['e'])
      expect(U(accept(unitMode, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
      const resMode = accept(returned, { optionIndex: 1 })
      expect(resMode.players.opponent.resources.filter(r => r.exhausted)).toHaveLength(1)
      expect(skip(fired).players.player.hand, 'declined: nothing returned').not.toContain('UNDER')
    }
  })

  it("LAW_185 Ben Solo readies another friendly unit, which can't be attacked this phase, when played and when defeated", () => {
    for (const fired of [
      played(board({ units: [unit('mate', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD', { exhausted: true })] }), 'LAW_185'),
      killed(board({ units: [unit('src', 'LAW_185'), unit('mate', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD', { exhausted: true })] })),
    ]) {
      const c = choice(fired)
      expect(targetsOf(c)).toEqual(['mate'])
      const done = accept(fired, { targetInstanceId: 'mate' })
      expect(U(done, 'mate')!.exhausted).toBe(false)
      expect(unitCannotBeAttacked(done, U(done, 'mate')!)).toBe(true)
    }
  })

  it('JTL_219 Rafa Martez deals 1 to a friendly unit and readies a resource, when played and on attack', () => {
    const s = played(board({ units: [unit('mate', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'JTL_219')
    const c = choice(s)
    expect(c).not.toMatchObject({ optional: true })
    expect(targetsOf(c)).toContain('mate')
    expect(targetsOf(c)).not.toContain('e')
    // One of the resources paid to play it is readied again.
    const paid = effectiveCost(board(), 'player', F['JTL_219'])
    expect(s.players.player.resources.filter(r => r.exhausted)).toHaveLength(paid - 1)
    expect(U(accept(s, { targetInstanceId: 'mate' }), 'mate')!.damage).toBe(1)
    const onAttack = attacking('JTL_219', { units: [unit('mate', 'GRD')], resources: [{ cardId: 'R0', exhausted: true }] })
    expect(onAttack.players.player.resources[0].exhausted).toBe(false)
    expect(targetsOf(choice(onAttack))).toContain('mate')
  })
})

describe('compound trigger heads, H: targets chosen by a rule', () => {
  it('SEC_244 Darth Nihilus hits the other unit with the least remaining HP, ties chosen, and grows on a non-Vehicle', () => {
    const units = { units: [unit('a', 'GRD', { damage: 6 }), unit('c', 'GRD', { damage: 3 })] }
    const theirs = { units: [unit('b', 'VEH', { damage: 6 })] }
    for (const fired of [played(board(units, theirs), 'SEC_244'), attacking('SEC_244', units, theirs)]) {
      const c = choice(fired)
      expect(targetsOf(c).sort(), 'the two tied on 2 remaining HP').toEqual(['a', 'b'])
      const nihilus = (s: GameState) => s.players.player.units.find(u => u.cardId === 'SEC_244')
      const onA = accept(fired, { targetInstanceId: 'a' })
      expect(U(onA, 'a'), 'defeated by the 3').toBeUndefined()
      expect(expCount(nihilus(onA))).toBe(1)
      const onB = accept(fired, { targetInstanceId: 'b' })
      expect(U(onB, 'b')).toBeUndefined()
      expect(expCount(nihilus(onB)), 'a Vehicle gives nothing').toBe(0)
    }
  })

  it('TWI_151 Resolute deals 2 to an enemy unit and each other enemy unit of its name, and costs 1 less per 5 base damage', () => {
    const setup = { units: [unit('mine', 'TWIN_A')] }
    const theirs = { units: [unit('t1', 'TWIN_A'), unit('t2', 'TWIN_B'), unit('o', 'GRD')] }
    for (const fired of [played(board(setup, theirs), 'TWI_151'), attacking('TWI_151', setup, theirs)]) {
      expect(targetsOf(choice(fired)).sort()).toEqual(['o', 't1', 't2'])
      const done = accept(fired, { targetInstanceId: 't1' })
      expect(U(done, 't1')!.damage).toBe(2)
      expect(U(done, 't2')!.damage).toBe(2)
      expect(U(done, 'o')!.damage).toBe(0)
      expect(U(done, 'mine')!.damage, 'a friendly namesake is spared').toBe(0)
    }
    const at = (dmg: number) => effectiveCost(board({ base: { cardId: 'VIG_BASE', damage: dmg } }), 'player', F['TWI_151'])
    expect(at(10)).toBe(at(0) - 2)
    expect(at(14)).toBe(at(10))
  })

  it('LAW_101 Lawbringer gives each enemy unit of the chosen aspect -2/-2 for this phase, when played and on attack', () => {
    const theirs = { units: [unit('agg', 'AGG'), unit('cun', 'CUN')] }
    for (const fired of [played(board({ units: [unit('mine', 'AGG')] }, theirs), 'LAW_101'), attacking('LAW_101', { units: [unit('mine', 'AGG')] }, theirs)]) {
      const c = choice(fired) as Extract<PendingChoice, { kind: 'chooseMode' }>
      expect(c.kind).toBe('chooseMode')
      const done = accept(fired, { optionIndex: c.modes.indexOf('Aggression') })
      expect(effectivePower(done, U(done, 'agg')!)).toBe(2)
      expect(effectivePower(done, U(done, 'cun')!)).toBe(4)
      expect(effectivePower(done, U(done, 'mine')!), 'not a friendly unit').toBe(4)
    }
  })

  it('LAW_178 Persecutor chooses an arena, then may deal 3 to each unit in it, when played and on attack', () => {
    const units = { units: [unit('mine', 'GRD')] }
    const theirs = { units: [unit('e', 'GRD'), unit('es', 'SPC')] }
    for (const fired of [played(board(units, theirs), 'LAW_178'), attacking('LAW_178', units, theirs)]) {
      expect(choice(fired)).toMatchObject({ kind: 'chooseArenaThen' })
      const ground = accept(fired, { optionIndex: 0 })
      expect(choice(ground)).toMatchObject({ kind: 'mayPayThen' })
      const done = accept(ground)
      expect(U(done, 'mine')!.damage).toBe(3)
      expect(U(done, 'e')!.damage).toBe(3)
      expect(U(done, 'es')!.damage).toBe(0)
      expect(U(skip(ground), 'e')!.damage, 'the damage is a may').toBe(0)
    }
  })

  it('SHD_171 Covetous Rivals may deal 2 to a unit with a Bounty, when played and on attack', () => {
    const theirs = { units: [unit('b', 'BOUNTY'), unit('plain', 'GRD')] }
    for (const fired of [played(board({}, theirs), 'SHD_171'), attacking('SHD_171', {}, theirs)]) {
      expect(choice(fired)).toMatchObject({ amount: 2, optional: true })
      expect(targetsOf(choice(fired))).toEqual(['b'])
    }
  })

  it("SHD_091 Jabba's Rancor deals 3 to another friendly ground unit and 3 to an enemy ground unit, and costs 1 less with Jabba", () => {
    const units = { units: [unit('mate', 'GRD'), unit('sp', 'SPC')] }
    const theirs = { units: [unit('e', 'GRD'), unit('es', 'SPC')] }
    for (const fired of [played(board(units, theirs), 'SHD_091'), attacking('SHD_091', units, theirs)]) {
      expect(targetsOf(choice(fired))).toEqual(['mate'])
      const first = accept(fired, { targetInstanceId: 'mate' })
      expect(U(first, 'mate')!.damage).toBe(3)
      expect(targetsOf(choice(first))).toEqual(['e'])
      expect(U(accept(first, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
    }
    // No other friendly ground unit: straight to the enemy.
    expect(targetsOf(choice(played(board({}, theirs), 'SHD_091')))).toEqual(['e'])
    const cost = (s: GameState) => effectiveCost(s, 'player', F['SHD_091'])
    expect(cost(board({ units: [unit('j', 'JABBA')] }))).toBe(cost(board()) - 1)
  })
})

describe('compound trigger heads, I: the rest', () => {
  it('SHD_103 General Rieekan gives a Sentinel unit an Experience token, and any other Sentinel, when played and on attack', () => {
    const units = { units: [unit('sent', 'SENT'), unit('plain', 'GRD')] }
    for (const fired of [played(board(units), 'SHD_103'), attacking('SHD_103', units)]) {
      expect(targetsOf(choice(fired))).toEqual(expect.arrayContaining(['sent', 'plain']))
      expect(expCount(U(accept(fired, { targetInstanceId: 'sent' }), 'sent'))).toBe(1)
      const plain = accept(fired, { targetInstanceId: 'plain' })
      expect(unitHasKeyword(plain, U(plain, 'plain')!, 'Sentinel')).toBe(true)
      expect(expCount(U(plain, 'plain'))).toBe(0)
    }
  })

  it('LOF_082 Vaneé may trade an Experience token on a friendly unit for one on a friendly unit, when played and on attack', () => {
    const units = { units: [unit('x', 'GRD', { upgrades: [upgrade(TOKEN_EXPERIENCE, 'player')] }), unit('y', 'GRD')] }
    for (const fired of [played(board(units, { units: [unit('e', 'GRD')] }), 'LOF_082'), attacking('LOF_082', units, { units: [unit('e', 'GRD')] })]) {
      const c = choice(fired)
      expect(c).toMatchObject({ optional: true })
      expect(targetsOf(c)).toEqual(['x'])
      const spent = accept(fired, { targetInstanceId: 'x' })
      expect(expCount(U(spent, 'x'))).toBe(0)
      expect(targetsOf(choice(spent))).not.toContain('e')
      expect(expCount(U(accept(spent, { targetInstanceId: 'y' }), 'y'))).toBe(1)
    }
  })

  it('LAW_158 Khetanna makes the next Underworld unit cost 1 less, when played and on attack', () => {
    for (const fired of [played(board(), 'LAW_158'), attacking('LAW_158')]) {
      expect(effectiveCost(fired, 'player', F['UNDER'])).toBe(effectiveCost(board(), 'player', F['UNDER']) - 1)
      expect(effectiveCost(fired, 'player', F['GRD'])).toBe(effectiveCost(board(), 'player', F['GRD']))
    }
  })

  it("TS26_38 Dooku's Solar Sailer gives another Separatist unit an Experience token once a base was healed this phase", () => {
    const units = { units: [unit('sep', 'SEP'), unit('plain', 'GRD')], base: { cardId: 'VIG_BASE', damage: 4 } }
    const theirs = { units: [unit('esep', 'SEP')] }
    noChoice(played(board(units, theirs), 'TS26_38'))
    const healed = healBase(board(units, theirs), 'player', 1)
    for (const fired of [played(healed, 'TS26_38'), attack({ ...healed, players: { ...healed.players, player: { ...healed.players.player, units: [...healed.players.player.units, unit('src', 'TS26_38')] } } }, 'src')]) {
      expect(targetsOf(choice(fired)).sort()).toEqual(['esep', 'sep'])
      expect(expCount(U(accept(fired, { targetInstanceId: 'sep' }), 'sep'))).toBe(1)
    }
  })

  it('TS26_49 Separatist Council creates a Battle Droid, or gives 2 Experience tokens to a Battle Droid token, when played and on attack', () => {
    const lone = played(board(), 'TS26_49')
    expect(choice(lone)).toMatchObject({ kind: 'chooseMode', modes: ['droid'] })
    expect(tokenUnits(accept(lone, { optionIndex: 0 }), 'player', 'Battle Droid')).toBe(1)
    const units = { units: [unit('bd', TOKEN_BATTLE_DROID)] }
    for (const fired of [played(board(units), 'TS26_49'), attacking('TS26_49', units)]) {
      expect(choice(fired)).toMatchObject({ kind: 'chooseMode', modes: ['droid', 'exp'] })
      const exp = accept(fired, { optionIndex: 1 })
      expect(targetsOf(choice(exp))).toEqual(['bd'])
      expect(expCount(U(accept(exp, { targetInstanceId: 'bd' }), 'bd'))).toBe(2)
    }
  })
})
