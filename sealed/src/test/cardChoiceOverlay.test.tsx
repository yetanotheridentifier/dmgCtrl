import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { CardChoiceOverlay } from '../components/gameScreen'
import { card } from './helpers/engineFixtures'

/** The reusable centre-screen "look at a card" overlay. */
describe('CardChoiceOverlay', () => {
  it('shows the prompt, the card, and the action buttons', () => {
    const onPlay = vi.fn()
    render(
      <CardChoiceOverlay card={card({ id: 'TOPU', name: 'Scout', type: 'unit' })} cardId="TOPU" prompt="Look at the top card of your deck">
        <button data-testid="choice-btn-0" onClick={onPlay}>Play Scout free</button>
        <button>Don't play</button>
      </CardChoiceOverlay>,
    )
    const overlay = screen.getByTestId('card-choice-overlay')
    expect(screen.getByTestId('card-choice-prompt')).toHaveTextContent(/look at the top card/i)
    expect(within(overlay).getByTestId('card-face')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('choice-btn-0'))
    expect(onPlay).toHaveBeenCalledOnce()
  })
})
