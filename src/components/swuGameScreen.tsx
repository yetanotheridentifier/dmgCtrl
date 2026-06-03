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
import { useTimer } from '../hooks/useTimer'
import { useInitiative } from '../hooks/useInitiative'
import SwuGameScreenView from './swuGameScreenView'
import RotatePrompt from './layout/rotatePrompt'
import { onGameStart, onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed, onEpicActionUsed, onForceGained, onForceUsed, onMatchCompleted } from '../services/analytics'
import type { PlayMode } from '../utils/playMode'

interface SwuGameSnapshot {
  gameState: GameState
  matchState: { playerScore: number; opponentScore: number; matchDrawn: boolean; matchClosedByTimer: boolean }
  lastGameResult: 'won' | 'lost' | 'drawn' | null
}

interface Props {
  base: Base
  playMode?: PlayMode
  isInTournament?: boolean
  onBack: (gamesCompleted: number) => void
  onHelp: () => void
  onSettings?: () => void
  onMatchComplete?: (result: 'won' | 'lost' | 'drawn', playerScore: number, opponentScore: number) => void
}

function SwuGameScreen({ base, playMode = 'casual', isInTournament = false, onBack, onHelp, onSettings, onMatchComplete }: Props) {
  const { forceTokenDisplay, enableEpicActions, enableWakeLock, useHyperspace, enableLongPress, enableActionLog, enableInitiativeBar, bo1TimerMinutes, bo3TimerMinutes } = useUserSettings()
  const match = useMatch(playMode)
  const art = useBaseArt(base, useHyperspace)
  const game = useSwuGame(base.hp)
  const log = useGameHistory<SwuGameSnapshot>()
  const { isPortrait } = useOrientation()
  useWakeLock(enableWakeLock)

  const timerDuration = (playMode === 'bo3' ? bo3TimerMinutes : bo1TimerMinutes) * 60
  const timer = useTimer(timerDuration)

  const initiative = useInitiative()
  const [showLog, setShowLog] = useState(false)
  const [epicOverlayDismissed, setEpicOverlayDismissed] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<'win' | 'loss' | 'draw' | null>(null)
  const [lastGameResult, setLastGameResult] = useState<'won' | 'lost' | 'drawn' | null>(null)
  const pendingConfirmRef = useRef(pendingConfirm)
  useEffect(() => { pendingConfirmRef.current = pendingConfirm }, [pendingConfirm])

  useEffect(() => {
    if (match.matchOver && playMode !== 'casual' && match.matchResult) {
      void onMatchCompleted(playMode, match.matchResult, match.playerScore, match.opponentScore)
      onMatchComplete?.(match.matchResult, match.playerScore, match.opponentScore)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.matchOver])

  // Auto-trigger loss confirm when base reaches 0 HP in competitive play
  useEffect(() => {
    if (
      playMode !== 'casual' &&
      game.round > 0 &&
      game.count >= base.hp &&
      !match.matchOver &&
      pendingConfirmRef.current === null
    ) {
      setPendingConfirm('loss')
    }
  }, [game.count, base.hp, playMode, game.round, match.matchOver])

  const makeSnapshot = (): SwuGameSnapshot => ({
    gameState: game.snapshot(),
    matchState: {
      playerScore: match.playerScore,
      opponentScore: match.opponentScore,
      matchDrawn: false,
      matchClosedByTimer: false,
    },
    lastGameResult,
  })

  const baseKey = `${base.set}-${base.number}`
  const baseSet = base.set

  const isMysticMonastery = base.set === 'LOF' && base.number === '022'
  const isForceBase = /the force is with you/i.test(base.epicAction)
  const effectiveForceEnabled = isForceBase || game.forceEnabled

  const gamesPlayed = match.playerScore + match.opponentScore
  const isPreFirstGame = game.round === 0 && gamesPlayed === 0
  const timerInteractive =
    playMode !== 'casual' &&
    !match.matchOver &&
    pendingConfirm === null &&
    (isPreFirstGame || timer.isExpired)

  const handleIncrement = (n: number) => {
    if (game.round === 0) return
    const snap = makeSnapshot()
    game.incrementBy(n)
    log.add({ type: 'hit', message: `Hit +${n}`, color: 'var(--color-error)', snapshot: snap })
    void onDamageDealt(baseKey, baseSet, n)
  }

  const handleDecrement = (n: number) => {
    if (game.round === 0) return
    const snap = makeSnapshot()
    game.decrementBy(n)
    log.add({ type: 'heal', message: `Heal −${n}`, color: 'var(--color-success)', snapshot: snap })
    void onDamageHealed(baseKey, baseSet, n)
  }

  const handleForceGain = () => {
    const snap = makeSnapshot()
    game.toggleForce()
    log.add({ type: 'force-gain', message: 'Force gained', color: 'var(--color-force)', snapshot: snap })
    void onForceGained(baseKey, baseSet)
  }

  const handleForceDismiss = () => {
    const snap = makeSnapshot()
    game.toggleForce()
    log.add({ type: 'force-use', message: 'Force used', color: '#93c5fd', snapshot: snap })
    void onForceUsed(baseKey, baseSet)
  }

  const handleEpicActionMark = () => {
    const snap = makeSnapshot()
    game.markEpicActionUsed()
    log.add({ type: 'epic', message: 'Epic action used', color: 'var(--color-epic)', snapshot: snap })
    setEpicOverlayDismissed(false)
    void onEpicActionUsed(baseKey, baseSet)
  }

  const handleMonasteryAction = () => {
    const snap = makeSnapshot()
    game.gainForceViaMonastery()
    log.add({ type: 'monastery', message: 'Force gained (Monastery)', color: 'var(--color-force)', snapshot: snap })
    void onForceGained(baseKey, baseSet)
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
    setLastGameResult(null)
    void onGameStart(baseKey, baseSet, useHyperspace, playMode)
  }

  const handleRoundButton = () => {
    if (game.round === 0) {
      handleStartGame()
    } else {
      handleRoundIncrement()
    }
  }

  const handleConfirmResult = (outcome: 'win' | 'loss' | 'draw') => {
    const gameNumber = match.playerScore + match.opponentScore + 1
    const snap = makeSnapshot()

    if (outcome === 'win') {
      match.incrementPlayerScore()
      if (timer.isExpired) match.closeByTimer()
    } else if (outcome === 'loss') {
      match.incrementOpponentScore()
      if (timer.isExpired) match.closeByTimer()
    } else {
      match.recordDraw()
    }

    game.reset()

    const message = outcome === 'draw'
      ? 'Match Drawn'
      : `Game ${gameNumber} ${outcome === 'win' ? 'Won' : 'Lost'}`

    log.add({
      type: 'game-result',
      message,
      color: '#ffffff',
      snapshot: snap,
    })

    setLastGameResult(outcome === 'win' ? 'won' : outcome === 'loss' ? 'lost' : 'drawn')
    setPendingConfirm(null)
  }

  const handleUndo = () => {
    const entry = log.undoLast()
    if (entry) {
      game.restoreState(entry.snapshot.gameState)
      match.restoreState(entry.snapshot.matchState)
      setLastGameResult(entry.snapshot.lastGameResult)
      if (entry.snapshot.gameState.round === 0) timer.reset()
      void onUndoUsed(baseKey, baseSet, entry.type)
    }
  }

  const handleReset = () => {
    if (!isInTournament) {
      game.reset()
      log.reset()
    }
    onBack(match.playerScore + match.opponentScore)
  }

  if (isPortrait) {
    return <RotatePrompt onBack={handleReset} />
  }

  const showForce = forceTokenDisplay !== 'always-off' &&
    (forceTokenDisplay === 'always-on' || (isForceBase && !isMysticMonastery))
  const showMysticMonastery = isMysticMonastery && forceTokenDisplay !== 'always-off'
  const showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)

  return (
    <SwuGameScreenView
      base={base}
      onBack={handleReset}
      onHelp={onHelp}
      onSettings={onSettings}
      imageSrc={art.src}
      imageRotationDeg={art.rotationDeg}
      count={game.count}
      imageLoaded={art.imageLoaded}
      imageError={art.allFailed}
      onIncrement={handleIncrement}
      onDecrement={handleDecrement}
      onImageLoad={art.onLoad}
      onImageError={art.onError}
      epicActionUsed={game.epicActionUsed}
      epicActionOverlayVisible={game.epicActionUsed && !epicOverlayDismissed}
      onEpicActionOverlayDismiss={!enableActionLog ? () => setEpicOverlayDismissed(true) : undefined}
      onEpicActionMark={handleEpicActionMark}
      showEpicAction={showEpicAction}
      showForce={showForce}
      forceEnabled={effectiveForceEnabled}
      forceActive={game.forceActive}
      onForceEnable={game.enableForce}
      onForceGain={handleForceGain}
      onForceDismiss={handleForceDismiss}
      showMysticMonastery={showMysticMonastery}
      mysticUsesRemaining={game.mysticUsesRemaining}
      onMysticAction={handleMonasteryAction}
      enableLongPress={enableLongPress}
      round={game.round}
      onRoundIncrement={handleRoundButton}
      onStartGame={handleStartGame}
      logEntries={log.entries}
      onUndo={handleUndo}
      enableActionLog={enableActionLog}
      showLog={showLog}
      onLogToggle={() => setShowLog(v => !v)}
      playMode={playMode}
      playerScore={match.playerScore}
      opponentScore={match.opponentScore}
      matchOver={match.matchOver}
      matchDrawn={match.matchResult === 'drawn'}
      pendingConfirm={pendingConfirm}
      onWinPending={() => setPendingConfirm('win')}
      onLossPending={() => setPendingConfirm('loss')}
      onDrawPending={() => setPendingConfirm('draw')}
      onConfirmResult={() => handleConfirmResult(pendingConfirm!)}
      onCancelConfirm={() => setPendingConfirm(null)}
      lastGameResult={lastGameResult}
      timerRemaining={timer.remaining}
      timerInteractive={timerInteractive}
      enableInitiativeBar={enableInitiativeBar}
      initiative={initiative.initiative}
      onInitiativeOpponent={initiative.setOpponent}
      onInitiativePlayer={initiative.setPlayer}
    />
  )
}

export default SwuGameScreen
