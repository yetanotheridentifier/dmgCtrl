import { useState, useEffect, useRef } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import type { GameState } from '../hooks/useSwuGame'
import { useGameHistory } from '../hooks/useGameHistory'
import { useBaseArt } from '../hooks/useBaseArt'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import { useMatch } from '../hooks/useMatch'
import type { MatchResult } from '../hooks/useMatch'
import { useTimer } from '../hooks/useTimer'
import type { Initiative } from '../hooks/useInitiative'
import SwuGameScreenView from './swuGameScreenView'
import type { SwuGameViewProps } from './swuGameScreenView'
import SwuGame2pView from './swuGame2pView'
import type { SwuSide } from './swuGame2pView'
import { baseControls } from './swuGameStyles'
import type { LastGame } from './swuGamePieces'
import { LandscapeScreen } from './layout/fixedOrientation'
import { onGameStart, onGameEnd, onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed, onEpicActionUsed, onForceGained, onForceUsed, onMatchCompleted } from '../services/analytics'
import type { PlayMode } from '../utils/playMode'
import type { Format } from '../utils/formatFilter'

// Who has the initiative, and whether it has been taken this round: once it has (its holder taking it
// again counts), the other side cannot take it until Round. Who has it before the game starts only
// says who starts with it.
interface InitiativeState {
  holder: Initiative
  taken: boolean
}
const NO_INITIATIVE: InitiativeState = { holder: null, taken: false }

interface SwuGameSnapshot {
  gameState: GameState
  // Two players: their base's state. The round lives in yours.
  theirGameState: GameState
  matchState: { playerScore: number; opponentScore: number; matchDrawn: boolean; matchClosedByTimer: boolean }
  lastGame: LastGame | null
  initiative: InitiativeState
}

interface Props {
  base: Base
  // Two players: their base, and the two-player screen with a half each.
  theirBase?: Base
  playMode?: PlayMode
  // A tournament's format; a casual game has none.
  format?: Format
  isInTournament?: boolean
  onBack: (gamesCompleted: number) => void
  onHelp: () => void
  onSettings?: () => void
  onMatchComplete?: (result: MatchResult, playerScore: number, opponentScore: number) => void
  // Limited best of 3: the bases the next game may be played on, and where the choice goes.
  changeBaseOptions?: Base[]
  onChangeBase?: (b: Base) => void
}

const RESULT_WORD: Record<MatchResult, string> = { won: 'won', lost: 'lost', drawn: 'drawn' }


