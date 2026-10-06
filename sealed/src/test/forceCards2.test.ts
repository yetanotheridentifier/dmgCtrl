import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { hasForceToken, createForceToken, defeatForceToken, dealDamageToBase, unitCannotReady } from '../engine/effects'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { defeatUnit } from '../engine/combat'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, ready, card, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The Force cards that need more than the token itself: a base's own printed trigger or action, the
 * "When you use the Force" trigger point, and the one-offs that read a context or offer a Force-gated
 * mode. See `forceCards.test.ts` for the cards built on the token alone.
 */

const POOL = poolFor(['LOF'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const FORCE_ATTACK_BASES = ['LOF_029', 'LOF_026', 'LOF_023', 'LOF_020', 'LOF_021', 'LOF_024', 'LOF_027', 'LOF_030']
const IDS = [
  ...FORCE_ATTACK_BASES, 'LOF_025', 'LOF_019', 'LOF_022', 'LOF_028',
  'LOF_101', 'LOF_260',
  'LOF_079', 'LOF_218', 'LOF_098', 'LOF_067', 'LOF_229', 'LOF_249', 'LOF_252',
  'LOF_172',
  // The use of the Force as a cost or a "may" on the existing machinery: leaders, units and events.
  'LOF_003', 'LOF_018', 'LOF_013', 'LOF_015', 'LOF_009', 'LOF_008', 'LOF_016',
  'LOF_188', 'LOF_185', 'LOF_115', 'LOF_039', 'LOF_087', 'LOF_094', 'LOF_189', 'LOF_072', 'LOF_227', 'LOF_221',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(IDS.map(id => [id, real(id)])),
  FORCEU: card({ id: 'FORCEU', arena: 'ground', cost: 2, power: 4, hp: 6, traits: ['Force'] }),
  FILLER: card({ id: 'FILLER', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  FILLER2: card({ id: 'FILLER2', arena: 'ground', cost: 1, power: 2, hp: 2 }),
  ENEMY: card({ id: 'ENEMY', arena: 'ground', cost: 3, power: 3, hp: 10 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  HERO: card({ id: 'HERO', arena: 'ground', cost: 1, power: 1, hp: 3, aspects: ['Heroism'] }),
  UNIQ: card({ id: 'UNIQ', arena: 'ground', cost: 1, power: 1, hp: 3, unique: true }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  VILE: card({ id: 'VILE', type: 'event', cost: 2, aspects: ['Villainy'] }),
  VILU: card({ id: 'VILU', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Villainy'] }),
  EV: card({ id: 'EV', type: 'event', cost: 2 }),
  RET: card({ id: 'RET', arena: 'ground', cost: 4, power: 2, hp: 5, aspects: ['Command'] }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Command'] }),
  SITH: card({ id: 'SITH', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Sith'] }),
}

const board = (overrides: { player?: Parameters<typeof player>[0]; opponent?: Parameters<typeof player>[0] } = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: ['TST_U1', 'TST_U1', 'TST_U1', 'TST_U1'], ...overrides.player }),
    opponent: player({ resources: ready(10), deck: ['TST_U1', 'TST_U1'], ...overrides.opponent }),
  },
})
const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const withToken = (s: GameState, who: 'player' | 'opponent' = 'player'): GameState => createForceToken(s, who)
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const decline = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const playUnit = (s: GameState, handIndex = 0) => resolve(s, { type: 'playUnit', handIndex })
const playEvent = (s: GameState, handIndex = 0) => resolve(s, { type: 'playEvent', handIndex })
const playUpgrade = (s: GameState, targetInstanceId: string, handIndex = 0) => resolve(s, { type: 'playUpgrade', handIndex, targetInstanceId })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const tokens = (s: GameState, id: string, token: string) => U(s, id)?.upgrades.filter(t => t.cardId === token).length ?? 0
const base = (cardId: string) => ({ cardId, damage: 0 })
const toRegroup = (s: GameState): GameState => resolve({ ...s, consecutivePasses: 1 }, { type: 'pass' })
const baseAction = (cardId: string): Action => ({ type: 'useBaseAbility', cardId, index: 0 })
const modeIndex = (s: GameState, mode: string): number => {
  const c = choice(s)
  if (c.kind !== 'chooseMode') throw new Error(`expected chooseMode, got ${c.kind}`)
  const i = c.modes.indexOf(mode)
  if (i === -1) throw new Error(`no mode ${mode} in ${c.modes.join(', ')}`)
  return i
}

describe('registration', () => {
  it('registers every card this file covers', () => {
    for (const id of IDS) expect(getCardDefinition(id), id).toBeDefined()
  })
})

describe('"When a friendly Force unit attacks: The Force is with you": eight bases', () => {
  it.each(FORCE_ATTACK_BASES)('%s creates the token when a friendly Force unit attacks', id => {
    const s = attackBase(board({ player: { base: base(id), units: [unit('f0', 'FORCEU')] } }), 'f0')
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it.each(FORCE_ATTACK_BASES)('%s does nothing when a friendly non-Force unit attacks', id => {
    const s = attackBase(board({ player: { base: base(id), units: [unit('u0', 'FILLER2')] } }), 'u0')
    expect(hasForceToken(s, 'player')).toBe(false)
  })
  it('does nothing for an enemy Force unit attacking (LOF_029 Crystal Caves)', () => {
    const s = attackBase({ ...board({ player: { base: base('LOF_029') }, opponent: { units: [unit('e0', 'FORCEU')] } }), activePlayer: 'opponent' }, 'e0')
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(hasForceToken(s, 'opponent')).toBe(false)
  })
})

describe('LOF_025 Temple of Destruction: a friendly unit deals 3 or more combat damage to an enemy base', () => {
  it('creates the token on 3 or more', () => {
    const s = attackBase(board({ player: { base: base('LOF_025'), units: [unit('f0', 'FORCEU')] } }), 'f0')
    expect(s.players.opponent.base.damage).toBe(4)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('does nothing on less than 3', () => {
    const s = attackBase(board({ player: { base: base('LOF_025'), units: [unit('u0', 'FILLER2')] } }), 'u0')
    expect(hasForceToken(s, 'player')).toBe(false)
  })
  it('does nothing for damage dealt by an ability', () => {
    const s = dealDamageToBase(board({ player: { base: base('LOF_025') } }), 'opponent', 5, { cardId: 'LOF_172', controller: 'player' })
    expect(hasForceToken(s, 'player')).toBe(false)
  })
  it('does nothing when an enemy unit deals combat damage to its own controller\'s enemy (your base)', () => {
    const s = attackBase({ ...board({ player: { base: base('LOF_025') }, opponent: { units: [unit('e0', 'FORCEU')] } }), activePlayer: 'opponent' }, 'e0')
    expect(hasForceToken(s, 'player')).toBe(false)
  })
})

describe('LOF_019 Vergence Temple: when the regroup phase starts, if you control a unit with 4 or more remaining HP', () => {
  it('creates the token', () => {
    const s = toRegroup(board({ player: { base: base('LOF_019'), units: [unit('u0', 'ENEMY', { damage: 6 })] } }))
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('does nothing when every unit has 3 or less remaining HP', () => {
    const s = toRegroup(board({ player: { base: base('LOF_019'), units: [unit('u0', 'ENEMY', { damage: 7 })] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    expect(hasForceToken(s, 'player')).toBe(false)
  })
})

describe('LOF_022 Mystic Monastery: Action: the Force is with you, no more than 3 times each game', () => {
  it('creates the token, and is offered at most three times in the game', () => {
    let s = board({ player: { base: base('LOF_022') } })
    for (let use = 0; use < 3; use++) {
      expect(legalMoves(s)).toContainEqual(baseAction('LOF_022'))
      s = resolve(s, baseAction('LOF_022'))
      expect(hasForceToken(s, 'player')).toBe(true)
      expect(s.activePlayer).toBe('opponent')
      s = { ...defeatForceToken(s, 'player'), activePlayer: 'player' }
    }
    expect(legalMoves(s)).not.toContainEqual(baseAction('LOF_022'))
  })
  it('is not offered while the token is already held', () => {
    expect(legalMoves(withToken(board({ player: { base: base('LOF_022') } })))).not.toContainEqual(baseAction('LOF_022'))
  })
})

describe('LOF_028 Tomb of Eilram: Action [exhaust a friendly unit]: the Force is with you', () => {
  it('exhausts the chosen friendly unit and creates the token', () => {
    let s = board({ player: { base: base('LOF_028'), units: [unit('u0', 'FILLER'), unit('u1', 'FILLER2')] } })
    expect(legalMoves(s)).toContainEqual(baseAction('LOF_028'))
    s = resolve(s, baseAction('LOF_028'))
    expect(choice(s)).toMatchObject({ targets: ['u0', 'u1'] })
    s = accept(s, { targetInstanceId: 'u1' })
    expect(U(s, 'u1')?.exhausted).toBe(true)
    expect(U(s, 'u0')?.exhausted).toBe(false)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('is not offered without a ready friendly unit to exhaust', () => {
    const s = board({ player: { base: base('LOF_028'), units: [unit('u0', 'FILLER', { exhausted: true })] } })
    expect(legalMoves(s)).not.toContainEqual(baseAction('LOF_028'))
  })
})

describe('"When you use the Force": LOF_101 Yoda and LOF_260 The Father', () => {
  it('LOF_101 When Played: may use the Force to heal 5 from a base, which also fires his own "When you use the Force"', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_101'], base: { cardId: 'TST_B', damage: 8 } }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 5 })
    s = accept(s, { baseTarget: 'player' })
    expect(s.players.player.base.damage).toBe(3)
    // Yoda is the only unit his player controls: twice that is 2.
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, optional: true })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(2)
  })
  it('LOF_101 hears another card\'s use of the Force, after that ability has resolved, counting the units you control', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_172'], units: [unit('y0', 'LOF_101'), unit('u1', 'FILLER')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 4, optional: true })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(7)
  })
  it('LOF_101 does not hear the Force token being created, nor a declined use', () => {
    const s = decline(playEvent(withToken(board({ player: { hand: ['LOF_172'], units: [unit('y0', 'LOF_101')] }, opponent: { units: [unit('e0', 'ENEMY')] } }))))
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('LOF_101 hears a "[use the Force]" action cost too (LOF_028 has none, so via Leia LOF_098)', () => {
    let s = withToken(board({ player: { units: [unit('y0', 'LOF_101'), unit('l0', 'LOF_098', { arena: 'space' })] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    s = resolve(s, { type: 'useAbility', instanceId: 'l0', cardId: 'LOF_098', index: 0 })
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 4, optional: true })
  })
  it('LOF_260 The Father: may deal 1 damage to himself to have the Force with you again', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_172'], units: [unit('f0', 'LOF_260')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', damageSelf: 1 })
    s = accept(s)
    expect(U(s, 'f0')?.damage).toBe(1)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('LOF_260 does not hear an opponent using the Force', () => {
    let s: GameState = { ...withToken(board({ player: { units: [unit('f0', 'LOF_260')] }, opponent: { hand: ['LOF_172'], units: [unit('e0', 'ENEMY')] } }), 'opponent'), activePlayer: 'opponent' }
    s = playEvent(s)
    s = accept(s)
    s = accept(s, { targetInstanceId: 'f0' })
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('LOF_079 Shatterpoint: Choose one: defeat a non-leader unit with 3 or less remaining HP, or use the Force to defeat a non-leader unit', () => {
  it('the first mode offers only units with 3 or less remaining HP', () => {
    let s = playEvent(board({ player: { hand: ['LOF_079'] }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'FRAIL')] } }))
    s = accept(s, { optionIndex: modeIndex(s, 'hp') })
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToDefeat', targets: ['e1'] })
    s = accept(s, { targetInstanceId: 'e1' })
    expect(U(s, 'e1')).toBeUndefined()
  })
  it('the Force mode is not offered without the token', () => {
    const s = playEvent(board({ player: { hand: ['LOF_079'] }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'FRAIL')] } }))
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', modes: ['hp'] })
  })
  it('the Force mode uses the token and defeats any non-leader unit', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_079'] }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'FRAIL')] } })))
    s = accept(s, { optionIndex: modeIndex(s, 'force') })
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToDefeat', targets: ['e0', 'e1'] })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')).toBeUndefined()
  })
})

describe('LOF_218 Impossible Escape: either exhaust a friendly unit or use the Force; if you do either, exhaust an enemy unit and draw', () => {
  const escape = () => playEvent(board({ player: { hand: ['LOF_218'], units: [unit('u0', 'FILLER')] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
  it('paying by exhausting a friendly unit', () => {
    let s = escape()
    s = accept(s, { optionIndex: modeIndex(s, 'exhaust') })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(U(s, 'u0')?.exhausted).toBe(true)
    expect(s.players.player.hand).toHaveLength(1)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.exhausted).toBe(true)
  })
  it('paying by using the Force', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_218'], units: [unit('u0', 'FILLER')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s, { optionIndex: modeIndex(s, 'force') })
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(U(s, 'u0')?.exhausted).toBe(false)
    expect(s.players.player.hand).toHaveLength(1)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.exhausted).toBe(true)
  })
  it('doing neither does nothing', () => {
    let s = escape()
    s = accept(s, { optionIndex: modeIndex(s, 'neither') })
    expect(U(s, 'u0')?.exhausted).toBe(false)
    expect(U(s, 'e0')?.exhausted).toBe(false)
    expect(s.players.player.hand).toHaveLength(0)
  })
  it('offers neither cost when it cannot be paid', () => {
    const s = playEvent(board({ player: { hand: ['LOF_218'], units: [unit('u0', 'FILLER', { exhausted: true })] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.hand).toHaveLength(0)
  })
})

describe('LOF_098 Leia Organa: while in the space arena, she can\'t ready and gains an Action [use the Force]', () => {
  const leia = (arena: 'space' | 'ground') => withToken(board({ player: { units: [unit('l0', 'LOF_098', { arena, exhausted: false }), unit('h0', 'HERO'), unit('u0', 'FILLER')] } }))
  it('moves her to the ground arena and gives each friendly Heroism unit +2/+2 for this phase', () => {
    const s = leia('space')
    const use: Action = { type: 'useAbility', instanceId: 'l0', cardId: 'LOF_098', index: 0 }
    expect(legalMoves(s)).toContainEqual(use)
    const after = resolve(s, use)
    expect(hasForceToken(after, 'player')).toBe(false)
    expect(U(after, 'l0')?.arena).toBe('ground')
    expect(effectivePower(after, U(after, 'h0')!)).toBe(F.HERO.power! + 2)
    expect(effectivePower(after, U(after, 'l0')!)).toBe(F.LOF_098.power! + 2)
    expect(effectivePower(after, U(after, 'u0')!)).toBe(F.FILLER.power)
  })
  it('has neither the action nor the restriction in the ground arena', () => {
    const s = leia('ground')
    expect(legalMoves(s).some(m => m.type === 'useAbility' && m.instanceId === 'l0')).toBe(false)
    expect(unitCannotReady(s, U(s, 'l0')!)).toBe(false)
  })
  it("can't ready while in the space arena", () => {
    const s = leia('space')
    expect(unitCannotReady(s, U(s, 'l0')!)).toBe(true)
  })
})

describe('LOF_067 Chirrut Îmwe: when attacked, may use the Force to give the attacker -2/-0 for this attack', () => {
  const attacked = (s: GameState) => resolve({ ...s, activePlayer: 'opponent' }, { type: 'attack', attackerId: 'e0', target: { kind: 'unit', instanceId: 'c0' } })
  it('the attacker deals 2 less damage', () => {
    let s = attacked(withToken(board({ player: { units: [unit('c0', 'LOF_067')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true, controller: 'player' })
    s = accept(s)
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(U(s, 'c0')?.damage).toBe(1)
    expect(effectivePower(s, U(s, 'e0')!)).toBe(F.ENEMY.power)
  })
  it('declined, the attacker deals full damage', () => {
    let s = attacked(withToken(board({ player: { units: [unit('c0', 'LOF_067')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = decline(s)
    expect(U(s, 'c0')?.damage).toBe(3)
  })
})

describe('LOF_229 Kylo Ren: when you play an upgrade on this unit, may use the Force to draw a card', () => {
  it('draws on accept', () => {
    let s = playUpgrade(withToken(board({ player: { hand: ['UPG'], units: [unit('k0', 'LOF_229')] } })), 'k0')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(s.players.player.hand).toHaveLength(1)
  })
  it('does not hear an upgrade played on another unit', () => {
    const s = playUpgrade(withToken(board({ player: { hand: ['UPG'], units: [unit('k0', 'LOF_229'), unit('u0', 'FILLER')] } })), 'u0')
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('LOF_249 Luke Skywalker: when you play another unique unit, may use the Force for an Experience and a Shield', () => {
  it('gives both tokens to Luke on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['UNIQ'], units: [unit('l0', 'LOF_249')] } })))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(tokens(s, 'l0', TOKEN_EXPERIENCE)).toBe(1)
    expect(tokens(s, 'l0', TOKEN_SHIELD)).toBe(1)
  })
  it('does not hear a non-unique unit', () => {
    const s = playUnit(withToken(board({ player: { hand: ['FILLER'], units: [unit('l0', 'LOF_249')] } })))
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('LOF_252 The Daughter: when damage is dealt to your base, may use the Force to heal 2 from it', () => {
  it('heals 2 on accept', () => {
    let s = dealDamageToBase(withToken(board({ player: { units: [unit('d0', 'LOF_252')] } })), 'player', 3, { cardId: 'LOF_172', controller: 'opponent' })
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(s.players.player.base.damage).toBe(1)
  })
  it('does not hear damage to the enemy base', () => {
    const s = dealDamageToBase(withToken(board({ player: { units: [unit('d0', 'LOF_252')] } })), 'opponent', 3, { cardId: 'LOF_172', controller: 'player' })
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

// ── The use of the Force on the existing machinery ──────────────────────────────────────────────
const undeployed = (cardId: string) => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const LEADER: Action = { type: 'useLeaderAbility', index: 0 }
const readyCount = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
const rich = { resources: ready(20) }

describe('Leaders whose front is an "Action [Exhaust, use the Force]"', () => {
  it('LOF_003 Ahsoka Tano: front gives a friendly unit Sentinel for this phase', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_003'), units: [unit('u0', 'FILLER')] } }))
    expect(legalMoves(s)).toContainEqual(LEADER)
    s = resolve(s, LEADER)
    expect(hasForceToken(s, 'player')).toBe(false)
    s = accept(s, { targetInstanceId: 'u0' })
    expect(unitHasKeyword(s, U(s, 'u0')!, 'Sentinel')).toBe(true)
  })
  it('LOF_003 front is not offered without the token', () => {
    expect(legalMoves(board({ player: { leader: undeployed('LOF_003'), units: [unit('u0', 'FILLER')] } }))).not.toContainEqual(LEADER)
  })
  it('LOF_003 back: On Attack, may give a friendly unit Sentinel for this phase', () => {
    let s = attackBase(board({ player: { units: [unit('a0', 'LOF_003'), unit('u0', 'FILLER')] } }), 'a0')
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff', optional: true })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(unitHasKeyword(s, U(s, 'u0')!, 'Sentinel')).toBe(true)
  })

  it('LOF_018 Anakin Skywalker: front plays a Villainy non-unit card from hand ignoring its aspect penalties', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_018'), hand: ['VILE'] } }))
    s = resolve(s, LEADER)
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom' })
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.discard).toContain('VILE')
    expect(readyCount(s)).toBe(10 - 2)
  })
  it('LOF_018 is not offered with only a Villainy unit in hand', () => {
    expect(legalMoves(withToken(board({ player: { leader: undeployed('LOF_018'), hand: ['VILU'] } })))).not.toContainEqual(LEADER)
  })
  it('LOF_018 back: Action [use the Force], no exhaust, does the same', () => {
    let s = withToken(board({ player: { units: [unit('a0', 'LOF_018')], hand: ['VILE'] } }))
    s = resolve(s, { type: 'useAbility', instanceId: 'a0', cardId: 'LOF_018', index: 0 })
    expect(hasForceToken(s, 'player')).toBe(false)
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.discard).toContain('VILE')
    expect(U(s, 'a0')?.exhausted).toBe(false)
  })

  it('LOF_013 Barriss Offee: front plays an event from hand for 1 less', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_013'), hand: ['EV'] } }))
    s = resolve(s, LEADER)
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.discard).toContain('EV')
    expect(readyCount(s)).toBe(10 - 1)
  })
  it('LOF_013 back: Action [use the Force] does the same', () => {
    let s = withToken(board({ player: { units: [unit('a0', 'LOF_013')], hand: ['EV'] } }))
    s = resolve(s, { type: 'useAbility', instanceId: 'a0', cardId: 'LOF_013', index: 0 })
    s = accept(s, { optionIndex: 0 })
    expect(readyCount(s)).toBe(10 - 1)
  })

  it('LOF_015 Cal Kestis: front has an opponent exhaust a ready unit they control', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_015') }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'ENEMY', { exhausted: true })] } }))
    s = resolve(s, LEADER)
    expect(choice(s)).toMatchObject({ controller: 'opponent', targets: ['e0'] })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.exhausted).toBe(true)
  })
  it('LOF_015 back: On Attack, the same', () => {
    const s = attackBase(board({ player: { units: [unit('a0', 'LOF_015')] }, opponent: { units: [unit('e0', 'ENEMY')] } }), 'a0')
    expect(choice(s)).toMatchObject({ controller: 'opponent', targets: ['e0'] })
  })

  it('LOF_009 Darth Maul: front deals 1 damage to a unit and 1 to a different unit', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_009') }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'ENEMY')] } }))
    s = resolve(s, LEADER)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(1)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, unitTargets: ['e1'] })
    s = accept(s, { targetInstanceId: 'e1' })
    expect(U(s, 'e1')?.damage).toBe(1)
  })
  it('LOF_009 back: On Attack, the same', () => {
    let s = attackBase(board({ player: { units: [unit('a0', 'LOF_009')] }, opponent: { units: [unit('e0', 'ENEMY'), unit('e1', 'ENEMY')] } }), 'a0')
    s = accept(s, { targetInstanceId: 'e0' })
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
  })

  it('LOF_008 Obi-Wan Kenobi: front gives an Experience token to a unit without one', () => {
    const xp = { cardId: TOKEN_EXPERIENCE, owner: 'player' as const }
    let s = withToken(board({ player: { leader: undeployed('LOF_008'), units: [unit('u0', 'FILLER'), unit('u1', 'FILLER', { upgrades: [xp] })] } }))
    s = resolve(s, LEADER)
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', targets: ['u0'] })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(tokens(s, 'u0', TOKEN_EXPERIENCE)).toBe(1)
  })
  it('LOF_008 back: On Attack, may give an Experience token to ANOTHER unit without one', () => {
    const s = attackBase(board({ player: { units: [unit('a0', 'LOF_008'), unit('u0', 'FILLER')] } }), 'a0')
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', targets: ['u0'], optional: true })
  })

  it('LOF_016 Qui-Gon Jinn: front returns a friendly unit, then plays a cheaper non-Villainy unit from hand for free', () => {
    let s = withToken(board({ player: { leader: undeployed('LOF_016'), units: [unit('r0', 'RET')], hand: ['CHEAP', 'VILU'] } }))
    s = resolve(s, LEADER)
    s = accept(s, { targetInstanceId: 'r0' })
    expect(s.players.player.hand).toContain('RET')
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', free: true })
    expect((choice(s) as Extract<PendingChoice, { kind: 'playCardFrom' }>).candidates).toHaveLength(1)
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.units.some(u => u.cardId === 'CHEAP')).toBe(true)
    expect(readyCount(s)).toBe(10)
  })
  it('LOF_016 back: when this unit completes an attack, may do the same', () => {
    const s = attackBase(board({ player: { units: [unit('a0', 'LOF_016', { isLeader: true }), unit('r0', 'RET')], hand: ['CHEAP'] } }), 'a0')
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true, targets: ['r0'] })
  })
})

describe('Units that use the Force', () => {
  it('LOF_094 Jedi Consular: Action [Exhaust, use the Force] plays a unit from hand for 2 less', () => {
    let s = withToken(board({ player: { units: [unit('c0', 'LOF_094')], hand: ['CHEAP'] } }))
    s = resolve(s, { type: 'useAbility', instanceId: 'c0', cardId: 'LOF_094', index: 0 })
    expect(U(s, 'c0')?.exhausted).toBe(true)
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.units.some(u => u.cardId === 'CHEAP')).toBe(true)
    expect(readyCount(s)).toBe(10)
  })
  it('LOF_185 Baylan Skoll: may use the Force to return a non-leader unit costing 4 or less; its owner may play it free', () => {
    let s = playUnit(withToken(board({ player: { ...rich, hand: ['LOF_185'] }, opponent: { units: [unit('e0', 'FRAIL'), unit('e1', 'ENEMY', { exhausted: false })] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', targets: ['e0', 'e1'] })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')).toBeUndefined()
    expect(choice(s)).toMatchObject({ kind: 'playUnitFromHand', controller: 'opponent' })
  })
  it('LOF_115 Dagoyan Master: When Played and When Defeated, may use the Force to search the top 5 for a Force unit', () => {
    let s = playUnit(withToken(board({ player: { ...rich, hand: ['LOF_115'], deck: ['TST_U1', 'FORCEU', 'TST_U1'] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'searchDraw', eligibleIndices: [1] })
    let d = withToken(board({ player: { units: [unit('d0', 'LOF_115')] } }))
    d = defeatUnit(d, 'd0')
    expect(choice(d)).toMatchObject({ kind: 'mayPayThen', useForce: true })
  })
  it('LOF_039 Darth Sidious: may use the Force to defeat each non-Sith unit with 3 or less remaining HP', () => {
    let s = playUnit(withToken(board({ player: { ...rich, hand: ['LOF_039'], units: [unit('u0', 'FILLER')] }, opponent: { units: [unit('e0', 'FRAIL'), unit('e1', 'ENEMY'), unit('e2', 'SITH')] } })))
    s = accept(s)
    expect(U(s, 'u0')).toBeUndefined()
    expect(U(s, 'e0')).toBeUndefined()
    expect(U(s, 'e1')).toBeDefined()
    expect(U(s, 'e2')).toBeDefined()
    expect(s.players.player.units.some(u => u.cardId === 'LOF_039')).toBe(true)
  })
  it('LOF_087 Eighth Brother: when you play another unit, may use the Force to give a unit +2/+2 for this phase', () => {
    let s = playUnit(withToken(board({ player: { hand: ['FILLER'], units: [unit('b0', 'LOF_087')] } })))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    const played = s.players.player.units.find(u => u.cardId === 'FILLER')!
    s = accept(s, { targetInstanceId: played.instanceId })
    expect(effectivePower(s, U(s, played.instanceId)!)).toBe(F.FILLER.power! + 2)
  })
  it('LOF_072 Priestesses of the Force: may use the Force to give a Shield token to each of up to 5 units', () => {
    let s = playUnit(withToken(board({ player: { ...rich, hand: ['LOF_072'], units: [unit('u0', 'FILLER')] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    s = accept(s, { targetInstanceId: 'u0' })
    s = accept(s, { targetInstanceId: 'e0' })
    s = decline(s)
    expect(tokens(s, 'u0', TOKEN_SHIELD)).toBe(1)
    expect(tokens(s, 'e0', TOKEN_SHIELD)).toBe(1)
  })
})

describe('Events that use the Force', () => {
  it('LOF_188 As I Have Foreseen: may use the Force to play the top card of the deck for 4 less', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_188'], deck: ['RET', 'TST_U1'] } })))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true, text: expect.stringContaining('RET') })
    const afterEvent = readyCount(s)
    s = accept(s)
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.units.some(u => u.cardId === 'RET')).toBe(true)
    expect(readyCount(s)).toBe(afterEvent) // RET costs 4, less 4
  })
  it('LOF_188 does nothing without the token', () => {
    const s = playEvent(board({ player: { hand: ['LOF_188'], deck: ['RET'] } }))
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
  it('LOF_189 Liberated by Darkness: use the Force to take control of a non-leader unit until the regroup phase', () => {
    let s = playEvent(withToken(board({ player: { ...rich, hand: ['LOF_189'] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(s.players.player.units.some(u => u.instanceId === 'e0')).toBe(true)
    s = toRegroup(s)
    expect(s.players.opponent.units.some(u => u.instanceId === 'e0')).toBe(true)
  })
  it('LOF_227 The Will of the Force: returns a non-leader unit; may use the Force to have that player discard at random', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_227'] }, opponent: { hand: ['TST_E1'], units: [unit('e0', 'ENEMY')] } })))
    s = accept(s, { targetInstanceId: 'e0' })
    expect(s.players.opponent.hand).toHaveLength(2)
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(s.players.opponent.hand).toHaveLength(1)
    expect(s.players.opponent.discard).toHaveLength(1)
  })
  it('LOF_227 without the token only returns the unit', () => {
    let s = playEvent(board({ player: { hand: ['LOF_227'] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    s = accept(s, { targetInstanceId: 'e0' })
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.opponent.hand).toEqual(['ENEMY'])
  })
  it('LOF_221 Trust Your Instincts: use the Force to attack with a unit at +2/+0, dealing its combat damage first', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_221'], units: [unit('a0', 'FILLER2')] }, opponent: { units: [unit('e0', 'FRAIL')] } })))
    s = accept(s)
    s = resolve(s, { type: 'attack', attackerId: 'a0', target: { kind: 'unit', instanceId: 'e0' } })
    expect(U(s, 'e0')).toBeUndefined()
    expect(U(s, 'a0')?.damage).toBe(0)
  })
  it('LOF_221 is not offered when no unit can attack', () => {
    const s = playEvent(withToken(board({ player: { hand: ['LOF_221'] } })))
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
})
