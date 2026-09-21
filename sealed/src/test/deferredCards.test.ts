import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { getCardDefinition, registerCard } from '../engine/abilities'
import { defeatUnit } from '../engine/combat'
import { dealDamageToBase } from '../engine/effects'
import { opponentOf } from '../engine/types'
import { reprintCanonicalId } from '../data/reprints'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_BEAST } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EffectContext, TriggerPoint } from '../engine/abilities'
import type { GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * Cards held on the deferred-cards spike whose blocker, read against the engine as it now is, turned
 * out to be none: each trigger head below already has a dispatch point, and the ability is a
 * registration over existing primitives. What each test pins is what the card itself decides: the
 * condition, whether it may be declined, and which side it reads.
 */
const F = {
  ...CARDS,
  HMW_115: card({ id: 'HMW_115', name: 'Leia Organa', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 3, aspects: ['Command', 'Heroism'], traits: ['Rebel', 'Official'], unique: true }),
  HMW_124: card({ id: 'HMW_124', name: 'Luminara Unduli', type: 'unit', arena: 'ground', cost: 7, power: 7, hp: 7, aspects: ['Command', 'Heroism'], traits: ['Force', 'Jedi', 'Republic'], unique: true }),
  HMW_168: card({ id: 'HMW_168', name: 'Ezra Bridger', type: 'unit', arena: 'ground', cost: 4, power: 5, hp: 4, aspects: ['Aggression', 'Heroism'], traits: ['Force', 'Rebel', 'Spectre'], unique: true }),
  HMW_223: card({ id: 'HMW_223', name: 'Therm Scissorpunch', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5, aspects: ['Cunning'], traits: ['Underworld'], unique: true }),
  SEC_168: card({ id: 'SEC_168', name: 'Ziton Moj', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 5, aspects: ['Aggression'], traits: ['Underworld'], unique: true }),
  JTL_216: card({ id: 'JTL_216', name: 'Contracted Hunter', type: 'unit', arena: 'ground', cost: 3, power: 4, hp: 4, aspects: ['Cunning'], traits: ['Underworld', 'Bounty Hunter'], keywords: [{ name: 'Ambush' }] }),
  JTL_198: card({ id: 'JTL_198', name: 'Fireball', type: 'unit', arena: 'space', cost: 2, power: 3, hp: 3, aspects: ['Cunning', 'Heroism'], traits: ['Resistance', 'Vehicle', 'Fighter'], keywords: [{ name: 'Ambush' }], unique: true }),
  TS26_24: card({ id: 'TS26_24', name: 'Sundari Gauntlet', type: 'unit', arena: 'space', cost: 5, power: 6, hp: 5, aspects: ['Command', 'Aggression'], traits: ['Mandalorian', 'Vehicle', 'Transport'], keywords: [{ name: 'Sentinel' }] }),
  LAW_046: card({ id: 'LAW_046', name: 'Chirrut Îmwe', type: 'unit', arena: 'ground', cost: 6, power: 8, hp: 6, aspects: ['Vigilance', 'Aggression', 'Heroism'], traits: ['Force', 'Rebel'], keywords: [{ name: 'Saboteur' }], unique: true }),
  LOF_130: card({ id: 'LOF_130', name: 'HK-47', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4, aspects: ['Aggression', 'Villainy'], traits: ['Sith', 'Droid'], unique: true }),
  SOR_109: card({ id: 'SOR_109', name: 'Colonel Yularen', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, aspects: ['Command'], traits: ['Imperial', 'Official'], unique: true }),
  TS26_73: card({ id: 'TS26_73', name: 'Moralo Eval', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 2, aspects: ['Cunning', 'Villainy'], traits: ['Underworld'], keywords: [{ name: 'Shielded' }], unique: true }),
  SHD_241: card({ id: 'SHD_241', name: 'Kragan Gorr', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 6, aspects: ['Villainy'], traits: ['Underworld'], unique: true }),
  TWI_166: card({ id: 'TWI_166', name: 'Aurra Sing', type: 'unit', arena: 'ground', cost: 7, power: 7, hp: 6, aspects: ['Aggression'], traits: ['Underworld', 'Bounty Hunter'], keywords: [{ name: 'Overwhelm' }], unique: true }),
  LAW_056: card({ id: 'LAW_056', name: 'Cassian Andor', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 4, aspects: ['Command', 'Aggression', 'Heroism'], traits: ['Rebel'], unique: true }),
  LAW_052: card({ id: 'LAW_052', name: 'The Mandalorian', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 5, aspects: ['Vigilance', 'Aggression'], traits: ['Mandalorian', 'Bounty Hunter'], unique: true }),
  SHD_084: card({ id: 'SHD_084', name: 'Phase-III Dark Trooper', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, aspects: ['Command', 'Villainy'], traits: ['Imperial', 'Droid', 'Trooper'], keywords: [{ name: 'Sentinel' }] }),
  JTL_111: card({ id: 'JTL_111', name: 'Seasoned Fleet Admiral', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4, aspects: ['Command'], traits: ['Rebel', "Twi'lek", 'Official'], keywords: [{ name: 'Raid', value: 1 }] }),
  // Props
  CHEAP: card({ id: 'CHEAP', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 5 }),
  DEAR: card({ id: 'DEAR', type: 'unit', arena: 'ground', cost: 4, power: 2, hp: 5 }),
  CMD: card({ id: 'CMD', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 5, aspects: ['Command'] }),
  VIG: card({ id: 'VIG', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 5, aspects: ['Vigilance'] }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 1, hp: 8 }),
  HEAVY: card({ id: 'HEAVY', type: 'unit', arena: 'ground', cost: 2, power: 9, hp: 9 }),
}

