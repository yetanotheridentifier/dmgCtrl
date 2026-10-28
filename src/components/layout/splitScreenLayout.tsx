import type { ReactNode } from 'react'
import { TurnedFrame } from './fixedOrientation'
import { useScreenAngle } from '../../hooks/useFrameTurn'

interface Props {
  top: ReactNode
  topLabel: string
  middle: ReactNode
  bottom: ReactNode
  bottomLabel: string
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

// One phone shared between two players facing each other: the screen splits into two halves with a
// strip between them, and the top half is turned round to face the far player. The split stays put on
// the phone whatever orientation it reports, because a phone lying flat flips unreliably: when the
// screen turns to landscape, the whole layout turns back against it.
function SplitScreenLayout({ top, topLabel, middle, bottom, bottomLabel }: Props) {
  const angle = useScreenAngle()

  return (
    <TurnedFrame
      turn={-angle}
      testId="split-screen"
      style={{
        paddingTop: 'var(--edge-top)',
        paddingRight: 'var(--edge-right)',
        paddingBottom: 'var(--edge-bottom)',
        paddingLeft: 'var(--edge-left)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <section aria-label={topLabel} style={half(true)}>{top}</section>
      {middle}
      <section aria-label={bottomLabel} style={half(false)}>{bottom}</section>
    </TurnedFrame>
  )
}

export default SplitScreenLayout
