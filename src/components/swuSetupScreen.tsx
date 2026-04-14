import { useState } from 'react'

const VALID_HEALTH_VALUES = [20, 25, 26, 27, 28, 30, 33, 34, 35]
const DEFAULT_HEALTH = 30

const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

interface Props {
  onConfirm: (health: number) => void
}

function SwuSetupScreen({ onConfirm }: Props) {
  const [input, setInput] = useState('')
  const handleSubmit = () => {
  if (input === '') {
    onConfirm(DEFAULT_HEALTH)
    return
  }
  onConfirm(parseInt(input, 10))
}
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

      {/* Content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3vh',
        width: 'clamp(280px, 40vw, 600px)',
      }}>

        <h1 style={{
          color: '#ffffff',
          fontWeight: '300',
          fontSize: 'clamp(1.2rem, 4vw, 2.5rem)',
          letterSpacing: '0.1em',
          margin: 0,
          textAlign: 'center',
        }}>
          Enter Base Health
        </h1>

        {/* Picker and button on same row */}
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          gap: '2vw',
        }}>
          <select
            value={input}
            onChange={e => setInput(e.target.value)}
            style={{
              flex: 1,
              padding: '1.5vh 2vw',
              fontSize: 'clamp(0.9rem, 2.5vw, 1.4rem)',
              fontWeight: '300',
              textAlign: 'center',
              background: 'transparent',
              border: '2px solid #4fc3f7',
              borderRadius: '12px',
              color: input === '' ? '#6b7280' : '#ffffff',
              outline: 'none',
              boxSizing: 'border-box',
              boxShadow: '0 0 12px rgba(79, 195, 247, 0.3)',
              WebkitAppearance: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="" disabled style={{ color: '#6b7280', background: '#0a0e1a' }}>
              Select base health
            </option>
            {VALID_HEALTH_VALUES.map(v => (
              <option key={v} value={v} style={{ color: '#ffffff', background: '#0a0e1a' }}>
                {v}
              </option>
            ))}
          </select>

          <button
            onClick={handleSubmit}
            style={{
              padding: '0',
              width: '12vw',
              height: '12vw',
              minWidth: '44px',
              minHeight: '44px',
              flexShrink: 0,
              fontSize: 'clamp(1rem, 3vw, 1.8rem)',
              fontWeight: '300',
              background: 'transparent',
              color: '#ffffff',
              border: '2px solid #ffffff',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 0 12px rgba(255, 255, 255, 0.2)',
              WebkitTapHighlightColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  )
}

export default SwuSetupScreen