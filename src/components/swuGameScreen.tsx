import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useBaseArt } from '../hooks/useBaseArt'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import SwuGameScreenView from './swuGameScreenView'
import { BackIcon } from './icons'
import AppScreenLayout from './layout/AppScreenLayout'

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

function SwuGameScreen({ base, onBack, onHelp, onSettings }: Props) {
  const { enableForceToken, enableEpicActions, enableWakeLock, useHyperspace, enableLongPress } = useUserSettings()
  const art = useBaseArt(base, useHyperspace)
  const { count, incrementBy, decrementBy, epicActionUsed, markEpicActionUsed, forceActive, toggleForce, forceEnabled, enableForce } = useSwuGame(base.hp)
  const { isPortrait } = useOrientation()
  useWakeLock(enableWakeLock)

  const isMysticMonastery = base.set === 'LOF' && base.number === '022'
  const isForceBase = /the force is with you/i.test(base.epicAction)
  const effectiveForceEnabled = isForceBase || forceEnabled

  const [mysticUsesRemaining, setMysticUsesRemaining] = useState(3)
  const gainForceViaAction = () => {
    setMysticUsesRemaining(n => n - 1)
    toggleForce()
  }

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <button
          onClick={onBack}
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

  return (
    <SwuGameScreenView
      base={base}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
      imageSrc={art.src ?? ''}
      imageRotationDeg={art.rotationDeg}
      count={count}
      imageLoaded={art.imageLoaded}
      imageError={art.allFailed}
      onIncrement={incrementBy}
      onDecrement={decrementBy}
      onImageLoad={art.onLoad}
      onImageError={art.onError}
      epicActionUsed={epicActionUsed}
      onEpicActionToggle={markEpicActionUsed}
      showEpicAction={enableEpicActions && /epic action/i.test(base.epicAction)}
      showForce={enableForceToken}
      forceEnabled={effectiveForceEnabled}
      forceActive={forceActive}
      onForceEnable={enableForce}
      onForceToggle={toggleForce}
      isMysticMonastery={isMysticMonastery}
      mysticUsesRemaining={mysticUsesRemaining}
      onMysticAction={gainForceViaAction}
      enableLongPress={enableLongPress}
    />
  )
}

export default SwuGameScreen
