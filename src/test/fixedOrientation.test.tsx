import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, renderHook } from '@testing-library/react'
import { LandscapeScreen, TurnedFrame } from '../components/layout/fixedOrientation'
import { Sheet } from '../components/shared/controls'
import { useOrientation } from '../hooks/useOrientation'
import { useCardDrag, useDragScrubber } from '../hooks/useDragScrubber'
import { makeMatchMediaMock } from './setup'

type Listener = () => void

function mockScreenAngle(angle: number) {
  const listeners: Listener[] = []
  const orientation = {
    angle,
    addEventListener: (_: string, l: Listener) => { listeners.push(l) },
    removeEventListener: (_: string, l: Listener) => { listeners.splice(listeners.indexOf(l), 1) },
  }
  Object.defineProperty(window.screen, 'orientation', { value: orientation, configurable: true })
}

// A viewport that can turn: a change fires the query's listeners, as a phone turning does.
function mockViewport(portrait: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = []
  let matches = portrait
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() { return matches && query === '(orientation: portrait)' },
      media: query,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { listeners.push(l) },
      removeEventListener: () => {},
    }),
  })
  return {
    turnTo: (toPortrait: boolean) => {
      matches = toPortrait
      act(() => { listeners.forEach(l => l({ matches: toPortrait })) })
    },
  }
}

const frame = () => screen.getByTestId('turned-frame')
const edges = () => ['top', 'right', 'bottom', 'left'].map(side => frame().style.getPropertyValue(`--edge-${side}`))

afterEach(() => {
  Object.defineProperty(window.screen, 'orientation', { value: undefined, configurable: true })
  makeMatchMediaMock()
})

describe('LandscapeScreen', () => {
  it('in landscape shows its screen upright, with each edge token its own screen edge', () => {
    mockViewport(false)
    mockScreenAngle(90)
    render(<LandscapeScreen><span>game</span></LandscapeScreen>)
    expect(frame().style.transform).not.toMatch(/rotate/)
    expect(frame()).toHaveStyle({ width: '100vw', height: '100vh' })
    expect(edges()).toEqual(['var(--screen-edge-top)', 'var(--screen-edge-right)', 'var(--screen-edge-bottom)', 'var(--screen-edge-left)'])
    expect(frame()).toHaveTextContent('game')
  })

  // No rotate prompt: a landscape screen held in portrait keeps its landscape layout, fixed to the
  // phone, turned a quarter so its top runs along the phone's right edge. Turning the phone puts it upright.
  it('in portrait turns its landscape layout a quarter, its top along the right edge of the phone', () => {
    mockViewport(true)
    mockScreenAngle(0)
    render(<LandscapeScreen><span>game</span></LandscapeScreen>)
    expect(frame().style.transform).toMatch(/rotate\(90deg\)/)
    expect(frame()).toHaveStyle({ width: '100vh', height: '100vw' })
    // Each side of the turned screen keeps clear of the screen edge it lies along.
    expect(edges()).toEqual(['var(--screen-edge-right)', 'var(--screen-edge-bottom)', 'var(--screen-edge-left)', 'var(--screen-edge-top)'])
  })

  it('held upside down in portrait turns the other way, so it still reads by turning the phone a quarter', () => {
    mockViewport(true)
    mockScreenAngle(180)
    render(<LandscapeScreen><span>game</span></LandscapeScreen>)
    expect(frame().style.transform).toMatch(/rotate\(-90deg\)/)
    expect(edges()).toEqual(['var(--screen-edge-left)', 'var(--screen-edge-top)', 'var(--screen-edge-right)', 'var(--screen-edge-bottom)'])
  })

  it('turns back upright when the phone turns to landscape', () => {
    const viewport = mockViewport(true)
    mockScreenAngle(0)
    render(<LandscapeScreen><span>game</span></LandscapeScreen>)
    expect(frame().style.transform).toMatch(/rotate/)
    viewport.turnTo(false)
    expect(frame().style.transform).not.toMatch(/rotate/)
  })

  // Sizes inside the screen (cqw, cqh) are read from the frame, so they follow its turned sides.
  it('is the size container its contents measure against', () => {
    mockViewport(true)
    render(<LandscapeScreen><span>game</span></LandscapeScreen>)
    expect(frame()).toHaveStyle({ containerType: 'size' })
  })

  it('inside a turned screen everything sees landscape, so a sheet opens from the side', () => {
    mockViewport(true)
    const Probe = () => <span>{useOrientation().isPortrait ? 'portrait' : 'landscape'}</span>
    render(
      <LandscapeScreen>
        <Probe />
        <Sheet open title="More" onClose={vi.fn()}><span>choices</span></Sheet>
      </LandscapeScreen>,
    )
    expect(screen.getByText('landscape')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'side')
    // The sheet is inside the frame, so it turns with the screen.
    expect(frame()).toContainElement(screen.getByRole('dialog'))
  })

  it('outside a turned screen, portrait is still portrait', () => {
    mockViewport(true)
    expect(renderHook(() => useOrientation()).result.current.isPortrait).toBe(true)
  })
})