const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const pending = (s: GameState): PendingChoice[] => s.pendingChoices ?? []
const choice = (s: GameState): PendingChoice => {
  expect(pending(s).length, 'a choice is raised').toBeGreaterThan(0)
  return pending(s)[0]
}
const noChoice = (s: GameState) => expect(pending(s), 'no choice is raised').toHaveLength(0)
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
type Extra = { targetInstanceId?: string; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra } as never)
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
/** Run one card's ability at `trigger` directly, with the event's context. */
const fireAt = (s: GameState, cardId: string, trigger: TriggerPoint, host: string, extra: Partial<EffectContext> = {}, owner: PlayerId = 'player'): GameState => {
  const ability = getCardDefinition(cardId)?.abilities?.find(a => a.trigger === trigger)
  if (!ability) throw new Error(`${cardId} has no ${trigger} ability`)
  return ability.effect(s, { owner, cardId, sourceInstanceId: host, ...extra })
}
const board = (mine: ReturnType<typeof unit>[], theirs: ReturnType<typeof unit>[] = [], over: Partial<GameState> = {}, me: Parameters<typeof player>[0] = {}) =>
  state({ cards: F, players: { player: player({ units: mine, ...me }), opponent: player({ units: theirs }) }, ...over })
const hasToken = (s: GameState, id: string, token: string) => (U(s, id)?.upgrades ?? []).some(a => a.cardId === token)
const playFirst = (s: GameState) => resolve(s, { type: 'playUnit', handIndex: 0 })

// ── Homeworlds ────────────────────────────────────────────────────────────────────────────────

describe('HMW_115 Leia Organa: when you play another unit that costs 3 or less, heal 1 from your base', () => {
  const withHand = (hand: string[]) => board([unit('leia', 'HMW_115')], [], {}, { hand, resources: ready(6), base: { cardId: 'TST_B', damage: 5 } })

  it('heals 1 when a unit costing 3 or less is played', () => {
    expect(playFirst(withHand(['CHEAP'])).players.player.base.damage).toBe(4)
  })

  it('does not heal for a unit costing 4', () => {
    expect(playFirst(withHand(['DEAR'])).players.player.base.damage).toBe(5)
  })

  it('does not heal for her own play', () => {
    const s = board([], [], {}, { hand: ['HMW_115'], resources: ready(6), base: { cardId: 'TST_B', damage: 5 } })
    expect(playFirst(s).players.player.base.damage).toBe(5)
  })
})

