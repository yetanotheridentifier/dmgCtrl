import { useState, useEffect, useRef } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useGameLog } from '../hooks/useGameLog'
import { useBaseArt } from '../hooks/useBaseArt'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import { useMatch } from '../hooks/useMatch'
import SwuGameScreenView from './swuGameScreenView'
import { BackIcon } from './icons'
import AppScreenLayout from './layout/AppScreenLayout'
import { onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed, onEpicActionUsed, onForceGained, onForceUsed } from '../services/analytics'
import type { PlayMode } from '../utils/playMode'

interface Props {
  base: Base
  playMode?: PlayMode
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

function SwuGameScreen({ base, playMode = 'casual', onBack, onHelp, onSettings }: Props) {
  const { enableForceToken, enableEpicActions, enableWakeLock, useHyperspace, enableLongPress, enableActionLog } = useUserSettings()
  const match = useMatch(playMode)
  const art = useBaseArt(base, useHyperspace)
  const game = useSwuGame(base.hp)
  const log = useGameLog()
  const { isPortrait } = useOrientation()
  useWakeLock(enableWakeLock)
  const [showLog, setShowLog] = useState(false)
  const [epicOverlayDismissed, setEpicOverlayDismissed] = useState(false)

  const baseKey = `${base.set}-${base.number}`
  const baseSet = base.set

  const isMysticMonastery = base.set === 'LOF' && base.number === '022'
  const isForceBase = /the force is with you/i.test(base.epicAction)
  const effectiveForceEnabled = isForceBase || game.forceEnabled

  const handleIncrement = (n: number) => {
    const prev = game.snapshot()
    game.incrementBy(n)
    log.add({ type: 'hit', message: `Hit +${n}`, color: '#ef4444', prevState: prev })
    void onDamageDealt(baseKey, baseSet, n)
  }

  const handleDecrement = (n: number) => {
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

  const handleUndo = () => {
    const entry = log.undoLast()
    if (entry) {
      game.restoreState(entry.prevState)
      void onUndoUsed(baseKey, baseSet, entry.type)
    }
  }

  const handleReset = () => {
    game.reset()
    log.reset()
    onBack()
  }

  const logInitialized = useRef(false)
  useEffect(() => {
    if (logInitialized.current) return
    logInitialized.current = true
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', prevState: game.snapshot(), undoable: false })
  }, [])

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

  const showForce = enableForceToken
  const showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)

  return (
    <SwuGameScreenView
      base={base}
      onBack={handleReset}
      onHelp={onHelp}
      onSettings={onSettings}
      imageSrc={art.src ?? ''}
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
      isMysticMonastery={isMysticMonastery}
      mysticUsesRemaining={game.mysticUsesRemaining}
      onMysticAction={handleMonasteryAction}
      enableLongPress={enableLongPress}
      round={game.round}
      onRoundIncrement={handleRoundIncrement}
      logEntries={log.entries}
      onUndo={handleUndo}
      enableActionLog={enableActionLog}
      showLog={showLog}
      onLogToggle={() => setShowLog(v => !v)}
      playMode={playMode}
      playerScore={match.playerScore}
      opponentScore={match.opponentScore}
    />
  )
}

export default SwuGameScreen
