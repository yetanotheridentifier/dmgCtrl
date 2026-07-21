import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CardRef, DescribedParts } from '../components/cardRef'
import { state, card, CARDS } from './helpers/engineFixtures'
import type { DescribePart } from '../utils/describeAction'

afterEach(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false, altKey: false }))

const s = state({ cards: { ...CARDS, REF: card({ id: 'REF', name: 'Referenced Card', type: 'unit' }) } })

describe('CardRef', () => {
  it('zooms on plain hover — no Shift, unlike board cards', () => {
    render(<CardRef state={s} cardId="REF" controller="player" text="Referenced Card" />)
    const ref = screen.getByTestId('card-ref')
    expect(screen.queryByTestId('card-zoom')).toBeNull()

    fireEvent.pointerEnter(ref, { pointerType: 'mouse' })
    const zoom = screen.getByTestId('card-zoom')
    // Visible and measured against the reference, not left hidden (see #367).
    expect(zoom.style.visibility).not.toBe('hidden')
    expect(zoom.style.left).toMatch(/px$/)

    fireEvent.pointerLeave(ref, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull()
  })

  it('colours by controller, matching the log’s actor colours, and reads as bold', () => {
    const { rerender } = render(<CardRef state={s} cardId="REF" controller="player" text="Referenced Card" />)
    expect(screen.getByTestId('card-ref')).toHaveClass('text-accent', 'font-semibold')

    rerender(<CardRef state={s} cardId="REF" controller="opponent" text="Referenced Card" />)
    expect(screen.getByTestId('card-ref')).toHaveClass('text-amber')
  })

  it('is not a link — nothing to navigate to, so no anchor for a screen reader to announce', () => {
    render(<CardRef state={s} cardId="REF" controller="player" text="Referenced Card" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('card-ref').tagName).toBe('SPAN')
  })
})

describe('DescribedParts', () => {
  const parts: DescribePart[] = ['Play ', { cardId: 'REF', controller: 'player', text: 'Referenced Card' }, ' (2)']

  it('renders plain text as text and card tokens as references', () => {
    render(<DescribedParts state={s} parts={parts} />)
    expect(screen.getByTestId('described-parts')).toHaveTextContent('Play Referenced Card (2)')
    expect(screen.getAllByTestId('card-ref')).toHaveLength(1)
  })

  it('renders an all-text description with no references at all', () => {
    render(<DescribedParts state={s} parts={['Pass']} />)
    expect(screen.queryByTestId('card-ref')).toBeNull()
    expect(screen.getByTestId('described-parts')).toHaveTextContent('Pass')
  })
})