describe('HMW_124 Luminara Unduli: when you play a unit (including this one), you may attack with a unit at +2/+0', () => {
  it('offers an optional attack when another unit is played', () => {
    const s = board([unit('lum', 'HMW_124'), unit('atk', 'TST_U1')], [], {}, { hand: ['CHEAP'], resources: ready(6) })
    const played = playFirst(s)
    expect(declinable(played)).toBe(true)
    noChoice(skip(played))
  })

  it('offers the attack on her own play too, and the attacker gets +2/+0', () => {
    const s = board([unit('atk', 'TST_U1')], [], {}, { hand: ['HMW_124'], resources: ready(12) })
    const played = playFirst(s)
    expect(choice(played)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(declinable(played)).toBe(true)
    const attacked = resolve(played, { type: 'attack', attackerId: 'atk', target: { kind: 'base' } })
    expect(attacked.players.opponent.base.damage, "TST_U1's 3 power + 2").toBe(5)
  })
})

describe('HMW_168 Ezra Bridger: when you take the initiative, you may deal 3 damage to your base to create a Beast', () => {
  const s = board([unit('ezra', 'HMW_168')])

  it('offers the trade when you take the initiative, and taking it damages your base and creates a Beast', () => {
    const taken = resolve(s, { type: 'takeInitiative' })
    expect(declinable(taken)).toBe(true)
    const done = accept(taken)
    expect(done.players.player.base.damage).toBe(3)
    expect(done.players.player.units.map(u => u.cardId)).toContain(TOKEN_BEAST)
  })

  it('declining costs nothing and creates nothing', () => {
    const done = skip(resolve(s, { type: 'takeInitiative' }))
    expect(done.players.player.base.damage).toBe(0)
    expect(done.players.player.units.map(u => u.cardId)).not.toContain(TOKEN_BEAST)
  })
})

describe('HMW_223 Therm Scissorpunch: when the action phase starts, -2/-2 for each revealed top card costing 3 or more', () => {
  const at = (mine: string[], theirs: string[]) => {
    const s = state({ cards: F, players: { player: player({ units: [unit('therm', 'HMW_223')], deck: mine }), opponent: player({ deck: theirs }) } })
    return fireAt(s, 'HMW_223', 'whenActionPhaseStarts', 'therm')
  }

  it('gets -2/-2 for each of the two top cards that costs 3 or more', () => {
    const both = at(['CHEAP'], ['DEAR'])
    expect(effectivePower(both, U(both, 'therm')!)).toBe(1)
    expect(effectiveHp(both, U(both, 'therm')!)).toBe(1)
  })

  it('counts only the cards that cost 3 or more', () => {
    const one = at(['TST_U1'], ['DEAR'])
    expect(effectivePower(one, U(one, 'therm')!)).toBe(3)
    const none = at(['TST_U1'], ['TST_U1'])
    expect(effectivePower(none, U(none, 'therm')!)).toBe(5)
  })

  it('reveals rather than moves: both decks are unchanged', () => {
    const s = at(['CHEAP', 'TST_U1'], ['DEAR'])
    expect(s.players.player.deck).toEqual(['CHEAP', 'TST_U1'])
    expect(s.players.opponent.deck).toEqual(['DEAR'])
  })

  it('an empty deck reveals nothing', () => {
    const s = at([], [])
    expect(effectivePower(s, U(s, 'therm')!)).toBe(5)
  })
})

// ── Other sets ───────────────────────────────────────────────────────────────────────────────

describe('SEC_168 Ziton Moj: when you take the initiative, deal 2 damage to a base', () => {
  it('raises a mandatory pick of either base', () => {
    const taken = resolve(board([unit('z', 'SEC_168')]), { type: 'takeInitiative' })
    const c = choice(taken)
    expect(c.kind).toBe('selectDamageTarget')
    expect(c.kind === 'selectDamageTarget' && c.baseTargets.slice().sort()).toEqual(['opponent', 'player'])
    expect(c.kind === 'selectDamageTarget' && c.amount).toBe(2)
    expect(declinable(taken)).toBe(false)
  })
})

describe('JTL_216 Contracted Hunter and JTL_198 Fireball: at the start of the regroup phase', () => {
  it('Contracted Hunter defeats itself', () => {
    const s = fireAt(board([unit('ch', 'JTL_216')]), 'JTL_216', 'whenRegroupStarts', 'ch')
    expect(U(s, 'ch')).toBeUndefined()
  })

  it('Fireball deals 1 damage to itself', () => {
    const s = fireAt(board([unit('fb', 'JTL_198')]), 'JTL_198', 'whenRegroupStarts', 'fb')
    expect(U(s, 'fb')?.damage).toBe(1)
  })

  it('both keep Ambush', () => {
    const s = board([unit('ch', 'JTL_216'), unit('fb', 'JTL_198')])
    expect(unitHasKeyword(s, U(s, 'ch')!, 'Ambush')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'fb')!, 'Ambush')).toBe(true)
  })
})

describe('TS26_24 Sundari Gauntlet: On Defense, deal 1 damage to your base', () => {
  it('damages its own controller\'s base when attacked', () => {
    const s = board([], [unit('sg', 'TS26_24')], { activePlayer: 'player' })
    const hit = fireAt(s, 'TS26_24', 'onDefense', 'sg', {}, 'opponent')
    expect(hit.players.opponent.base.damage).toBe(1)
    expect(hit.players.player.base.damage).toBe(0)
  })
})

describe('LAW_046 Chirrut Îmwe: When Attack Ends, if he dealt combat damage to a base, you may heal 4 from another unit', () => {
  const s = board([unit('ch', 'LAW_046'), unit('hurt', 'BIG', { damage: 6 })], [unit('e', 'BIG', { damage: 2 })])

  it('offers an optional heal of 4 on another unit, either side', () => {
    const fired = fireAt(s, 'LAW_046', 'onAttackEnd', 'ch', { combatDamageToBase: 8 })
    const c = choice(fired)
    expect(c.kind).toBe('selectHealTarget')
    expect(c.kind === 'selectHealTarget' && c.unitTargets.slice().sort()).toEqual(['e', 'hurt'])
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'hurt' }), 'hurt')?.damage).toBe(2)
  })

  it('does nothing when the attack did not damage a base', () => {
    noChoice(fireAt(s, 'LAW_046', 'onAttackEnd', 'ch', {}))
  })
})

