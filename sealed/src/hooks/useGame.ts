import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedDeck } from '../data/deckStore'
import { getCard, cardId } from '../data/cards'
import type { SwuCard } from '../data/cards'
import { asCardId, canonicalDeck, canonicaliseCards } from '../data/printings'
import type { Unresolved } from '../data/printings'
import { cardRefFromId } from '../utils/parseProtectThePod'
import { buildCardDb } from '../engine/cardDb'
import { initGame, fisherYates } from '../engine/initGame'
import type { Action } from '../engine/actions'
import type { GameState, PendingChoice, PlayerId } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { nextSeed } from '../engine/rng'
import { opponentAi, OPPONENT_AI } from '../config'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { driverAction } from '../ai/concession'
import type { DescribePart } from '../utils/describeAction'
import { logEntries } from '../utils/boardDiff'
import { saveGameRecord } from '../data/gameRecords'
import { consentStamp } from '../data/collection'
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
  /**
   * A follow-up line: something the action above it changed on the board (`boardChanges`), not an
   * action of its own. It sits directly after the entry for that action, so it is rewound with it.
   */
  outcome?: true
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
  /**
   * Take back the player's own action whose choice is pending, as if it had never been made. Offered
   * regardless of the undo setting, because `cancelPoint` refuses it whenever anything hidden has been
   * seen, which is the reason undo is a setting at all. `undefined` when the pending choice cannot be
   * cancelled.
   */
  cancelChoice: (() => void) | undefined
  rematch: () => void
  /**
   * The game so far as replay data, for an in-app bug report (#373). A function rather than a
   * value: it reads refs, so nothing re-renders as the game goes on, and it is only ever called
   * when a report is actually being filed. Undone moves are already truncated out, so a report
   * taken after an undo still replays.
   */
  replayData: () => { initialState: GameState | null; moves: MoveRecord[] }
  /**
   * Cards whose printing could not be resolved to a Normal id, so they play vanilla. Surfaced in
   * the UI and in bug reports rather than failing silently, since the symptom (an ability simply
   * not happening) is otherwise indistinguishable from a broken implementation.
   */
  unresolvedPrintings: Unresolved[]
}

export interface UseGameOptions {
  shuffle?: <T>(arr: T[]) => T[]
  /** Only decides the opening initiative roll — the AI draws from the state's own seed. */
  rng?: () => number
  firstPlayer?: PlayerId
  rngSeed?: number
  /** Swap the opponent (tests inject a passive one; a smarter rung slots in here later). */
  ai?: (state: GameState) => Action | null
  /**
   * The least time, in milliseconds, between one opponent action being shown and the next. Absent or
   * zero, the opponent's whole reply lands synchronously with the action that prompted it. Unlike the
   * other options it is read at every step, so a change applies to the turn in progress.
   */
  opponentDelayMs?: number
}

const HUMAN: PlayerId = 'player'
const AI: PlayerId = 'opponent'
/** Hard stop for the AI drive loop — engine bugs must not hang the UI. */
const MAX_AI_STEPS = 500
/**
 * How long a paced opponent waits after a state is shown before choosing its next action. Choosing
 * blocks the main thread, sometimes for seconds, so it must not start until the browser has painted
 * the state the player is meant to be looking at.
 */
const PAINT_GAP_MS = 50

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

/**
 * Choices whose whole point is to show the player cards they could not otherwise see. Nothing in the
 * state changes when they are raised, so the look itself has to count as hidden information seen.
 */
const REVEALING_KINDS: ReadonlySet<PendingChoice['kind']> = new Set<PendingChoice['kind']>([
  'mayPlayTopFree', 'mayDiscardTop', 'search', 'searchDraw', 'searchPlayFree', 'searchPlayUpgrade', 'lookAtHand', 'lookAtDeckTops',
])

const revealing = (s: GameState) => (s.pendingChoices ?? []).some(c => REVEALING_KINDS.has(c.kind))

/**
 * True when nothing hidden from the player differs between `a` and `b`, `actions` actions apart. The
 * engine steps the random seed once per action whatever happens, so only a seed that moved further
 * than that means a random outcome was drawn.
 */
