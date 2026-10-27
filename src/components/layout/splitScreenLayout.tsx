import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  top: ReactNode
  topLabel: string
  middle: ReactNode
  bottom: ReactNode
  bottomLabel: string
}

// How far the screen is turned from the phone's natural (portrait) orientation, in degrees.
function screenAngle(): number {
  const angle = window.screen.orientation?.angle
  if (typeof angle === 'number') return angle
  const legacy = (window as { orientation?: number }).orientation
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0
}

function useScreenAngle(): number {
  const [angle, setAngle] = useState(screenAngle)
  useEffect(() => {
    const update = () => setAngle(screenAngle())
    const orientation = window.screen.orientation
    orientation?.addEventListener('change', update)
    window.addEventListener('orientationchange', update)
    return () => {
      orientation?.removeEventListener('change', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return angle
}

const half = (turned: boolean): React.CSSProperties => ({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  boxSizing: 'border-box',
  // The frame keeps the screen edges; a half adds space only towards the middle (its own top).
  paddingTop: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  // Each half sizes its contents from its own box (container query units).
  containerType: 'size',
  ...(turned ? { transform: 'rotate(180deg)' } : {}),
})

// Screen edges in the order of CSS sides (top, right, bottom, left). Turned by -angle, the frame's side i
// lies along screen edge i - angle / 90, and is padded by that edge's token.
const EDGES = ['top', 'right', 'bottom', 'left']
function framePadding(angle: number): React.CSSProperties {
  const edge = (i: number) => `var(--edge-${EDGES[(i - Math.round(angle / 90) + 8) % 4]})`
  return { paddingTop: edge(0), paddingRight: edge(1), paddingBottom: edge(2), paddingLeft: edge(3) }
}

// One phone shared between two players facing each other: the screen splits into two halves with a
// strip between them, and the top half is turned round to face the far player. The split stays put on
// the phone whatever orientation it reports, because a phone lying flat flips unreliably: when the
// screen turns to landscape, the whole layout turns back against it.
function SplitScreenLayout({ top, topLabel, middle, bottom, bottomLabel }: Props) {
  const angle = useScreenAngle()
  const turned = angle % 180 !== 0

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div
        data-testid="split-screen"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: turned ? '100vh' : '100vw',
          height: turned ? '100vw' : '100vh',
          transform: angle ? `translate(-50%, -50%) rotate(-${angle}deg)` : 'translate(-50%, -50%)',
          boxSizing: 'border-box',
          ...framePadding(angle),
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <section aria-label={topLabel} style={half(true)}>{top}</section>
        {middle}
        <section aria-label={bottomLabel} style={half(false)}>{bottom}</section>
      </div>
    </div>
  )
}

export default SplitScreenLayout
