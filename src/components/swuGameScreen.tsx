import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import { useOrientation } from '../hooks/useOrientation'
import SwuGameScreenView from './swuGameScreenView'

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  useHyperspace: boolean
}

function SwuGameScreen({ base, onBack, onHelp, useHyperspace }: Props) {
  const { count, imageLoaded, imageError, increment, decrement, handleImageLoad, handleImageError } = useSwuGame()
  const { isPortrait } = useOrientation()

  if (isPortrait) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: 'radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        gap: '2rem',
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
    )
  }

  return (
    <SwuGameScreenView
      base={base}
      onBack={onBack}
      onHelp={onHelp}
      useHyperspace={useHyperspace}
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