function sameHidden(a: GameState, b: GameState, actions: number): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((v, i) => v === y[i])
  let seed = a.rngSeed
  for (let i = 0; i < actions; i++) seed = nextSeed(seed)
  const pa = a.players, pb = b.players
  return seed === b.rngSeed
    && same(pa.player.deck, pb.player.deck)
    && same(pa.opponent.deck, pb.opponent.deck)
    && same(pa.opponent.hand, pb.opponent.hand)
    && same(pa.opponent.resources.map(r => r.cardId), pb.opponent.resources.map(r => r.cardId))
}

/**
 * Where cancelling the player's pending choice rewinds to, or `undefined` when it cannot be cancelled.
 *
 * Cancelling takes back the player's own action that raised the choice, and every answer given to it
 * since: the snapshot returned is the last one with no choice pending, so a follow-up choice cancels
 * the whole action rather than one step of it. It is refused when that would be more than taking
 * back the player's own move:
 *
 * - **The opponent has acted since.** The choice then came out of the opponent's turn, and rewinding
 *   would take the opponent's moves back too.
 * - **The choice is the opponent's card's.** Its source is theirs, so it is not the player's to cancel.
 * - **Something hidden has been seen.** A draw, a search, a look at a hand or a random outcome: going
 *   back would let the same decision be taken again knowing the cards.
 */
export function cancelPoint(history: readonly { by: PlayerId; state: GameState }[], current: GameState): number | undefined {
  const choice = current.pendingChoices?.find(c => c.controller === HUMAN)
  if (!choice || choice.source?.controller === AI) return undefined
  let root = history.length - 1
  for (; root >= 0; root--) {
    if (history[root].by !== HUMAN) return undefined
    if (!history[root].state.pendingChoices?.length) break
  }
  if (root < 0) return undefined
  if (revealing(current) || history.slice(root + 1).some(s => revealing(s.state))) return undefined
  return sameHidden(history[root].state, current, history.length - root) ? root : undefined
}