describe('LOF_130 HK-47: when an enemy unit is defeated, deal 1 damage to its controller\'s base', () => {
  it('pings the opponent\'s base when their unit is defeated', () => {
    const s = board([unit('hk', 'LOF_130')], [unit('e', 'CHEAP')])
    const done = defeatUnit(s, 'e')
    expect(done.players.opponent.base.damage).toBe(1)
  })

  it('does not fire for a friendly unit', () => {
    const s = board([unit('hk', 'LOF_130'), unit('f', 'CHEAP')])
    expect(defeatUnit(s, 'f').players.opponent.base.damage).toBe(0)
  })
})

describe('SOR_109 Colonel Yularen: when you play a Command unit (including this one), heal 1 from your base', () => {
  const me = (hand: string[], units: ReturnType<typeof unit>[] = []) => board(units, [], {}, { hand, resources: ready(8), base: { cardId: 'TST_B', damage: 5 } })

  it('heals for his own play', () => {
    expect(playFirst(me(['SOR_109'])).players.player.base.damage).toBe(4)
  })

  it('heals for another Command unit and not for a unit without the aspect', () => {
    expect(playFirst(me(['CMD'], [unit('y', 'SOR_109')])).players.player.base.damage).toBe(4)
    expect(playFirst(me(['VIG'], [unit('y', 'SOR_109')])).players.player.base.damage).toBe(5)
  })
})

describe('TS26_73 Moralo Eval: when your base is dealt combat damage, you may deal 1 damage to a unit', () => {
  const s = board([unit('m', 'TS26_73')], [unit('e', 'CHEAP')])

  it('offers an optional ping for combat damage', () => {
    const fired = fireAt(s, 'TS26_73', 'whenOwnBaseDamaged', 'm', { byCombat: true, attackerInstanceId: 'e' })
    expect(choice(fired).kind).toBe('selectDamageTarget')
    expect(declinable(fired)).toBe(true)
  })

  it('does nothing for ability damage', () => {
    noChoice(fireAt(s, 'TS26_73', 'whenOwnBaseDamaged', 'm', {}))
  })
})

describe('SHD_241 Kragan Gorr: when an enemy unit attacks your base, Shield a friendly unit in the attacker\'s arena', () => {
  it('offers only friendly units in the attacker\'s arena', () => {
    const s = board([unit('k', 'SHD_241'), unit('sp', 'SPACER', { arena: 'space' })], [unit('e', 'CHEAP')])
    const fired = fireAt(s, 'SHD_241', 'whenEnemyAttacksBase', 'k', { attackerInstanceId: 'e' })
    const c = choice(fired)
    expect(c.kind === 'mayGiveTokens' && c.targets).toEqual(['k'])
    expect(hasToken(accept(fired, { targetInstanceId: 'k' }), 'k', TOKEN_SHIELD)).toBe(true)
  })

  it('does nothing when no friendly unit shares the arena', () => {
    const s = board([unit('k', 'SHD_241')], [unit('e', 'SPACER', { arena: 'space' })])
    noChoice(fireAt(s, 'SHD_241', 'whenEnemyAttacksBase', 'k', { attackerInstanceId: 'e' }))
  })
})

describe('TWI_166 Aurra Sing: when an enemy ground unit attacks your base, ready this unit', () => {
  it('readies for a ground attacker and not for a space one', () => {
    const s = board([unit('a', 'TWI_166', { exhausted: true })], [unit('g', 'CHEAP'), unit('sp', 'SPACER', { arena: 'space' })])
    expect(U(fireAt(s, 'TWI_166', 'whenEnemyAttacksBase', 'a', { attackerInstanceId: 'g' }), 'a')?.exhausted).toBe(false)
    expect(U(fireAt(s, 'TWI_166', 'whenEnemyAttacksBase', 'a', { attackerInstanceId: 'sp' }), 'a')?.exhausted).toBe(true)
  })

  it('is raised by a real attack on the base', () => {
    const s = board([unit('a', 'TWI_166', { exhausted: true })], [unit('g', 'CHEAP')], { activePlayer: 'opponent' })
    const attacked = resolve(s, { type: 'attack', attackerId: 'g', target: { kind: 'base' } } as never)
    expect(U(attacked, 'a')?.exhausted).toBe(false)
  })
})

describe('LAW_056 Cassian Andor: when a friendly unit\'s attack ends, if the defender was defeated, deal 2 damage to a base', () => {
  const s = board([unit('c', 'LAW_056'), unit('atk', 'TST_U1')])

  it('raises a pick of either base when the defender was defeated', () => {
    const fired = fireAt(s, 'LAW_056', 'whenFriendlyAttackEnds', 'c', { attackerInstanceId: 'atk', defenderDefeated: true })
    const c = choice(fired)
    expect(c.kind === 'selectDamageTarget' && c.amount).toBe(2)
    expect(c.kind === 'selectDamageTarget' && c.baseTargets.slice().sort()).toEqual(['opponent', 'player'])
  })

  it('does nothing when the defender survived', () => {
    noChoice(fireAt(s, 'LAW_056', 'whenFriendlyAttackEnds', 'c', { attackerInstanceId: 'atk' }))
  })
})

