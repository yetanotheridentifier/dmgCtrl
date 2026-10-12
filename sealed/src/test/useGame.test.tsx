// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { db } from '../data/db'
import { useGame } from '../hooks/useGame'
import { listGameRecords } from '../data/gameRecords'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { buildGameExport } from '../data/recordExport'
import { withoutCards } from '../data/replayData'
import { OPPONENT_AI } from '../config'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { replay } from './helpers/replayReport'

// Seeded SWUDB-shaped cards. TST_900 is a 0-cost 30-power unit so a game can
// be won in two rounds, keeping tests fast and deterministic.
const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '30', HP: '30' },
]

const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Big Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [{ id: 'TST_900', count: 30 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
// A passive opponent, injected outright: the real AI draws from the state seed, so nudging an
// rng no longer steers it. legalMoves puts the do-nothing move (pass / skipResource) last, so
// taking the last move is passive in every phase — what the old `rng: () => 0.999999` meant.
const passiveAi = (s: GameState) => {
  const moves = legalMoves(s)
  return moves.length > 0 ? moves[moves.length - 1] : null
}

const OPTS = { shuffle: identity, ai: passiveAi, firstPlayer: 'player' as const }

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

describe('useGame', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates cards and opens in the setup phase (mulligan decision)', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    const game = result.current.gameState!
    expect(game.phase).toBe('setup')
    expect(game.players.player.hand).toHaveLength(6)
    expect(game.players.player.resources).toHaveLength(0)
    expect(game.activePlayer).toBe('player')
    expect(result.current.legal.map(a => a.type)).toEqual(['mulligan', 'keepHand'])
  })

  it('keeping the hand moves to the resource choice; picking a pair starts round 1', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))

    // The AI (heuristic) made its mulligan call; the human now picks resources.
    let game = result.current.gameState!
    expect(game.phase).toBe('setup')
    expect(game.setupStage).toBe('resource')
    expect(result.current.legal.every(a => a.type === 'setupResource')).toBe(true)

    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))

    game = result.current.gameState!
    expect(game.phase).toBe('action')
    expect(game.players.player.hand).toHaveLength(4)
    expect(game.players.player.resources).toHaveLength(2)
    expect(game.activePlayer).toBe('player')
  })

  it('does not duplicate log entries under StrictMode (updater must be pure)', async () => {
    // The app renders inside <StrictMode>, which double-invokes state updaters
    // in dev to surface impurity. Any side effect inside a setState updater
    // (logging, driving the AI) then runs twice → doubled log entries.
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS), { wrapper: StrictMode })
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))

    const keepEntries = result.current.log.filter(e => e.by === 'player' && /keep hand/i.test(e.text))
    expect(keepEntries).toHaveLength(1)

    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

    // Exactly one log entry per human action taken (keepHand, resource ×2, play).
    expect(result.current.log.filter(e => e.by === 'player')).toHaveLength(4)
    expect(result.current.log.filter(e => e.by === 'player' && /play/i.test(e.text))).toHaveLength(1)
  })

  it('reports an error with diagnostic detail when a deck card cannot be hydrated', async () => {
    // TST_404 is not seeded, so hydration goes to the network — which fails.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }))
    const badDeck = { ...DECK, cards: [{ id: 'TST_404', count: 30 }] }
    const { result } = renderHook(() => useGame(badDeck, badDeck, OPTS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorDetail).toMatch(/TST_404/)
  })

  // The reported load: the deck list names IBH_052, SWUDB serves the card as number 52, and the
  // engine knows it as IBH_52. The game starts, and the deck plays the card under the served id.
  it('starts a game from a deck that names a card with a zero-padded number the source serves unpadded', async () => {
    const watchThis: SwuCard = { Set: 'IBH', Number: '52', Name: 'Watch This', Type: 'Event', Cost: '6', Aspects: ['Cunning'], Traits: ['GAMBIT'], VariantType: 'Normal' }
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(
        String(url).endsWith('/cards/IBH/52')
          ? { ok: true, status: 200, json: () => Promise.resolve(watchThis) }
          : { ok: false, status: 404, json: () => Promise.resolve({ cards: [] }) },
      ),
    ))
    const deck = { ...DECK, cards: [{ id: 'IBH_052', count: 30 }] }
    const { result } = renderHook(() => useGame(deck, deck, OPTS))
    await waitFor(() => expect(result.current.status).not.toBe('loading'))

    expect(result.current.errorDetail).toBeNull()
    expect(result.current.status).toBe('playing')
    const game = result.current.gameState!
    expect(game.players.player.hand).toEqual(Array(6).fill('IBH_52'))
    expect(game.cards.IBH_52?.name).toBe('Watch This')
    expect(result.current.unresolvedPrintings).toEqual([])
  })

  it('acting as the human triggers the AI to take its turn', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

    const game = result.current.gameState!
    expect(game.players.player.units).toHaveLength(1)
    // AI (passive rng) passed and the turn came back to the human
    expect(game.activePlayer).toBe('player')
    expect(result.current.log.some(e => e.by === 'opponent' && /pass/i.test(e.text))).toBe(true)
  })

  it('drives the AI through the regroup choice too', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    act(() => result.current.act({ type: 'pass' })) // AI passes → regroup begins
    // human regroup choice
    act(() => result.current.act({ type: 'skipResource' }))

    const game = result.current.gameState!
    // AI auto-resolved its regroup choice; round 2 action phase, human first
    expect(game.phase).toBe('action')
    expect(game.round).toBe(2)
    expect(game.activePlayer).toBe('player')
  })

  it('plays to a win and saves the game record', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    act(() => result.current.act({ type: 'pass' }))
    act(() => result.current.act({ type: 'skipResource' }))

    const unitId = result.current.gameState!.players.player.units[0].instanceId
    act(() => result.current.act({ type: 'attack', attackerId: unitId, target: { kind: 'base' } }))

    expect(result.current.gameState!.winner).toBe('player')

    await waitFor(async () => {
      const records = await listGameRecords()
      expect(records).toHaveLength(1)
      expect(records[0].winner).toBe('player')
      expect(records[0].playerDeckName).toBe('Big Deck')
      expect(records[0].moves.length).toBeGreaterThan(0)
      expect(records[0].finalState.winner).toBe('player')
    })
  })

  /**
   * Undo (#366) exists to diagnose odd behaviour, so it rewinds the player's last action AND
   * the AI's reply to it — one `act` covers both. It is not an Action: exposing it on the hook
   * keeps it out of `legalMoves`, so the AI can never choose it and loop.
   */
  describe('undo', () => {
    async function atRoundOne() {
      const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      act(() => result.current.act({ type: 'keepHand' }))
      act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
      act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
      return result
    }

    it('is unavailable until the player has acted, and after a rematch', async () => {
      const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      expect(result.current.canUndo).toBe(false)

      act(() => result.current.act({ type: 'keepHand' }))
      expect(result.current.canUndo).toBe(true)

      act(() => result.current.rematch())
      await waitFor(() => expect(result.current.status).toBe('playing'))
      expect(result.current.canUndo).toBe(false)
    })

    it('restores the exact state from before the last action', async () => {
      const result = await atRoundOne()
      const before = result.current.gameState!
      const logBefore = result.current.log.length

      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      expect(result.current.gameState).not.toEqual(before)

      act(() => result.current.undo())
      expect(result.current.gameState).toEqual(before)
      expect(result.current.log).toHaveLength(logBefore)
    })

    /** What an action changed is logged under it, and is taken back with it. */
    it('logs what an attack changed under the attack, and rewinds those lines with it', async () => {
      const result = await atRoundOne()
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      // Round 2: the unit readied in the regroup, so it can attack.
      act(() => result.current.act({ type: 'pass' }))
      while (result.current.gameState!.phase !== 'action') act(() => result.current.act(result.current.legal[result.current.legal.length - 1]))
      const logBefore = result.current.log
      const attack = result.current.legal.find(a => a.type === 'attack' && a.target.kind === 'base')!

      act(() => result.current.act(attack))
      const added = result.current.log.slice(logBefore.length)
      expect(added[0]).toMatchObject({ by: 'player', text: 'Attack base with Big Test Unit' })
      expect(added[1]).toMatchObject({ by: 'player', outcome: true, text: "Opponent's base takes 30 damage" })

      act(() => result.current.undo())
      expect(result.current.log).toEqual(logBefore)
    })

    it('rolls back the AI’s reply along with the player’s action', async () => {
      const result = await atRoundOne()
      // The AI has already acted during setup, so count its replies rather than their presence.
      const aiEntriesBefore = result.current.log.filter(e => e.by === 'opponent').length

      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      // The AI answered inside the same act — that reply must be rolled back too.
      expect(result.current.log.filter(e => e.by === 'opponent').length).toBeGreaterThan(aiEntriesBefore)

      act(() => result.current.undo())
      expect(result.current.log.filter(e => e.by === 'opponent')).toHaveLength(aiEntriesBefore)
      expect(result.current.gameState!.players.player.units).toHaveLength(0)
    })

    it('replays identically after an undo — the AI does not re-roll', async () => {
      const result = await atRoundOne()
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      const firstTry = result.current.gameState!
      const firstLog = result.current.log.map(e => e.text)

      act(() => result.current.undo())
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

      expect(result.current.gameState).toEqual(firstTry)
      expect(result.current.log.map(e => e.text)).toEqual(firstLog)
    })

    it('rewinds repeatedly, back to the first decision of the game', async () => {
      const result = await atRoundOne()
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

      let guard = 0
      while (result.current.canUndo && guard++ < 20) act(() => result.current.undo())

      expect(guard).toBeLessThan(20) // terminated on its own
      expect(result.current.canUndo).toBe(false)
      // Back at the opening mulligan decision.
      expect(result.current.gameState!.setupStage).toBe('mulligan')
      expect(result.current.log).toHaveLength(0)
    })

    it('keeps undone moves out of the saved game record', async () => {
      const result = await atRoundOne()
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      act(() => result.current.undo())
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      act(() => result.current.act({ type: 'pass' }))
      act(() => result.current.act({ type: 'skipResource' }))
      const unitId = result.current.gameState!.players.player.units[0].instanceId
      act(() => result.current.act({ type: 'attack', attackerId: unitId, target: { kind: 'base' } }))
      expect(result.current.gameState!.winner).toBe('player')

      await waitFor(async () => {
        const records = await listGameRecords()
        expect(records).toHaveLength(1)
        // The record must replay: an undone move left in the list would derail it.
        expect(records[0].moves.reduce((s, m) => resolve(s, m.action), records[0].initialState)).toEqual(records[0].finalState)
      })
    })

    it('is not a legal move, so the AI can never pick it', async () => {
      const result = await atRoundOne()
      expect(result.current.legal.some(a => (a as { type: string }).type === 'undo')).toBe(false)
      expect(legalMoves(result.current.gameState!).some(a => (a as { type: string }).type === 'undo')).toBe(false)
    })

    /**
     * #533: undone moves are truncated out, so a game played with undo replays perfectly and is
     * otherwise indistinguishable from one played straight through. The E7 training pipeline is
     * the consumer of these records, and a retried line is not a played line, so the record has
     * to say so. It cannot be backfilled later, hence counting it from the start.
     */
    describe('undo provenance on the saved record', () => {
      async function playToAWin(result: Awaited<ReturnType<typeof atRoundOne>>, undos: number) {
        act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
        for (let i = 0; i < undos; i++) {
          act(() => result.current.undo())
          act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
        }
        act(() => result.current.act({ type: 'pass' }))
        act(() => result.current.act({ type: 'skipResource' }))
        const unitId = result.current.gameState!.players.player.units[0].instanceId
        act(() => result.current.act({ type: 'attack', attackerId: unitId, target: { kind: 'base' } }))
        expect(result.current.gameState!.winner).toBe('player')
      }

      it('records zero when the game was played straight through', async () => {
        const result = await atRoundOne()
        await playToAWin(result, 0)

        await waitFor(async () => {
          const records = await listGameRecords()
          expect(records).toHaveLength(1)
          expect(records[0].undoCount).toBe(0)
        })
      })

      it('counts every undo, not just whether one was used', async () => {
        const result = await atRoundOne()
        await playToAWin(result, 3)

        await waitFor(async () => {
          const records = await listGameRecords()
          expect(records).toHaveLength(1)
          expect(records[0].undoCount).toBe(3)
        })
      })

      /** An undo with nothing to take back is not an undo: it must not inflate the count. */
      it('does not count an undo that rewound nothing', async () => {
        const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
        await waitFor(() => expect(result.current.status).toBe('playing'))
        act(() => result.current.undo())

        act(() => result.current.act({ type: 'keepHand' }))
        act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
        act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
        await playToAWin(result, 0)

        await waitFor(async () => {
          const records = await listGameRecords()
          expect(records[0].undoCount).toBe(0)
        })
      })
    })
  })

  /**
   * What a saved record says about where it came from. All of it is written when the game is saved,
   * because none of it can be recovered from the moves afterwards.
   */
  describe('provenance on the saved record', () => {
    async function winFromTheStart(result: { current: ReturnType<typeof useGame> }) {
      act(() => result.current.act({ type: 'keepHand' }))
      act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
      act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
      act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
      act(() => result.current.act({ type: 'pass' }))
      act(() => result.current.act({ type: 'skipResource' }))
      const unitId = result.current.gameState!.players.player.units[0].instanceId
      act(() => result.current.act({ type: 'attack', attackerId: unitId, target: { kind: 'base' } }))
      expect(result.current.gameState!.winner).toBe('player')
    }

    /** The start is when the board was dealt, not when the record was written. */
    it('records when the game started and when it ended as two different moments', async () => {
      let now = 1_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
        await waitFor(() => expect(result.current.status).toBe('playing'))
        now = 61_000
        await winFromTheStart(result)

        await waitFor(async () => {
          const records = await listGameRecords()
          expect(records).toHaveLength(1)
          expect(records[0].startedAt).toBe(1_000)
          expect(records[0].endedAt).toBe(61_000)
        })
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('starts the clock again on a rematch', async () => {
      let now = 1_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
        await waitFor(() => expect(result.current.status).toBe('playing'))
        const first = result.current.gameState
        now = 30_000
        act(() => result.current.rematch())
        await waitFor(() => {
          expect(result.current.status).toBe('playing')
          expect(result.current.gameState).not.toBe(first)
        })
        now = 61_000
        await winFromTheStart(result)

        await waitFor(async () => {
          const records = await listGameRecords()
          expect(records).toHaveLength(1)
          expect(records[0].startedAt).toBe(30_000)
        })
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('records the build that played the game and the seat the person held', async () => {
      const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      await winFromTheStart(result)

      await waitFor(async () => {
        const records = await listGameRecords()
        expect(records).toHaveLength(1)
        expect(records[0].build).toEqual({ release: RELEASE, commitId: COMMIT_ID })
        expect(records[0].humanSeat).toBe('player')
      })
    })

    /** An opponent handed in as a function has no registered name, and unknown is left unsaid. */
    it('leaves the opponent AI unnamed when one was injected', async () => {
      const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      await winFromTheStart(result)

      await waitFor(async () => {
        const records = await listGameRecords()
        expect(records).toHaveLength(1)
        expect('opponentAi' in records[0]).toBe(false)
      })
    })

    it('names the deployed opponent AI when the game was played against it', async () => {
      const { result } = renderHook(() => useGame(DECK, DECK, { shuffle: identity, firstPlayer: 'player' }))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      // Whoever wins: the first legal move is never the do-nothing one, so the game ends quickly.
      for (let i = 0; i < 200 && result.current.gameState!.winner === null; i++) {
        act(() => result.current.act(result.current.legal[0]))
      }
      expect(result.current.gameState!.winner).not.toBeNull()

      await waitFor(async () => {
        const records = await listGameRecords()
        expect(records).toHaveLength(1)
        expect(records[0].opponentAi).toBe(OPPONENT_AI)
      })
    })

    /**
     * The whole route a game takes off the device: played through the hook, saved, exported, written
     * as JSON, and read back by the replay harness as it stands. The deck here is not ASH, so its
     * cards are passed to the harness the way any report from another set's pool needs.
     */
    it('exports a played game that replays to the final state it was saved with', async () => {
      const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
      await waitFor(() => expect(result.current.status).toBe('playing'))
      await winFromTheStart(result)
      await waitFor(async () => expect(await listGameRecords()).toHaveLength(1))
      const [record] = await listGameRecords()

      const file = JSON.parse(JSON.stringify(buildGameExport([record]))) as ReturnType<typeof buildGameExport>
      const end = replay(file.records[0], SWU_CARDS)

      expect(end.winner).toBe(record.winner)
      expect(withoutCards(end)).toEqual(withoutCards(record.finalState))
    })
  })

  /** #373: a bug report carries the game so far, which must replay to what is on screen. */
  it('exposes replay data that re-resolves to the live state', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

    const { initialState, moves } = result.current.replayData()
    expect(initialState).not.toBeNull()
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.reduce((s, m) => resolve(s, m.action), initialState!)).toEqual(result.current.gameState)
  })

  it('leaves undone moves out of the replay data', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    const before = result.current.replayData().moves.length

    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    act(() => result.current.undo())

    const { initialState, moves } = result.current.replayData()
    expect(moves).toHaveLength(before)
    expect(moves.reduce((s, m) => resolve(s, m.action), initialState!)).toEqual(result.current.gameState)
  })

  it('rematch resets to a fresh game', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    act(() => result.current.rematch())

    await waitFor(() => {
      expect(result.current.gameState!.players.player.units).toHaveLength(0)
      expect(result.current.gameState!.round).toBe(1)
      expect(result.current.log).toEqual([])
    })
  })
})
