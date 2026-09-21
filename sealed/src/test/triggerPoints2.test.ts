import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import { healUnit } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { TOKEN_BATTLE_DROID, TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { effectiveCost } from '../engine/legalMoves'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { unitHasKeyword } from '../engine/keywords'
import { getCardDefinition } from '../engine/abilities'
import { recordUnitAttacked } from '../engine/types'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * The trigger heads of the second trigger-points ticket. Every one reads an event the engine already
 * dispatches, so nothing here adds a trigger point.
 *
 * "When this unit completes an attack (and survives)" is `onAttackEnd`. That point fires for an
 * attacker the combat defeated too (CR 7.6), so "(and survives)" is a guard the card applies, and each
 * card printed with it is tested both ways.
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  JTL_070: card({ id: 'JTL_070', name: 'U-Wing Lander', type: 'unit', arena: 'space', cost: 5, power: 2, hp: 2, traits: ['Rebel', 'Vehicle', 'Transport'] }),
  JTL_089: card({ id: 'JTL_089', name: 'The Invisible Hand', type: 'unit', arena: 'space', cost: 6, power: 6, hp: 6, traits: ['Separatist', 'Vehicle', 'Capital Ship'] }),
  LOF_038: card({ id: 'LOF_038', name: 'Pong Krell', type: 'unit', arena: 'ground', cost: 7, power: 2, hp: 9, traits: ['Force', 'Jedi', 'Republic'], keywords: [{ name: 'Grit' }] }),
  SEC_048: card({ id: 'SEC_048', name: 'Captain Rex', type: 'unit', arena: 'ground', cost: 6, power: 7, hp: 7, traits: ['Republic', 'Clone', 'Trooper'], keywords: [{ name: 'Sentinel' }] }),
  SEC_174: card({ id: 'SEC_174', name: "Saw Gerrera's U-Wing", type: 'unit', arena: 'space', cost: 6, power: 4, hp: 8, aspects: ['Aggression'], traits: ['Rebel', 'Vehicle', 'Fighter'], keywords: [{ name: 'Saboteur' }] }),
  SHD_059: card({ id: 'SHD_059', name: 'Embo', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 4, traits: ['Underworld', 'Bounty Hunter'] }),
  SOR_146: card({ id: 'SOR_146', name: 'Zeb Orrelios', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 5, traits: ['Rebel', 'Spectre'] }),
  SOR_192: card({ id: 'SOR_192', name: 'Ezra Bridger', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 4, traits: ['Force', 'Rebel', 'Spectre'] }),
  TWI_053: card({ id: 'TWI_053', name: 'Finn', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 4, traits: ['Fringe', 'Trooper'], unique: true }),
  // Props
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  VEH: card({ id: 'VEH', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6, traits: ['Vehicle'] }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  SMALLSP: card({ id: 'SMALLSP', type: 'unit', arena: 'space', cost: 1, power: 1, hp: 1 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 4, power: 9, hp: 12 }),
  BIGSP: card({ id: 'BIGSP', type: 'unit', arena: 'space', cost: 4, power: 9, hp: 12 }),
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', cost: 4, power: 1, hp: 20 }),
  AGG: card({ id: 'AGG', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Aggression'] }),
  UNIQ: card({ id: 'UNIQ', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6, unique: true }),
  DROID2: card({ id: 'DROID2', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 1, traits: ['Droid'] }),
  DROID5: card({ id: 'DROID5', type: 'unit', arena: 'ground', cost: 5, power: 1, hp: 1, traits: ['Droid'] }),
  DROIDEV: card({ id: 'DROIDEV', type: 'event', cost: 1, traits: ['Droid'] }),
}

/**
 * `unit()` reads the arena off the SHARED fixture pool, so it is stated here from `P`, the widest of
 * the maps below (each extends the one before). Read at call time, inside the tests, once all exist.
 */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: P[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...mine }),
    opponent: player({ resources: ready(10), deck: [], ...theirs }),
  },
})
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? [], 'no choice is raised').toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const optional = (c: PendingChoice): boolean => 'optional' in c && c.optional === true
const targetsOf =(c: PendingChoice): string[] => ('targets' in c ? [...(c.targets as string[])] : 'unitTargets' in c ? [...(c.unitTargets as string[])] : []).sort()
const attackBase = (s: GameState, attackerId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })

// ── "When this unit completes an attack (and survives)" ───────────────────────────────────────

describe('JTL_070 U-Wing Lander', () => {
  const lander = () => unit('l', 'JTL_070', { upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: TOKEN_EXPERIENCE, owner: 'player' }] })

  it('may move an upgrade on itself to another friendly Vehicle unit', () => {
    const s = board({ units: [lander(), unit('v', 'VEH'), unit('g', 'GRD'), unit('o', 'SPC', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] })
    const swung = attackBase(s, 'l')
    const pick = choice(swung)
    expect(pick.kind).toBe('selectUpgradeThen')
    expect(pick.kind === 'selectUpgradeThen' ? pick.candidates.map(c => c.unitId) : [], 'only the upgrades on this unit').toEqual(['l', 'l'])
    const where = accept(swung, { optionIndex: 0 })
    expect(targetsOf(choice(where)), 'another friendly Vehicle').toEqual(['v'])
    const moved = accept(where, { targetInstanceId: 'v' })
    expect(U(moved, 'v')!.upgrades.map(u => u.cardId)).toEqual(['UPG'])
    expect(U(moved, 'l')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
  })

  it('offers nothing when it did not survive the attack', () => {
    const s = board({ units: [lander(), unit('v', 'VEH')] }, { units: [unit('e', 'BIGSP')] })
    const swung = attackUnit(s, 'l', 'e')
    expect(U(swung, 'l')).toBeUndefined()
    noChoice(swung)
  })
})

