import type { GameLogEntry } from '../hooks/useGameLog'

interface Props {
  entries: GameLogEntry[]
  onUndo: () => void
}

function GameLogOverlay({ entries, onUndo }: Props) {
  return (
    <div
      data-testid="log-overlay"
      style={{
        position: 'absolute',
        bottom: 'calc(env(safe-area-inset-bottom) + 9vw)',
        right: 'calc(env(safe-area-inset-right) + 2vw)',
        width: 'clamp(200px, 28vw, 360px)',
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        border: '2px solid var(--color-ui-border)',
        borderRadius: '8px',
        zIndex: 20,
        padding: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
      }}
    >
      {entries.length === 0 && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'clamp(0.7rem, 1.5vw, 0.9rem)', padding: '0.25rem' }}>
          No actions yet
        </span>
      )}
      {entries.map((entry, i) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            padding: '0.2rem 0.25rem',
            borderRadius: '4px',
            background: i === entries.length - 1 ? 'rgba(255,255,255,0.05)' : 'transparent',
          }}
        >
          <span style={{ color: entry.color, fontSize: 'clamp(0.7rem, 1.5vw, 0.9rem)', flex: 1 }}>
            {entry.message}
          </span>
          {i === entries.length - 1 && (
            <button
              data-testid="log-undo-btn"
              onClick={onUndo}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-ui-border)',
                borderRadius: '4px',
                color: 'var(--color-text-muted)',
                fontSize: 'clamp(0.6rem, 1.2vw, 0.8rem)',
                cursor: 'pointer',
                padding: '0.1rem 0.4rem',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default GameLogOverlay