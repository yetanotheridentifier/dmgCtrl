import helpHtml from '../help.md'

const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

// Strip the <h1> from the rendered HTML — the title is provided by the JSX header instead.
const contentHtml = helpHtml.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '')

interface Props {
  onBack: () => void
}

function SwuHelpScreen({ onBack }: Props) {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: starField,
      display: 'flex',
      flexDirection: 'column',
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

      {/* Header overlay — locked above the scroll, fades into content below */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 5,
        pointerEvents: 'none',
      }}>

        {/* Solid zone: back button + title */}
        <div style={{
          background: '#0a0e1a',
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '1vh 1vw 1rem',
          }}>

            <button
              onClick={onBack}
              style={{
                pointerEvents: 'auto',
                flexShrink: 0,
                width: 'max(36px, 5vw)',
                height: 'max(36px, 5vw)',
                background: 'transparent',
                border: '2px solid #6b7280',
                borderRadius: '8px',
                color: '#9ca3af',
                fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
              }}
            >
              &lt;
            </button>

            <h1 style={{
              flex: 1,
              textAlign: 'left',
              color: '#ffffff',
              fontWeight: '300',
              fontSize: 'clamp(1.1rem, 6vw, 1.5rem)',
              letterSpacing: '0.1em',
              margin: 0,
              paddingLeft: 5,
            }}>
              dmgCtrl: Help
            </h1>

            {/* Spacer — mirrors button width to keep title visually centred */}
            <div style={{ width: 'max(36px, 5vw)', flexShrink: 0 }} />

          </div>
        </div>

        {/* Fade zone — content scrolls up through this before being covered */}
        <div style={{
          height: '2.5rem',
          background: 'linear-gradient(to bottom, #0a0e1a, transparent)',
        }} />

      </div>

      {/* Scrollable content — driven from help.md at build time */}
      <div
        data-testid="help-content"
        className="help-content"
        style={{
          position: 'relative',
          zIndex: 1,
          overflowY: 'auto',
          flex: 1,
          paddingTop: 'calc(env(safe-area-inset-top) + 1vh + max(36px, 5vw) + 1rem + 2.5rem)',
          paddingRight: '5vw',
          paddingBottom: '5vw',
          paddingLeft: '5vw',
          boxSizing: 'border-box',
        }}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

    </div>
  )
}

export default SwuHelpScreen