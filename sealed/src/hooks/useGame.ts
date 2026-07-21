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
import { setupAi } from '../ai/setupAi'
import { describeActionParts, partsText } from '../utils/describeAction'
import type { DescribePart } from '../utils/describeAction'
import { saveGameRecord } from '../data/gameRecords'
import { logger } from '../data/log'

export type GameStatus = 'loading' | 'error' | 'playing'

export interface LogEntry {
  by: PlayerId
  text: string
  /**
   * The same description in pieces, so the log can render the cards it names as hover-to-zoom
   * references. `text` stays the plain-text join — tests and any text-only consumer are
   * unaffected by the richer form.
   */
  parts: DescribePart[]
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
  /**
   * Rewind to just before the player's last action, taking the AI's reply with it. Deliberately
   * a hook method rather than an `Action`: it can't reach `legalMoves`, so the AI can never pick
   * it and loop. Unavailable before the player's first action and once the game is over.
   */
  undo: () => void
  canUndo: boolean
  rematch: () => void
  /**
   * The game so far as replay data, for an in-app bug report (#373). A function rather than a
   * value: it reads refs, so nothing re-renders as the game goes on, and it is only ever called
   * when a report is actually being filed. Undone moves are already truncated out, so a report
   * taken after an undo still replays.
   */
  replayData: () => { initialState: GameState | null; moves: MoveRecord[] }
}

export interface UseGameOptions {
  shuffle?: <T>(arr: T[]) => T[]
  /** Only decides the opening initiative roll — the AI draws from the state's own seed. */
  rng?: () => number
  firstPlayer?: PlayerId
  rngSeed?: number
  /** Swap the opponent (tests inject a passive one; a smarter rung slots in here later). */
  ai?: (state: GameState) => Action | null
}

const HUMAN: PlayerId = 'player'
const AI: PlayerId = 'opponent'
/** Hard stop for the AI drive loop — engine bugs must not hang the UI. */
const MAX_AI_STEPS = 500

interface MoveRecord {
  by: PlayerId
  action: Action
}

/**
 * The state as it stood immediately BEFORE one action, with the lengths of the log and move
 * list at that moment so both truncate back cleanly. Taken per individual action — including
 * each of the AI's — so the history is fine-grained enough to step through later, even though
 * `undo` currently rewinds a whole player turn at a time.
 */
interface Snapshot {
  by: PlayerId
  state: GameState
  logLength: number
  movesLength: number
}

export function useGame(playerDeck: SavedDeck, opponentDeck: SavedDeck, options: UseGameOptions = {}): GameValue {
  const [status, setStatus] = useState<GameStatus>('loading')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [generation, setGeneration] = useState(0)

  const rng = options.rng ?? Math.random
  const shuffle = options.shuffle ?? fisherYates
  const ai = options.ai ?? randomAi

  const initialStateRef = useRef<GameState | null>(null)
  const movesRef = useRef<MoveRecord[]>([])
  const recordSavedRef = useRef(false)
  // Mirror of the live game state, read synchronously by `act`. The app runs in
  // <StrictMode>, which double-invokes setState updaters; keeping the mutating
  // logic out of the updater (and reading `prev` from this ref instead) makes
  // each action apply — and log — exactly once. See useGame StrictMode test.
  const gameStateRef = useRef<GameState | null>(null)
  // Undo history, and a rendered mirror of "is there anything to undo" (refs don't re-render).
  const historyRef = useRef<Snapshot[]>([])
  const logRef = useRef<LogEntry[]>([])
  const [canUndo, setCanUndo] = useState(false)

  /** Advance the AI while it is the active player; returns the resulting state. */
  const driveAi = useCallback(
    (state: GameState, entries: LogEntry[]): GameState => {
      let current = state
      let steps = 0
      while (current.winner === null && current.activePlayer === AI && steps < MAX_AI_STEPS) {
        // Setup decisions (mulligan/resourcing) use the dedicated heuristic —
        // random choices there are game-ruiningly bad. See ai/setupAi.ts.
        const action = setupAi(current) ?? ai(current)
        if (!action) break
        historyRef.current.push({
          by: AI,
          state: current,
          logLength: logRef.current.length + entries.length,
          movesLength: movesRef.current.length,
        })
        const aiParts = describeActionParts(current, AI, action, { redact: true })
        entries.push({ by: AI, text: partsText(aiParts), parts: aiParts })
        movesRef.current.push({ by: AI, action })
        current = resolve(current, action)
        steps++
      }
      return current
    },
    [ai],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      setErrorDetail(null)
      setGameState(null)
      gameStateRef.current = null
      setLog([])
      logRef.current = []
      movesRef.current = []
      historyRef.current = []
      setCanUndo(false)
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
          rngSeed: options.rngSeed,
        })
        initialStateRef.current = state

        // If the AI won the initiative roll it moves before the human sees the board.
        const entries: LogEntry[] = []
        state = driveAi(state, entries)

        gameStateRef.current = state
        setGameState(state)
        logRef.current = entries
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

  // Persist the record once, when a winner appears.
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
      // Read the live state from the ref, not a setState updater — this handler
      // must run its side effects (logging, AI drive, move recording) exactly
      // once even though StrictMode double-invokes updaters.
      const prev = gameStateRef.current
      if (!prev || prev.winner !== null || prev.activePlayer !== HUMAN) return
      historyRef.current.push({
        by: HUMAN,
        state: prev,
        logLength: logRef.current.length,
        movesLength: movesRef.current.length,
      })
      const humanParts = describeActionParts(prev, HUMAN, action)
      const entries: LogEntry[] = [{ by: HUMAN, text: partsText(humanParts), parts: humanParts }]
      movesRef.current.push({ by: HUMAN, action })
      let next = resolve(prev, action)
      next = driveAi(next, entries)
      gameStateRef.current = next
      setGameState(next)
      logRef.current = [...logRef.current, ...entries]
      setLog(logRef.current)
      setCanUndo(true)
    },
    [driveAi],
  )

  /**
   * Rewind to the snapshot taken before the player's most recent action. Everything after it —
   * the AI's reply included — is dropped from the state, the log and the move list, so a saved
   * record never contains a move that was taken back.
   */
  const undo = useCallback(() => {
    const index = historyRef.current.map(s => s.by).lastIndexOf(HUMAN)
    if (index < 0) return
    const snapshot = historyRef.current[index]
    historyRef.current = historyRef.current.slice(0, index)
    movesRef.current = movesRef.current.slice(0, snapshot.movesLength)
    logRef.current = logRef.current.slice(0, snapshot.logLength)
    gameStateRef.current = snapshot.state
    setGameState(snapshot.state)
    setLog(logRef.current)
    setCanUndo(historyRef.current.some(s => s.by === HUMAN))
  }, [])

  const rematch = useCallback(() => setGeneration(g => g + 1), [])

  const replayData = useCallback(() => ({ initialState: initialStateRef.current, moves: [...movesRef.current] }), [])

  const legal = gameState && status === 'playing' && gameState.activePlayer === HUMAN
    ? legalMoves(gameState)
    : []

  // Once the game is over the record has been written — rewinding past that would leave a saved
  // game disagreeing with what is on screen.
  return { status, errorDetail, gameState, legal, log, act, undo, canUndo: canUndo && gameState?.winner === null, rematch, replayData }
}
