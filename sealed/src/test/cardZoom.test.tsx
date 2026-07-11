import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useCardZoom } from '../components/useCardZoom'
import { CardZoomPopover } from '../components/cardZoom'
import type { EngineCard } from '../engine/types'

function Harness({ onClick }: { onClick?: () => void }) {
  const { zoomed, bind } = useCardZoom()
  return (
    <button data-testid="card" onClick={onClick} {...bind}>
      {zoomed ? 'ZOOM' : 'idle'}
    </button>
  )
}

// Modifier keys are shared module state; release them after each test.
afterEach(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false, altKey: false }))

describe('useCardZoom (#321)', () => {
  it('zooms on Shift + mouse hover, not on hover alone', () => {
    render(<Harness />)
    const el = screen.getByTestId('card')
    fireEvent.pointerEnter(el, { pointerType: 'mouse' })
    expect(el).toHaveTextContent('idle') // hovering without Shift must not zoom
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(el).toHaveTextContent('ZOOM')
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
    expect(el).toHaveTextContent('idle')
  })

  it('restores when the mouse leaves even while Shift is held', () => {
    render(<Harness />)
    const el = screen.getByTestId('card')
    fireEvent.pointerEnter(el, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(el).toHaveTextContent('ZOOM')
    fireEvent.pointerLeave(el, { pointerType: 'mouse' })
    expect(el).toHaveTextContent('idle')
  })

  it('does NOT zoom on focus — focus persisted and left the zoom stuck on for leaders/bases (#321)', () => {
    render(<Harness />)
    const el = screen.getByTestId('card')
    fireEvent.focus(el)
    expect(el).toHaveTextContent('idle')
    // ...and Shift+hover still zooms afterwards (the stuck state is gone).
    fireEvent.pointerEnter(el, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(el).toHaveTextContent('ZOOM')
  })

  describe('touch long-press', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('zooms after a long press and restores on release', () => {
      render(<Harness />)
      const el = screen.getByTestId('card')
      fireEvent.pointerDown(el, { pointerType: 'touch' })
      expect(el).toHaveTextContent('idle')
      act(() => { vi.advanceTimersByTime(400) })
      expect(el).toHaveTextContent('ZOOM')
      fireEvent.pointerUp(el, { pointerType: 'touch' })
      expect(el).toHaveTextContent('idle')
    })

    it('a quick tap does not zoom and still fires the click', () => {
      const onClick = vi.fn()
      render(<Harness onClick={onClick} />)
      const el = screen.getByTestId('card')
      fireEvent.pointerDown(el, { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(100) }) // released before the long-press threshold
      fireEvent.pointerUp(el, { pointerType: 'touch' })
      fireEvent.click(el)
      expect(el).toHaveTextContent('idle')
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('suppresses the click that follows a long press (so it does not also play/attack)', () => {
      const onClick = vi.fn()
      render(<Harness onClick={onClick} />)
      const el = screen.getByTestId('card')
      fireEvent.pointerDown(el, { pointerType: 'touch' })
      act(() => { vi.advanceTimersByTime(400) })
      fireEvent.pointerUp(el, { pointerType: 'touch' })
      fireEvent.click(el)
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})

const LEADER: EngineCard = {
  id: 'ASH_001',
  name: 'Ahsoka Tano',
  type: 'leader',
  cost: 6,
  aspects: [],
  traits: [],
  keywords: [],
  unique: true,
  frontArt: 'https://cdn.swu-db.com/images/cards/ASH/001.png',
  backArt: 'https://cdn.swu-db.com/images/cards/ASH/001-b.png',
}

describe('CardZoomPopover (#321)', () => {
  it('renders the card at full zoom size (240px short edge), upright', () => {
    const unit: EngineCard = { ...LEADER, type: 'unit', backArt: undefined }
    render(<CardZoomPopover card={unit} />)
    expect(screen.getByTestId('card-zoom')).toBeInTheDocument()
    // Portrait card at full size: 240 wide (its short edge).
    expect(screen.getByTestId('card-face')).toHaveStyle({ width: '240px', height: '336px' })
  })

  it('shows a leader’s other side while Alt is held (Shift is the zoom trigger)', () => {
    // Undeployed leader → front (leader) side by default.
    render(<CardZoomPopover card={LEADER} deployed={false} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/ASH/001.png')

    act(() => { fireEvent.keyDown(window, { key: 'Alt', altKey: true }) })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/ASH/001-b.png')

    act(() => { fireEvent.keyUp(window, { key: 'Alt', altKey: false }) })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/ASH/001.png')
  })

  it('Alt does nothing for a single-sided (non-leader) card', () => {
    const unit: EngineCard = { ...LEADER, type: 'unit', backArt: undefined }
    render(<CardZoomPopover card={unit} />)
    const before = screen.getByRole('img').getAttribute('src')
    act(() => { fireEvent.keyDown(window, { key: 'Alt', altKey: true }) })
    expect(screen.getByRole('img')).toHaveAttribute('src', before!)
  })
})
