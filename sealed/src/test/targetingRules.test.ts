import { describe, it, expect } from 'vitest'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'

/**
 * Targeting rules — who may attack what: "can't attack bases" (Wicket), "can't be attacked
 * while …" (Tatooine Repulsor Train) and "may attack either arena" (Red Leader). All are enforced in
 * `legalMoves` (`enemyAttackTargets` + the base-attack move), so they also bind Ambush/Support attacks.
 */
const F = {
  ...CARDS,
  ASH_034: card({ id: 'ASH_034', type: 'unit', arena: 'ground', power: 3, hp: 3, keywords: [{ name: 'Saboteur' }] }), // Wicket
  ASH_037: card({ id: 'ASH_037', type: 'unit', arena: 'space', power: 6, hp: 6, keywords: [{ name: 'Support' }] }), // Red Leader
  ASH_035: card({ id: 'ASH_035', type: 'unit', arena: 'ground', power: 8, hp: 7 }), // Tatooine Repulsor Train
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', power: 2, hp: 5 }),
  SENTINEL_GRD: card({ id: 'SENTINEL_GRD', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Sentinel' }] }),
}
const attacks = (s: GameState, attackerId: string) =>
  legalMoves(s).filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.attackerId === attackerId)
const targetsOf = (s: GameState, attackerId: string) =>
  attacks(s, attackerId).map(a => (a.target.kind === 'base' ? 'base' : a.target.instanceId)).sort()

describe("Wicket (034) — can't attack bases", () => {
  it('offers enemy units but never the base', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('w', 'ASH_034', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) },
    })
    expect(targetsOf(s, 'w')).toEqual(['e'])
  })

  it('a normal unit in the same spot CAN attack the base (control)', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('n', 'GRD', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) },
    })
    expect(targetsOf(s, 'n')).toEqual(['base', 'e'])
  })
})

describe('Red Leader (037) — may attack units in either arena', () => {
  it('reaches a ground unit from the space arena', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('r', 'ASH_037', { arena: 'space' })] }),
        opponent: player({ units: [unit('g', 'GRD', { arena: 'ground' }), unit('sp', 'SPC', { arena: 'space' })] }),
      },
    })
    expect(targetsOf(s, 'r')).toEqual(['base', 'g', 'sp'])
  })

  it('a normal space unit only reaches the space arena (control)', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('n', 'SPC', { arena: 'space' })] }),
        opponent: player({ units: [unit('g', 'GRD', { arena: 'ground' }), unit('sp', 'SPC', { arena: 'space' })] }),
      },
    })
    expect(targetsOf(s, 'n')).toEqual(['base', 'sp'])
  })
})

describe("Tatooine Repulsor Train (035) — can't be attacked while you control 2+ exhausted units", () => {
  const board = (defenderExtras: ReturnType<typeof unit>[], train: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('a', 'GRD', { arena: 'ground' })] }), // active attacker
      opponent: player({ units: [unit('t', 'ASH_035', { arena: 'ground', ...train }), ...defenderExtras] }),
    },
  })

  it('is attackable with fewer than 2 exhausted friendlies', () => {
    const s = board([unit('x', 'GRD', { arena: 'ground', exhausted: true })]) // only 1 exhausted
    expect(targetsOf(s, 'a')).toContain('t')
  })

  it('is NOT attackable once its controller has 2+ exhausted units', () => {
    const s = board([unit('x', 'GRD', { arena: 'ground', exhausted: true }), unit('y', 'GRD', { arena: 'ground', exhausted: true })])
    const t = targetsOf(s, 'a')
    expect(t).not.toContain('t')
    expect(t).toContain('x') // the others are still fair game
  })

  it('is attackable again if it gains Sentinel — and then forces the attack', () => {
    const s = board(
      [unit('x', 'GRD', { arena: 'ground', exhausted: true }), unit('y', 'GRD', { arena: 'ground', exhausted: true })],
      { upgrades: [{ cardId: 'SENTINEL_UP', owner: 'opponent' }] },
    )
    const withUpgrade = { ...s, cards: { ...F, SENTINEL_UP: card({ id: 'SENTINEL_UP', type: 'upgrade', power: 0, hp: 0, keywords: [{ name: 'Sentinel' }] }) } }
    expect(targetsOf(withUpgrade, 'a')).toEqual(['t']) // Sentinel re-exposes it and locks the attack on
  })

  it('On Attack: deals 2 damage per friendly exhausted unit to a chosen ground unit', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_035', { arena: 'ground' }), unit('x', 'GRD', { arena: 'ground', exhausted: true })] }),
        opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 't', target: { kind: 'base' } })
    // The Train exhausts itself by attacking, so 2 exhausted friendlies → 4 damage.
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', amount: 4 })
  })
})
