import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { dealIndirectDamage, dealDamageToUnit, defeatUnit } from '../engine/combat'
import { indirectDamageBonus, indirectDamageAssignedByDealer } from '../engine/effects'
import { registerCard } from '../engine/abilities'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Indirect damage (JTL, #604): damage dealt to a PLAYER that THEY assign, as unpreventable damage,
 * among their own base and units — `dealIndirectDamage` (combat.ts), which raises a
 * `distributeIndirectDamage` choice. Modifiers: Hunting Aggressor (+1, `indirectDamageBonus`),
 * Devastator (the dealer assigns instead, `assignsIndirectDamage`), and Allegiant General Pryde
 * (reacts when a unit is dealt indirect damage).
 */

const SOURCE = { cardId: 'SRC', controller: 'player' as const }

const F = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 9 }),
  SHIELDED: card({ id: 'SHIELDED', type: 'unit', arena: 'space', cost: 3, power: 1, hp: 9 }),
}
const shielded = (id: string, cardId = 'SHIELDED') => unit(id, cardId, { arena: 'space', upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })
const board = (overrides: Partial<GameState> = {}) => state({
  cards: F,
  players: {
    player: player(),
    opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' }), unit('d2', 'BIG', { arena: 'space' })] }),
  },
  ...overrides,
})

