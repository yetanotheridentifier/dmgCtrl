import { useState } from 'react'

const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

interface Props {
  startingHealth: number
  onBack: () => void
}

function SwuGameScreen({ startingHealth, onBack }: Props) {
  const [count, setCount] = useState(0)

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: starField,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      touchAction: 'none',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      boxSizing: 'border-box',
    }}>

      {/* Star field layer */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(1px 1px at 25% 75%, rgba(255,255,255,0.4) 0%, transparent 100%),
          radial-gradient(1px 1px at 40% 35%, rgba(255,255,255,0.7) 0%, transparent 100%),
          radial-gradient(1px 1px at 55% 60%, rgba(255,255,255,0.3) 0%, transparent 100%),
          radial-gradient(1px 1px at 65% 15%, rgba(255,255,255,0.5) 0%, transparent 100%),
          radial-gradient(1px 1px at 75% 85%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(1px 1px at 85% 40%, rgba(255,255,255,0.4) 0%, transparent 100%),
          radial-gradient(1px 1px at 90% 70%, rgba(255,255,255,0.5) 0%, transparent 100%),
          radial-gradient(1px 1px at 15% 90%, rgba(255,255,255,0.3) 0%, transparent 100%),
          radial-gradient(1px 1px at 50% 10%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(2px 2px at 30% 50%, rgba(255,255,255,0.2) 0%, transparent 100%),
          radial-gradient(2px 2px at 70% 30%, rgba(255,255,255,0.15) 0%, transparent 100%)
        `,
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Back button */}
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
          zIndex: 2,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
        }}
      >
        &lt;
      </button>

      {/* Main content - grouped as a single centered block */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '70vw',
        marginTop: '10vh',
      }}>

        {/* Counter row */}
        <div style={{
          width: '100%',
          height: '33vh',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}>

          {/* Minus button */}
          <button
            onClick={() => setCount(c => Math.max(0, c - 1))}
            style={{
              width: '20vw',
              height: '20vw',
              maxHeight: '33vh',
              background: 'transparent',
              color: '#4fc3f7',
              border: '2px solid #4fc3f7',
              borderRadius: '12px',
              fontSize: '3rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 0 12px rgba(79, 195, 247, 0.3), inset 0 0 12px rgba(79, 195, 247, 0.05)',
            }}
          >
            −
          </button>

          {/* Counter */}
          <div style={{
            width: '30vw',
            height: '33vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'clamp(3rem, 12vw, 8rem)',
            fontWeight: '300',
            color: '#ffffff',
            letterSpacing: '-0.02em',
            flexShrink: 0,
            textShadow: '0 0 30px rgba(79, 195, 247, 0.4)',
          }}>
            {count}
          </div>

          {/* Plus button */}
          <button
            onClick={() => setCount(c => c + 1)}
            style={{
              width: '20vw',
              height: '20vw',
              maxHeight: '33vh',
              background: 'transparent',
              color: '#4fc3f7',
              border: '2px solid #4fc3f7',
              borderRadius: '12px',
              fontSize: '3rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 0 12px rgba(79, 195, 247, 0.3), inset 0 0 12px rgba(79, 195, 247, 0.05)',
            }}
          >
            +
          </button>

        </div>

        {/* Remaining health - hugs the counter row */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: '5vh',
          paddingRight: '1vw',
        }}>
          <span style={{
            fontSize: 'clamp(1rem, 4.5vw, 3rem)',
            fontWeight: '300',
            color: '#ffffff',
            letterSpacing: '0.05em',
            opacity: 0.85,
            textShadow: '0 0 12px rgba(255, 255, 255, 0.3)',
          }}>
            Remaining: {startingHealth - count}
          </span>
        </div>

      </div>
    </div>
  )
}

export default SwuGameScreen