describe('LAW_052 The Mandalorian: When Played draw a card; when you draw during the action phase, Shield this unit', () => {
  it('draws a card when played, and that draw shields him', () => {
    const s = board([], [], {}, { hand: ['LAW_052'], resources: ready(12), deck: ['TST_U1', 'TST_U1'] })
    const played = playFirst(s)
    expect(played.players.player.hand).toHaveLength(1)
    const mando = played.players.player.units.find(u => u.cardId === 'LAW_052')!
    expect(hasToken(played, mando.instanceId, TOKEN_SHIELD)).toBe(true)
  })

  it('reads only his own side\'s draws, and only in the action phase', () => {
    const s = board([unit('m', 'LAW_052')])
    expect(hasToken(fireAt(s, 'LAW_052', 'whenDrawCards', 'm', { drawingPlayer: 'player', cardsDrawn: 1 }), 'm', TOKEN_SHIELD)).toBe(true)
    expect(hasToken(fireAt(s, 'LAW_052', 'whenDrawCards', 'm', { drawingPlayer: 'opponent', cardsDrawn: 1 }), 'm', TOKEN_SHIELD)).toBe(false)
    const regroup: GameState = { ...s, phase: 'regroup' }
    expect(hasToken(fireAt(regroup, 'LAW_052', 'whenDrawCards', 'm', { drawingPlayer: 'player', cardsDrawn: 2 }), 'm', TOKEN_SHIELD)).toBe(false)
  })
})

describe('JTL_111 Seasoned Fleet Admiral: when an opponent draws during the action phase, you may give an Experience token to a unit', () => {
  const s = board([unit('adm', 'JTL_111')], [unit('e', 'CHEAP')])

  it('offers an optional Experience token to any unit when the opponent draws', () => {
    const fired = fireAt(s, 'JTL_111', 'whenDrawCards', 'adm', { drawingPlayer: 'opponent', cardsDrawn: 1 })
    const c = choice(fired)
    expect(c.kind === 'mayGiveTokens' && c.token).toBe(TOKEN_EXPERIENCE)
    expect(c.kind === 'mayGiveTokens' && c.targets.slice().sort()).toEqual(['adm', 'e'])
    expect(declinable(fired)).toBe(true)
  })

  it('ignores its own side\'s draws and regroup draws', () => {
    noChoice(fireAt(s, 'JTL_111', 'whenDrawCards', 'adm', { drawingPlayer: 'player', cardsDrawn: 1 }))
    noChoice(fireAt({ ...s, phase: 'regroup' }, 'JTL_111', 'whenDrawCards', 'adm', { drawingPlayer: 'opponent', cardsDrawn: 1 }))
  })
})

describe('SHD_084 Phase-III Dark Trooper: when combat damage is dealt to this unit, it gains Experience if it survives', () => {
  const s = board([unit('p3', 'SHD_084', { damage: 1 })])
  const survivors = [{ instanceId: 'p3', amount: 1 }]

  it('gains an Experience token for combat damage it survives', () => {
    expect(hasToken(fireAt(s, 'SHD_084', 'whenFriendlyDamagedSurvives', 'p3', { damagedSurvivors: survivors, byCombat: true }), 'p3', TOKEN_EXPERIENCE)).toBe(true)
  })

  it('does not gain one for ability damage, or for another unit\'s damage', () => {
    expect(hasToken(fireAt(s, 'SHD_084', 'whenFriendlyDamagedSurvives', 'p3', { damagedSurvivors: survivors }), 'p3', TOKEN_EXPERIENCE)).toBe(false)
    expect(hasToken(fireAt(s, 'SHD_084', 'whenFriendlyDamagedSurvives', 'p3', { damagedSurvivors: [{ instanceId: 'x', amount: 1 }], byCombat: true }), 'p3', TOKEN_EXPERIENCE)).toBe(false)
  })
})

// ── "When an opponent plays": `whenPlayCard` fires on both sides ─────────────────────────────

