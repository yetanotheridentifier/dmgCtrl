import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * An action ability with a discard cost, a choice raised
 * during the regroup phase, and a static that turns off friendly Advantage tokens.
 */
const F = {
  ...CARDS,
  ASH_217: card({ id: 'ASH_217', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4 }), // Mayor's Majordomo
  ASH_159: card({ id: 'ASH_159', type: 'unit', arena: 'space', cost: 5, power: 5, hp: 6, keywords: [{ name: 'Overwhelm' }] }), // Alphabet Squadron U-Wing
  ASH_149: card({ id: 'ASH_149', type: 'unit', arena: 'space', cost: 8, power: 9, hp: 7 }), // Eviscerator
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 9 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices![0]
const advs = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length

describe("Mayor's Majordomo (217) — [Exhaust, discard a card]: exhaust a unit", () => {
  it('discards a card as part of the cost, then exhausts the chosen unit', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['GRD', 'SPC'], units: [unit('m', 'ASH_217')] }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const used = resolve(s, { type: 'useAbility', instanceId: 'm', cardId: 'ASH_217', index: 0 })
    expect(U(used, 'm').exhausted).toBe(true) // [Exhaust] paid
    expect(choice(used)).toMatchObject({ kind: 'selectDiscard', count: 1 })

    const discarded = resolve(used, { type: 'acceptChoice', choiceId: choice(used).id, handIndex: 0 })
    expect(discarded.players.player.hand).toEqual(['SPC'])
    expect(discarded.players.player.discard).toContain('GRD')
    expect(choice(discarded)).toMatchObject({ kind: 'mayExhaustUnit' })

    const done = resolve(discarded, { type: 'acceptChoice', choiceId: choice(discarded).id, targetInstanceId: 'e' })
    expect(U(done, 'e').exhausted).toBe(true)
  })

  it('is unavailable with an empty hand — the discard is a cost, not an effect', () => {
    const s = state({ cards: F, players: { player: rich({ hand: [], units: [unit('m', 'ASH_217')] }), opponent: player({ units: [unit('e', 'GRD')] }) } })
    expect(legalMoves(s).some(m => m.type === 'useAbility')).toBe(false)
  })
})

describe('Alphabet Squadron U-Wing (159) — a choice when the regroup phase starts', () => {
  it('raises the Advantage choice at regroup and lets it be resolved there', () => {
    const s = state({
      cards: F,
      phase: 'action',
      consecutivePasses: 1,
      activePlayer: 'player',
      players: {
        player: rich({ units: [unit('u', 'ASH_159', { arena: 'space' }), unit('g', 'GRD')] }),
        opponent: player(),
      },
    })
    // Both players passing ends the action phase and starts regroup.
    const regroup = resolve(s, { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(choice(regroup)).toMatchObject({ kind: 'mayGiveTokens', count: 1 })

    // The choice must be answerable during regroup — this is what used to deadlock.
    const moves = legalMoves(regroup)
    expect(moves.some(m => m.type === 'acceptChoice')).toBe(true)
    const given = resolve(regroup, { type: 'acceptChoice', choiceId: choice(regroup).id, targetInstanceId: 'g' })
    expect(advs(U(given, 'g'))).toBe(1)
    expect(given.pendingChoices ?? []).toHaveLength(0)
    // Regroup proceeds normally afterwards.
    expect(legalMoves(given).some(m => m.type === 'resourceCard' || m.type === 'skipResource')).toBe(true)
  })
})

describe('Eviscerator (149) — friendly Advantage tokens lose all abilities', () => {
  const board = (withEviscerator: boolean) => state({
    cards: F,
    players: {
      player: rich({
        units: [
          ...(withEviscerator ? [unit('ev', 'ASH_149', { arena: 'space' })] : []),
          unit('a', 'SPC', { arena: 'space', upgrades: [{ cardId: TOKEN_ADVANTAGE, owner: 'player' }] }),
        ],
      }),
      opponent: player({ units: [unit('e', 'SPC', { arena: 'space', upgrades: [{ cardId: TOKEN_ADVANTAGE, owner: 'opponent' }] })] }),
    },
  })

  it('zeroes the token’s power bonus for friendly units only', () => {
    const withEv = board(true)
    expect(effectivePower(withEv, U(withEv, 'a'))).toBe(2) // 2 + 0, token inert
    expect(effectivePower(withEv, U(withEv, 'e'))).toBe(3) // enemy token still gives +1
    const without = board(false)
    expect(effectivePower(without, U(without, 'a'))).toBe(3)
  })

  it('keeps friendly tokens on the unit after combat, while enemy tokens are spent', () => {
    const s = board(true)
    const done = resolve(s, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'e' } })
    expect(advs(U(done, 'a'))).toBe(1) // "They aren't defeated after combat."
    expect(advs(U(done, 'e'))).toBe(0) // the enemy's token is consumed as normal
  })

  it('gives 2 Advantage tokens to each other friendly unit when played', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_149'], units: [unit('x', 'SPC', { arena: 'space' }), unit('y', 'GRD')] }),
        opponent: player({ units: [unit('e', 'SPC', { arena: 'space' })] }),
      },
    })
    const p = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(advs(U(p, 'x'))).toBe(2)
    expect(advs(U(p, 'y'))).toBe(2)
    expect(advs(U(p, 'e'))).toBe(0) // friendly only
  })
})