// vw and vh measure the phone's screen, not a turned one: what draws on a landscape screen sizes by
// the frame (cqw, cqh, or a percentage) so it is the same upright and turned.
describe('sizes on a landscape screen', () => {
  const sources = import.meta.glob([
    '../components/swuGameScreenView.tsx', '../components/swuTwinSunsGameView.tsx', '../components/xwingGameScreenView.tsx',
    '../components/swuGamePieces.tsx', '../components/gameLogOverlay.tsx', '../components/shared/controls.tsx',
  ], { query: '?raw', import: 'default', eager: true })

  it('never read the viewport', () => {
    expect(Object.keys(sources)).toHaveLength(6)
    const viewportSized = Object.entries(sources).flatMap(([file, text]) =>
      String(text).split('\n')
        // The sheet's overhang runs on below the foot of the screen by a whole screen, on purpose.
        .filter(line => /\d(vw|vh|dvh|svh|lvh)\b/.test(line) && !line.includes('sheet-overhang'))
        .map(line => `${file}: ${line.trim()}`))
    expect(viewportSized).toEqual([])
  })
})

// Pointer events report screen coordinates; on a turned screen its own "up" lies along another
// screen direction, and a drag counts along that.
describe('drags on a turned screen', () => {
  const event = (clientX: number, clientY: number) =>
    ({ clientX, clientY, pointerId: 1, currentTarget: { setPointerCapture: vi.fn() } }) as unknown as React.PointerEvent<HTMLButtonElement>
  const turned = (turn: number) => ({ children }: { children: React.ReactNode }) => <TurnedFrame turn={turn}>{children}</TurnedFrame>

  it.each([
    [90, 'towards the right of the phone', [300, 100]],
    [-90, 'towards the left of the phone', [-100, 100]],
    [0, 'up the phone', [100, -100]],
  ])('with the screen turned %i, a drag %s adds', (turn, _, [x, y]) => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useCardDrag(vi.fn(), onIncrement, vi.fn(), 20, 20, true), { wrapper: turned(turn) })
    act(() => { result.current.onPointerDown(event(100, 100)) })
    act(() => { result.current.onPointerMove(event(x, y)) })
    act(() => { result.current.onPointerUp() })
    expect(onIncrement).toHaveBeenCalled()
  })

  it('a drag along the phone, across the turned screen, adds nothing', () => {
    const onIncrement = vi.fn()
    const onDecrement = vi.fn()
    const { result } = renderHook(() => useCardDrag(vi.fn(), onIncrement, onDecrement, 20, 20, true), { wrapper: turned(90) })
    act(() => { result.current.onPointerDown(event(100, 100)) })
    act(() => { result.current.onPointerMove(event(100, -100)) })
    act(() => { result.current.onPointerUp() })
    expect(onIncrement).not.toHaveBeenCalled()
    expect(onDecrement).not.toHaveBeenCalled()
  })

  it('the + button scrubs along the turned screen too, and a flipped one the other way', () => {
    const onIncrement = vi.fn()
    const { result } = renderHook(() => useDragScrubber(onIncrement, vi.fn(), 20, 20, true), { wrapper: turned(90) })
    act(() => { result.current.handlePointerDown('+')(event(100, 100)) })
    act(() => { result.current.handlePointerMove(event(300, 100)) })
    expect(result.current.dragIndicator?.value).toBeGreaterThan(1)
    const flipped = renderHook(() => useDragScrubber(vi.fn(), vi.fn(), 20, 20, true, true), { wrapper: turned(90) }).result
    act(() => { flipped.current.handlePointerDown('+')(event(100, 100)) })
    act(() => { flipped.current.handlePointerMove(event(300, 100)) })
    expect(flipped.current.dragIndicator).toBeNull()
  })
})
