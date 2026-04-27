import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useBaseArt } from '../hooks/useBaseArt'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'
import { FEATURE_EPIC_ACTION, FEATURE_FORCE_TOKEN, FEATURE_WAKE_LOCK, FEATURE_USER_SETTINGS } from '../flags'
import SwuGameScreenView from './swuGameScreenView'
import AppScreenLayout from './layout/AppScreenLayout'

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  useHyperspace: boolean
}

function SwuGameScreen({ base, onBack, onHelp, onSettings, useHyperspace }: Props) {
  const art = useBaseArt(base, useHyperspace)
  const { count, increment, decrement, epicActionUsed, toggleEpicAction, forceActive, toggleForce, forceEnabled, enableForce } = useSwuGame(base.hp)
  const { isPortrait } = useOrientation()
  useWakeLock(FEATURE_WAKE_LOCK)

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
          &lt;
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
      onSettings={FEATURE_USER_SETTINGS ? onSettings : undefined}
      imageSrc={art.src ?? ''}
      imageRotationDeg={art.rotationDeg}
      count={count}
      imageLoaded={art.imageLoaded}
      imageError={art.allFailed}
      onIncrement={increment}
      onDecrement={decrement}
      onImageLoad={art.onLoad}
      onImageError={art.onError}
      epicActionUsed={epicActionUsed}
      onEpicActionToggle={toggleEpicAction}
      showEpicAction={FEATURE_EPIC_ACTION && /epic action/i.test(base.epicAction)}
      showForce={FEATURE_FORCE_TOKEN}
      forceEnabled={effectiveForceEnabled}
      forceActive={forceActive}
      onForceEnable={enableForce}
      onForceToggle={toggleForce}
      isMysticMonastery={isMysticMonastery}
      mysticUsesRemaining={mysticUsesRemaining}
      onMysticAction={gainForceViaAction}
    />
  )
}

export default SwuGameScreen