const G = {
  ...F,
  HMW_119: card({ id: 'HMW_119', name: 'Saw Gerrera', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 6, aspects: ['Command', 'Heroism'], traits: ['Rebel'], unique: true }),
  LOF_142: card({ id: 'LOF_142', name: 'Adi Gallia', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4, aspects: ['Aggression', 'Heroism'], traits: ['Force', 'Jedi', 'Republic'], unique: true }),
  SHD_172: card({ id: 'SHD_172', name: 'Krayt Dragon', type: 'unit', arena: 'ground', cost: 9, power: 10, hp: 10, aspects: ['Aggression'], traits: ['Creature'] }),
  HMW_215: card({ id: 'HMW_215', name: 'L3-37', type: 'unit', arena: 'ground', cost: 6, power: 5, hp: 7, aspects: ['Cunning', 'Heroism'], traits: ['Underworld', 'Droid'], unique: true }),
  LAW_003: card({ id: 'LAW_003', name: 'Agent Kallus', type: 'leader', cost: 5, power: 4, hp: 6 }),
  TST_EV_PING: card({ id: 'TST_EV_PING', type: 'event', cost: 2 }),
  TST_EV_DEAR: card({ id: 'TST_EV_DEAR', type: 'event', cost: 4 }),
  TST_EV_HERO: card({ id: 'TST_EV_HERO', type: 'event', cost: 1, aspects: ['Heroism'] }),
}
// A test event with a visible effect, so a replay is observable: 1 damage to the opponent's base.
registerCard('TST_EV_PING', { abilities: [{ trigger: 'whenPlayed', description: 'Deal 1 damage to the opponent base.', effect: (s, ctx) => dealDamageToBase(s, opponentOf(ctx.owner), 1) }] })
registerCard('TST_EV_DEAR', { abilities: [{ trigger: 'whenPlayed', description: 'Deal 1 damage to the opponent base.', effect: (s, ctx) => dealDamageToBase(s, opponentOf(ctx.owner), 1) }] })

/**
 * Answer the ordering questions a batch raises (CR 7.6.9, 7.6.10), first option each time: the event's
 * own When Played and a listener's trigger are one batch, and on two sides the active player picks.
 */
const settle = (s: GameState): GameState => {
  let next = s
  for (let i = 0; i < 8; i++) {
    const c = pending(next)[0]
    if (!c || (c.kind !== 'chooseTriggerOrder' && c.kind !== 'chooseNextTrigger')) return next
    next = resolve(next, { type: 'acceptChoice', choiceId: c.id, optionIndex: 0 })
  }
  return next
}
/** `who` plays the first card of their hand, an event or a unit. */
const playAs = (s: GameState, who: PlayerId, type: 'playEvent' | 'playUnit' = 'playEvent') => settle(resolve({ ...s, activePlayer: who }, { type, handIndex: 0 }))
const table = (mine: ReturnType<typeof unit>[], oppHand: string[], me: Parameters<typeof player>[0] = {}) =>
  state({ cards: G, players: { player: player({ units: mine, ...me }), opponent: player({ hand: oppHand, resources: ready(12), units: [unit('og', 'CHEAP')] }) } })

describe('HMW_119 Saw Gerrera: when an opponent plays an event, resource the top card of your deck', () => {
  it('resources the top card when the opponent plays an event', () => {
    const s = table([unit('saw', 'HMW_119')], ['TST_EV_PING'], { deck: ['CHEAP', 'DEAR'] })
    const done = playAs(s, 'opponent')
    expect(done.players.player.resources.map(r => r.cardId)).toEqual(['CHEAP'])
    expect(done.players.player.deck).toEqual(['DEAR'])
  })

  it('does not fire for an opponent\'s unit, or for his own side\'s event', () => {
    const unitPlay = playAs(table([unit('saw', 'HMW_119')], ['CHEAP']), 'opponent', 'playUnit')
    expect(unitPlay.players.player.resources).toHaveLength(0)
    const own = table([unit('saw', 'HMW_119')], [], { hand: ['TST_EV_PING'], resources: ready(6) })
    expect(playAs(own, 'player').players.player.resources).toHaveLength(6)
  })
})

describe('LOF_142 Adi Gallia: when an opponent plays an event, deal 1 damage to that player\'s base', () => {
  it('damages the playing opponent\'s base', () => {
    const done = playAs(table([unit('adi', 'LOF_142')], ['TST_EV_PING']), 'opponent')
    expect(done.players.opponent.base.damage).toBe(1)
    expect(done.players.player.base.damage, 'the event itself hit this base').toBe(1)
  })
})

describe('SHD_172 Krayt Dragon: when an opponent plays a card, you may deal its cost in damage to their base or a ground unit they control', () => {
  it('offers the opponent\'s base and their ground units, for the card\'s cost, and may be declined', () => {
    const played = playAs(table([unit('kd', 'SHD_172')], ['TST_EV_DEAR']), 'opponent')
    const c = choice(played)
    expect(c.kind === 'selectDamageTarget' && c.amount).toBe(4)
    expect(c.kind === 'selectDamageTarget' && c.baseTargets).toEqual(['opponent'])
    expect(c.kind === 'selectDamageTarget' && c.unitTargets).toEqual(['og'])
    expect(c.controller).toBe('player')
    expect(declinable(played)).toBe(true)
  })

  it('does not fire for its own side\'s plays', () => {
    const own = table([unit('kd', 'SHD_172')], [], { hand: ['TST_EV_DEAR'], resources: ready(8) })
    noChoice(playAs(own, 'player'))
  })
})

