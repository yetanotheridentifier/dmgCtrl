import helpHtml from '../../docs/help.md'
import AppScreenLayout from './layout/AppScreenLayout'

// Strip the <h1> from the rendered HTML — the title is provided by the JSX header instead.
const contentHtml = helpHtml.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '')

interface Props {
  onBack: () => void
}

function SwuHelpScreen({ onBack }: Props) {
  return (
    <AppScreenLayout>

      {/* Pinned header: title row + subtitle */}
      <div style={{
        padding: '5vw 5vw 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '2vh',
        flexShrink: 0,
      }}>

        {/* Title row: back button + app name */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '3vw',
        }}>
          <button
            onClick={onBack}
            style={{
              flexShrink: 0,
              width: '5vw',
              height: '5vw',
              minWidth: '36px',
              minHeight: '36px',
              background: 'transparent',
              border: '2px solid var(--color-ui-border)',
              borderRadius: '8px',
              color: 'var(--color-ui-border-muted)',
              fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
            }}
          >
            &lt;
          </button>

          <h1 style={{
            color: 'var(--color-text-primary)',
            fontWeight: '200',
            fontSize: 'clamp(1.8rem, 8vw, 3rem)',
            letterSpacing: '0.15em',
            margin: 0,
            lineHeight: 0.8,
          }}>
            dmgCtrl
          </h1>
        </div>

        <h2 style={{
          color: 'var(--color-accent)',
          fontWeight: '300',
          fontSize: 'clamp(0.9rem, 5vw, 1.2rem)',
          letterSpacing: '0.12em',
          margin: 0,
          paddingBottom: '2vh',
          textTransform: 'uppercase',
        }}>
          Help
        </h2>

      </div>

      {/* Scrollable content — driven from help.md at build time */}
      <div
        data-testid="help-content"
        className="help-content"
        style={{
          overflowY: 'auto',
          flex: 1,
          padding: '2vh 5vw 5vw',
          boxSizing: 'border-box',
        }}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

    </AppScreenLayout>
  )
}

export default SwuHelpScreen