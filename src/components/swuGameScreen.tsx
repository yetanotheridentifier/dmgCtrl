import { useState, useEffect, useRef } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useGameLog } from '../hooks/useGameLog'
import { useBaseArt } from '../hooks/useBaseArt'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import { useMatch } from '../hooks/useMatch'
import { useTimer } from '../hooks/useTimer'
import SwuGameScreenView from './swuGameScreenView'
import { BackIcon } from './icons'
import AppScreenLayout from './layout/AppScreenLayout'
import { onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed, onEpicActionUsed, onForceGained, onForceUsed, onMatchCompleted } from '../services/analytics'
import type { PlayMode } from '../utils/playMode'

interface Props {
  base: Base
  playMode?: PlayMode
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onMatchComplete?: (result: 'won' | 'lost' | 'drawn', playerScore: number, opponentScore: number) => void
}

function SwuGameScreen({ base, playMode = 'casual', onBack, onHelp, onSettings, onMatchComplete }: Props) {
  const { forceTokenDisplay, enableEpicActions, enableWakeLock, useHyperspace, enableLongPress, enableActionLog, bo1TimerMinutes, bo3TimerMinutes } = useUserSettings()
  const match = useMatch(playMode)
  const art = useBaseArt(base, useHyperspace)
  const game = useSwuGame(base.hp)
  const log = useGameLog()
  const { isPortrait } = useOrientation()
  useWakeLock(enableWakeLock)

  const timerDuration = (playMode === 'bo3' ? bo3TimerMinutes : bo1TimerMinutes) * 60
  const timer = useTimer(timerDuration)

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
    const prev = game.snapshot()
    game.incrementBy(n)
    log.add({ type: 'hit', message: `Hit +${n}`, color: '#ef4444', prevState: prev })
    void onDamageDealt(baseKey, baseSet, n)
  }

  const handleDecrement = (n: number) => {
    if (game.round === 0) return
    const prev = game.snapshot()
    game.decrementBy(n)
    log.add({ type: 'heal', message: `Heal −${n}`, color: '#22c55e', prevState: prev })
    void onDamageHealed(baseKey, baseSet, n)
  }

  const handleForceGain = () => {
    const prev = game.snapshot()
    game.toggleForce()
    log.add({ type: 'force-gain', message: 'Force gained', color: '#3b82f6', prevState: prev })
    void onForceGained(baseKey, baseSet)
  }

  const handleForceDismiss = () => {
    const prev = game.snapshot()
    game.toggleForce()
    log.add({ type: 'force-use', message: 'Force used', color: '#93c5fd', prevState: prev })
    void onForceUsed(baseKey, baseSet)
  }

  const handleEpicActionMark = () => {
    const prev = game.snapshot()
    game.markEpicActionUsed()
    log.add({ type: 'epic', message: 'Epic action used', color: '#f5c518', prevState: prev })
    setEpicOverlayDismissed(false)
    void onEpicActionUsed(baseKey, baseSet)
  }

  const handleMonasteryAction = () => {
    const prev = game.snapshot()
    game.gainForceViaMonastery()
    log.add({ type: 'monastery', message: 'Force gained (monastery)', color: '#3b82f6', prevState: prev })
    void onForceGained(baseKey, baseSet)
  }

  const handleRoundIncrement = () => {
    const prev = game.snapshot()
    game.incrementRound()
    log.add({ type: 'round', message: `Round ${prev.round + 1}`, color: '#ffffff', prevState: prev })
    void onRoundIncremented(baseKey, baseSet, prev.round + 1)
  }

  const handleStartGame = () => {
    const prev = game.snapshot()
    game.incrementRound()
    timer.start()
    log.reset()
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', prevState: prev, undoable: false })
    setLastGameResult(null)
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
    const prevLogEntries = [...log.entries]
    const prevMatchState = {
      playerScore: match.playerScore,
      opponentScore: match.opponentScore,
      matchDrawn: false,
      matchClosedByTimer: false,
    }
    const prevGameState = game.snapshot()

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

    log.clearAndAdd({
      type: 'game-result',
      message,
      color: '#ffffff',
      prevState: prevGameState,
      prevLogEntries,
      prevMatchState,
      undoable: true,
    })

    setLastGameResult(outcome === 'win' ? 'won' : outcome === 'loss' ? 'lost' : 'drawn')
    setPendingConfirm(null)
  }

  const handleUndo = () => {
    const entry = log.undoLast()
    if (entry) {
      game.restoreState(entry.prevState)
      if (entry.prevMatchState) {
        match.restoreState(entry.prevMatchState)
      }
      if (entry.type === 'game-result') {
        setLastGameResult(null)
      }
      void onUndoUsed(baseKey, baseSet, entry.type)
    }
  }

  const handleReset = () => {
    game.reset()
    log.reset()
    onBack()
  }

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <button
          onClick={handleReset}
          aria-label="Back"
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 5vw)',
            left: 'calc(env(safe-area-inset-left) + 5vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            background: 'transparent',
            border: '2px solid #6b7280',
            borderRadius: '8px',
            color: '#9ca3af',
            fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
          }}
        >
          <BackIcon />
        </button>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2rem',
          zIndex: 1,
        }}>
          <div style={{ fontSize: '3rem', color: '#4fc3f7' }}>↻</div>
          <p style={{
            color: '#ffffff',
            fontWeight: '300',
            fontSize: 'clamp(1rem, 5vw, 1.4rem)',
            letterSpacing: '0.05em',
            margin: 0,
            textAlign: 'center',
            padding: '0 10vw',
          }}>
            Please rotate to landscape
          </p>
        </div>
      </AppScreenLayout>
    )
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
    />
  )
}

export default SwuGameScreen
