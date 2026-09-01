// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { saveDeck } from '../data/deckStore'
import { db } from '../data/db'
import type { SwuCard } from '../data/cards'

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '4', HP: '3' },
]

/**
 * Start a real game through the deck screen. The cards are seeded so no network is needed;
 * with one saved deck the opponent picker mirrors it.
 */
async function startGame(user: ReturnType<typeof userEvent.setup>) {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
  saveDeck({ name: 'Playable', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_900', count: 30 }] })
  render(<App />)

  const row = within(screen.getByTestId('deck-list')).getByText('Playable').closest('li')!
  await user.click(within(row).getByRole('button', { name: /^play$/i }))
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
}

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.cards.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /dmgctrl/i })).toBeInTheDocument()
  })

  it('shows the release (dev: fixed bottom-right badge), not in the header', () => {
    render(<App />)
    const tag = screen.getByTestId('build-tag')
    // A release number in CI, or a `dev-` marker locally. Never a bare counter: that was the old
    // BUILD_TAG, which said nothing about which code was running.
    expect(tag).toHaveTextContent(/^(dev-[0-9a-f]+|\d+)$/)
    expect(tag).toHaveStyle({ position: 'fixed', right: '8px', bottom: '8px' })
    // In dev the tag is a corner badge, no longer inside the header.
    expect(within(screen.getByRole('banner')).queryByTestId('build-tag')).toBeNull()
  })

  it('exits the game via the dmgCtrl icon, returning to decks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    const user = userEvent.setup()
    saveDeck({ name: 'Ready Deck', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<App />)

    const row = within(screen.getByTestId('deck-list')).getByText('Ready Deck').closest('li')!
    await user.click(within(row).getByRole('button', { name: /^play$/i }))

    // On the game screen the dmgCtrl icon (in the log column header) is the exit
    // control; clicking it returns to decks.
    await user.click(screen.getByTestId('exit-btn'))
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  it('shows the transparent dmgCtrl icon left of the title', () => {
    render(<App />)
    const icon = screen.getByRole('img', { name: /dmgctrl/i })
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('src', expect.stringContaining('dmgCtrl-icon-transparent-192.png'))
  })

  it('shows the deck selection screen initially', () => {
    render(<App />)
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  it('does not show the game screen initially', () => {
    render(<App />)
    expect(screen.queryByTestId('game-screen')).not.toBeInTheDocument()
  })

  it('opens help from the header without leaving the current screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
    // The deck screen stays mounted underneath, rather than being replaced.
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()

    await user.click(screen.getByTestId('help-overlay'))
    expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  /**
   * #541: help used to be a screen, so opening it unmounted GameScreen and the game went with
   * it (the whole game lives in useGame's state and refs). Coming back started a *different*
   * game, with a fresh seed. Asserted on a decision already taken: a remounted game is back at
   * the mulligan, so the mulligan buttons reappearing is the defect.
   */
  it('leaves a game in progress alone when help is opened over it', async () => {
    const user = userEvent.setup()
    await startGame(user)

    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    expect(screen.queryByRole('button', { name: /keep hand/i })).toBeNull()
    const logBefore = screen.getByTestId('game-log').textContent

    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
    await user.click(screen.getByTestId('help-overlay'))

    // Still the same game: past the mulligan, same log, never remounted.
    expect(screen.getByTestId('game-board')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep hand/i })).toBeNull()
    expect(screen.getByTestId('game-log').textContent).toBe(logBefore)
  })

  /** #542: help is for the screen you opened it from. */
  it('shows the deck screen’s help from the deck screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /help/i }))
    const content = screen.getByTestId('help-content').innerHTML
    expect(content).toContain('Importing a deck')
    expect(content).not.toContain('Turn structure')
  })

  it('shows the game’s help from a game', async () => {
    const user = userEvent.setup()
    await startGame(user)

    await user.click(screen.getByRole('button', { name: /help/i }))
    const content = screen.getByTestId('help-content').innerHTML
    expect(content).toContain('Turn structure')
    expect(content).not.toContain('Importing a deck')
  })

  /** #539: settings open over whatever is on screen rather than replacing it. */
  it('opens settings from the header without leaving the current screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
    // The deck screen is still mounted underneath, not replaced.
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()

    await user.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()
  })

  it('keeps a setting changed from the header, across screens', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.selectOptions(screen.getByTestId('setting-base-health'), 'remaining')
    await user.click(screen.getByTestId('settings-close'))

    await user.click(screen.getByRole('button', { name: /help/i }))
    await user.click(screen.getByTestId('help-overlay'))
    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(screen.getByTestId('setting-base-health')).toHaveValue('remaining')
  })
})