export function useGame(playerDeck: SavedDeck, opponentDeck: SavedDeck, options: UseGameOptions = {}): GameValue {
  const [status, setStatus] = useState<GameStatus>('loading')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [generation, setGeneration] = useState(0)
  const [unresolvedPrintings, setUnresolvedPrintings] = useState<Unresolved[]>([])

  const rng = options.rng ?? Math.random
  const shuffle = options.shuffle ?? fisherYates
  const ai = options.ai ?? opponentAi

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
  // Rewinds actually performed, for the saved record's provenance. A ref, not state: it is
  // read once at save time and must not re-render the board on every undo.
  const undoCountRef = useRef(0)
  // When the board was dealt, for the saved record. Set with the initial state, so a rematch
  // starts it again.
  const startedAtRef = useRef(0)

  // The opponent's pace, read by timers that outlive the render that set them.
  const delayRef = useRef(0)
  useEffect(() => {
    delayRef.current = options.opponentDelayMs ?? 0
  })
  // The timer for the paced opponent's next step. Non-null for as long as the opponent has actions
  // still to show, which is what refuses an undo in the middle of them.
  const pendingStepRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Stop a paced opponent where it stands: nothing it had not yet shown is ever applied. */
  const cancelOpponent = useCallback(() => {
    if (pendingStepRef.current !== null) clearTimeout(pendingStepRef.current)
    pendingStepRef.current = null
  }, [])

  /**
   * Apply one action to the live game, in the refs: the snapshot undo rewinds to, the move record,
   * the new state, and its log lines. The player's actions and the opponent's both come through here.
   */
  const apply = useCallback((by: PlayerId, action: Action) => {
    const prev = gameStateRef.current
    if (!prev) return
    historyRef.current.push({ by, state: prev, logLength: logRef.current.length, movesLength: movesRef.current.length })
    movesRef.current.push({ by, action })
    const next = resolve(prev, action)
    logRef.current = [...logRef.current, ...logEntries(prev, next, by, action)]
    gameStateRef.current = next
  }, [])

  /** Render what the refs hold. */
  const publish = useCallback(() => {
    setGameState(gameStateRef.current)
    setLog(logRef.current)
    setCanUndo(pendingStepRef.current === null && historyRef.current.some(s => s.by === HUMAN))
  }, [])

  /**
   * Publish the live state, with the opponent's reply to it: its actions for as long as it is the
   * active player.
   *
   * With no delay they are all applied first, so the reply lands in the same render as whatever
   * prompted it. With a delay the state is shown as it stands and the actions follow on timers, one
   * at a time, each applied by the same `apply` and shown no sooner than the delay after the state
   * before it. The delay is a floor on that gap, not a wait added to it: the time the AI spends
   * choosing counts towards it, so a choice slower than the delay is shown the moment it is made.
   */
  const driveAi = useCallback(() => {
    let steps = 0
    let shownAt = 0
    // The step the bench takes too: offer to concede a certain loss, else the setup heuristic, else
    // the AI. An offer hands the turn to the player, which is what ends the reply to ask them.
    function choose(): Action | null {
      const state = gameStateRef.current
      if (!state || state.winner !== null || state.activePlayer !== AI || steps >= MAX_AI_STEPS) return null
      return driverAction(state, ai)
    }
    function step(action: Action) {
      apply(AI, action)
      steps++
    }
    function show() {
      if (delayRef.current <= 0) {
        for (let action = choose(); action; action = choose()) step(action)
      } else if (gameStateRef.current?.winner === null && gameStateRef.current.activePlayer === AI) {
        pendingStepRef.current = setTimeout(think, Math.min(delayRef.current, PAINT_GAP_MS))
      }
      shownAt = Date.now()
      publish()
    }
    function think() {
      pendingStepRef.current = null
      const action = choose()
      // Nothing to play: publish anyway, since the reply being over is what allows an undo again.
      if (!action) return publish()
      const reveal = () => {
        pendingStepRef.current = null
        step(action)
        show()
      }
      // Never longer than the delay itself, whatever the clock has done since.
      const remaining = Math.min(delayRef.current, delayRef.current - (Date.now() - shownAt))
      if (remaining > 0) pendingStepRef.current = setTimeout(reveal, remaining)
      else reveal()
    }
    show()
  }, [ai, apply, publish])

  useEffect(() => {
    let cancelled = false

    async function load() {
      cancelOpponent()
      setStatus('loading')
      setErrorDetail(null)
      setGameState(null)
      gameStateRef.current = null
      setLog([])
      logRef.current = []
      movesRef.current = []
      historyRef.current = []
      setCanUndo(false)
      undoCountRef.current = 0
      recordSavedRef.current = false

      try {
        const ids = new Set<string>()
        for (const deck of [playerDeck, opponentDeck]) {
          ids.add(deck.leader)
          ids.add(deck.base)
          for (const c of deck.cards) ids.add(c.id)
        }

        // A card is filed under the number its source serves, which is not always the deck's spelling
        // of it (a deck's IBH_052 is served as IBH_52), so each deck id remembers the id it came back as.
        const cards: SwuCard[] = []
        const servedAs = new Map<string, string>()
        for (const id of ids) {
          const ref = cardRefFromId(id)
          if (!ref) throw new Error(`Malformed card id in deck: ${id}`)
          const card = await getCard(ref.set, ref.number)
          cards.push(card)
          servedAs.set(id, cardId(card.Set, card.Number))
        }

        if (cancelled) return

        // Collapse every printing of a card onto its Normal id before the engine sees it, so
        // abilities, corrections and the unique rule (all keyed by card id) apply to the
        // Hyperspace, foil, prestige and showcase printings a real pool contains (#382-#385).
        // The printing's own art rides along, so the card still looks like the one you own.
        const { map: canonical, unresolved } = await canonicaliseCards(cards)
        if (cancelled) return
        setUnresolvedPrintings(unresolved)

        const canonicalCards = cards.map(card => {
          const target = canonical.get(cardId(card.Set, card.Number))
          return target ? asCardId(card, target) : card
        })

        const toCanonical = (id: string) => canonical.get(servedAs.get(id) ?? id)
        const state = initGame(canonicalDeck(playerDeck, toCanonical), canonicalDeck(opponentDeck, toCanonical), buildCardDb(canonicalCards), {
          firstPlayer: options.firstPlayer ?? (rng() < 0.5 ? 'player' : 'opponent'),
          shuffle,
          rngSeed: options.rngSeed,
        })
        initialStateRef.current = state
        startedAtRef.current = Date.now()

        // If the AI won the initiative roll it moves first: before the human sees the board when it
        // is instant, and onto the opening board when it is paced.
        gameStateRef.current = state
        driveAi()
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
      // A rematch, a change of deck or leaving the game: the opponent's pending actions go with it.
      cancelOpponent()
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
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      initialState: initial,
      moves: movesRef.current,
      finalState: gameState,
      undoCount: undoCountRef.current,
      build: { release: RELEASE, commitId: COMMIT_ID },
      // An opponent handed in as a function has no registered name, so it is left unsaid.
      ...(options.ai ? {} : { opponentAi: OPPONENT_AI }),
      humanSeat: HUMAN,
      // Marked only if the player is opted in to sharing games at this moment.
      ...consentStamp(),
    })
  }, [gameState, playerDeck.name, opponentDeck.name, options.ai])

  const act = useCallback(
    (action: Action) => {
      // Read the live state from the ref, not a setState updater — this handler
      // must run its side effects (logging, AI drive, move recording) exactly
      // once even though StrictMode double-invokes updaters.
      // While a paced opponent is acting it is the active player in this state, so the same check
      // refuses the player's input until its last action has been shown.
      const prev = gameStateRef.current
      if (!prev || prev.winner !== null || prev.activePlayer !== HUMAN) return
      apply(HUMAN, action)
      driveAi()
    },
    [apply, driveAi],
  )

  /**
   * Rewind to the snapshot taken before the player's most recent action. Everything after it —
   * the AI's reply included — is dropped from the state, the log and the move list, so a saved
   * record never contains a move that was taken back.
   */
  const rewind = useCallback((index: number) => {
    cancelOpponent()
    undoCountRef.current++
    const snapshot = historyRef.current[index]
    historyRef.current = historyRef.current.slice(0, index)
    movesRef.current = movesRef.current.slice(0, snapshot.movesLength)
    logRef.current = logRef.current.slice(0, snapshot.logLength)
    gameStateRef.current = snapshot.state
    publish()
  }, [cancelOpponent, publish])

  // Not while a paced opponent is part-way through its reply: the rewind takes the whole reply, so
  // it waits until the whole reply has been seen.
  const undo = useCallback(() => {
    if (pendingStepRef.current !== null) return
    const index = historyRef.current.map(s => s.by).lastIndexOf(HUMAN)
    if (index >= 0) rewind(index)
  }, [rewind])

  // Read from the ref during render: the history only changes alongside `gameState`, which is what
  // re-renders, so the answer is current whenever it is read.
  const cancelAt = gameState && gameState.winner === null && gameState.activePlayer === HUMAN
    // eslint-disable-next-line react-hooks/refs
    ? cancelPoint(historyRef.current, gameState)
    : undefined
  const cancelChoice = cancelAt === undefined ? undefined : () => rewind(cancelAt)

  const rematch = useCallback(() => setGeneration(g => g + 1), [])

  const replayData = useCallback(() => ({ initialState: initialStateRef.current, moves: [...movesRef.current] }), [])

  const legal = gameState && status === 'playing' && gameState.activePlayer === HUMAN
    ? legalMoves(gameState)
    : []

  // Once the game is over the record has been written — rewinding past that would leave a saved
  // game disagreeing with what is on screen.
  return { status, errorDetail, gameState, legal, log, act, undo, canUndo: canUndo && gameState?.winner === null, cancelChoice, rematch, replayData, unresolvedPrintings }
}
