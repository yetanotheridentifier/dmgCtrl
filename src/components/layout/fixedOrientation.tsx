import type { CSSProperties, ReactNode } from 'react'
import { useOrientation } from '../../hooks/useOrientation'
import { FrameTurn, useScreenAngle } from '../../hooks/useFrameTurn'

// Screen edges in the order of CSS sides (top, right, bottom, left). Turned clockwise by `turn`, the
// frame's side i lies along screen edge i + turn / 90, so its edge token is that screen edge's.
const EDGES = ['top', 'right', 'bottom', 'left']
function edgeTokens(turn: number): CSSProperties {
  const quarter = Math.round(turn / 90)
  return Object.fromEntries(EDGES.map((side, i) => [`--edge-${side}`, `var(--screen-edge-${EDGES[(((i + quarter) % 4) + 4) % 4]})`]))
}

interface FrameProps {
  turn: number
  children: ReactNode
  testId?: string
  style?: CSSProperties
}

// A screen fixed to the phone rather than to the orientation it reports: the frame fills the screen,
// turned clockwise by `turn` degrees. Everything inside turns with it: fixed layers (sheets, dialogs)
// are fixed to the frame, sizes in cqw and cqh are the frame's, the edge tokens keep each side clear
// of the screen edge it lies along, and orientation and drags read the frame's turn.
export function TurnedFrame({ turn, children, testId = 'turned-frame', style }: FrameProps) {
  const sideways = turn % 180 !== 0
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div
        data-testid={testId}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: sideways ? '100vh' : '100vw',
          height: sideways ? '100vw' : '100vh',
          transform: turn ? `translate(-50%, -50%) rotate(${turn}deg)` : 'translate(-50%, -50%)',
          boxSizing: 'border-box',
          containerType: 'size',
          ...edgeTokens(turn),
          ...style,
        }}
      >
        <FrameTurn.Provider value={turn}>{children}</FrameTurn.Provider>
      </div>
    </div>
  )
}

// A screen with a landscape layout only. Held in portrait, it stays landscape on the phone, turned a
// quarter so the player turns the phone to read it: its top runs along the phone's right edge, or its
// left edge when the phone is upside down, so a quarter turn either way puts it upright.
export function LandscapeScreen({ children }: { children: ReactNode }) {
  const { isPortrait } = useOrientation()
  const angle = useScreenAngle()
  const turn = !isPortrait ? 0 : angle === 180 ? -90 : 90
  return <TurnedFrame turn={turn}>{children}</TurnedFrame>
}