function SwuGameScreen({ base, theirBase, playMode = 'casual', format, isInTournament = false, onBack, onHelp, onSettings, onMatchComplete, changeBaseOptions, onChangeBase }: Props) {
  const { forceTokenDisplay, useHyperspace, enableInitiativeBar, enableDamageButtons, bo1TimerMinutes, bo3TimerMinutes, setBo1TimerMinutes, setBo3TimerMinutes } = useUserSettings()
  const match = useMatch(playMode)
  const art = useBaseArt(base, useHyperspace)
  const game = useSwuGame(base.hp)
  // Their base, in two players; idle in one.
  const theirs = theirBase ?? base
  const theirArt = useBaseArt(theirs, useHyperspace)
  const theirGame = useSwuGame(theirs.hp)
  const twoPlayers = theirBase !== undefined
  const log = useGameHistory<SwuGameSnapshot>()
  // The game screen always keeps the phone awake.
  useWakeLock(true)

  const isCasual = playMode === 'casual'
  const timerMinutes = playMode === 'bo3' ? bo3TimerMinutes : bo1TimerMinutes
  const setTimerMinutes = playMode === 'bo3' ? setBo3TimerMinutes : setBo1TimerMinutes
  const timer = useTimer(timerMinutes * 60)

  const [initiative, setInitiative] = useState<InitiativeState>(NO_INITIATIVE)
  const [showLog, setShowLog] = useState(false)
  const [endGameOpen, setEndGameOpen] = useState(false)
  const [endGameChoice, setEndGameChoice] = useState<MatchResult | null>(null)
  const [gameOverOpen, setGameOverOpen] = useState(false)
  const [lastGame, setLastGame] = useState<LastGame | null>(null)
  const gameStartTime = useRef<number>(0)
  const endGameOpenRef = useRef(endGameOpen)
  useEffect(() => { endGameOpenRef.current = endGameOpen }, [endGameOpen])

  useEffect(() => {
    if (match.matchOver && !isCasual && match.matchResult) {
      void onMatchCompleted(playMode, match.matchResult, match.playerScore, match.opponentScore)
      onMatchComplete?.(match.matchResult, match.playerScore, match.opponentScore)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.matchOver])

  // Your base reaching 0 opens End game with Lost chosen; theirs, with Won.
  const yoursDestroyed = game.round > 0 && game.count >= base.hp
  const theirsDestroyed = twoPlayers && game.round > 0 && theirGame.count >= theirs.hp
  useEffect(() => {
    if ((yoursDestroyed || theirsDestroyed) && !match.matchOver && !endGameOpenRef.current) {
      setEndGameChoice(yoursDestroyed ? 'lost' : 'won')
      setEndGameOpen(true)
    }
  }, [yoursDestroyed, theirsDestroyed, match.matchOver])

  const makeSnapshot = (): SwuGameSnapshot => ({
    gameState: game.snapshot(),
    theirGameState: theirGame.snapshot(),
    matchState: {
      playerScore: match.playerScore,
      opponentScore: match.opponentScore,
      matchDrawn: false,
      matchClosedByTimer: false,
    },
    lastGame,
    initiative,
  })

  const baseKey = `${base.set}-${base.number}`
  const baseSet = base.set

  const gamesPlayed = match.playerScore + match.opponentScore
  const gameStarted = game.round > 0
  const isPreFirstGame = !gameStarted && gamesPlayed === 0 && lastGame === null

  // What acts on one base: yours, or theirs in two players. Log entries name the base in two players.
  const sideOf = (b: Base, g: ReturnType<typeof useSwuGame>, sideArt: ReturnType<typeof useBaseArt>, who: string): SwuSide => {
    const key = `${b.set}-${b.number}`
    const say = (message: string) => (twoPlayers ? `${who}: ${message.charAt(0).toLowerCase()}${message.slice(1)}` : message)
    const add = (type: string, message: string, color: string, snapshot: SwuGameSnapshot) =>
      log.add({ type, message: say(message), color, snapshot })

    const onForceToggle = () => {
      const snap = makeSnapshot()
      const gaining = !g.forceActive
      g.toggleForce()
      if (gaining) {
        add('force-gain', 'Force gained', 'var(--color-force)', snap)
        void onForceGained(key, b.set)
      } else {
        add('force-use', 'Force used', '#93c5fd', snap)
        void onForceUsed(key, b.set)
      }
    }

    return {
      base: b,
      art: { src: sideArt.src, rotationDeg: sideArt.rotationDeg, loaded: sideArt.imageLoaded, failed: sideArt.allFailed, onLoad: sideArt.onLoad, onError: sideArt.onError },
      count: g.count,
      onIncrement: (n: number) => {
        const amount = Math.min(n, b.hp - g.count)
        if (!gameStarted || amount <= 0) return
        const snap = makeSnapshot()
        g.incrementBy(amount)
        log.add({ type: 'hit', message: twoPlayers ? `${who}: ${amount} damage` : `Hit +${amount}`, color: 'var(--color-error)', snapshot: snap })
        void onDamageDealt(key, b.set, amount)
      },
      onDecrement: (n: number) => {
        const amount = Math.min(n, g.count)
        if (!gameStarted || amount <= 0) return
        const snap = makeSnapshot()
        g.decrementBy(amount)
        log.add({ type: 'heal', message: twoPlayers ? `${who}: ${amount} damage removed` : `Heal −${amount}`, color: 'var(--color-success)', snapshot: snap })
        void onDamageHealed(key, b.set, amount)
      },
      ...baseControls(b, forceTokenDisplay),
      epicActionUsed: g.epicActionUsed,
      onEpicActionMark: () => {
        const snap = makeSnapshot()
        g.markEpicActionUsed()
        add('epic', 'Epic action used', 'var(--color-epic)', snap)
        void onEpicActionUsed(key, b.set)
      },
      forceActive: g.forceActive,
      mysticUsesRemaining: g.mysticUsesRemaining,
      onForceToggle,
      onMysticAction: () => {
        if (g.forceActive) {
          onForceToggle()
          return
        }
        const snap = makeSnapshot()
        g.gainForceViaMonastery()
        add('monastery', 'Force gained (Monastery)', 'var(--color-force)', snap)
        void onForceGained(key, b.set)
      },
    }
  }

  const you = sideOf(base, game, art, 'Your base')
  const them = sideOf(theirs, theirGame, theirArt, 'Their base')

  // Before the game, choosing who starts with it; during one, once a round, and a log entry.
  const takeInitiative = (side: 'player' | 'opponent') => {
    if (!gameStarted) {
      setInitiative({ holder: side, taken: false })
      return
    }
    if (initiative.taken) return
    const who = twoPlayers ? (side === 'player' ? 'your base' : 'their base') : (side === 'player' ? 'you' : 'opponent')
    log.add({ type: 'initiative', message: `Initiative: ${who}`, color: 'var(--color-accent)', snapshot: makeSnapshot() })
    setInitiative({ holder: side, taken: true })
  }
  const freeInitiative = () => setInitiative(i => ({ ...i, taken: false }))

  const handleRoundIncrement = () => {
    const snap = makeSnapshot()
    freeInitiative()
    game.incrementRound()
    log.add({ type: 'round', message: `Round ${snap.gameState.round + 1}`, color: '#ffffff', snapshot: snap })
    void onRoundIncremented(baseKey, baseSet, snap.gameState.round + 1)
  }

  const handleStartGame = () => {
    const snap = makeSnapshot()
    game.incrementRound()
    timer.start()
    log.reset()
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', snapshot: snap })
    setLastGame(null)
    setGameOverOpen(false)
    gameStartTime.current = Date.now()
    void onGameStart(baseKey, baseSet, useHyperspace, playMode)
  }

  const handleRecord = (result: MatchResult) => {
    const gameNumber = gamesPlayed + 1
    const snap = makeSnapshot()

    if (!isCasual) {
      if (result === 'won') match.incrementPlayerScore()
      else if (result === 'lost') match.incrementOpponentScore()
      else match.recordDraw()
      if (result !== 'drawn' && timer.isExpired) match.closeByTimer()
    }

    const ended: LastGame = { result, round: game.round, damage: game.count, ...(twoPlayers ? { theirDamage: theirGame.count } : {}) }
    game.reset()
    theirGame.reset()
    freeInitiative()

    log.add({
      type: 'game-result',
      message: isCasual ? `Game ${RESULT_WORD[result]}` : `Game ${gameNumber} ${RESULT_WORD[result]}`,
      color: '#ffffff',
      snapshot: snap,
    })

    const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
    void onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)
    setLastGame(ended)
    setEndGameOpen(false)
    setEndGameChoice(null)
    if (isCasual) setGameOverOpen(true)
  }

  const handleOpenEndGame = () => {
    setEndGameChoice(null)
    setEndGameOpen(true)
  }

  const handleRematch = () => {
    setLastGame(null)
    setGameOverOpen(false)
    setInitiative(NO_INITIATIVE)
  }

  const handleUndo = () => {
    const entry = log.undoLast()
    if (entry) {
      const { gameState, theirGameState, matchState } = entry.snapshot
      game.restoreState(gameState)
      theirGame.restoreState(theirGameState)
      match.restoreState(matchState)
      setLastGame(entry.snapshot.lastGame)
      setInitiative(entry.snapshot.initiative)
      // Only the first game's start owns the match timer.
      if (gameState.round === 0 && matchState.playerScore + matchState.opponentScore === 0) timer.reset()
      void onUndoUsed(baseKey, baseSet, entry.type)
    }
  }

  const handleReset = () => {
    if (gameStarted) {
      const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
      void onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)
    }
    if (!isInTournament) {
      game.reset()
      theirGame.reset()
      log.reset()
    }
    onBack(gamesPlayed)
  }

  // Draws, including an intentional one before game 1 of a match, go through End game.
  const canEndGame = !match.matchOver && (gameStarted || (!isCasual && isPreFirstGame))
  const canChangeBase = !!changeBaseOptions && !!onChangeBase && !gameStarted && gamesPlayed > 0 && !match.matchOver

  const viewProps: SwuGameViewProps = {
    ...you,
    onBack: handleReset,
    onHelp,
    onSettings,
    round: game.round,
    onStartGame: handleStartGame,
    onRoundIncrement: handleRoundIncrement,
    showDamageButtons: enableDamageButtons,
    showInitiative: enableInitiativeBar,
    initiative: initiative.holder,
    initiativeTaken: initiative.taken,
    onInitiativeOpponent: () => takeInitiative('opponent'),
    onInitiativePlayer: () => takeInitiative('player'),
    logEntries: log.entries,
    onUndo: handleUndo,
    showLog,
    onLogToggle: () => setShowLog(v => !v),
    playMode,
    playerScore: match.playerScore,
    opponentScore: match.opponentScore,
    matchResult: match.matchOver ? match.matchResult : null,
    lastGame,
    timerRemaining: timer.remaining,
    timerMinutes,
    onTimerMinutesChange: isPreFirstGame ? setTimerMinutes : undefined,
    canEndGame,
    endGameOpen,
    endGameChoice,
    onOpenEndGame: handleOpenEndGame,
    onEndGameChoice: setEndGameChoice,
    onKeepPlaying: () => setEndGameOpen(false),
    onRecord: handleRecord,
    timerExpired: timer.isExpired,
    gameOverOpen: gameOverOpen && lastGame !== null,
    onCloseGameOver: () => setGameOverOpen(false),
    onRematch: handleRematch,
    onNewSetup: handleReset,
    changeBaseOptions: canChangeBase ? changeBaseOptions : undefined,
    onChangeBase,
  }

  // Two players lie the phone flat between them: their screen stays portrait on the phone. One player's
  // screen stays landscape on the phone.
  if (twoPlayers) {
    const destroyedNote = yoursDestroyed ? 'Your base is destroyed' : theirsDestroyed ? 'Their base is destroyed' : null
    return <SwuGame2pView {...viewProps} them={them} destroyedNote={destroyedNote} />
  }
  return <LandscapeScreen><SwuGameScreenView {...viewProps} /></LandscapeScreen>
}

export default SwuGameScreen
