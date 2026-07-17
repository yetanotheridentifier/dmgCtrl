import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { CardSelectOverlay } from '../components/gameScreen'
import { state } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'

/** Reusable "select a card" overlay (#348) — Vane's choose-an-upgrade picker. */
describe('CardSelectOverlay', () => {
  const s = state()
  const items = [
    { cardId: 'TST_U1', optionIndex: 0 },
    { cardId: TOKEN_ADVANTAGE, optionIndex: 1 }, // a token upgrade — must be selectable
  ]

  it('renders each candidate with a Select button and reports the picked option index', () => {
    const onPick = vi.fn()
    render(<CardSelectOverlay state={s} prompt="Choose an upgrade to defeat" items={items} onPick={onPick} />)
    const overlay = screen.getByTestId('card-select-overlay')
    expect(screen.getByTestId('card-select-prompt')).toHaveTextContent(/choose an upgrade/i)
    expect(within(overlay).getAllByTestId('card-face')).toHaveLength(2) // token art included
    fireEvent.click(screen.getByTestId('card-select-1'))
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('shows a Cancel button only when the choice is optional (onCancel provided)', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<CardSelectOverlay state={s} prompt="Choose" items={items} onPick={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('card-select-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()

    rerender(<CardSelectOverlay state={s} prompt="Choose" items={items} onPick={vi.fn()} />)
    expect(screen.queryByTestId('card-select-cancel')).toBeNull()
  })

  it('reveals disabled items (dimmed, not clickable) — the Armorer "look at your resources" case', () => {
    const onPick = vi.fn()
    // key identifies each item (resource index); a non-upgrade resource is revealed but disabled.
    const revealItems = [
      { cardId: 'TST_U1', optionIndex: 0, key: 0 },
      { cardId: 'TST_U2', optionIndex: -1, disabled: true, key: 1 },
    ]
    render(<CardSelectOverlay state={s} prompt="Play an upgrade from your resources" items={revealItems} onPick={onPick} />)
    expect(screen.getByTestId('card-select-1')).toBeDisabled() // revealed but not selectable
    fireEvent.click(screen.getByTestId('card-select-1'))
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('card-select-0'))
    expect(onPick).toHaveBeenCalledWith(0)
  })
})
