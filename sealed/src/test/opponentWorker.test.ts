import { describe, it, expect, vi } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { resolveAi } from '../ai/registry'
import { driverAction } from '../ai/concession'
import { opponentAi } from '../config'
import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import { answer } from '../hooks/opponentWorker'
import type { OpponentReply, OpponentRequest } from '../hooks/opponentWorker'
import { directChooser, workerChooser } from '../hooks/opponentChooser'
import type { WorkerLike } from '../hooks/opponentChooser'

/**
 * The opponent's move is chosen in a Web Worker, so the state crosses a structured clone on the way
 * in and the action on the way out. These pin that the crossing changes nothing, and that a reply the
 * game has moved past is never applied.
 */

const pool = ashSet as unknown as SwuCard[]
const cardDb = buildCardDb(pool)
const { decks } = buildCoverageDecks(pool, 1)

/** One game per coverage deck, played by the setup heuristic and greedy, every state along the way. */
function statesOf(deckIndex: number, steps: number): GameState[] {
  const deck = decks[deckIndex]
  const other = decks[(deckIndex + 1) % decks.length]
  let s = nextSeed(deckIndex + 1)
  let g = initGame(deck, other, cardDb, {
    firstPlayer: 'player',
    shuffle: <T,>(a: T[]): T[] => { s = nextSeed(s); return seededShuffle(a, s) },
    rngSeed: s,
  })
  const out: GameState[] = []
  const greedy = resolveAi('greedy')
  for (let i = 0; i < steps && g.winner === null; i++) {
    out.push(g)
    const action = setupAi(g) ?? greedy(g)
    if (!action) break
    g = resolve(g, action)
  }
  return out
}

/** A fake worker that answers with the real handler, cloning both ways as a real one does. */
class HandlerWorker implements WorkerLike {
  onmessage: ((event: { data: OpponentReply }) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  readonly inbox: OpponentRequest[] = []
  postMessage(request: OpponentRequest): void {
    this.inbox.push(structuredClone(request))
  }
  /** Answer the oldest request still unanswered. */
  deliver(): void {
    const request = this.inbox.shift()
    if (request) this.onmessage?.({ data: structuredClone(answer(request)) })
  }
  terminate(): void {
    this.terminated = true
  }
}

describe('the game state crossing to the worker', () => {
  it.each(decks.map((_, i) => i))('survives structuredClone with identical legal moves (coverage deck %i)', i => {
    const states = statesOf(i, 50)
    expect(states.length).toBeGreaterThan(10)
    // The card database is the same object all game: compared once, then left out of the deep
    // comparison of each state, which it would otherwise dominate.
    expect(structuredClone(states[0].cards)).toStrictEqual(states[0].cards)
    for (const state of states) {
      const copy = structuredClone(state)
      expect({ ...copy, cards: null }).toStrictEqual({ ...state, cards: null })
      expect(legalMoves(copy)).toStrictEqual(legalMoves(state))
    }
  })
})

describe('the worker handler', () => {
  it('registers every card ability itself rather than relying on the page', async () => {
    vi.resetModules()
    const abilities = await import('../engine/abilities')
    expect(abilities.registeredCardIds()).toEqual([])
    await import('../hooks/opponentWorker')
    expect(abilities.registeredCardIds().length).toBeGreaterThan(100)
  })

  it('chooses the same action as the direct path for a fixed seed', () => {
    // Positions past the setup phase, so the shipped search makes the choice rather than the heuristic.
    const positions = [0, 1, 2].map(i => statesOf(i, 40).filter(s => s.phase === 'action' && s.activePlayer === 'player').at(-1)!)
    for (const state of positions) {
      const direct = driverAction(state, opponentAi)
      const viaWorker = answer({ id: 7, state: structuredClone(state) })
      expect(viaWorker).toStrictEqual({ id: 7, action: direct })
    }
  })

  it('reports a failure as an error reply rather than throwing out of the worker', () => {
    const broken = { ...statesOf(0, 1)[0], players: undefined } as unknown as GameState
    const reply = answer({ id: 3, state: broken })
    expect(reply.id).toBe(3)
    expect('error' in reply && typeof reply.error).toBe('string')
  })
})

describe('the chooser', () => {
  const position = () => statesOf(0, 20).at(-1)!

  it('gives the worker path and the direct path the same action', () => {
    const state = position()
    const worker = new HandlerWorker()
    const viaWorker: (Action | null)[] = []
    workerChooser(worker).choose(state, a => viaWorker.push(a))
    expect(viaWorker).toEqual([])
    worker.deliver()

    const direct: (Action | null)[] = []
    directChooser(opponentAi).choose(state, a => direct.push(a))

    expect(viaWorker).toHaveLength(1)
    expect(viaWorker).toStrictEqual(direct)
  })

  it('discards a reply to a request that was cancelled', () => {
    const worker = new HandlerWorker()
    const chooser = workerChooser(worker)
    const first = vi.fn()
    const second = vi.fn()
    chooser.choose(position(), first)
    chooser.cancel()
    chooser.choose(position(), second)
    worker.deliver()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    worker.deliver()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('discards a reply that arrives after the chooser is closed, and terminates the worker', () => {
    const worker = new HandlerWorker()
    const chooser = workerChooser(worker)
    const reply = vi.fn()
    chooser.choose(position(), reply)
    chooser.close()
    worker.deliver()
    expect(reply).not.toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
  })

  it('answers on the main thread if the worker cannot start', () => {
    const worker = new HandlerWorker()
    const chooser = workerChooser(worker)
    const state = position()
    const reply = vi.fn()
    chooser.choose(state, reply)
    worker.onerror?.()
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith(driverAction(state, opponentAi))
    // And keeps doing so: the worker is not asked again.
    worker.inbox.length = 0
    chooser.choose(state, reply)
    expect(worker.inbox).toEqual([])
    expect(reply).toHaveBeenCalledTimes(2)
  })
})
