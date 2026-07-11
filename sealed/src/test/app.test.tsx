import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { saveDeck } from '../data/deckStore'
import { db } from '../data/db'

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.cards.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /dmgctrl · sealed/i })).toBeInTheDocument()
  })

  it('shows the build tag (dev: bottom-right badge), not in the header (#332)', () => {
    render(<App />)
    expect(screen.getByTestId('build-tag')).toHaveTextContent(/b\d+/)
    // In dev the tag is a corner badge, no longer inside the header.
    expect(within(screen.getByRole('banner')).queryByTestId('build-tag')).toBeNull()
  })

  it('shows an Exit button in the header on the game screen that returns to decks (#332)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    const user = userEvent.setup()
    saveDeck({ name: 'Ready Deck', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<App />)

    const row = within(screen.getByTestId('deck-list')).getByText('Ready Deck').closest('li')!
    await user.click(within(row).getByRole('button', { name: /^play$/i }))

    // Now on the game screen — the header shows Exit (next to Help); clicking it returns to decks.
    const exit = within(screen.getByRole('banner')).getByTestId('exit-btn')
    await user.click(exit)
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  it('shows the dmgCtrl icon left of the title', () => {
    render(<App />)
    const icon = screen.getByRole('img', { name: /dmgctrl/i })
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('src', expect.stringContaining('dmgCtrl-icon-192.png'))
  })

  it('shows the deck selection screen initially', () => {
    render(<App />)
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  it('does not show the game screen initially', () => {
    render(<App />)
    expect(screen.queryByTestId('game-screen')).not.toBeInTheDocument()
  })

  it('opens help from the header and returns to the previous screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByTestId('help-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('deck-select-screen')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })
})
