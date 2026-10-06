import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { defeatUnit } from '../engine/combat'
import { hasForceToken, createForceToken } from '../engine/effects'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, ready, card, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * 28 of #462's Force-token cards: the ones needing nothing beyond the primitive itself (create,
 * optional use, and the passive "while the Force is with you" grant), covering all three shapes
 * `mayUseForceWp`/`useForceCost`/`conditionalKeywords` are built for. See `forceTokens.test.ts` for
 * the primitive itself, and `forceCards2.test.ts` for the rest of LOF's Force cards.
 */

const POOL = poolFor(['LOF'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const IDS = [
  'LOF_129', 'LOF_007', 'LOF_193', 'LOF_041',
  'LOF_231', 'LOF_196', 'LOF_050', 'LOF_237',
  'LOF_075', 'LOF_097', 'LOF_048', 'LOF_031', 'LOF_146', 'LOF_149', 'LOF_035', 'LOF_173', 'LOF_195',
  'LOF_102', 'LOF_172', 'LOF_175', 'LOF_137', 'LOF_156', 'LOF_159', 'LOF_123', 'LOF_216',
  'LOF_002', 'LOF_178', 'LOF_014',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(IDS.map(id => [id, real(id)])),
  FILLER: card({ id: 'FILLER', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  FILLER2: card({ id: 'FILLER2', arena: 'ground', cost: 1, power: 2, hp: 2 }),
  ENEMY: card({ id: 'ENEMY', arena: 'ground', cost: 3, power: 3, hp: 10 }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 2, power: 3, hp: 10 }),
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
const withToken = (s: GameState): GameState => createForceToken(s, 'player')
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const decline = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const playUnit = (s: GameState, handIndex = 0) => resolve(s, { type: 'playUnit', handIndex })
const playEvent = (s: GameState, handIndex = 0) => resolve(s, { type: 'playEvent', handIndex })
const playUpgrade = (s: GameState, targetInstanceId: string, handIndex = 0) => resolve(s, { type: 'playUpgrade', handIndex, targetInstanceId })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const expTokens = (u: ReturnType<typeof U>) => u?.upgrades.filter(t => t.cardId === TOKEN_EXPERIENCE).length ?? 0

describe('LOF_129 Acolyte of the Beyond / LOF_007 Avar Kriss / LOF_193 Youngling Padawan: unconditional token creation', () => {
  it('LOF_129 creates a token on attack', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_129', { exhausted: false })] } })
    s = resolve(s, { type: 'attack', attackerId: 'u0', target: { kind: 'base' } })
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('LOF_129 creates a token when defeated', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_129')] } })
    s = defeatUnit(s, 'u0')
    expect(hasForceToken(s, 'player')).toBe(true)
  })
  it('LOF_007 Avar Kriss creates a token via its undeployed leader Action, and its deployed back grants +4/+0 and Overwhelm while held', () => {
    const s = board({ player: { leader: { cardId: 'LOF_007', deployed: false, epicActionUsed: false, exhausted: false } } })
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    const after = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(hasForceToken(after, 'player')).toBe(true)
    expect(after.players.player.leader.exhausted).toBe(true)
    // Deployed back, gated on holding the token.
    const deployed = board({ player: { units: [unit('c', 'LOF_007')] } })
    expect(unitHasKeyword(deployed, U(deployed, 'c')!, 'Overwhelm')).toBe(false)
    const held = withToken(deployed)
    expect(effectivePower(held, U(held, 'c')!)).toBe(F.LOF_007.power! + 4)
    expect(unitHasKeyword(held, U(held, 'c')!, 'Overwhelm')).toBe(true)
  })
  it('LOF_193 creates a token when played', () => {
    const s = playUnit(board({ player: { hand: ['LOF_193'] } }))
    expect(hasForceToken(s, 'player')).toBe(true)
  })
})

describe('LOF_041 Drain Essence: deal 2 damage to a unit, unconditionally the Force is with you', () => {
  it('deals 2 and creates a token', () => {
    let s = playEvent(board({ player: { hand: ['LOF_041'] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(2)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
})

describe('Passive "while the Force is with you" grants', () => {
  it('LOF_231 Darth Tyranus gains Ambush only while the token is held', () => {
    const without = board({ player: { units: [unit('c', 'LOF_231')] } })
    expect(unitHasKeyword(without, U(without, 'c')!, 'Ambush')).toBe(false)
    const held = withToken(without)
    expect(unitHasKeyword(held, U(held, 'c')!, 'Ambush')).toBe(true)
  })
  it('LOF_196 Jedi Sentinel gains Sentinel only while the token is held', () => {
    const without = board({ player: { units: [unit('c', 'LOF_196')] } })
    expect(unitHasKeyword(without, U(without, 'c')!, 'Sentinel')).toBe(false)
    const held = withToken(without)
    expect(unitHasKeyword(held, U(held, 'c')!, 'Sentinel')).toBe(true)
  })
  it('LOF_050 Plo Koon gains Grit only while the token is held', () => {
    const without = board({ player: { units: [unit('c', 'LOF_050')] } })
    expect(unitHasKeyword(without, U(without, 'c')!, 'Grit')).toBe(false)
    const held = withToken(without)
    expect(unitHasKeyword(held, U(held, 'c')!, 'Grit')).toBe(true)
  })
  it('LOF_237 The Son: each friendly unit gets +2/+0 only while the token is held', () => {
    const without = board({ player: { units: [unit('c', 'LOF_237'), unit('f1', 'FILLER')] } })
    expect(effectivePower(without, U(without, 'f1')!)).toBe(F.FILLER.power)
    const held = withToken(without)
    expect(effectivePower(held, U(held, 'f1')!)).toBe(F.FILLER.power! + 2)
    // Not itself excluded or included specially, but the source's own aura affects others, not the source.
  })
})

describe('LOF_075 Cure Wounds / LOF_172 Sorcerous Blast / LOF_173 Unleash Rage: events, Use the Force (never optional wording, always optional in practice)', () => {
  it('LOF_075: heals 6 from a unit only on accept, never offered without a token', () => {
    const dmg = board({ player: { hand: ['LOF_075'], units: [unit('u0', 'TOUGH', { damage: 6 })] } })
    expect(playEvent(dmg).pendingChoices ?? []).toHaveLength(0) // no token: no choice at all
    let s = playEvent(withToken(dmg))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 6 })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(U(s, 'u0')?.damage).toBe(0)
  })
  it('LOF_172: deals 3 to a unit on accept', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_172'] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(3)
  })
  it('LOF_173: gives a friendly unit +3/+0 for the phase on accept', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_173'], units: [unit('u0', 'FILLER')] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff' })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(effectivePower(s, U(s, 'u0')!)).toBe(F.FILLER.power! + 3)
  })
  it('declining leaves the token held and applies nothing (LOF_172)', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_172'] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = decline(s)
    expect(hasForceToken(s, 'player')).toBe(true)
    expect(U(s, 'e0')?.damage ?? 0).toBe(0)
  })
})

describe('When Played / When Defeated: You may use the Force. If you do, <effect>', () => {
  it('LOF_097 Eeth Koth: When Defeated, resources the card from discard', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_097')] } })
    s = withToken(s)
    s = defeatUnit(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(s.players.player.resources.some(r => r.cardId === 'LOF_097')).toBe(true)
  })
  it('LOF_048 Itinerant Warrior: When Played, heals 3 from a base on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_048'] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 3 })
  })
  it('LOF_031 Karis: When Defeated, gives a unit -2/-2 for the phase on accept', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_031'), unit('u1', 'TOUGH')] } })
    s = withToken(s)
    s = defeatUnit(s, 'u0')
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff' })
    s = accept(s, { targetInstanceId: 'u1' })
    expect(effectivePower(s, U(s, 'u1')!)).toBe(F.TOUGH.power! - 2)
  })
  it('LOF_146 Ki-Adi-Mundi: When Played, draws 2 on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_146'] } })))
    s = accept(s)
    expect(s.players.player.hand.length).toBe(2)
  })
  it('LOF_149 Mace Windu: When Played, deals 4 to a unit on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_149'] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 4 })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(U(s, 'e0')?.damage).toBe(4)
  })
  it('LOF_035 Talzin\'s Assassin: When Played, gives a unit -3/-3 for the phase on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_035'] }, opponent: { units: [unit('e0', 'ENEMY')] } })))
    s = accept(s)
    s = accept(s, { targetInstanceId: 'e0' })
    expect(effectivePower(s, U(s, 'e0')!)).toBe(F.ENEMY.power! - 3)
  })
  it('LOF_195 Vernestra Rwoh: When Played, readies itself on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_195'] } })))
    const before = U(s, 'u0')
    s = accept(s)
    // The freshly played unit is exhausted or ready depending on Ambush; either way, accepting readies it.
    const played = s.players.player.units.find(u => u.cardId === 'LOF_195')!
    expect(played.exhausted).toBe(false)
    void before
  })
  it('LOF_159 Jedi In Hiding: When Defeated, each opponent discards a card on accept', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_159')] }, opponent: { hand: ['TST_E1'] } })
    s = withToken(s)
    s = defeatUnit(s, 'u0')
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent' })
    s = accept(s, { handIndex: 0 })
    expect(s.players.opponent.discard).toContain('TST_E1')
  })
  it('LOF_156 Infused Brawler: When Played gives 2 Experience on accept; completing an attack defeats one', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_156'] } })))
    s = accept(s)
    const played = s.players.player.units.find(u => u.cardId === 'LOF_156')!
    expect(expTokens(played)).toBe(2)
    s = {
      ...s,
      activePlayer: 'player',
      players: { ...s.players, player: { ...s.players.player, units: s.players.player.units.map(u => (u.instanceId === played.instanceId ? { ...u, exhausted: false } : u)) } },
    }
    s = resolve(s, { type: 'attack', attackerId: played.instanceId, target: { kind: 'base' } })
    const after = s.players.player.units.find(u => u.instanceId === played.instanceId)!
    expect(expTokens(after)).toBe(1)
  })
})

