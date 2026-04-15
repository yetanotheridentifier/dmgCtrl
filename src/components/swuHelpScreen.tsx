const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

interface Props {
  onBack: () => void
}

function SwuHelpScreen({ onBack }: Props) {
  const headingStyle = {
    color: '#4fc3f7',
    fontWeight: '300',
    fontSize: 'clamp(1rem, 5vw, 1.3rem)',
    letterSpacing: '0.05em',
    margin: '0 0 0.75em 0',
    paddingBottom: '0.4em',
    borderBottom: '1px solid rgba(79, 195, 247, 0.3)',
  }

  const bodyStyle = {
    color: '#d0d0d8',
    fontWeight: '300',
    fontSize: 'clamp(0.9rem, 4vw, 1.05rem)',
    lineHeight: 1.65,
    margin: '0 0 0.6em 0',
  }

  const sectionStyle = {
    marginBottom: '2em',
  }

  const listStyle = {
    color: '#d0d0d8',
    fontWeight: '300',
    fontSize: 'clamp(0.9rem, 4vw, 1.05rem)',
    lineHeight: 1.65,
    margin: '0 0 0.6em 0',
    paddingLeft: '1.4em',
  }

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

      {/* Scrollable content — starts below the solid zone, first lines enter the fade */}
      <div
        data-testid="help-content"
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
      >

        <div style={sectionStyle}>
          <h2 style={headingStyle}>Getting Started</h2>
          <p style={bodyStyle}>
            Open the app and you'll see the <strong style={{ color: '#ffffff', fontWeight: '400' }}>Select Base</strong> screen.
            Use the three dropdowns to find your base:
          </p>
          <ol style={listStyle}>
            <li><strong style={{ color: '#ffffff', fontWeight: '400' }}>Set</strong> — the set your base is from</li>
            <li><strong style={{ color: '#ffffff', fontWeight: '400' }}>Aspect</strong> — the base's aspect (Aggression, Command, Cunning, Vigilance, or None)</li>
            <li><strong style={{ color: '#ffffff', fontWeight: '400' }}>Base</strong> — your specific base, shown with its name, subtitle, and HP</li>
          </ol>
          <p style={bodyStyle}>
            If only one option is available at any step it is selected automatically.
            Once a base is selected, a preview of the card art appears below the dropdowns.
            Tap <strong style={{ color: '#ffffff', fontWeight: '400' }}>&gt;</strong> to start the game.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={headingStyle}>During a Game</h2>
          <p style={bodyStyle}>
            Rotate your phone to <strong style={{ color: '#ffffff', fontWeight: '400' }}>landscape</strong> for the best view.
            The base card fills the screen with the damage counter overlaid across the middle.
          </p>
          <ul style={listStyle}>
            <li>Tap <strong style={{ color: '#ffffff', fontWeight: '400' }}>+</strong> to add 1 damage</li>
            <li>Tap <strong style={{ color: '#ffffff', fontWeight: '400' }}>−</strong> to remove 1 damage (won't go below zero)</li>
            <li><strong style={{ color: '#ffffff', fontWeight: '400' }}>Remaining</strong> shows your starting HP minus damage taken so far</li>
          </ul>
          <p style={bodyStyle}>
            To return to base selection, tap <strong style={{ color: '#ffffff', fontWeight: '400' }}>&lt;</strong> in the top-left corner.
            This resets the damage counter to zero, ready for the next game.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={headingStyle}>Hyperspace Variant</h2>
          <p style={bodyStyle}>
            Some bases have a Hyperspace variant with alternate card art.
            When available, a toggle appears below the card preview on the setup screen.
          </p>
          <ul style={listStyle}>
            <li>Enable the toggle to use Hyperspace art during the game</li>
            <li>Disable it to use the standard art</li>
            <li>Your preference is saved automatically between sessions</li>
          </ul>
          <p style={bodyStyle}>
            If the Hyperspace image can't be loaded, the app will fall back to the standard art and let you know.
            If neither image is available, the base name and epic action text are shown instead.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={headingStyle}>Formats and Base Selection</h2>
          <p style={bodyStyle}>
            The Set and Aspect dropdowns help narrow down which base you're playing.
            Star Wars Unlimited has multiple sets, each containing bases with different aspects and HP values.
            Only bases are shown — leader cards are not tracked by this app.
          </p>
          <p style={{ ...bodyStyle, color: '#a8a8b3', fontStyle: 'italic' }}>
            Note: all bases across all sets are currently shown regardless of format.
            Format filtering — limiting the list to bases legal in your chosen format — is planned for a future update.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={headingStyle}>Troubleshooting</h2>

          <p style={{ ...bodyStyle, color: '#ffffff', fontWeight: '400', marginBottom: '0.2em' }}>
            Base art isn't loading
          </p>
          <p style={{ ...bodyStyle, marginBottom: '1em' }}>
            Check your connection and try refreshing the page. The app needs an internet connection on first load to fetch card data. Once loaded, data is cached on your device for 24 hours.
          </p>

          <p style={{ ...bodyStyle, color: '#ffffff', fontWeight: '400', marginBottom: '0.2em' }}>
            The wrong base is showing
          </p>
          <p style={{ ...bodyStyle, marginBottom: '1em' }}>
            Tap <strong style={{ color: '#ffffff', fontWeight: '400' }}>&lt;</strong> on the game screen to return to setup and make a new selection.
          </p>

          <p style={{ ...bodyStyle, color: '#ffffff', fontWeight: '400', marginBottom: '0.2em' }}>
            Card art isn't loading
          </p>
          <p style={{ ...bodyStyle, marginBottom: '1em' }}>
            The app will show the base name and game text in place of the card art — all game functions still work normally.
          </p>

          <p style={{ ...bodyStyle, color: '#ffffff', fontWeight: '400', marginBottom: '0.2em' }}>
            Newly previewed bases not showing
          </p>
          <p style={bodyStyle}>
            Card data refreshes automatically every 24 hours. If a new base from spoiler season is not appearing, try again once published to https://starwarsunlimited.com/ and wait for the cache to refresh.
          </p>
        </div>

      </div>
    </div>
  )
}

export default SwuHelpScreen
