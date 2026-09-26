import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { exploitTerms } from '../engine/legalMoves'
import { createCreditTokens, defeatCreditTokens, takeControlOfCreditTokens, friendlyCreditTokens } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Credit tokens (LAW's set mechanic, #602): "While paying resources, you may defeat this token. If
 * you do, pay 1 less."
 *
 * Unlike Experience/Shield/Weakness, a Credit token belongs to a PLAYER rather than to a unit: it has
 * no board identity, is fungible, and "take control of an enemy Credit token" is the count moving
 * between the two players. The discount is a standing rule usable on ANY card play, read by
 * `exploitTerms` as a fourth mode of the #473/#683 `exploit`/`whilePlaying` step, not declared by the
 * card being played.
 */

const F: Record<string, EngineCard> = {
  ...CARDS,
  PLAIN: card({ id: 'PLAIN', arena: 'ground', cost: 4, power: 2, hp: 2 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 3 }),
  EX2: card({ id: 'EX2', arena: 'ground', cost: 6, power: 6, hp: 6, keywords: [{ name: 'Exploit', value: 2 }] }),
}

const board = (resources: number, hand: string[], creditTokens = 0, units: string[] = []): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(resources), hand, deck: [], creditTokens, units: units.map((c, i) => unit(`f${i}`, c, { exhausted: true })) }),
    opponent: player({ resources: ready(5), deck: [] }),
  },
})

const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const answers = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
const optionIndices = (s: GameState) => answers(s).flatMap(m => (m.type === 'acceptChoice' && m.optionIndex !== undefined ? [m.optionIndex] : []))
const canFinish = (s: GameState) => answers(s).some(m => m.type === 'skipTrigger')
const pickOption = (s: GameState, optionIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, optionIndex })
const done = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const readyLeft = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length

describe('Credit token primitives', () => {
  it('creates tokens, reads by friendlyCreditTokens', () => {
    const s = createCreditTokens(state({ players: { player: player(), opponent: player() } }), 'player', 2)
    expect(friendlyCreditTokens(s, 'player')).toBe(2)
    expect(friendlyCreditTokens(s, 'opponent')).toBe(0)
  })

  it('records tokensCreated (The Client, #602 comment on #458)', () => {
    const s = createCreditTokens(state({ players: { player: player(), opponent: player() } }), 'player', 1)
    expect(s.phaseEvents?.tokensCreated).toContain('player')
  })

  it('defeats up to the held count, clamped at 0', () => {
    const held2 = createCreditTokens(state({ players: { player: player(), opponent: player() } }), 'player', 2)
    expect(friendlyCreditTokens(defeatCreditTokens(held2, 'player', 1), 'player')).toBe(1)
    expect(friendlyCreditTokens(defeatCreditTokens(held2, 'player', 5), 'player')).toBe(0)
    expect(friendlyCreditTokens(defeatCreditTokens(held2, 'player', 0), 'player')).toBe(2)
  })

  it('take control moves the count from one player to the other, clamped to what is held', () => {
    const s0 = state({ players: { player: player(), opponent: player() } })
    const s1 = createCreditTokens(s0, 'opponent', 1)
    const s2 = takeControlOfCreditTokens(s1, 'opponent', 'player', 1)
    expect(friendlyCreditTokens(s2, 'opponent')).toBe(0)
    expect(friendlyCreditTokens(s2, 'player')).toBe(1)
    // Nothing to take: a no-op, not a crash.
    expect(takeControlOfCreditTokens(s2, 'opponent', 'player', 3)).toBe(s2)
  })
})

describe('Credit tokens as a payment: exploitTerms offers the standing discount', () => {
  it('offers nothing when the player holds none', () => {
    expect(exploitTerms(board(4, ['PLAIN']), 'player', F.PLAIN)).toBeUndefined()
  })

  it('offers a credit mode sized to what is held, discount 1 each, when the player holds any', () => {
    expect(exploitTerms(board(4, ['PLAIN'], 3), 'player', F.PLAIN)).toEqual({ limit: 3, discount: 1, credit: true })
  })

  it('makes an otherwise-too-dear play affordable', () => {
    // Cost 4, only 2 ready resources, but 3 Credit tokens can cover the rest.
    expect(legalMoves(board(2, ['PLAIN'], 3))).toContainEqual({ type: 'playUnit', handIndex: 0 })
    expect(legalMoves(board(2, ['PLAIN'], 1))).not.toContainEqual({ type: 'playUnit', handIndex: 0 })
  })

  it('is offered for an event too', () => {
    expect(legalMoves(board(0, ['EVT'], 3))).toContainEqual({ type: 'playEvent', handIndex: 0 })
  })

  it('does not combine with a card\'s own Exploit (scope limit, #602): Exploit wins when there are units to exploit', () => {
    const s = resolve(board(6, ['EX2'], 5, ['PLAIN']), { type: 'playUnit', handIndex: 0 })
    const c = choice(s)
    expect(c.kind).toBe('exploit')
    expect(c).toMatchObject({ discount: 2 }) // the keyword's own discount, not Credit's 1
    expect('credit' in c && c.credit).toBeFalsy()
  })

  it('falls back to the credit discount when a card grants Exploit but there is nothing to exploit', () => {
    const s = resolve(board(6, ['EX2'], 5), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'exploit', credit: true, limit: 5, discount: 1 })
  })

  it('picks by ordinal position, one at a time, up to what is held', () => {
    let s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'exploit', credit: true, limit: 3, discount: 1 })
    expect(optionIndices(s)).toEqual([0, 1, 2])
    s = pickOption(s, 0)
    expect(friendlyCreditTokens(s, 'player')).toBe(3) // not spent until Done/finish
    expect(optionIndices(s)).toEqual([1, 2])
  })

  it('finishing pays the remainder from ready resources and defeats the Credits picked, not before', () => {
    let s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    s = pickOption(s, 0)
    s = pickOption(s, 1) // 2 picked, cost 4 - 2 = 2, affordable with 2 ready
    expect(canFinish(s)).toBe(true)
    s = done(s)
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.units.some(u => u.cardId === 'PLAIN')).toBe(true)
    expect(readyLeft(s)).toBe(0) // paid the remaining 2
    expect(friendlyCreditTokens(s, 'player')).toBe(1) // 3 held - 2 defeated
  })

  it('a defeated Credit triggers nothing and does not reduce ready resources (unlike a defeated resource)', () => {
    let s = resolve(board(0, ['PLAIN'], 4), { type: 'playUnit', handIndex: 0 })
    // Cost 4, discount 1 x 4 = 4, so all 4 must be picked to afford it with 0 ready resources.
    for (let i = 0; i < 4; i++) s = pickOption(s, i)
    expect(s.pendingChoices ?? []).toHaveLength(0) // finished itself at the limit
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
    expect(readyLeft(s)).toBe(0)
  })
})
