import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useOrientation } from '../hooks/useOrientation'
import SwuGameScreenView from './swuGameScreenView'
import AppScreenLayout from './layout/AppScreenLayout'

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  useHyperspace: boolean
}

function SwuGameScreen({ base, onBack, onHelp, useHyperspace }: Props) {
  const imageSrcs = useHyperspace
    ? [
        ...(base.hyperspaceArtHiRes ? [base.hyperspaceArtHiRes] : []),
        ...(base.hyperspaceArt ? [base.hyperspaceArt] : []),
        ...(base.frontArt ? [base.frontArt] : []),
        ...(base.frontArtLowRes ? [base.frontArtLowRes] : []),
      ]
    : [
        ...(base.frontArt ? [base.frontArt] : []),
        ...(base.frontArtLowRes ? [base.frontArtLowRes] : []),
        ...(base.hyperspaceArtHiRes ? [base.hyperspaceArtHiRes] : []),
        ...(base.hyperspaceArt ? [base.hyperspaceArt] : []),
      ]

  const { count, imageLoaded, imageError, currentImageSrc, increment, decrement, handleImageLoad, handleImageError } = useSwuGame(imageSrcs)
  const { isPortrait } = useOrientation()

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <button
          onClick={onBack}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 1vh)',
            left: 'calc(env(safe-area-inset-left) + 1vw)',
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
      imageSrc={currentImageSrc}
      count={count}
      imageLoaded={imageLoaded}
      imageError={imageError}
      onIncrement={increment}
      onDecrement={decrement}
      onImageLoad={handleImageLoad}
      onImageError={handleImageError}
    />
  )
}

export default SwuGameScreen