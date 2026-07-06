import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedDeck } from '../data/deckStore'
import { getCard } from '../data/cards'
import type { SwuCard } from '../data/cards'
import { cardRefFromId } from '../utils/parseProtectThePod'
import { buildCardDb } from '../engine/cardDb'
import { initGame, fisherYates } from '../engine/initGame'
import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { randomAi } from '../ai/randomAi'
import { describeAction } from '../utils/describeAction'
import { saveGameRecord } from '../data/gameRecords'
import { logger } from '../data/log'

export type GameStatus = 'loading' | 'error' | 'playing'

export interface LogEntry {
  by: PlayerId
  text: string
}

export interface GameValue {
  status: GameStatus
  /** Populated when status is 'error' — names the card/cause for diagnosis. */
  errorDetail: string | null
  gameState: GameState | null
  /** Legal moves for the human — empty while the AI acts or when over. */
  legal: Action[]
  log: LogEntry[]
  act: (action: Action) => void
  rematch: () => void
}

export interface UseGameOptions {
  shuffle?: <T>(arr: T[]) => T[]
  rng?: () => number
  firstPlayer?: PlayerId
}

const HUMAN: PlayerId = 'player'
const AI: PlayerId = 'opponent'
/** Hard stop for the AI drive loop — engine bugs must not hang the UI. */
const MAX_AI_STEPS = 500

interface MoveRecord {
  by: PlayerId
  action: Action
}

export function useGame(playerDeck: SavedDeck, opponentDeck: SavedDeck, options: UseGameOptions = {}): GameValue {
  const [status, setStatus] = useState<GameStatus>('loading')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [generation, setGeneration] = useState(0)

  const rng = options.rng ?? Math.random
  const shuffle = options.shuffle ?? fisherYates

  const initialStateRef = useRef<GameState | null>(null)
  const movesRef = useRef<MoveRecord[]>([])
  const recordSavedRef = useRef(false)

  /** Advance the AI while it is the active player; returns the resulting state. */
  const driveAi = useCallback(
    (state: GameState, entries: LogEntry[]): GameState => {
      let current = state
      let steps = 0
      while (current.winner === null && current.activePlayer === AI && steps < MAX_AI_STEPS) {
        const action = randomAi(current, rng)
        if (!action) break
        entries.push({ by: AI, text: describeAction(current, AI, action) })
        movesRef.current.push({ by: AI, action })
        current = resolve(current, action)
        steps++
      }
      return current
    },
    [rng],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      setErrorDetail(null)
      setGameState(null)
      setLog([])
      movesRef.current = []
      recordSavedRef.current = false

      try {
        const ids = new Set<string>()
        for (const deck of [playerDeck, opponentDeck]) {
          ids.add(deck.leader)
          ids.add(deck.base)
          for (const c of deck.cards) ids.add(c.id)
        }

        const cards: SwuCard[] = []
        for (const id of ids) {
          const ref = cardRefFromId(id)
          if (!ref) throw new Error(`Malformed card id in deck: ${id}`)
          cards.push(await getCard(ref.set, ref.number))
        }

        if (cancelled) return

        let state = initGame(playerDeck, opponentDeck, buildCardDb(cards), {
          firstPlayer: options.firstPlayer ?? (rng() < 0.5 ? 'player' : 'opponent'),
          shuffle,
        })
        initialStateRef.current = state

        // If the AI won the initiative roll it moves before the human sees the board.
        const entries: LogEntry[] = []
        state = driveAi(state, entries)

        setGameState(state)
        setLog(entries)
        setStatus('playing')
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        logger.error('game load failed', { detail })
        if (!cancelled) {
          setErrorDetail(detail)
          setStatus('error')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // Re-run on rematch (generation) or deck change; options are init-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerDeck, opponentDeck, generation])

  // Persist the record once, when a winner appears (T4.5).
  useEffect(() => {
    if (!gameState || gameState.winner === null || recordSavedRef.current) return
    recordSavedRef.current = true
    const initial = initialStateRef.current
    if (!initial) return
    void saveGameRecord({
      playerDeckName: playerDeck.name,
      opponentDeckName: opponentDeck.name,
      winner: gameState.winner,
      startedAt: Date.now(),
      endedAt: Date.now(),
      initialState: initial,
      moves: movesRef.current,
      finalState: gameState,
    })
  }, [gameState, playerDeck.name, opponentDeck.name])

  const act = useCallback(
    (action: Action) => {
      setGameState(prev => {
        if (!prev || prev.winner !== null || prev.activePlayer !== HUMAN) return prev
        const entries: LogEntry[] = [{ by: HUMAN, text: describeAction(prev, HUMAN, action) }]
        movesRef.current.push({ by: HUMAN, action })
        let next = resolve(prev, action)
        next = driveAi(next, entries)
        setLog(existing => [...existing, ...entries])
        return next
      })
    },
    [driveAi],
  )

  const rematch = useCallback(() => setGeneration(g => g + 1), [])

  const legal = gameState && status === 'playing' && gameState.activePlayer === HUMAN
    ? legalMoves(gameState)
    : []

  return { status, errorDetail, gameState, legal, log, act, rematch }
}
