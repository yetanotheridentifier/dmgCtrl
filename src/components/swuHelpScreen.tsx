import helpHtml from '../../docs/help.md'
import AppScreenLayout from './layout/AppScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon } from './icons'

// Strip the <h1> from the rendered HTML — the title is provided by the JSX header instead.
const contentHtml = helpHtml.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '')

interface Props {
  onBack: () => void
}

function SwuHelpScreen({ onBack }: Props) {
  const { isPortrait, vmin } = useOrientation()
  const baseFontSize = `${Math.min(Math.max(14, Math.round(vmin * 0.04)), 18)}px`

  return (
    <AppScreenLayout>

      {/* Pinned header: title row + subtitle */}
      <div key={isPortrait ? 'portrait' : 'landscape'} style={{
        padding: '5vw 5vw 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '2vh',
        flexShrink: 0,
      }}>

        {/* Title row: back button + icon + heading */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '3vw',
          paddingBottom: '2vh',
        }}>
          <button
            onClick={onBack}
            aria-label="Back"
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
              fontSize: `clamp(0.8rem, ${vmin * 0.02}px, 1.2rem)`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
            }}
          >
            <BackIcon />
          </button>

          <img
            src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
            alt="dmgCtrl"
            style={{ height: `clamp(1.8rem, ${vmin * 0.08}px, 3rem)`, width: 'auto', flexShrink: 0 }}
          />

          <h1 style={{
            color: 'var(--color-text-primary)',
            fontWeight: '200',
            fontSize: `clamp(1.8rem, ${vmin * 0.08}px, 3rem)`,
            letterSpacing: '0.15em',
            margin: 0,
            lineHeight: 0.8,
          }}>
            Help
          </h1>
        </div>

      </div>

      {/* Scrollable content — driven from help.md at build time */}
      <div
        data-testid="help-content"
        className="help-content"
        style={{
          fontSize: baseFontSize,
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