const choice = (s: GameState): PendingChoice & { kind: 'distributeIndirectDamage' } => {
  const c = s.pendingChoices?.[0]
  if (!c || c.kind !== 'distributeIndirectDamage') throw new Error('no distributeIndirectDamage choice')
  return c
}
const answers = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
const toUnit = (s: GameState, id: string) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, targetInstanceId: id })
const toBase = (s: GameState, playerId: 'player' | 'opponent') => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, baseTarget: playerId })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('dealIndirectDamage (primitive)', () => {
  it('raises a mandatory distribute choice controlled by the receiving player', () => {
    const s = dealIndirectDamage(board(), 'opponent', 3, SOURCE)
    const c = choice(s)
    expect(c.controller).toBe('opponent')
    expect(c.targetPlayer).toBe('opponent')
    expect(c.total).toBe(3)
    expect(c.remaining).toBe(3)
    expect(c.source.unpreventable).toBe(true)
    expect(c.source.indirect).toBe(true)
  })

  it('never offers Done while any amount remains — nobody may decline to absorb it', () => {
    const s = dealIndirectDamage(board(), 'opponent', 2, SOURCE)
    expect(answers(s).some(m => m.type === 'skipTrigger')).toBe(false)
  })

  it('assigns one point at a time to units or the base until spent', () => {
    let s = dealIndirectDamage(board(), 'opponent', 3, SOURCE)
    s = toUnit(s, 'd1')
    expect(U(s, 'd1').damage).toBe(1)
    expect(choice(s).remaining).toBe(2)
    s = toBase(s, 'opponent')
    expect(s.players.opponent.base.damage).toBe(1)
    s = toUnit(s, 'd1')
    expect(U(s, 'd1').damage).toBe(2)
    // Spent: the choice clears.
    expect(s.pendingChoices?.length ?? 0).toBe(0)
  })

  it('does nothing for zero or negative amounts', () => {
    const s = dealIndirectDamage(board(), 'opponent', 0, SOURCE)
    expect(s.pendingChoices?.length ?? 0).toBe(0)
  })

  it('is unpreventable: a Shield token neither stops it nor is spent', () => {
    const withShield = board({
      players: { player: player(), opponent: player({ units: [shielded('d1')] }) },
    })
    let s = dealIndirectDamage(withShield, 'opponent', 2, SOURCE)
    s = toUnit(s, 'd1')
    expect(U(s, 'd1').damage).toBe(1)
    expect(U(s, 'd1').upgrades.filter(u => u.cardId === TOKEN_SHIELD)).toHaveLength(1) // not spent
  })

  it('is unpreventable: a shielded base is not stopped either', () => {
    let s = dealIndirectDamage(board({ shieldedBases: ['opponent'] }), 'opponent', 1, SOURCE)
    s = toBase(s, 'opponent')
    expect(s.players.opponent.base.damage).toBe(1)
    expect(s.shieldedBases).toContain('opponent') // the base's own shield is untouched, unlike ordinary damage
  })

  it('can always finish even once every eligible unit is dead — the base is always a legal target', () => {
    // `activePlayer` is set to the receiving side directly, as the real hand-off (`handOffOpponentChoice`)
    // would leave it once the ability that raised this choice finishes resolving.
    const noUnits = board({ activePlayer: 'opponent', players: { player: player(), opponent: player() } })
    const s = dealIndirectDamage(noUnits, 'opponent', 2, SOURCE)
    const moves = answers(s)
    expect(moves).toEqual([{ type: 'acceptChoice', choiceId: choice(s).id, baseTarget: 'opponent' }])
  })

  it('Hunting Aggressor-style bonus: indirectDamageBonus is asked only of the dealer\'s own units', () => {
    registerCard('TST_BONUS', { indirectDamageBonus: () => 1 })
    const withBonus = board({
      players: {
        player: player({ units: [unit('b1', 'TST_BONUS')] }),
        opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }),
      },
    })
    expect(indirectDamageBonus(withBonus, SOURCE, 'opponent')).toBe(1)
    // Never asked of the target's own side.
    expect(indirectDamageBonus(withBonus, { cardId: 'SRC', controller: 'opponent' }, 'opponent')).toBe(0)
    const s = dealIndirectDamage(withBonus, 'opponent', 2, SOURCE)
    expect(choice(s).total).toBe(3)
  })

  it('Devastator-style flip: assignsIndirectDamage hands the assignment to the dealer', () => {
    registerCard('TST_ASSIGNER', { assignsIndirectDamage: () => true })
    const withFlip = board({
      players: {
        player: player({ units: [unit('a1', 'TST_ASSIGNER')] }),
        opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }),
      },
    })
    expect(indirectDamageAssignedByDealer(withFlip, SOURCE, 'opponent')).toBe(true)
    const s = dealIndirectDamage(withFlip, 'opponent', 2, SOURCE)
    const c = choice(s)
    expect(c.controller).toBe('player') // the dealer assigns...
    expect(c.targetPlayer).toBe('opponent') // ...but it still lands on the opponent's board
  })

  it('follow-up: readyIfBaseDamaged only fires when the base was actually hit', () => {
    const withSelf = board({
      players: { player: player({ units: [unit('self', 'BIG', { exhausted: true })] }), opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }) },
    })
    // Hits only a unit — no ready.
    let s = dealIndirectDamage(withSelf, 'opponent', 1, SOURCE, { readyIfBaseDamaged: 'self' })
    s = toUnit(s, 'd1')
    expect(U(s, 'self').exhausted).toBe(true)
    // Hits the base — readies.
    let s2 = dealIndirectDamage(withSelf, 'opponent', 1, SOURCE, { readyIfBaseDamaged: 'self' })
    s2 = toBase(s2, 'opponent')
    expect(U(s2, 'self').exhausted).toBe(false)
  })

  it('follow-up: exhaustUnitsDamaged exhausts exactly the units that were hit', () => {
    const b = board()
    let s = dealIndirectDamage(b, 'opponent', 2, SOURCE, { exhaustUnitsDamaged: true })
    s = toUnit(s, 'd1')
    s = toBase(s, 'opponent') // the base is not exhaustable — only d1 should end up exhausted
    expect(U(s, 'd1').exhausted).toBe(true)
    expect(U(s, 'd2').exhausted).toBe(false)
  })

  it('follow-up: drawIfBaseDamaged draws only when the base was hit', () => {
    let onlyUnit = dealIndirectDamage(board(), 'opponent', 1, SOURCE, { drawIfBaseDamaged: 'player' })
    onlyUnit = toUnit(onlyUnit, 'd1')
    expect(onlyUnit.players.player.hand.length).toBe(0)
    let hitBase = dealIndirectDamage(board(), 'opponent', 1, SOURCE, { drawIfBaseDamaged: 'player' })
    hitBase = toBase(hitBase, 'opponent')
    expect(hitBase.players.player.hand.length).toBe(1)
  })
})

