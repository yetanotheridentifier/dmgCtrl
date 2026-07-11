import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { UnitLine } from '../components/gameScreen'
import type { UnitInteraction } from '../components/gameScreen'
import { state, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

const noInteract: UnitInteraction = { actionable: false, selected: false, isTarget: false }

function boardWith(id: string): GameState {
  return state({ cards: { ...CARDS, [id]: card({ id, type: 'unit', power: 3, hp: 4 }) } })
}

describe('UnitLine — on-card damage overlay (#326)', () => {
  it('overlays a damaged unit’s damage as a red token with white text', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 2 })} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-damage-u1')
    expect(token).toHaveTextContent('2')
    expect(token).toHaveStyle({ background: 'var(--color-red)', color: '#fff' })
  })

  it('shows no damage overlay at 0 damage', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 0 })} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-damage-u1')).toBeNull()
  })

  it('keeps the damage overlay outside the rotatable card face so it stays upright when exhausted', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 3, exhausted: true })} interact={noInteract} />)
    const face = screen.getByTestId('card-face')
    // The exhausted card face is rotated 90°; the damage number must not live inside it.
    expect(within(face).queryByTestId('board-unit-damage-u1')).toBeNull()
    expect(screen.getByTestId('board-unit-damage-u1')).toBeInTheDocument()
  })

  it('zooms the card to full size on Shift+hover, and removes it on leave (#321)', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { exhausted: true })} interact={noInteract} />)
    const tile = screen.getByTestId('board-unit-u1')

    fireEvent.pointerEnter(tile, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull() // hover alone: no zoom

    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    const zoom = screen.getByTestId('card-zoom')
    // Full size and upright even though the source unit is exhausted (rotated).
    expect(within(zoom).getByTestId('card-face')).toHaveStyle({ width: '240px' })
    expect(within(zoom).getByTestId('card-face')).toHaveAttribute('data-orientation', 'portrait')

    fireEvent.pointerLeave(tile, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull()
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
  })

  it('does not render the old bottom power/health line for a unit with art-backed stats', () => {
    // A card WITH art renders no textual fallback; the board tile should carry no
    // "power/health" readout of its own any more — that lives on the card art (#326).
    const s = state({ cards: { ...CARDS, TST_A: card({ id: 'TST_A', type: 'unit', power: 3, hp: 4, frontArt: 'https://cdn.swu-db.com/images/cards/TST/A.png' }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_A', { damage: 0 })} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-u1')).not.toHaveTextContent('3/4')
  })
})