describe('LOF_102 Yoda\'s Lightsaber: attach to a non-Vehicle unit; When Played, may use the Force to heal 3 from a base', () => {
  it('offers the choice on attach and heals on accept', () => {
    let s = board({ player: { hand: ['LOF_102'], units: [unit('h0', 'FILLER')] } })
    s = withToken(s)
    s = playUpgrade(s, 'h0')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
    s = accept(s)
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 3 })
  })
})

describe('LOF_175 Do or Do Not: You may use the Force. If you do, draw 2. If you do not, draw a card (declineStep)', () => {
  it('draws 2 on accept', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_175'] } })))
    s = accept(s)
    expect(s.players.player.hand.length).toBe(2)
  })
  it('draws 1 on decline', () => {
    let s = playEvent(withToken(board({ player: { hand: ['LOF_175'] } })))
    s = decline(s)
    expect(s.players.player.hand.length).toBe(1)
    expect(hasForceToken(s, 'player')).toBe(true)
  })
})

describe('LOF_137 Savage Opress: When Played/When Defeated, may use the Force. If you don\'t, deal 9 to your own base (declineStep)', () => {
  it('does nothing to the base on accept', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_137'] } })))
    s = accept(s)
    expect(s.players.player.base.damage).toBe(0)
  })
  it('deals 9 to its own base on decline', () => {
    let s = playUnit(withToken(board({ player: { hand: ['LOF_137'] } })))
    s = decline(s)
    expect(s.players.player.base.damage).toBe(9)
  })
  it('also fires (and can decline) when defeated', () => {
    let s = board({ player: { units: [unit('u0', 'LOF_137')] } })
    s = withToken(s)
    s = defeatUnit(s, 'u0')
    s = decline(s)
    expect(s.players.player.base.damage).toBe(9)
  })
})

