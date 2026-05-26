import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InitiativeToggle from '../components/initiativeToggle'

describe('InitiativeToggle', () => {

  // --- Rendering ---

  it('renders the OPP label', () => {
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByText('OPP')).toBeInTheDocument()
  })

  it('renders the YOU label', () => {
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByText('YOU')).toBeInTheDocument()
  })

  it('renders the sliding indicator', () => {
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toBeInTheDocument()
  })

  it('renders a static INIT label in the bar', () => {
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByText('INIT')).toBeInTheDocument()
    expect(screen.getByTestId('initiative-indicator')).not.toHaveTextContent('INIT')
  })

  it('indicator shows "OPP" text when opponent has initiative', () => {
    render(<InitiativeToggle initiative="opponent" onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveTextContent('OPP')
  })

  it('indicator shows "YOU" text when player has initiative', () => {
    render(<InitiativeToggle initiative="player" onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveTextContent('YOU')
  })

  // --- Indicator position ---

  it('indicator has data-position="none" when initiative is null', () => {
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'none')
  })

  it('indicator has data-position="opponent" when initiative is opponent', () => {
    render(<InitiativeToggle initiative="opponent" onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('indicator has data-position="player" when initiative is player', () => {
    render(<InitiativeToggle initiative="player" onSetOpponent={vi.fn()} onSetPlayer={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

  // --- Tap zones ---

  it('tapping the OPP zone calls onSetOpponent', async () => {
    const user = userEvent.setup()
    const onSetOpponent = vi.fn()
    render(<InitiativeToggle initiative={null} onSetOpponent={onSetOpponent} onSetPlayer={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(onSetOpponent).toHaveBeenCalledOnce()
  })

  it('tapping the YOU zone calls onSetPlayer', async () => {
    const user = userEvent.setup()
    const onSetPlayer = vi.fn()
    render(<InitiativeToggle initiative={null} onSetOpponent={vi.fn()} onSetPlayer={onSetPlayer} />)
    await user.click(screen.getByTestId('initiative-you-zone'))
    expect(onSetPlayer).toHaveBeenCalledOnce()
  })

  it('tapping the OPP zone again (when already opponent) calls onSetOpponent', async () => {
    const user = userEvent.setup()
    const onSetOpponent = vi.fn()
    render(<InitiativeToggle initiative="opponent" onSetOpponent={onSetOpponent} onSetPlayer={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(onSetOpponent).toHaveBeenCalledOnce()
  })

})
