import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { hasForceToken, createForceToken, defeatForceToken, dealDamageToBase, unitCannotReady } from '../engine/effects'
import { effectivePower } from '../engine/stats'
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
    let s = { ...withToken(board({ player: { units: [unit('f0', 'LOF_260')] }, opponent: { hand: ['LOF_172'], units: [unit('e0', 'ENEMY')] } }), 'opponent'), activePlayer: 'opponent' as const }
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