describe('LOF_123 Directed by the Force: unconditionally the Force is with you; may play a unit from hand paying its cost', () => {
  it('creates a token and offers playing a unit from hand', () => {
    let s = playEvent(board({ player: { hand: ['LOF_123', 'FILLER'] } }))
    expect(hasForceToken(s, 'player')).toBe(true)
    expect(choice(s).kind).toBe('playCardFrom')
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.units.some(u => u.cardId === 'FILLER')).toBe(true)
  })
})

describe('LOF_216 Disturbance in the Force: conditional on a friendly unit leaving play this phase', () => {
  it('creates a token and offers a Shield when a friendly unit left play this phase', () => {
    let s = board({ player: { hand: ['LOF_216'], units: [unit('u0', 'FILLER'), unit('u1', 'FILLER2')] } })
    s = defeatUnit(s, 'u0')
    s = playEvent(s)
    expect(hasForceToken(s, 'player')).toBe(true)
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens' })
  })
  it('does nothing without a friendly unit leaving play this phase', () => {
    const s = playEvent(board({ player: { hand: ['LOF_216'] } }))
    expect(hasForceToken(s, 'player')).toBe(false)
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('LOF_178 Adept of Anger: a unit\'s own useForceCost action ability', () => {
  it('Action [Exhaust, use the Force]: exhausts a unit', () => {
    const s = withToken(board({ player: { units: [unit('u0', 'LOF_178', { exhausted: false })] }, opponent: { units: [unit('e0', 'ENEMY', { exhausted: false })] } }))
    let after = resolve(s, { type: 'useAbility', instanceId: 'u0', cardId: 'LOF_178', index: 0 })
    expect(hasForceToken(after, 'player')).toBe(false)
    after = accept(after, { targetInstanceId: 'e0' })
    expect(U(after, 'e0')?.exhausted).toBe(true)
  })
})

describe('useForceCost on a leader\'s front (undeployed) action; each also has an unrelated deployed back', () => {
  const undeployed = (cardId: string) => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })

  it('LOF_002 Mother Talzin: front Action [Exhaust, use the Force]: gives a unit -1/-1 for the phase', () => {
    const s = withToken(board({ player: { leader: undeployed('LOF_002') }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0, targetInstanceId: 'e0' })
    const after = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'e0' })
    expect(hasForceToken(after, 'player')).toBe(false)
    expect(after.players.player.leader.exhausted).toBe(true)
    expect(effectivePower(after, U(after, 'e0')!)).toBe(F.ENEMY.power! - 1)
  })
  it('LOF_002 front is not offered without a held token', () => {
    const s = board({ player: { leader: undeployed('LOF_002') }, opponent: { units: [unit('e0', 'ENEMY')] } })
    expect(legalMoves(s)).not.toContainEqual({ type: 'useLeaderAbility', index: 0, targetInstanceId: 'e0' })
  })
  it("LOF_002's deployed back: On Attack, may give a unit -1/-1 for the phase (unrelated to the Force)", () => {
    let s = board({ player: { units: [unit('u0', 'LOF_002', { exhausted: false })] }, opponent: { units: [unit('e0', 'ENEMY')] } })
    s = resolve(s, { type: 'attack', attackerId: 'u0', target: { kind: 'base' } })
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff' })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(effectivePower(s, U(s, 'e0')!)).toBe(F.ENEMY.power! - 1)
  })

  it('LOF_014 Grand Inquisitor: front Action [Exhaust, use the Force]: attack with a friendly unit, defender -2/-0', () => {
    const s = withToken(board({ player: { leader: undeployed('LOF_014'), units: [unit('a0', 'FILLER2', { exhausted: false })] }, opponent: { units: [unit('e0', 'ENEMY')] } }))
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    let after = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(hasForceToken(after, 'player')).toBe(false)
    expect(after.players.player.leader.exhausted).toBe(true)
    expect(choice(after)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    after = resolve(after, { type: 'attack', attackerId: 'a0', target: { kind: 'unit', instanceId: 'e0' } })
    // The defender (e0, power 3) fought at -2/-0 for this attack: the attacker (FILLER2, 2 power) took only 1.
    expect(U(after, 'a0')?.damage).toBe(1)
  })
  it("LOF_014's deployed back: his own unconditional On Attack debuff (unrelated to the Force; Shielded is the printed keyword machinery, not new here)", () => {
    let s = board({ player: { units: [unit('u0', 'LOF_014', { exhausted: false })] }, opponent: { units: [unit('e0', 'ENEMY')] } })
    s = resolve(s, { type: 'attack', attackerId: 'u0', target: { kind: 'unit', instanceId: 'e0' } })
    // LOF_014's own power fought at printed value; e0 (ENEMY, power 3) fought at -2/-0 against him.
    expect(U(s, 'u0')?.damage).toBe(1)
  })
})
