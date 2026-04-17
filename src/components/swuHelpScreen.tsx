import helpHtml from '../help.md'
import AppScreenLayout from './layout/AppScreenLayout'

// Strip the <h1> from the rendered HTML — the title is provided by the JSX header instead.
const contentHtml = helpHtml.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '')

interface Props {
  onBack: () => void
}

function SwuHelpScreen({ onBack }: Props) {
  return (
    <AppScreenLayout>

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

    </AppScreenLayout>
  )
}

export default SwuHelpScreen