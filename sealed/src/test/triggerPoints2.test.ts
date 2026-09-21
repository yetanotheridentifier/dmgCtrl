import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
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

/** `unit()` reads the arena off the SHARED fixture pool, so it is stated from `F` here. */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
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
