// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { db } from '../data/db'
import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import { opponentAi } from '../config'
import { answer } from '../hooks/opponentWorker'
import type { OpponentReply, OpponentRequest } from '../hooks/opponentWorker'

/**
 * The shipped opponent chooses in a Web Worker. jsdom has no `Worker`, so these stand one in that
 * answers with the worker's real handler only when the test says so, which is what lets a reply be
 * held back until the game has moved past it.
 */

vi.mock('../data/collectionSend', () => ({ sendForCollection: vi.fn().mockResolvedValue(undefined) }))

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Small Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '3', HP: '3' },
]

const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Small Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [{ id: 'TST_900', count: 30 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
/** No `ai`: the shipped opponent, which is the one that goes to the worker. */
const SHIPPED: UseGameOptions = { shuffle: identity, firstPlayer: 'opponent', rngSeed: 7 }

class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: ((event: { data: OpponentReply }) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  readonly inbox: OpponentRequest[] = []
  constructor(readonly url: URL | string, readonly options?: WorkerOptions) {
    FakeWorker.made.push(this)
  }
  postMessage(request: OpponentRequest): void {
    this.inbox.push(structuredClone(request))
  }
  /** Answer the oldest request still unanswered, as the real worker would. */
  deliver(): void {
    const request = this.inbox.shift()
    if (request) this.onmessage?.({ data: structuredClone(answer(request)) })
  }
  terminate(): void {
    this.terminated = true
  }
}

/** Answer every request until the worker has none, including the ones each answer prompts. */
function drain(worker: FakeWorker) {
  for (let i = 0; i < 500 && worker.inbox.length > 0; i++) act(() => worker.deliver())
}

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

describe('the opponent in a worker', () => {
  beforeEach(async () => {
    FakeWorker.made = []
    vi.stubGlobal('Worker', FakeWorker)
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks a module worker, and plays what it answers', async () => {
    const hook = renderHook(() => useGame(DECK, DECK, SHIPPED))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    expect(FakeWorker.made).toHaveLength(1)
    const worker = FakeWorker.made[0]
    expect(worker.options).toEqual({ type: 'module' })
    // Nothing is played until the worker answers.
    expect(worker.inbox).toHaveLength(1)
    expect(hook.result.current.replayData().moves).toEqual([])

    drain(worker)
    expect(hook.result.current.gameState!.activePlayer).toBe('player')

    // The same game the direct path plays.
    const direct = renderHook(() => useGame(DECK, DECK, { ...SHIPPED, ai: opponentAi }))
    await waitFor(() => expect(direct.result.current.status).toBe('playing'))
    expect(hook.result.current.replayData().moves.length).toBeGreaterThan(0)
    expect(hook.result.current.replayData().moves).toEqual(direct.result.current.replayData().moves)
    expect(hook.result.current.gameState).toEqual(direct.result.current.gameState)
  })

  it('refuses an undo while the worker is choosing', async () => {
    const hook = renderHook(() => useGame(DECK, DECK, { ...SHIPPED, firstPlayer: 'player' }))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    const worker = FakeWorker.made[0]
    expect(worker.inbox).toEqual([])

    act(() => hook.result.current.act(hook.result.current.legal.at(-1)!))
    expect(worker.inbox).toHaveLength(1)
    const before = hook.result.current.replayData().moves
    act(() => hook.result.current.undo())
    expect(hook.result.current.replayData().moves).toEqual(before)

    drain(worker)
    expect(hook.result.current.canUndo).toBe(true)
  })

  it('discards a reply that arrives after a rematch, and ends the old worker', async () => {
    const hook = renderHook(() => useGame(DECK, DECK, SHIPPED))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    const old = FakeWorker.made[0]
    expect(old.inbox).toHaveLength(1)

    act(() => hook.result.current.rematch())
    await waitFor(() => expect(FakeWorker.made).toHaveLength(2))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    expect(old.terminated).toBe(true)

    const fresh = hook.result.current.gameState
    act(() => old.deliver())
    expect(hook.result.current.gameState).toBe(fresh)
    expect(hook.result.current.replayData().moves).toEqual([])
  })

  it('ends the worker when the game is left', async () => {
    const hook = renderHook(() => useGame(DECK, DECK, SHIPPED))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    const worker = FakeWorker.made[0]
    hook.unmount()
    expect(worker.terminated).toBe(true)
  })

  it('chooses on the main thread when an AI is handed in', async () => {
    const hook = renderHook(() => useGame(DECK, DECK, { ...SHIPPED, ai: opponentAi }))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    expect(FakeWorker.made).toEqual([])
    expect(hook.result.current.gameState!.activePlayer).toBe('player')
  })
})
