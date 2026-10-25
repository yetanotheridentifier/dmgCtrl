import { useState, useEffect, useRef } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import type { GameState } from '../hooks/useSwuGame'
import { useGameHistory } from '../hooks/useGameHistory'
import { useBaseArt } from '../hooks/useBaseArt'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import { useMatch } from '../hooks/useMatch'
import type { MatchResult } from '../hooks/useMatch'
import { useTimer } from '../hooks/useTimer'
import { useInitiative } from '../hooks/useInitiative'
import SwuGameScreenView from './swuGameScreenView'
import type { LastGame } from './swuGameScreenView'
import RotatePrompt from './layout/rotatePrompt'
import { onGameStart, onGameEnd, onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed, onEpicActionUsed, onForceGained, onForceUsed, onMatchCompleted } from '../services/analytics'
import type { PlayMode } from '../utils/playMode'
import type { Format } from '../utils/formatFilter'

interface SwuGameSnapshot {
  gameState: GameState
  matchState: { playerScore: number; opponentScore: number; matchDrawn: boolean; matchClosedByTimer: boolean }
  lastGame: LastGame | null
}

interface Props {
  base: Base
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

function SwuGameScreen({ base, playMode = 'casual', format, isInTournament = false, onBack, onHelp, onSettings, onMatchComplete, changeBaseOptions, onChangeBase }: Props) {
  const { forceTokenDisplay, useHyperspace, enableInitiativeBar, enableDamageButtons, bo1TimerMinutes, bo3TimerMinutes, setBo1TimerMinutes, setBo3TimerMinutes } = useUserSettings()
  const match = useMatch(playMode)
  const art = useBaseArt(base, useHyperspace)
  const game = useSwuGame(base.hp)
  const log = useGameHistory<SwuGameSnapshot>()
  const { isPortrait } = useOrientation()
  // The game screen always keeps the phone awake.
  useWakeLock(true)

  const isCasual = playMode === 'casual'
  const timerMinutes = playMode === 'bo3' ? bo3TimerMinutes : bo1TimerMinutes
  const setTimerMinutes = playMode === 'bo3' ? setBo3TimerMinutes : setBo1TimerMinutes
  const timer = useTimer(timerMinutes * 60)

  const initiative = useInitiative()
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

  // Your base reaching 0 opens End game with Lost chosen.
  useEffect(() => {
    if (game.round > 0 && game.count >= base.hp && !match.matchOver && !endGameOpenRef.current) {
      setEndGameChoice('lost')
      setEndGameOpen(true)
    }
  }, [game.count, base.hp, game.round, match.matchOver])

  const makeSnapshot = (): SwuGameSnapshot => ({
    gameState: game.snapshot(),
    matchState: {
      playerScore: match.playerScore,
      opponentScore: match.opponentScore,
      matchDrawn: false,
      matchClosedByTimer: false,
    },
    lastGame,
  })

  const baseKey = `${base.set}-${base.number}`
  const baseSet = base.set

  const isMysticMonastery = base.set === 'LOF' && base.number === '022'
  const isForceBase = /the force is with you/i.test(base.epicAction)

  const gamesPlayed = match.playerScore + match.opponentScore
  const gameStarted = game.round > 0
  const isPreFirstGame = !gameStarted && gamesPlayed === 0 && lastGame === null

  const handleIncrement = (n: number) => {
    const amount = Math.min(n, base.hp - game.count)
    if (!gameStarted || amount <= 0) return
    const snap = makeSnapshot()
    game.incrementBy(amount)
    log.add({ type: 'hit', message: `Hit +${amount}`, color: 'var(--color-error)', snapshot: snap })
    void onDamageDealt(baseKey, baseSet, amount)
  }

  const handleDecrement = (n: number) => {
    const amount = Math.min(n, game.count)
    if (!gameStarted || amount <= 0) return
    const snap = makeSnapshot()
    game.decrementBy(amount)
    log.add({ type: 'heal', message: `Heal −${amount}`, color: 'var(--color-success)', snapshot: snap })
    void onDamageHealed(baseKey, baseSet, amount)
  }

  const handleForceToggle = () => {
    const snap = makeSnapshot()
    const gaining = !game.forceActive
    game.toggleForce()
    if (gaining) {
      log.add({ type: 'force-gain', message: 'Force gained', color: 'var(--color-force)', snapshot: snap })
      void onForceGained(baseKey, baseSet)
    } else {
      log.add({ type: 'force-use', message: 'Force used', color: '#93c5fd', snapshot: snap })
      void onForceUsed(baseKey, baseSet)
    }
  }

  const handleMonasteryAction = () => {
    if (game.forceActive) {
      handleForceToggle()
      return
    }
    const snap = makeSnapshot()
    game.gainForceViaMonastery()
    log.add({ type: 'monastery', message: 'Force gained (Monastery)', color: 'var(--color-force)', snapshot: snap })
    void onForceGained(baseKey, baseSet)
  }

  const handleEpicActionMark = () => {
    const snap = makeSnapshot()
    game.markEpicActionUsed()
    log.add({ type: 'epic', message: 'Epic action used', color: 'var(--color-epic)', snapshot: snap })
    void onEpicActionUsed(baseKey, baseSet)
  }

  const handleRoundIncrement = () => {
    const snap = makeSnapshot()
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

    const ended: LastGame = { result, round: game.round, damage: game.count }
    game.reset()

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
    initiative.reset()
  }

  const handleUndo = () => {
    const entry = log.undoLast()
    if (entry) {
      const { gameState, matchState } = entry.snapshot
      game.restoreState(gameState)
      match.restoreState(matchState)
      setLastGame(entry.snapshot.lastGame)
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
      log.reset()
    }
    onBack(gamesPlayed)
  }

  if (isPortrait) {
    return <RotatePrompt onBack={handleReset} />
  }

  const forceShown = forceTokenDisplay !== 'always-off'
  const showForce = forceShown && !isMysticMonastery && (forceTokenDisplay === 'always-on' || isForceBase)
  const showMysticMonastery = forceShown && isMysticMonastery
  const showEpicAction = /epic action/i.test(base.epicAction)

  // Draws, including an intentional one before game 1 of a match, go through End game.
  const canEndGame = !match.matchOver && (gameStarted || (!isCasual && isPreFirstGame))
  const canChangeBase = !!changeBaseOptions && !!onChangeBase && !gameStarted && gamesPlayed > 0 && !match.matchOver

  return (
    <SwuGameScreenView
      base={base}
      onBack={handleReset}
      onHelp={onHelp}
      onSettings={onSettings}
      art={{ src: art.src, rotationDeg: art.rotationDeg, loaded: art.imageLoaded, failed: art.allFailed, onLoad: art.onLoad, onError: art.onError }}
      count={game.count}
      round={game.round}
      onIncrement={handleIncrement}
      onDecrement={handleDecrement}
      onStartGame={handleStartGame}
      onRoundIncrement={handleRoundIncrement}
      showDamageButtons={enableDamageButtons}
      showEpicAction={showEpicAction}
      epicActionUsed={game.epicActionUsed}
      onEpicActionMark={handleEpicActionMark}
      showForce={showForce}
      showMysticMonastery={showMysticMonastery}
      forceActive={game.forceActive}
      mysticUsesRemaining={game.mysticUsesRemaining}
      onForceToggle={handleForceToggle}
      onMysticAction={handleMonasteryAction}
      showInitiative={enableInitiativeBar}
      initiative={initiative.initiative}
      onInitiativeOpponent={initiative.setOpponent}
      onInitiativePlayer={initiative.setPlayer}
      logEntries={log.entries}
      onUndo={handleUndo}
      showLog={showLog}
      onLogToggle={() => setShowLog(v => !v)}
      playMode={playMode}
      playerScore={match.playerScore}
      opponentScore={match.opponentScore}
      matchResult={match.matchOver ? match.matchResult : null}
      lastGame={lastGame}
      timerRemaining={timer.remaining}
      timerMinutes={timerMinutes}
      onTimerMinutesChange={isPreFirstGame ? setTimerMinutes : undefined}
      canEndGame={canEndGame}
      endGameOpen={endGameOpen}
      endGameChoice={endGameChoice}
      onOpenEndGame={handleOpenEndGame}
      onEndGameChoice={setEndGameChoice}
      onKeepPlaying={() => setEndGameOpen(false)}
      onRecord={handleRecord}
      timerExpired={timer.isExpired}
      gameOverOpen={gameOverOpen && lastGame !== null}
      onCloseGameOver={() => setGameOverOpen(false)}
      onRematch={handleRematch}
      onNewSetup={handleReset}
      changeBaseOptions={canChangeBase ? changeBaseOptions : undefined}
      onChangeBase={onChangeBase}
    />
  )
}

export default SwuGameScreen
