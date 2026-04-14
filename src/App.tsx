import { useState } from 'react'

const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: starField,
      display: 'flex',
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
      boxSizing: 'border-box'
    }}>

      {/* Subtle star dots via box shadow on a pseudo-element isn't possible inline,
          so we use a nested absolutely positioned layer */}
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

      {/* Main content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '70vw',
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
            transition: 'box-shadow 0.1s ease',
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
            transition: 'box-shadow 0.1s ease',
          }}
        >
          +
        </button>

      </div>
    </div>
  )
}

export default App