describe('Indirect damage cards', () => {
  it('Devastator (JTL_143): assigns its own indirect damage, and deals 4 to the opponent when played', () => {
    const s0 = board({
      players: { player: player({ hand: ['JTL_143'], resources: ready(8) }), opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' }), unit('d2', 'BIG', { arena: 'space' })] }) },
      cards: { ...F, JTL_143: card({ id: 'JTL_143', type: 'unit', arena: 'space', cost: 8, power: 9, hp: 6 }) },
    })
    const played = resolve(s0, { type: 'playUnit', handIndex: 0 })
    const c = choice(played)
    expect(c.controller).toBe('player') // Devastator's own controller assigns, not the opponent
    expect(c.total).toBe(4)
  })

  it('Hunting Aggressor (JTL_165) adds 1 to the controller\'s indirect damage against opponents', () => {
    const withAggressor = board({
      cards: { ...F, JTL_165: card({ id: 'JTL_165', type: 'unit', arena: 'space', cost: 4, power: 3, hp: 6 }) },
      players: { player: player({ units: [unit('ha', 'JTL_165', { arena: 'space' })] }), opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }) },
    })
    const s = dealIndirectDamage(withAggressor, 'opponent', 2, SOURCE)
    expect(choice(s).total).toBe(3)
  })

  it('Decimator of Dissidents (JTL_138) costs 1 less once its controller has dealt indirect damage this phase', () => {
    const cards = { ...F, JTL_138: card({ id: 'JTL_138', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 5 }) }
    const before = state({ cards, players: { player: player({ hand: ['JTL_138'], resources: ready(4) }), opponent: player() } })
    const afterIndirect = dealIndirectDamage(before, 'opponent', 1, SOURCE)
    expect(effectiveCost(before, 'player', cards.JTL_138)).toBe(4)
    expect(effectiveCost(afterIndirect, 'player', cards.JTL_138)).toBe(3)
  })

  it('Allegiant General Pryde (JTL_133) may defeat a non-unique upgrade on a unit dealt indirect damage, not ordinary damage', () => {
    const cards = {
      ...F,
      JTL_133: card({ id: 'JTL_133', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3 }),
      UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, unique: false }),
    }
    const withPryde = state({
      cards,
      players: {
        player: player({ units: [unit('pryde', 'JTL_133')] }),
        opponent: player({ units: [unit('d1', 'BIG', { arena: 'space', upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }),
      },
    })
    let s = dealIndirectDamage(withPryde, 'opponent', 1, SOURCE)
    s = toUnit(s, 'd1')
    // Pryde's reaction should now be pending, offering to defeat the non-unique upgrade.
    const reaction = s.pendingChoices?.find(c => c.kind === 'selectUpgradeToDefeat')
    expect(reaction).toBeDefined()

    // Ordinary (non-indirect) damage to the same unit does not raise Pryde's reaction.
    const before = state({ cards, players: withPryde.players })
    const ordinary = dealDamageToUnit(before, 'd1', 1, SOURCE)
    expect(ordinary.pendingChoices?.some(c => c.kind === 'selectUpgradeToDefeat')).toBeFalsy()
  })

  it('Torpedo Barrage (event): a genuine choice of player, then the distribution', () => {
    const cards = { ...F, JTL_234: card({ id: 'JTL_234', type: 'event', cost: 3 }) }
    const s0 = state({
      cards,
      players: { player: player({ hand: ['JTL_234'], resources: ready(3) }), opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }) },
    })
    const played = resolve(s0, { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]?.kind).toBe('choosePlayerThen')
    const chosen = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 }) // the opponent
    const c = choice(chosen)
    expect(c.targetPlayer).toBe('opponent')
    expect(c.total).toBe(5)
  })

  it("First Order Stormtrooper (JTL_132): When Defeated also deals indirect damage (the On Attack/When Defeated compound)", () => {
    const cards = { ...F, JTL_132: card({ id: 'JTL_132', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 1 }) }
    const s0 = state({
      cards,
      players: { player: player({ units: [unit('fo', 'JTL_132')] }), opponent: player({ units: [unit('d1', 'BIG', { arena: 'space' })] }) },
    })
    const dead = defeatUnit(s0, 'fo')
    expect(dead.pendingChoices?.[0]?.kind).toBe('choosePlayerThen')
    const chosen = resolve(dead, { type: 'acceptChoice', choiceId: dead.pendingChoices![0].id, optionIndex: 0 })
    expect(choice(chosen).total).toBe(1)
  })

  it('Lightspeed Assault (JTL_127): defeats a friendly space unit, damages an enemy one, then deals indirect damage equal to its power to that unit\'s controller', () => {
    const cards = { ...F, JTL_127: card({ id: 'JTL_127', type: 'event', cost: 2 }) }
    const s0 = state({
      cards,
      players: {
        player: player({ hand: ['JTL_127'], resources: ready(2), units: [unit('f1', 'BIG', { arena: 'space' })] }),
        opponent: player({ units: [unit('e1', 'BIG', { arena: 'space' })] }),
      },
    })
    const played = resolve(s0, { type: 'playEvent', handIndex: 0 })
    const pick1 = played.pendingChoices![0]
    const afterFriendly = resolve(played, { type: 'acceptChoice', choiceId: pick1.id, targetInstanceId: 'f1' })
    const pick2 = afterFriendly.pendingChoices![0]
    const afterEnemy = resolve(afterFriendly, { type: 'acceptChoice', choiceId: pick2.id, targetInstanceId: 'e1' })
    // The friendly unit is defeated...
    expect(afterEnemy.players.player.units.some(u => u.instanceId === 'f1')).toBe(false)
    // ...the enemy unit took BIG's power (3) in ordinary damage...
    expect(U(afterEnemy, 'e1').damage).toBe(3)
    // ...and indirect damage equal to e1's OWN power (3) is now pending for its controller to assign.
    const c = choice(afterEnemy)
    expect(c.targetPlayer).toBe('opponent')
    expect(c.total).toBe(3)
  })
})