describe('Agent Kallus (LAW_003) deployed: "when you play a Heroism card" still reads only its own side', () => {
  it('does not heal for an opponent\'s Heroism card', () => {
    const s = state({
      cards: G,
      players: {
        player: player({ leader: { cardId: 'LAW_003', deployed: true, epicActionUsed: true, exhausted: false }, units: [unit('kal', 'LAW_003', { isLeader: true })], base: { cardId: 'TST_B', damage: 5 } }),
        opponent: player({ hand: ['TST_EV_HERO'], resources: ready(6) }),
      },
    })
    expect(playAs(s, 'opponent').players.player.base.damage).toBe(5)
  })
})

describe('HMW_215 L3-37: when you play an event that costs 3 or less, you may play it again from your discard pile for free, once each phase', () => {
  const s = table([unit('l3', 'HMW_215')], [], { hand: ['TST_EV_PING', 'TST_EV_PING'], resources: ready(6) })

  it('offers the free replay out of the discard pile, and taking it resolves the event again without paying', () => {
    const played = playAs(s, 'player')
    expect(choice(played).kind).toBe('playCardFrom')
    expect(declinable(played)).toBe(true)
    const again = accept(played)
    expect(again.players.opponent.base.damage, 'resolved twice').toBe(2)
    expect(again.players.player.resources.filter(r => r.exhausted), 'paid once').toHaveLength(2)
    noChoice(again)
  })

  it('is spent by the replay, so the next event this phase is not offered one', () => {
    const again = accept(playAs(s, 'player'))
    noChoice(playAs(again, 'player'))
  })

  it('declining does not spend it', () => {
    const declined = skip(playAs(s, 'player'))
    expect(choice(playAs(declined, 'player')).kind).toBe('playCardFrom')
  })

  it('does not fire for an event costing 4', () => {
    const dear = table([unit('l3', 'HMW_215')], [], { hand: ['TST_EV_DEAR'], resources: ready(6) })
    noChoice(playAs(dear, 'player'))
  })
})

// ── Returning a card from the discard pile, and two constant-plus-trigger units ──────────────