describe('JTL_089 The Invisible Hand', () => {
  const deck = ['DROIDEV', 'DROID5', 'DROID2', 'GRD']
  it('searches the top 8 for a Droid unit on attack, and may play it for free if it costs 2 or less', () => {
    const swung = attackBase(board({ units: [unit('h', 'JTL_089')], deck }), 'h')
    const c = choice(swung)
    expect(c.kind).toBe('searchDraw')
    expect(c.kind === 'searchDraw' ? c.eligibleIndices : [], 'Droid units only').toEqual([1, 2])
    const drawn = accept(swung, { deckIndex: 2 })
    expect(drawn.players.player.hand).toEqual(['DROID2'])
    const offer = choice(drawn)
    expect(offer).toMatchObject({ kind: 'playCardFrom', zone: 'hand', free: true, optional: true })
    const played = accept(drawn, { optionIndex: 0 })
    expect(played.players.player.units.map(u => u.cardId)).toContain('DROID2')
    expect(played.players.player.resources.every(r => !r.exhausted), 'for free').toBe(true)
  })

  it('offers no free play for a Droid that costs more than 2', () => {
    const swung = attackBase(board({ units: [unit('h', 'JTL_089')], deck }), 'h')
    const drawn = accept(swung, { deckIndex: 1 })
    expect(drawn.players.player.hand).toEqual(['DROID5'])
    noChoice(drawn)
  })

  it('offers no free play when the search is declined', () => {
    const swung = attackBase(board({ units: [unit('h', 'JTL_089')], hand: ['DROID2'], deck }), 'h')
    noChoice(skip(swung))
  })

  it('searches when played too, and not on an attack it did not survive', () => {
    const def = getCardDefinition('JTL_089')
    expect(def?.abilities?.map(a => a.trigger)).toEqual(['whenPlayed', 'onAttackEnd'])
    const s = board({ units: [unit('h', 'JTL_089')], deck }, { units: [unit('e', 'BIGSP')] })
    noChoice(attackUnit(s, 'h', 'e'))
  })
})

describe('LOF_038 Pong Krell', () => {
  it('may defeat a unit with less remaining HP than his power', () => {
    // Power 2: remaining HP 1 qualifies, 2 does not.
    const s = board({ units: [unit('p', 'LOF_038'), unit('f', 'SMALL')] }, { units: [unit('a', 'GRD', { damage: 5 }), unit('b', 'GRD', { damage: 4 })] })
    const swung = attackBase(s, 'p')
    expect(targetsOf(choice(swung))).toEqual(['a', 'f'])
    expect(optional(choice(swung))).toBe(true)
    expect(U(accept(swung, { targetInstanceId: 'a' }), 'a')).toBeUndefined()
  })

  it('offers nothing when he did not survive the attack', () => {
    const s = board({ units: [unit('p', 'LOF_038', { damage: 8 }), unit('f', 'SMALL')] }, { units: [unit('e', 'BIG')] })
    noChoice(attackUnit(s, 'p', 'e'))
  })
})

