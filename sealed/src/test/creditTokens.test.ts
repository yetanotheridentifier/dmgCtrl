import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { exploitTerms } from '../engine/legalMoves'
import { describeAction } from '../utils/describeAction'
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
 * between the two players. The discount is a standing rule usable on any cost, asked in the paying
 * step that stands in front of the action (`payment.ts`), not declared by the card being played.
 * `payingStepDoors.test.ts` takes the doors other than a card played from hand through it.
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
const creditCounts = (s: GameState) => answers(s).flatMap(m => (m.type === 'acceptChoice' && m.credits !== undefined ? [m.credits] : []))
const payCredits = (s: GameState, credits: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, credits })
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

describe('Credit tokens as a payment: the paying step in front of a card played from hand', () => {
  it('asks nothing when the player holds none', () => {
    const s = resolve(board(4, ['PLAIN']), { type: 'playUnit', handIndex: 0 })
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.units.some(u => u.cardId === 'PLAIN')).toBe(true)
  })

  it('is not a step the card declares: it stands in front of the play, for what the play costs', () => {
    expect(exploitTerms(board(4, ['PLAIN'], 3), 'player', F.PLAIN)).toBeUndefined()
    const s = resolve(board(4, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'payWith', id: 'exploit-PLAIN', cost: 4, credits: 0, resume: { type: 'playUnit', handIndex: 0 } })
    expect(s.players.player.hand).toEqual(['PLAIN'])
  })

  it('makes an otherwise-too-dear play affordable', () => {
    // Cost 4, only 2 ready resources, but 3 Credit tokens can cover the rest.
    expect(legalMoves(board(2, ['PLAIN'], 3))).toContainEqual({ type: 'playUnit', handIndex: 0 })
    expect(legalMoves(board(2, ['PLAIN'], 1))).not.toContainEqual({ type: 'playUnit', handIndex: 0 })
  })

  it('is offered for an event too', () => {
    expect(legalMoves(board(0, ['EVT'], 3))).toContainEqual({ type: 'playEvent', handIndex: 0 })
  })

  it("follows a card's own Exploit: the units are chosen first, then what is left is paid with tokens or resources", () => {
    let s = resolve(board(2, ['EX2'], 5, ['PLAIN']), { type: 'playUnit', handIndex: 0 })
    const c = choice(s)
    expect(c.kind).toBe('exploit')
    expect(c).toMatchObject({ discount: 2 }) // the keyword's own discount, not Credit's 1
    // The one unit there is to exploit finishes Exploit's step, and the 4 left to pay is asked about.
    s = resolve(s, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'f0' })
    const pays = s.pendingChoices?.find(p => p.kind === 'payWith')
    expect(pays).toMatchObject({ cost: 4, credits: 0 })
    expect(s.players.player.units.map(u => u.cardId)).toEqual(['PLAIN']) // nothing exploited yet
    s = resolve(s, { type: 'acceptChoice', choiceId: pays!.id, optionIndex: 0 })
    s = resolve(s, { type: 'acceptChoice', choiceId: pays!.id, optionIndex: 1 })
    s = resolve(s, { type: 'skipTrigger', choiceId: pays!.id })
    expect(s.players.player.units.map(u => u.cardId)).toEqual(['EX2'])
    expect(friendlyCreditTokens(s, 'player')).toBe(3)
    expect(readyLeft(s)).toBe(0)
  })

  it('is asked of a card with Exploit and nothing to exploit', () => {
    const s = resolve(board(6, ['EX2'], 5), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'payWith', cost: 6, credits: 0 })
  })

  it('offers Pay N once for every count the tokens held, the cost and the ready resources allow', () => {
    // Cost 4 with 2 ready: at least 2 tokens, at most the 3 held. No Done, since 4 > 2.
    const s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'payWith', cost: 4, credits: 0 })
    expect(creditCounts(s)).toEqual([2, 3])
    expect(canFinish(s)).toBe(false)
    expect(optionIndices(s)).toEqual([])
    // Ready resources that cover it all: Done, then every count up to the cost.
    const rich = resolve(board(5, ['EVT'], 5), { type: 'playEvent', handIndex: 0 })
    expect(canFinish(rich)).toBe(true)
    expect(creditCounts(rich)).toEqual([1, 2, 3])
  })

  it('Pay N defeats N tokens and pays the rest from resources, in one move', () => {
    let s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    s = payCredits(s, 2)
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.units.some(u => u.cardId === 'PLAIN')).toBe(true)
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
    expect(readyLeft(s)).toBe(0)
  })

  it('refuses a Pay N past the tokens held, past the cost, or leaving more than the ready resources', () => {
    const s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    // The step stands as it was and nothing is paid (the resolver still moves its random seed on).
    const unchanged = (from: GameState, to: GameState) => expect({ ...to, rngSeed: 0 }).toEqual({ ...from, rngSeed: 0 })
    unchanged(s, payCredits(s, 4)) // 3 held
    unchanged(s, payCredits(s, 1)) // leaves 3 for 2 ready
    const rich = resolve(board(5, ['EVT'], 5), { type: 'playEvent', handIndex: 0 })
    unchanged(rich, payCredits(rich, 4)) // the event costs 3
  })

  it('logs a Pay as one line naming the tokens it defeats', () => {
    const s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: choice(s).id, credits: 2 })).toBe('Defeat 2 Credit tokens to pay')
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: choice(s).id, credits: 1 })).toBe('Defeat a Credit token to pay')
  })

  it('still takes one token per answer from a game recorded before Pay N', () => {
    let s = resolve(board(2, ['PLAIN'], 3), { type: 'playUnit', handIndex: 0 })
    s = pickOption(s, 0)
    expect(friendlyCreditTokens(s, 'player')).toBe(3) // not spent until Done/finish
    expect(choice(s)).toMatchObject({ credits: 1 })
    // What is left to offer counts from the token already picked.
    expect(creditCounts(s)).toEqual([1, 2])
  })

  it('never takes more tokens than the cost', () => {
    let s = resolve(board(4, ['EVT'], 5), { type: 'playEvent', handIndex: 0 })
    for (let i = 0; i < 3; i++) s = pickOption(s, i)
    expect(s.pendingChoices ?? []).toHaveLength(0) // three cover the event's 3, and the step finishes
    expect(friendlyCreditTokens(s, 'player')).toBe(2)
    expect(readyLeft(s)).toBe(4)
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