const H = {
  ...G,
  SHD_260: card({ id: 'SHD_260', name: 'Street Gang Recruiter', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 4, traits: ['Underworld'] }),
  SHD_044: card({ id: 'SHD_044', name: 'Razor Crest', type: 'unit', arena: 'space', cost: 4, power: 3, hp: 4, aspects: ['Vigilance', 'Heroism'], traits: ['Mandalorian', 'Vehicle', 'Transport'], keywords: [{ name: 'Restore', value: 2 }], unique: true }),
  SOR_101: card({ id: 'SOR_101', name: 'Rogue Squadron Skirmisher', type: 'unit', arena: 'ground', cost: 6, power: 4, hp: 6, aspects: ['Command', 'Heroism'], traits: ['Rebel', 'Vehicle', 'Speeder'], keywords: [{ name: 'Ambush' }] }),
  TS26_13: card({ id: 'TS26_13', name: 'Darth Sidious', type: 'unit', arena: 'ground', cost: 6, power: 4, hp: 6, aspects: ['Vigilance', 'Command', 'Villainy'], traits: ['Force', 'Separatist', 'Sith'], keywords: [{ name: 'Hidden' }], unique: true }),
  SHD_255: card({ id: 'SHD_255', name: 'Lady Proxima', type: 'unit', arena: 'ground', cost: 1, power: 0, hp: 4, traits: ['Underworld'], unique: true }),
  UW_EV: card({ id: 'UW_EV', type: 'event', cost: 1, traits: ['Underworld'] }),
  UW_U: card({ id: 'UW_U', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, traits: ['Underworld'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  SEP: card({ id: 'SEP', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Separatist'] }),
}
const withDiscard = (discard: string[], hand: string[]) =>
  state({ cards: H, players: { player: player({ hand, discard, resources: ready(12) }), opponent: player() } })
const offeredFromDiscard = (s: GameState) => {
  const c = choice(s)
  expect(c.kind).toBe('selectFromDiscard')
  return c.kind === 'selectFromDiscard' ? c.candidates : []
}

describe('SHD_260 Street Gang Recruiter (reprinted as LAW_261): When Played, you may return an Underworld card from your discard pile', () => {
  it('offers only Underworld cards, of any type, and may be declined', () => {
    const played = playFirst(withDiscard(['UW_EV', 'CHEAP', 'UW_U'], ['SHD_260']))
    expect(offeredFromDiscard(played)).toEqual(['UW_EV', 'UW_U'])
    expect(declinable(played)).toBe(true)
    const back = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 1 })
    expect(back.players.player.hand).toEqual(['UW_U'])
  })

  it('the LAW printing is the same card', () => {
    expect(getCardDefinition('SHD_260')).toBeTruthy()
    expect(reprintCanonicalId('LAW_261')).toBe('SHD_260')
  })
})

describe('SHD_044 Razor Crest: When Played, you may return an upgrade from your discard pile', () => {
  it('offers only upgrades, and may be declined', () => {
    const played = playFirst(withDiscard(['UPG', 'CHEAP'], ['SHD_044']))
    expect(offeredFromDiscard(played)).toEqual(['UPG'])
    expect(declinable(played)).toBe(true)
  })
})

describe('SOR_101 Rogue Squadron Skirmisher: When Played, return a unit that costs 2 or less from your discard pile', () => {
  it('offers only units costing 2 or less, and is mandatory', () => {
    const played = settle(playFirst(withDiscard(['TST_U1', 'CHEAP', 'UW_EV'], ['SOR_101'])))
    const c = pending(played).find(p => p.kind === 'selectFromDiscard')
    expect(c?.kind === 'selectFromDiscard' && c.candidates).toEqual(['TST_U1'])
    expect(c?.kind === 'selectFromDiscard' && c.optional).toBeFalsy()
  })
})

describe('TS26_13 Darth Sidious: other friendly Separatist units get +1/+0; when a non-token unit is defeated, create a Battle Droid', () => {
  const s = state({ cards: H, players: { player: player({ units: [unit('ds', 'TS26_13'), unit('sep', 'SEP'), unit('f', 'CHEAP')] }), opponent: player({ units: [unit('esep', 'SEP'), unit('e', 'CHEAP')] }) } })
  const droids = (st: GameState) => st.players.player.units.filter(u => u.cardId === 'TOKEN_BATTLE_DROID' || st.cards[u.cardId]?.name === 'Battle Droid').length

  it('buffs other friendly Separatists only', () => {
    expect(effectivePower(s, U(s, 'sep')!)).toBe(3)
    expect(effectivePower(s, U(s, 'ds')!)).toBe(4)
    expect(effectivePower(s, U(s, 'esep')!)).toBe(2)
  })

  it('creates a Battle Droid when a non-token unit on either side is defeated', () => {
    expect(droids(defeatUnit(s, 'e'))).toBe(1)
    expect(droids(defeatUnit(s, 'f'))).toBe(1)
  })
})

describe('SHD_255 Lady Proxima: when you play another Underworld card, you may deal 1 damage to a base', () => {
  it('offers an optional ping for another Underworld card', () => {
    const s = state({ cards: H, players: { player: player({ units: [unit('lp', 'SHD_255')], hand: ['UW_U'], resources: ready(6) }), opponent: player() } })
    const played = settle(playFirst(s))
    const c = choice(played)
    expect(c.kind === 'selectDamageTarget' && c.amount).toBe(1)
    expect(declinable(played)).toBe(true)
  })

  it('does not fire for a card without the trait, or for her own play', () => {
    const plain = state({ cards: H, players: { player: player({ units: [unit('lp', 'SHD_255')], hand: ['CHEAP'], resources: ready(6) }), opponent: player() } })
    noChoice(settle(playFirst(plain)))
    const herself = state({ cards: H, players: { player: player({ hand: ['SHD_255'], resources: ready(6) }), opponent: player() } })
    noChoice(settle(playFirst(herself)))
  })
})

describe('LOF_001 Kylo Ren front: Action [Exhaust], discard a card from your hand; if it was an upgrade, draw a card', () => {
  const K = { ...H, LOF_001: card({ id: 'LOF_001', name: 'Kylo Ren', type: 'leader', cost: 5, power: 5, hp: 6 }) }
  const kylo = (hand: string[]) => state({ cards: K, players: { player: player({ leader: { cardId: 'LOF_001', deployed: false, epicActionUsed: false, exhausted: false }, hand, deck: ['TST_U1', 'TST_U1'] }), opponent: player() } })
  const use = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })
  const pick = (s: GameState, handIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, handIndex })

  it('discarding an upgrade draws a card and exhausts the leader', () => {
    const done = pick(use(kylo(['CHEAP', 'UPG'])), 1)
    expect(done.players.player.discard).toEqual(['UPG'])
    expect(done.players.player.hand).toEqual(['CHEAP', 'TST_U1'])
    expect(done.players.player.leader.exhausted).toBe(true)
  })

  it('discarding anything else draws nothing', () => {
    const done = pick(use(kylo(['CHEAP', 'UPG'])), 0)
    expect(done.players.player.discard).toEqual(['CHEAP'])
    expect(done.players.player.hand).toEqual(['UPG'])
  })

  it('is not offered with an empty hand', () => {
    expect(legalMoves(kylo([])).some(m => m.type === 'useLeaderAbility')).toBe(false)
  })
})

describe('each card registers a definition', () => {
  it.each(['SHD_260', 'SHD_044', 'SOR_101', 'TS26_13', 'SHD_255', 'HMW_119', 'LOF_142', 'SHD_172', 'HMW_215', 'HMW_115', 'HMW_124', 'HMW_168', 'HMW_223', 'SEC_168', 'JTL_216', 'JTL_198', 'TS26_24', 'LAW_046', 'LOF_130', 'SOR_109', 'TS26_73', 'SHD_241', 'TWI_166', 'LAW_056', 'LAW_052', 'JTL_111', 'SHD_084'])('%s', id => {
    expect(getCardDefinition(id)).toBeTruthy()
  })
})
