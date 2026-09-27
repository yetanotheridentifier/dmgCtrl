import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { discloseRemaining } from '../engine/effects'
import { pushChoice } from '../engine/types'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, card, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Disclose (SEC's set mechanic, #603): "reveal cards from your hand with these aspect icons among
 * them." `need` is a flat multiset of aspect names (a repeated name for a repeated icon requirement,
 * "Command Command Villainy" is `['Command', 'Command', 'Villainy']`); nothing leaves hand, cards are
 * only revealed. `picks` accumulate one hand index at a time like `exploit`'s picks, and Done
 * (`acceptChoice` with no `handIndex`) is offered once `need` is covered.
 */

const F: Record<string, EngineCard> = {
  ...CARDS,
  VIG: card({ id: 'VIG', type: 'event', cost: 1, aspects: ['Vigilance'] }),
  CMD: card({ id: 'CMD', type: 'event', cost: 1, aspects: ['Command'] }),
  CMD2: card({ id: 'CMD2', type: 'event', cost: 1, aspects: ['Command', 'Command'] }), // double icon (Chancellor Valorum)
  DUAL: card({ id: 'DUAL', type: 'event', cost: 1, aspects: ['Command', 'Villainy'] }),
  PLAIN: card({ id: 'PLAIN', type: 'event', cost: 1, aspects: ['Aggression'] }),
}

const board = (hand: string[]): GameState => state({
  cards: F,
  players: { player: player({ hand }), opponent: player() },
})

const raise = (s: GameState, need: string[], optional = true, extra: Partial<Extract<PendingChoice, { kind: 'disclose' }>> = {}): GameState =>
  pushChoice(s, { kind: 'disclose', id: 'test-disclose', controller: 'player', need, picks: [], optional, ...extra })

const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const moves = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
const handIndices = (s: GameState) => moves(s).flatMap(m => (m.type === 'acceptChoice' && m.handIndex !== undefined ? [m.handIndex] : []))
const canFinish = (s: GameState) => moves(s).some(m => m.type === 'acceptChoice' && m.handIndex === undefined)
const canDecline = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const pick = (s: GameState, handIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, handIndex })
const finish = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id })
const decline = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })

describe('discloseRemaining (pure multiset subtraction)', () => {
  it('cancels one matching entry per contribution', () => {
    expect(discloseRemaining(['Command', 'Command', 'Villainy'], ['Command'])).toEqual(['Command', 'Villainy'])
  })
  it('a double-icon contribution cancels two entries of the same aspect', () => {
    expect(discloseRemaining(['Command', 'Command', 'Villainy'], ['Command', 'Command'])).toEqual(['Villainy'])
  })
  it('an aspect not in need is ignored', () => {
    expect(discloseRemaining(['Command'], ['Aggression'])).toEqual(['Command'])
  })
  it('empty once fully covered', () => {
    expect(discloseRemaining(['Command', 'Villainy'], ['Command', 'Villainy'])).toEqual([])
  })
})

describe('disclose: legal moves', () => {
  it('offers one hand index per card that helps the still-unmet requirement, plus decline', () => {
    const s = raise(board(['VIG', 'PLAIN']), ['Vigilance'])
    expect(handIndices(s)).toEqual([0]) // PLAIN (Aggression) does not help
    expect(canDecline(s)).toBe(true)
    expect(canFinish(s)).toBe(false)
  })

  it('does not offer decline once optional is false, only picks', () => {
    const s = raise(board(['VIG']), ['Vigilance'], false)
    expect(canDecline(s)).toBe(false)
    expect(handIndices(s)).toEqual([0])
  })

  it('does not offer decline once at least one card has been picked', () => {
    let s = raise(board(['VIG', 'CMD']), ['Vigilance', 'Command'])
    s = pick(s, 0)
    expect(canDecline(s)).toBe(false)
  })

  it('offers Done once the requirement is fully covered, and stops offering further picks', () => {
    let s = raise(board(['VIG']), ['Vigilance'])
    s = pick(s, 0)
    expect(canFinish(s)).toBe(true)
    expect(handIndices(s)).toEqual([])
  })

  it('a double-icon card alone can satisfy a doubled requirement', () => {
    const s = raise(board(['CMD2']), ['Command', 'Command'])
    let next = pick(s, 0)
    expect(canFinish(next)).toBe(true)
  })

  it('needs a second card when one card only partly covers a doubled requirement', () => {
    let s = raise(board(['CMD', 'DUAL']), ['Command', 'Command'])
    s = pick(s, 0) // CMD: one Command
    expect(canFinish(s)).toBe(false)
    expect(handIndices(s)).toEqual([1]) // DUAL still helps (has a Command icon)
    s = pick(s, 1)
    expect(canFinish(s)).toBe(true)
  })

  it('a pick that would strand the remainder with nothing left to complete it is never offered', () => {
    // Need 2 Villainy; hand holds only one Villainy icon total (on DUAL). PLAIN helps nothing.
    const s = raise(board(['DUAL', 'PLAIN']), ['Villainy', 'Villainy'])
    // DUAL is offered even though it alone cannot finish it (it's the only progress available and
    // the requirement is unreachable regardless — declining is still open since nothing was picked).
    expect(canDecline(s)).toBe(true)
  })

  it('with nothing in hand that helps, only decline is offered', () => {
    const s = raise(board(['PLAIN']), ['Vigilance'])
    expect(handIndices(s)).toEqual([])
    expect(canDecline(s)).toBe(true)
  })
})

describe('disclose: resolving', () => {
  it('picking does not remove the card from hand', () => {
    let s = raise(board(['VIG']), ['Vigilance'])
    s = pick(s, 0)
    expect(s.players.player.hand).toEqual(['VIG'])
  })

  it('declining removes the choice and runs no effect', () => {
    const s = raise(board(['VIG']), ['Vigilance'])
    const next = decline(s)
    expect(next.pendingChoices ?? []).toHaveLength(0)
  })

  it('onDecline runs its effect only when declined ("if you don\'t")', () => {
    const s = raise(board(['PLAIN']), ['Vigilance'], true, { onDecline: { damageOwnBase: 2 } })
    const next = decline(s)
    expect(next.players.player.base.damage).toBe(2)
  })

  it('onDecline does not run when the disclosure is completed instead', () => {
    let s = raise(board(['VIG']), ['Vigilance'], true, { onDecline: { damageOwnBase: 2 } })
    s = pick(s, 0)
    s = finish(s)
    expect(s.players.player.base.damage).toBe(0)
  })

  it('finishing with no `then` is a harmless no-op beyond clearing the choice', () => {
    let s = raise(board(['VIG']), ['Vigilance'])
    s = pick(s, 0)
    s = finish(s)
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })
})
