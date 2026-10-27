import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SplitScreenLayout from '../components/layout/splitScreenLayout'

type Listener = () => void

function mockScreenAngle(angle: number) {
  const listeners: Listener[] = []
  const orientation = {
    angle,
    addEventListener: (_: string, l: Listener) => { listeners.push(l) },
    removeEventListener: (_: string, l: Listener) => { listeners.splice(listeners.indexOf(l), 1) },
  }
  Object.defineProperty(window.screen, 'orientation', { value: orientation, configurable: true })
  return {
    turnTo: (a: number) => {
      orientation.angle = a
      act(() => { listeners.forEach(l => l()) })
    },
  }
}

const renderLayout = () => render(
  <SplitScreenLayout
    top={<span>top</span>}
    topLabel="Theirs"
    middle={<span>middle</span>}
    bottom={<span>bottom</span>}
    bottomLabel="Yours"
  />,
)

const frame = () => screen.getByTestId('split-screen')

afterEach(() => {
  Object.defineProperty(window.screen, 'orientation', { value: undefined, configurable: true })
})

describe('SplitScreenLayout', () => {
  it('puts the top half, the middle and the bottom half in order, and turns only the top half round', () => {
    mockScreenAngle(0)
    renderLayout()
    const top = screen.getByRole('region', { name: 'Theirs' })
    const bottom = screen.getByRole('region', { name: 'Yours' })
    expect(top).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(bottom).not.toHaveStyle({ transform: 'rotate(180deg)' })
    expect(frame()).toHaveTextContent(/^topmiddlebottom$/)
  })

  it('stays upright on the phone in portrait', () => {
    mockScreenAngle(0)
    renderLayout()
    expect(frame().style.transform).not.toMatch(/rotate/)
  })

  // A phone lying flat flips its orientation unreliably: the halves stay where they are on the phone.
  it('turns against a landscape orientation, so the layout stays portrait on the phone', () => {
    const s = mockScreenAngle(0)
    renderLayout()
    s.turnTo(90)
    expect(frame().style.transform).toMatch(/rotate\(-90deg\)/)
    expect(frame()).toHaveStyle({ width: '100vh', height: '100vw' })
    s.turnTo(270)
    expect(frame().style.transform).toMatch(/rotate\(-270deg\)/)
    s.turnTo(0)
    expect(frame().style.transform).not.toMatch(/rotate/)
  })

  // The frame is turned, so each of its sides lies along a different screen edge: it pads each side by
  // the edge token of the screen edge it lies along, and the halves add space only towards the middle.
  it('pads each side by the edge token of the screen edge it lies along', () => {
    const s = mockScreenAngle(0)
    renderLayout()
    const sides = ['top', 'right', 'bottom', 'left']
    expect(sides.map(side => frame().style.getPropertyValue(`padding-${side}`)))
      .toEqual(['var(--edge-top)', 'var(--edge-right)', 'var(--edge-bottom)', 'var(--edge-left)'])
    // The frame points each edge token at the screen edge its side lies along.
    const edges = () => sides.map(side => frame().style.getPropertyValue(`--edge-${side}`))
    expect(edges()).toEqual(['var(--screen-edge-top)', 'var(--screen-edge-right)', 'var(--screen-edge-bottom)', 'var(--screen-edge-left)'])
    s.turnTo(90)
    expect(edges()).toEqual(['var(--screen-edge-left)', 'var(--screen-edge-top)', 'var(--screen-edge-right)', 'var(--screen-edge-bottom)'])
    s.turnTo(270)
    expect(edges()).toEqual(['var(--screen-edge-right)', 'var(--screen-edge-bottom)', 'var(--screen-edge-left)', 'var(--screen-edge-top)'])
    for (const name of ['Theirs', 'Yours']) {
      expect(screen.getByRole('region', { name })).toHaveStyle({ paddingTop: '8px', paddingLeft: '0px', paddingRight: '0px', paddingBottom: '0px' })
    }
  })
})
