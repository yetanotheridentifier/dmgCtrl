import { useRef, useState, useLayoutEffect } from 'react'
import type React from 'react'
import type { Initiative } from '../hooks/useInitiative'
import { BAR_LABEL_STYLE } from '../styles/barContainer'

interface Props {
  initiative: Initiative
  onSetOpponent: () => void
  onSetPlayer: () => void
  interactive?: boolean
}

// Counter height — slightly reduced so it clears OPP/YOU labels with breathing room
const COUNTER_H = 'max(4vw, 28px)'
const COUNTER_H_PX = () => Math.max(window.innerWidth * 0.04, 28)

// Optical correction: top appears more spacious than bottom at equal values,
// so OPP (top) uses a smaller raw value to achieve visual parity with YOU (bottom)
const INSET_TOP = '4px'
const INSET_BOTTOM = '6px'

const TINY: React.CSSProperties = { ...BAR_LABEL_STYLE, pointerEvents: 'none' }

function counterTop(initiative: Initiative): string {
  if (initiative === 'opponent') return INSET_TOP
  if (initiative === 'player')   return `calc(100% - ${COUNTER_H} - ${INSET_BOTTOM})`
  // neutral: centred — counter stays here but is invisible
  return `calc(50% - ${COUNTER_H} / 2)`
}

function InitiativeToggle({ initiative, onSetOpponent, onSetPlayer, interactive = true }: Props) {
  const active = initiative !== null
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Show the static INIT label only when the bar is tall enough to accommodate
  // it without overlapping the OPP/YOU counters (threshold: 3× counter height).
  // Defaults to true so the label shows in JSDOM (where getBoundingClientRect
  // returns 0 — we return early and keep the default).
  const [showInitLabel, setShowInitLabel] = useState(true)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (h === 0) return  // JSDOM or not yet laid out — keep default
      setShowInitLabel(h >= COUNTER_H_PX() * 3)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* Tap zones — only rendered when interactive (Planning phase or pre-game) */}
      {interactive && (
        <>
          <button
            data-testid="initiative-opp-zone"
            aria-label="Opponent initiative"
            onClick={onSetOpponent}
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: '50%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 3,
              WebkitTapHighlightColor: 'transparent',
            }}
          />
          <button
            data-testid="initiative-you-zone"
            aria-label="Player initiative"
            onClick={onSetPlayer}
            style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: '50%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 3,
              WebkitTapHighlightColor: 'transparent',
            }}
          />
        </>
      )}

      {/* OPP external label — fades out as counter slides over it */}
      <span style={{
        ...TINY,
        position: 'absolute',
        top: INSET_TOP,
        left: 0, right: 0,
        height: COUNTER_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)',
        opacity: initiative === 'opponent' ? 0 : 1,
        transition: 'opacity 0.15s',
        zIndex: 1,
      }}>
        OPP
      </span>

      {/* INIT — static middle label; identifies the bar; hidden when the bar is
          too short to show it without overlapping the OPP/YOU counters */}
      {showInitLabel && (
        <span style={{
          ...TINY,
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: 0, right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          zIndex: 1,
        }}>
          INIT
        </span>
      )}

      {/* YOU external label — fades out as counter slides over it */}
      <span style={{
        ...TINY,
        position: 'absolute',
        bottom: INSET_BOTTOM,
        left: 0, right: 0,
        height: COUNTER_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)',
        opacity: initiative === 'player' ? 0 : 1,
        transition: 'opacity 0.15s',
        zIndex: 1,
      }}>
        YOU
      </span>

      {/* Sliding counter — fades out when neutral, shows OPP/YOU when active */}
      <div
        data-testid="initiative-indicator"
        data-position={initiative ?? 'none'}
        style={{
          position: 'absolute',
          left: '10%',
          right: '10%',
          top: counterTop(initiative),
          height: COUNTER_H,
          transition: 'top 0.2s ease, opacity 0.15s, background 0.15s, border-color 0.15s',
          borderRadius: '6px',
          background: active
            ? 'rgba(var(--color-accent-rgb), 0.18)'
            : 'rgba(255,255,255,0.06)',
          border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-ui-border)'}`,
          boxShadow: active
            ? '0 0 8px rgba(var(--color-accent-rgb), 0.2)'
            : 'none',
          opacity: active ? 1 : 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <span style={{
          ...TINY,
          color: 'var(--color-accent)',
        }}>
          {initiative === 'opponent' ? 'OPP' : initiative === 'player' ? 'YOU' : ''}
        </span>
      </div>

    </div>
  )
}

export default InitiativeToggle