describe('SEC_048 Captain Rex', () => {
  const sentinelFor = (s: GameState, id: string) =>
    (s.lastingEffects ?? []).some(e => e.targetInstanceId === id && (e.keywords ?? []).some(k => k.name === 'Sentinel'))

  it('gives himself and an enemy unit Sentinel for this phase when he completes an attack', () => {
    const s = board({ units: [unit('r', 'SEC_048'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] })
    const swung = attackBase(s, 'r')
    // His printed Sentinel would pass a keyword check vacuously, so read the lasting effect.
    expect(sentinelFor(swung, 'r')).toBe(true)
    expect(targetsOf(choice(swung)), 'an enemy unit').toEqual(['e', 'sp'])
    const done = accept(swung, { targetInstanceId: 'sp' })
    expect(unitHasKeyword(done, U(done, 'sp')!, 'Sentinel')).toBe(true)
  })

  it('does the same when played', () => {
    expect(getCardDefinition('SEC_048')?.abilities?.map(a => a.trigger)).toEqual(['whenPlayed', 'onAttackEnd'])
  })
})

describe("SEC_174 Saw Gerrera's U-Wing", () => {
  it('may attack with another Aggression unit when it survives', () => {
    const s = board({ units: [unit('w', 'SEC_174'), unit('a', 'AGG'), unit('g', 'GRD')] })
    const swung = attackBase(s, 'w')
    const c = choice(swung)
    expect(c.kind).toBe('mayAttackAnyUnit')
    expect(optional(c)).toBe(true)
    expect(c.kind === 'mayAttackAnyUnit' ? c.attacker?.only : undefined).toEqual(['a'])
  })

  it('offers nothing when it did not survive the attack', () => {
    const s = board({ units: [unit('w', 'SEC_174', { damage: 7 }), unit('a', 'AGG')] }, { units: [unit('e', 'BIGSP')] })
    noChoice(attackUnit(s, 'w', 'e'))
  })
})

describe('SHD_059 Embo', () => {
  it('heals up to 2 damage from a unit when the defender was defeated', () => {
    const s = board({ units: [unit('m', 'SHD_059'), unit('f', 'GRD', { damage: 3 }), unit('g', 'GRD')] }, { units: [unit('e', 'SMALL')] })
    const swung = attackUnit(s, 'm', 'e')
    expect(U(swung, 'e')).toBeUndefined()
    const c = choice(swung)
    expect(c.kind).toBe('selectHealTarget')
    expect(targetsOf(c), 'a damaged unit').toEqual(['f', 'm'])
    expect(U(accept(swung, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it('does nothing when the defender survived', () => {
    const s = board({ units: [unit('m', 'SHD_059'), unit('f', 'GRD', { damage: 3 })] }, { units: [unit('e', 'TOUGH')] })
    noChoice(attackUnit(s, 'm', 'e'))
  })
})

describe('SOR_146 Zeb Orrelios', () => {
  it('may deal 4 damage to a ground unit when the defender was defeated', () => {
    const s = board({ units: [unit('z', 'SOR_146'), unit('sp', 'SPC')] }, { units: [unit('e', 'SMALL'), unit('g', 'GRD'), unit('esp', 'SPC')] })
    const swung = attackUnit(s, 'z', 'e')
    const c = choice(swung)
    expect(c).toMatchObject({ kind: 'selectDamageTarget', amount: 4, optional: true })
    expect(targetsOf(c), 'ground units, either side').toEqual(['g', 'z'])
    expect(U(accept(swung, { targetInstanceId: 'g' }), 'g')!.damage).toBe(4)
  })

  it('does nothing on a base attack', () => {
    noChoice(attackBase(board({ units: [unit('z', 'SOR_146')] }, { units: [unit('g', 'GRD')] }), 'z'))
  })
})

describe('SOR_192 Ezra Bridger', () => {
  it('looks at the top card: he may play it, or discard it, or leave it', () => {
    const s = board({ units: [unit('ez', 'SOR_192')], deck: ['GRD', 'SMALL'] })
    const swung = attackBase(s, 'ez')
    expect(choice(swung)).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', optional: true })
    expect((choice(swung) as { costDelta?: number }).costDelta, 'at its printed cost').toBeUndefined()
    const played = accept(swung, { optionIndex: 0 })
    expect(played.players.player.units.map(u => u.cardId)).toContain('GRD')
    // Declining the play offers the discard, and declining that leaves it on top.
    const declined = skip(swung)
    const discarded = accept(declined)
    expect(discarded.players.player.discard).toEqual(['GRD'])
    expect(discarded.players.player.deck).toEqual(['SMALL'])
    const left = skip(declined)
    expect(left.players.player.deck).toEqual(['GRD', 'SMALL'])
  })
})

describe('TWI_053 Finn', () => {
  it('chooses a unique unit, which prevents 1 of each damage dealt to it this phase', () => {
    const s = board({ units: [unit('fn', 'TWI_053'), unit('g', 'GRD')] }, { units: [unit('u', 'UNIQ')] })
    const swung = attackBase(s, 'fn')
    const c = choice(swung)
    expect(targetsOf(c), 'unique units only, himself included').toEqual(['fn', 'u'])
    expect(optional(c), 'the choice is not optional').toBe(false)
    const chosen = accept(swung, { targetInstanceId: 'u' })
    const once = dealDamageToUnit(chosen, 'u', 3)
    expect(U(once, 'u')!.damage).toBe(2)
    const twice = dealDamageToUnit(once, 'u', 2)
    expect(U(twice, 'u')!.damage, 'every instance, not only the next').toBe(3)
    expect(U(dealDamageToUnit(chosen, 'g', 3), 'g')!.damage, 'only that unit').toBe(3)
  })
})

// ── "When a friendly / another friendly / an enemy unit attacks" ──────────────────────────────
// `whenUnitAttacks`: the same event as the attacker's own On Attack, heard by both players' leaders,
// bases and units, with the attacker in `ctx.attackerInstanceId` and its controller in
// `ctx.attackingPlayer`. Every registration states its side, so each card is tested from the far side.

const A: Record<string, EngineCard> = {
  ...F,
  HMW_014: card({ id: 'HMW_014', name: 'Wicket', type: 'leader', arena: 'ground', cost: 4, power: 2, hp: 5, aspects: ['Aggression', 'Heroism'], traits: ['Ewok'] }),
  SEC_081: card({ id: 'SEC_081', name: 'Major Partagaz', type: 'unit', arena: 'ground', cost: 2, power: 0, hp: 6, traits: ['Imperial', 'Official'], keywords: [{ name: 'Overwhelm' }] }),
  LAW_112: card({ id: 'LAW_112', name: 'Boonta Eve Flagbearer', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 3, traits: ['Fringe'] }),
  TS26_78: card({ id: 'TS26_78', name: 'Barriss Offee', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6, traits: ['Force', 'Jedi', 'Republic'], keywords: [{ name: 'Hidden' }] }),
  OFF: card({ id: 'OFF', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['Official'] }),
  PRICEY: card({ id: 'PRICEY', type: 'unit', arena: 'ground', cost: 5, power: 1, hp: 20 }),
}
const aBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: A })
const drawn = (s: GameState) => s.players.player.hand.length

describe('HMW_014 Wicket', () => {
  const wicketFront = (mine: Side = {}, theirs: Side = {}) =>
    aBoard({ leader: { cardId: 'HMW_014', deployed: false, epicActionUsed: false, exhausted: false }, deck: ['GRD', 'GRD'], ...mine }, theirs)

  it('front: when a friendly unit attacks a unit that costs more than it, may exhaust himself to draw a card', () => {
    const swung = attackUnit(wicketFront({ units: [unit('g', 'GRD')] }, { units: [unit('e', 'PRICEY')] }), 'g', 'e')
    expect(choice(swung)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const paid = accept(swung)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(drawn(paid)).toBe(1)
  })

  it('front: not against a unit that costs the same or less, not on a base, not for an enemy attacker, not while exhausted', () => {
    noChoice(attackUnit(wicketFront({ units: [unit('g', 'GRD')] }, { units: [unit('e', 'SMALL')] }), 'g', 'e'))
    noChoice(attackBase(wicketFront({ units: [unit('g', 'GRD')] }), 'g'))
    noChoice(attackUnit(wicketFront({ units: [unit('p', 'PRICEY')] }, { units: [unit('e', 'GRD')] }), 'e', 'p', 'opponent'))
    const tired = wicketFront({ units: [unit('g', 'GRD')] }, { units: [unit('e', 'PRICEY')] })
    noChoice(attackUnit({ ...tired, players: { ...tired.players, player: { ...tired.players.player, leader: { ...tired.players.player.leader, exhausted: true } } } }, 'g', 'e'))
  })

  it('back: On Attack, draws a card if you control a unit that costs 3 or less', () => {
    const deployed = (units: UnitState[]) =>
      aBoard({ leader: { cardId: 'HMW_014', deployed: true, epicActionUsed: true, exhausted: false }, deck: ['GRD'], units: [unit('L', 'HMW_014', { isLeader: true }), ...units] })
    expect(drawn(attackBase(deployed([unit('g', 'GRD')]), 'L'))).toBe(1)
    expect(drawn(attackBase(deployed([unit('p', 'PRICEY')]), 'L'))).toBe(0)
  })
})

describe('SEC_081 Major Partagaz', () => {
  const buffed = (s: GameState) => (s.lastingEffects ?? []).some(e => e.targetInstanceId === 'pz' && e.power === 2 && e.hp === 2)
  it('gets +2/+2 for this phase when another friendly Official unit attacks', () => {
    expect(buffed(attackBase(aBoard({ units: [unit('pz', 'SEC_081'), unit('o', 'OFF')] }), 'o'))).toBe(true)
  })
  it('not for a non-Official, not for himself, not for an enemy Official', () => {
    expect(buffed(attackBase(aBoard({ units: [unit('pz', 'SEC_081'), unit('g', 'GRD')] }), 'g'))).toBe(false)
    expect(buffed(attackBase(aBoard({ units: [unit('pz', 'SEC_081')] }), 'pz'))).toBe(false)
    expect(buffed(attackBase(aBoard({ units: [unit('pz', 'SEC_081')] }, { units: [unit('o', 'OFF')] }), 'o', 'opponent'))).toBe(false)
  })
})

describe('LAW_112 Boonta Eve Flagbearer', () => {
  const hurt = (units: UnitState[], theirs: UnitState[] = []) => {
    const s = aBoard({ units }, { units: theirs })
    return { ...s, players: { ...s.players, player: { ...s.players.player, base: { ...s.players.player.base, damage: 5 } } } }
  }
  it('heals 2 from your base when a friendly unit makes the first attack of the phase', () => {
    expect(attackBase(hurt([unit('fb', 'LAW_112'), unit('g', 'GRD')]), 'g').players.player.base.damage).toBe(3)
    expect(attackBase(hurt([unit('fb', 'LAW_112')]), 'fb').players.player.base.damage, 'including itself').toBe(3)
  })
  it('not when another unit, of either side, has attacked this phase, and not for an enemy attack', () => {
    const first = attackBase(hurt([unit('fb', 'LAW_112'), unit('g', 'GRD'), unit('h', 'GRD')]), 'g')
    expect(attackBase(first, 'h').players.player.base.damage).toBe(3)
    const s = hurt([unit('fb', 'LAW_112'), unit('g', 'GRD')], [unit('e', 'GRD')])
    const enemyFirst = recordUnitAttacked(s, 'e')
    expect(attackBase(enemyFirst, 'g').players.player.base.damage).toBe(5)
    expect(attackUnit(s, 'e', 'g', 'opponent').players.player.base.damage).toBe(5)
  })
})

describe('TS26_78 Barriss Offee', () => {
  it('may give an Experience token to an enemy unit that attacks', () => {
    const swung = attackBase(aBoard({ units: [unit('b', 'TS26_78')] }, { units: [unit('e', 'GRD')] }), 'e', 'opponent')
    const c = choice(swung)
    expect(c).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_EXPERIENCE, controller: 'player' })
    expect(targetsOf(c)).toEqual(['e'])
    expect(optional(c)).toBe(true)
    expect(U(accept(swung, { targetInstanceId: 'e' }), 'e')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
  })
  it('not for a friendly attack', () => {
    noChoice(attackBase(aBoard({ units: [unit('b', 'TS26_78'), unit('g', 'GRD')] }), 'g'))
  })
})

// ── "When you play an event" ──────────────────────────────────────────────────────────────────
// `whenPlayCard`, which covers a card of any type and fires on both players: each card states the
// type and the side.

const E: Record<string, EngineCard> = {
  ...A,
  SOR_182: card({ id: 'SOR_182', name: 'Bossk', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5, traits: ['Underworld', 'Bounty Hunter'], keywords: [{ name: 'Ambush' }] }),
  TWI_216: card({ id: 'TWI_216', name: 'Fives', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 5, traits: ['Republic', 'Clone', 'Trooper'], keywords: [{ name: 'Saboteur' }] }),
  TS26_8: card({ id: 'TS26_8', name: 'Ahsoka Tano', type: 'leader', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Force'], keywords: [{ name: 'Raid', value: 1 }] }),
  CLONE: card({ id: 'CLONE', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Clone'] }),
  CLONEEV: card({ id: 'CLONEEV', type: 'event', cost: 1, traits: ['Clone'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
}
const eBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: E })
const playEvent = (s: GameState, who: PlayerId = 'player') => resolve({ ...s, activePlayer: who }, { type: 'playEvent', handIndex: 0 })

describe('SOR_182 Bossk', () => {
  it('may deal 2 damage to a unit when you play an event', () => {
    const played = playEvent(eBoard({ hand: ['EV'], units: [unit('bk', 'SOR_182')] }, { units: [unit('e', 'GRD')] }))
    const c = choice(played)
    expect(c).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    expect(optional(c)).toBe(true)
    expect(targetsOf(c)).toEqual(['bk', 'e'])
  })
  it('not for an opponent\'s event, and not for a unit', () => {
    noChoice(playEvent(eBoard({ units: [unit('bk', 'SOR_182')] }, { hand: ['EV'] }), 'opponent'))
    noChoice(resolve(eBoard({ hand: ['GRD'], units: [unit('bk', 'SOR_182')] }), { type: 'playUnit', handIndex: 0 }))
  })
})

describe('TWI_216 Fives', () => {
  it('may put a Clone unit from your discard pile on the bottom of your deck, and if you do, draw a card', () => {
    const played = playEvent(eBoard({ hand: ['EV'], discard: ['CLONEEV', 'CLONE', 'GRD'], deck: ['GRD'], units: [unit('f', 'TWI_216')] }))
    const c = choice(played)
    expect(c.kind === 'selectCardThen' ? c.candidates : [], 'Clone units only').toEqual(['CLONE'])
    expect(optional(c)).toBe(true)
    const done = accept(played, { optionIndex: 0 })
    expect(done.players.player.deck).toEqual(['CLONE'])
    expect(done.players.player.hand).toEqual(['GRD'])
    expect(done.players.player.discard).not.toContain('CLONE')
    const declined = skip(played)
    expect(declined.players.player.hand, 'no draw on a decline').toEqual([])
  })
})

describe('TS26_8 Ahsoka Tano', () => {
  it('front: when you play an event, may exhaust herself to look at the top card, then play, discard or leave it', () => {
    const s = eBoard({ leader: { cardId: 'TS26_8', deployed: false, epicActionUsed: false, exhausted: false }, hand: ['EV'], deck: ['GRD', 'SMALL'] })
    const played = playEvent(s)
    expect(choice(played)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const paid = accept(played)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(choice(paid)).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', optional: true })
    expect((choice(paid) as { costDelta?: number }).costDelta, 'paying its cost').toBeUndefined()
    noChoice(resolve(eBoard({ leader: { cardId: 'TS26_8', deployed: false, epicActionUsed: false, exhausted: false }, hand: ['GRD'], deck: ['GRD'] }), { type: 'playUnit', handIndex: 0 }))
  })
  it('back: when her attack ends, the same look, and a play costs 1 less', () => {
    const s = eBoard({ leader: { cardId: 'TS26_8', deployed: true, epicActionUsed: true, exhausted: false }, deck: ['GRD'], units: [unit('L', 'TS26_8', { isLeader: true })] })
    expect(choice(attackBase(s, 'L'))).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', optional: true, costDelta: -1 })
  })
})

// ── "When you deploy a leader" ────────────────────────────────────────────────────────────────
// A deploy raises `whenFriendlyEntersPlay`, which reaches the controller's base and other units, so
// each card is that point with a guard that the unit arriving is a leader.

const D: Record<string, EngineCard> = {
  ...E,
  JTL_191: card({ id: 'JTL_191', name: 'Invincible', type: 'unit', arena: 'space', cost: 6, power: 6, hp: 6, traits: ['Separatist', 'Vehicle', 'Capital Ship'] }),
  TWI_022: card({ id: 'TWI_022', name: 'Droid Manufactory', type: 'base', hp: 24 }),
  TWI_025: card({ id: 'TWI_025', name: 'Shadow Collective Camp', type: 'base', hp: 25 }),
  SEPU: card({ id: 'SEPU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Separatist'], unique: true }),
  SEP: card({ id: 'SEP', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Separatist'] }),
  SEPL: card({ id: 'SEPL', type: 'leader', cost: 5, power: 4, hp: 7, traits: ['Separatist'], unique: true }),
}
const dBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: D })
const deploy = (s: GameState) => resolve(s, { type: 'deployLeader' })

describe('JTL_191 Invincible', () => {
  it('may return a non-leader unit that costs 3 or less when you deploy a leader', () => {
    const deployed = deploy(dBoard({ units: [unit('inv', 'JTL_191'), unit('g', 'GRD')] }, { units: [unit('e', 'SMALL'), unit('p', 'BIG')] }))
    const c = choice(deployed)
    expect(c.kind).toBe('selectUnitToReturn')
    expect(optional(c)).toBe(true)
    expect(targetsOf(c), 'not the leader, not the 4-cost').toEqual(['e', 'g'])
  })
  it('not when a unit that is not a leader enters play', () => {
    noChoice(resolve(dBoard({ hand: ['GRD'], units: [unit('inv', 'JTL_191'), unit('g', 'GRD')] }), { type: 'playUnit', handIndex: 0 }))
  })
  it('costs 1 less while you control a unique Separatist card', () => {
    expect(effectiveCost(dBoard(), 'player', D.JTL_191)).toBe(6)
    expect(effectiveCost(dBoard({ units: [unit('s', 'SEP')] }), 'player', D.JTL_191), 'unique only').toBe(6)
    expect(effectiveCost(dBoard({ units: [unit('s', 'SEPU')] }), 'player', D.JTL_191)).toBe(5)
    expect(effectiveCost(dBoard({ leader: { cardId: 'SEPL', deployed: false, epicActionUsed: false, exhausted: false } }), 'player', D.JTL_191), 'a leader is a card').toBe(5)
  })
})

describe('TWI_022 Droid Manufactory and TWI_025 Shadow Collective Camp', () => {
  it('create 2 Battle Droid tokens, or draw a card, when you deploy a leader', () => {
    const droids = deploy(dBoard({ base: { cardId: 'TWI_022', damage: 0 } }))
    expect(droids.players.player.units.filter(u => u.cardId === TOKEN_BATTLE_DROID)).toHaveLength(2)
    const drew = deploy(dBoard({ base: { cardId: 'TWI_025', damage: 0 }, deck: ['GRD'] }))
    expect(drew.players.player.hand).toEqual(['GRD'])
  })
  it('not for an opponent\'s deploy, and not for a unit played', () => {
    const theirs = resolve({ ...dBoard({ base: { cardId: 'TWI_022', damage: 0 } }), activePlayer: 'opponent' }, { type: 'deployLeader' })
    expect(theirs.players.player.units).toHaveLength(0)
    const played = resolve(dBoard({ base: { cardId: 'TWI_025', damage: 0 }, hand: ['GRD'], deck: ['SMALL'] }), { type: 'playUnit', handIndex: 0 })
    expect(played.players.player.hand).toEqual([])
  })
})

// ── "When this unit attacks and defeats a unit" ───────────────────────────────────────────────
// `onAttackEnd` with `ctx.defenderDefeated`. The defeated unit itself rides on `ctx.defeatedDefender`,
// and what the hit had left over past its remaining HP on `ctx.excessCombatDamage`.

const K: Record<string, EngineCard> = {
  ...D,
  LOF_017: card({ id: 'LOF_017', name: 'Darth Revan', type: 'leader', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Force', 'Sith'], keywords: [{ name: 'Restore', value: 1 }] }),
  LOF_063: card({ id: 'LOF_063', name: 'Oggdo Bogdo', type: 'unit', arena: 'ground', cost: 3, power: 5, hp: 5, traits: ['Creature'] }),
  LOF_086: card({ id: 'LOF_086', name: 'Drengir Spawn', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 3, traits: ['Creature'], keywords: [{ name: 'Overwhelm' }] }),
  SOR_088: card({ id: 'SOR_088', name: 'Blizzard Assault AT-AT', type: 'unit', arena: 'ground', cost: 8, power: 9, hp: 9, traits: ['Imperial', 'Vehicle', 'Walker'] }),
  SOR_149: card({ id: 'SOR_149', name: 'Mace Windu', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 7, traits: ['Force', 'Jedi', 'Republic'], keywords: [{ name: 'Ambush' }] }),
  SOR_085: card({ id: 'SOR_085', name: 'Rukh', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Imperial'] }),
  TWO: card({ id: 'TWO', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 2 }),
  TOUGHL: card({ id: 'TOUGHL', type: 'leader', arena: 'ground', cost: 5, power: 1, hp: 20 }),
}
const kBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: K })
const exp = (s: GameState, id: string) => (U(s, id)?.upgrades ?? []).filter(u => u.cardId === TOKEN_EXPERIENCE).length

describe('LOF_017 Darth Revan', () => {
  it('front: when a friendly unit attacks and defeats a unit, may exhaust himself to give it an Experience token', () => {
    const s = kBoard({ leader: { cardId: 'LOF_017', deployed: false, epicActionUsed: false, exhausted: false }, units: [unit('g', 'GRD')] }, { units: [unit('e', 'SMALL'), unit('t', 'TOUGH')] })
    const swung = attackUnit(s, 'g', 'e')
    expect(choice(swung)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const paid = accept(swung)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(exp(paid, 'g')).toBe(1)
    noChoice(attackUnit(s, 'g', 't'))
  })
  it('back: may give that friendly unit an Experience token, himself included', () => {
    const s = kBoard({ leader: { cardId: 'LOF_017', deployed: true, epicActionUsed: true, exhausted: false }, units: [unit('L', 'LOF_017', { isLeader: true }), unit('g', 'GRD')] }, { units: [unit('e', 'SMALL'), unit('f', 'SMALL')] })
    const one = attackUnit(s, 'g', 'e')
    expect(choice(one)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_EXPERIENCE })
    expect(targetsOf(choice(one))).toEqual(['g'])
    expect(exp(accept(one, { targetInstanceId: 'g' }), 'g')).toBe(1)
    expect(targetsOf(choice(attackUnit(s, 'L', 'f')))).toEqual(['L'])
  })
})

describe('LOF_063 Oggdo Bogdo', () => {
  it("can't attack unless damaged, and heals 2 from himself when he attacks and defeats a unit", () => {
    expect(getCardDefinition('LOF_063')?.cannotAttack?.(kBoard(), unit('o', 'LOF_063'))).toBe(true)
    expect(getCardDefinition('LOF_063')?.cannotAttack?.(kBoard(), unit('o', 'LOF_063', { damage: 1 }))).toBe(false)
    const swung = attackUnit(kBoard({ units: [unit('o', 'LOF_063', { damage: 3 })] }, { units: [unit('e', 'SMALL')] }), 'o', 'e')
    expect(U(swung, 'o')!.damage).toBe(2) // 3 + 1 from the defender, less 2
  })
})

describe('LOF_086 Drengir Spawn', () => {
  it("gives itself Experience tokens equal to the defeated unit's cost", () => {
    const swung = attackUnit(kBoard({ units: [unit('d', 'LOF_086')] }, { units: [unit('e', 'TWO')] }), 'd', 'e')
    expect(U(swung, 'e')).toBeUndefined()
    expect(exp(swung, 'd')).toBe(3)
  })
})

describe('SOR_088 Blizzard Assault AT-AT', () => {
  it('may deal the excess damage from the attack to an enemy ground unit', () => {
    const s = kBoard({ units: [unit('at', 'SOR_088'), unit('mine', 'GRD')] }, { units: [unit('e', 'TWO'), unit('g', 'GRD'), unit('sp', 'SPC')] })
    const swung = attackUnit(s, 'at', 'e')
    const c = choice(swung)
    expect(c).toMatchObject({ kind: 'selectDamageTarget', amount: 7 }) // 9 power into 2 remaining HP
    expect(optional(c)).toBe(true)
    expect(targetsOf(c), 'enemy ground units').toEqual(['g'])
  })
  it('offers nothing when the defender survived', () => {
    noChoice(attackUnit(kBoard({ units: [unit('at', 'SOR_088')] }, { units: [unit('e', 'TOUGH'), unit('g', 'GRD')] }), 'at', 'e'))
  })
})

describe('SOR_149 Mace Windu', () => {
  it('readies when he attacks and defeats a unit', () => {
    expect(U(attackUnit(kBoard({ units: [unit('m', 'SOR_149')] }, { units: [unit('e', 'SMALL')] }), 'm', 'e'), 'm')!.exhausted).toBe(false)
    expect(U(attackUnit(kBoard({ units: [unit('m', 'SOR_149')] }, { units: [unit('e', 'TOUGH')] }), 'm', 'e'), 'm')!.exhausted).toBe(true)
  })
})

describe('SOR_085 Rukh', () => {
  it('defeats a non-leader unit he deals combat damage to while attacking', () => {
    const swung = attackUnit(kBoard({ units: [unit('r', 'SOR_085')] }, { units: [unit('e', 'TOUGH')] }), 'r', 'e')
    expect(U(swung, 'e')).toBeUndefined()
  })
  it('not a leader unit', () => {
    const swung = attackUnit(kBoard({ units: [unit('r', 'SOR_085')] }, { units: [unit('l', 'TOUGHL', { isLeader: true })] }), 'r', 'l')
    expect(U(swung, 'l')).toBeDefined()
  })
})

// ── "When this unit is attacked" ──────────────────────────────────────────────────────────────
// `onDefense`, which fires on the defender before damage is dealt. The enemy attacks here, so the
// player's unit is the defender.

const V: Record<string, EngineCard> = {
  ...K,
  LOF_047: card({ id: 'LOF_047', name: 'T-6 Shuttle 1974', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 4, traits: ['Fringe', 'Vehicle', 'Transport'] }),
  SEC_090: card({ id: 'SEC_090', name: 'Director Krennic', type: 'unit', arena: 'ground', cost: 9, power: 8, hp: 10, traits: ['Imperial', 'Official'], keywords: [{ name: 'Sentinel' }] }),
  SEC_187: card({ id: 'SEC_187', name: 'General Grievous', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 3, traits: ['Separatist', 'Official'], keywords: [{ name: 'Hidden' }] }),
  SHD_035: card({ id: 'SHD_035', name: 'Clan Saxon Gauntlet', type: 'unit', arena: 'space', cost: 6, power: 4, hp: 5, traits: ['Mandalorian', 'Vehicle', 'Transport'], keywords: [{ name: 'Sentinel' }] }),
  SOR_196: card({ id: 'SOR_196', name: 'Chewbacca', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Underworld', 'Wookiee'], keywords: [{ name: 'Sentinel' }] }),
  TWI_049: card({ id: 'TWI_049', name: 'Knight of the Republic', type: 'unit', arena: 'ground', cost: 6, power: 4, hp: 7, traits: ['Force', 'Jedi', 'Republic'] }),
  TWI_083: card({ id: 'TWI_083', name: "General's Guardian", type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 4, traits: ['Separatist', 'Droid'] }),
}
const vBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: V })
/** The opponent's `attacker` attacks the player's `defender`. */
const attacked = (s: GameState, defender: string, attacker = 'e') => attackUnit(s, attacker, defender, 'opponent')

describe('LOF_047 T-6 Shuttle 1974', () => {
  it('may give itself an Experience token before damage is dealt', () => {
    const swung = attacked(vBoard({ units: [unit('t', 'LOF_047')] }, { units: [unit('e', 'SPC')] }), 't')
    expect(choice(swung)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_EXPERIENCE })
    expect(targetsOf(choice(swung))).toEqual(['t'])
    const done = accept(swung, { targetInstanceId: 't' })
    expect(exp(done, 't')).toBe(1)
    expect(U(done, 't')!.damage, 'the token is there before the damage').toBe(2)
  })
})

describe('SEC_090 Director Krennic', () => {
  it('discards the top card of his deck; if it is a unit, he may return it to hand', () => {
    const swung = attacked(vBoard({ units: [unit('k', 'SEC_090')], deck: ['GRD', 'EV'] }, { units: [unit('e', 'GRD')] }), 'k')
    expect(swung.players.player.discard).toEqual(['GRD'])
    expect(choice(swung)).toMatchObject({ kind: 'selectFromDiscard', candidates: ['GRD'] })
    expect(optional(choice(swung))).toBe(true)
    expect(accept(swung, { optionIndex: 0 }).players.player.hand).toEqual(['GRD'])
    const event = attacked(vBoard({ units: [unit('k', 'SEC_090')], deck: ['EV'] }, { units: [unit('e', 'GRD')] }), 'k')
    expect(event.players.player.discard).toEqual(['EV'])
    noChoice(event)
  })
})

describe('SEC_187 General Grievous', () => {
  it('returns to his owner\'s hand before damage is dealt, and the attack deals nothing', () => {
    const swung = attacked(vBoard({ units: [unit('gg', 'SEC_187')] }, { units: [unit('e', 'GRD')] }), 'gg')
    expect(U(swung, 'gg')).toBeUndefined()
    expect(swung.players.player.hand).toEqual(['SEC_187'])
    expect(U(swung, 'e')!.damage).toBe(0)
  })
})

describe('SHD_035 Clan Saxon Gauntlet', () => {
  it('may give an Experience token to a unit', () => {
    const swung = attacked(vBoard({ units: [unit('c', 'SHD_035'), unit('g', 'GRD')] }, { units: [unit('e', 'SPC')] }), 'c')
    expect(choice(swung)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_EXPERIENCE })
    expect(optional(choice(swung))).toBe(true)
    expect(targetsOf(choice(swung))).toEqual(['c', 'e', 'g'])
  })
})

describe('SOR_196 Chewbacca', () => {
  it('readies when attacked', () => {
    const swung = attacked(vBoard({ units: [unit('ch', 'SOR_196', { exhausted: true })] }, { units: [unit('e', 'GRD')] }), 'ch')
    expect(U(swung, 'ch')!.exhausted).toBe(false)
  })
})

describe('TWI_049 Knight of the Republic and TWI_083 General\'s Guardian', () => {
  it('create a Clone Trooper token, or a Battle Droid token, when attacked', () => {
    const knight = attacked(vBoard({ units: [unit('k', 'TWI_049')] }, { units: [unit('e', 'GRD')] }), 'k')
    expect(knight.players.player.units.filter(u => u.cardId === TOKEN_CLONE_TROOPER)).toHaveLength(1)
    const guard = attacked(vBoard({ units: [unit('k', 'TWI_083')] }, { units: [unit('e', 'GRD')] }), 'k')
    expect(guard.players.player.units.filter(u => u.cardId === TOKEN_BATTLE_DROID)).toHaveLength(1)
  })
  it('not when it is the attacker', () => {
    const swung = attackUnit(vBoard({ units: [unit('k', 'TWI_049')] }, { units: [unit('e', 'GRD')] }), 'k', 'e')
    expect(swung.players.player.units.filter(u => u.cardId === TOKEN_CLONE_TROOPER)).toHaveLength(0)
  })
})

// ── "When you play an upgrade (on this unit / on a unit)" ─────────────────────────────────────
// "On this unit" is `whenUpgradeAttached` with `ctx.upgradePlayed` on the host, and who played it in
// `ctx.playingPlayer`, since an opponent can play an upgrade on your unit. "On a unit" is
// `whenPlayUpgrade`, which names the host in `ctx.targetInstanceId`.

const P: Record<string, EngineCard> = {
  ...V,
  JTL_202: card({ id: 'JTL_202', name: 'Black Squadron Scout Wing', type: 'unit', arena: 'space', cost: 5, power: 4, hp: 6, traits: ['Resistance', 'Vehicle', 'Fighter'] }),
  SHD_018: card({ id: 'SHD_018', name: 'The Mandalorian', type: 'leader', arena: 'ground', cost: 6, power: 4, hp: 7, traits: ['Mandalorian', 'Bounty Hunter'] }),
  SHD_067: card({ id: 'SHD_067', name: 'Fenn Rau', type: 'unit', arena: 'ground', cost: 6, power: 5, hp: 6, traits: ['Mandalorian'] }),
  SHD_133: card({ id: 'SHD_133', name: 'Dengar', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 2, traits: ['Underworld', 'Bounty Hunter'] }),
  UPG3: card({ id: 'UPG3', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
}
const pBoard = (mine: Side = {}, theirs: Side = {}) => ({ ...board(mine, theirs), cards: P })
const playUpgrade = (s: GameState, targetInstanceId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'playUpgrade', handIndex: 0, targetInstanceId })

describe('JTL_202 Black Squadron Scout Wing', () => {
  it('may attack when you play an upgrade on it, +1/+0 for this attack', () => {
    const played = playUpgrade(pBoard({ hand: ['UPG'], units: [unit('w', 'JTL_202'), unit('g', 'GRD')] }), 'w')
    const c = choice(played)
    expect(c.kind).toBe('mayAttackAnyUnit')
    expect(optional(c)).toBe(true)
    expect(c.kind === 'mayAttackAnyUnit' ? c.attacker?.only : undefined).toEqual(['w'])
    const swung = resolve(played, { type: 'attack', attackerId: 'w', target: { kind: 'base' } })
    expect(swung.players.opponent.base.damage, '4 + 1 from the upgrade + 1 for this attack').toBe(6)
  })
  it('not for an upgrade on another unit, and not for an opponent\'s upgrade on it', () => {
    noChoice(playUpgrade(pBoard({ hand: ['UPG'], units: [unit('w', 'JTL_202'), unit('g', 'GRD')] }), 'g'))
    noChoice(playUpgrade(pBoard({ units: [unit('w', 'JTL_202')] }, { hand: ['UPG'] }), 'w', 'opponent'))
  })
})

describe('SHD_067 Fenn Rau', () => {
  it('when played, may play an upgrade from your hand for 2 less', () => {
    const played = resolve(pBoard({ hand: ['SHD_067', 'UPG3'] }), { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'playCardFrom', zone: 'hand', costDelta: -2 })
    expect(optional(choice(played))).toBe(true)
  })
  it('gives an enemy unit -2/-2 for this phase when you play an upgrade on him', () => {
    const played = playUpgrade(pBoard({ hand: ['UPG'], units: [unit('f', 'SHD_067')] }, { units: [unit('e', 'GRD')] }), 'f')
    expect(choice(played)).toMatchObject({ kind: 'mayLastingBuff', power: -2, hp: -2 })
    expect(targetsOf(choice(played))).toEqual(['e'])
  })
})

describe('SHD_133 Dengar', () => {
  it('may deal 1 damage to the unit you play an upgrade on, either side\'s', () => {
    const played = playUpgrade(pBoard({ hand: ['UPG'], units: [unit('d', 'SHD_133')] }, { units: [unit('e', 'GRD')] }), 'e')
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(optional(choice(played))).toBe(true)
    expect(targetsOf(choice(played))).toEqual(['e'])
  })
  it('not for an opponent\'s upgrade', () => {
    noChoice(playUpgrade(pBoard({ units: [unit('d', 'SHD_133')] }, { hand: ['UPG'], units: [unit('e', 'GRD')] }), 'e', 'opponent'))
  })
})

describe('SHD_018 The Mandalorian', () => {
  const front = (units: UnitState[]) => pBoard({ leader: { cardId: 'SHD_018', deployed: false, epicActionUsed: false, exhausted: false }, hand: ['UPG'], units: [unit('g', 'GRD')] }, { units })
  it('front: when you play an upgrade, may exhaust himself to exhaust an enemy unit with 4 or less remaining HP', () => {
    const played = playUpgrade(front([unit('e', 'GRD', { damage: 2 }), unit('f', 'GRD')]), 'g')
    expect(choice(played)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const paid = accept(played)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(targetsOf(choice(paid))).toEqual(['e'])
    expect(U(accept(paid, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })
  it('back: may exhaust an enemy unit with 6 or less remaining HP', () => {
    const s = pBoard({ leader: { cardId: 'SHD_018', deployed: true, epicActionUsed: true, exhausted: false }, hand: ['UPG'], units: [unit('L', 'SHD_018', { isLeader: true })] }, { units: [unit('e', 'GRD'), unit('t', 'TOUGH')] })
    const played = playUpgrade(s, 'L')
    expect(targetsOf(choice(played))).toEqual(['e'])
    expect(optional(choice(played))).toBe(true)
  })
})

// ── "When an enemy leader deploys" ────────────────────────────────────────────────────────────
// `whenUnitEntersPlay`, which every arrival raises on both players' bases and on every unit but the
// one arriving, so the far side hears a deploy.

describe('HMW_214 Phee Genoa', () => {
  const G: Record<string, EngineCard> = {
    ...P,
    HMW_214: card({ id: 'HMW_214', name: 'Phee Genoa', type: 'unit', arena: 'ground', cost: 4, power: 5, hp: 4, traits: ['Underworld'], keywords: [{ name: 'Hidden' }] }),
  }
  // A deploy needs as many resources as the leader costs but exhausts none of them.
  const gBoard = (readyCount = 10, spent = 0) => {
    const s = { ...board({ units: [unit('ph', 'HMW_214')] }), cards: G }
    const resources = [...ready(readyCount), ...ready(spent).map(r => ({ ...r, exhausted: true }))]
    return { ...s, activePlayer: 'opponent' as PlayerId, players: { ...s.players, opponent: { ...s.players.opponent, resources } } }
  }
  const leaderUnit = (s: GameState) => s.players.opponent.units.find(u => u.isLeader)!
  const readyLeft = (s: GameState) => s.players.opponent.resources.filter(r => !r.exhausted).length

  it("offers the deploying leader's controller a payment of 2, and exhausts the leader if they don't", () => {
    const deployed = deploy(gBoard())
    const c = choice(deployed)
    expect(c).toMatchObject({ kind: 'mayPayThen', cost: 2, controller: 'opponent' })
    const paid = accept(deployed)
    expect(readyLeft(paid)).toBe(8)
    expect(leaderUnit(paid).exhausted).toBe(false)
    const declined = skip(deployed)
    expect(readyLeft(declined)).toBe(10)
    expect(leaderUnit(declined).exhausted).toBe(true)
  })

  it('exhausts the leader outright when its controller cannot pay', () => {
    const deployed = deploy(gBoard(1, 5))
    noChoice(deployed)
    expect(leaderUnit(deployed).exhausted).toBe(true)
  })

  it('not for a friendly deploy', () => {
    const s = { ...board({ units: [unit('ph', 'HMW_214')] }), cards: G }
    noChoice(deploy(s))
    expect(s.players.player.units.find(u => u.isLeader)).toBeUndefined()
    expect(deploy(s).players.player.units.find(u => u.isLeader)!.exhausted).toBe(false)
  })
})

// ── "When 1 or more damage is healed from this unit" ──────────────────────────────────────────
// `whenHealed`, raised on the unit by `healUnit`, the one place a unit is healed, with what the heal
// actually removed in `ctx.amountHealed`.

describe('JTL_062 Silver Angel and LAW_047 Baze Malbus', () => {
  const H: Record<string, EngineCard> = {
    ...P,
    JTL_062: card({ id: 'JTL_062', name: 'Silver Angel', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 3, traits: ['Fringe', 'Vehicle', 'Transport'] }),
    LAW_047: card({ id: 'LAW_047', name: 'Baze Malbus', type: 'unit', arena: 'ground', cost: 7, power: 6, hp: 8, traits: ['Rebel'], keywords: [{ name: 'Sentinel' }] }),
  }
  const hBoard = (mine: UnitState[], theirs: UnitState[] = []) => ({ ...board({ units: mine }, { units: theirs }), cards: H })

  it('Silver Angel may deal 1 damage to a space unit when damage is healed from it', () => {
    // `unit()` reads the arena from `F`, which does not hold Silver Angel, so it is stated.
    const healed = healUnit(hBoard([unit('sa', 'JTL_062', { damage: 2, arena: 'space' }), unit('g', 'GRD')], [unit('sp', 'SPC')]), 'sa', 1)
    expect(choice(healed)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(optional(choice(healed))).toBe(true)
    expect(targetsOf(choice(healed))).toEqual(['sa', 'sp'])
  })

  it('Baze Malbus may deal as much damage as was healed from him, to a unit', () => {
    const healed = healUnit(hBoard([unit('bz', 'LAW_047', { damage: 2 })], [unit('e', 'GRD')]), 'bz', 3)
    expect(choice(healed)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    expect(targetsOf(choice(healed))).toEqual(['bz', 'e'])
  })

  it('nothing when no damage was healed, or when another unit is healed', () => {
    noChoice(healUnit(hBoard([unit('bz', 'LAW_047')]), 'bz', 3))
    noChoice(healUnit(hBoard([unit('bz', 'LAW_047'), unit('g', 'GRD', { damage: 2 })]), 'g', 2))
  })
})

// ── "When attached unit readies" ──────────────────────────────────────────────────────────────
// The host's `whenReadies` gathers its upgrades' abilities too, so the upgrade listens on the host.

describe('JTL_192 In Debt to Crimson Dawn', () => {
  const R: Record<string, EngineCard> = { ...P, JTL_192: card({ id: 'JTL_192', name: 'In Debt to Crimson Dawn', type: 'upgrade', cost: 2, power: 0, hp: 0, traits: ['Condition'] }) }
  /** A regroup where the player's exhausted `g` carries the opponent's In Debt to Crimson Dawn. */
  const regroup = () => ({
    ...board({ resources: ready(5), units: [unit('g', 'GRD', { exhausted: true, upgrades: [{ cardId: 'JTL_192', owner: 'opponent' }] })] }),
    cards: R, phase: 'regroup' as const, regroupResourced: { player: false, opponent: false },
  })
  const intoNextRound = (s: GameState) => resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })

  it("exhausts the unit as it readies unless its controller pays 2", () => {
    const next = intoNextRound(regroup())
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'payOrExhaust', unitId: 'g', cost: 2, controller: 'player' })
    const paid = accept(next)
    expect(U(paid, 'g')!.exhausted).toBe(false)
    expect(paid.players.player.resources.filter(r => !r.exhausted)).toHaveLength(3)
    expect(U(skip(next), 'g')!.exhausted).toBe(true)
  })
})
