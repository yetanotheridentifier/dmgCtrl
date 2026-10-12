// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { saveDeck } from '../data/deckStore'
import { db } from '../data/db'
import { defaultSettings, loadSettings, STORAGE_KEY as SETTINGS_KEY } from '../data/settingsStore'
import type { Settings } from '../data/settingsStore'
import type { SwuCard } from '../data/cards'

/**
 * The deck screen caches the set its generators are pointed at as soon as it opens, which would put
 * a real SWUDB call in the middle of every shell test. These tests are about the shell, so the
 * cache reads as empty and the fetch is a no-op: the seeded `TST_*` cards below are all they need.
 */
vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 0, total: 0 }),
  cachedSetCount: vi.fn().mockResolvedValue(0),
  cachedSetCards: vi.fn().mockResolvedValue([]),
}))

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '4', HP: '3' },
]

/**
 * Start a real game through the deck screen. The cards are seeded so no network is needed. The
 * opponent is chosen explicitly as a random built deck, which with one saved deck mirrors it: the
 * default is a generated deck, and these tests are about the shell, not the generator.
 */
async function startGame(user: ReturnType<typeof userEvent.setup>, stored: Partial<Settings> = {}) {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
  saveDeck({ name: 'Playable', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_900', count: 30 }] })
  // The opponent replies at once: either side may open, and a paced reply would land mid-assertion.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), opponentDelayMs: 0, ...stored }))
  render(<App />)

  await user.selectOptions(screen.getByTestId('opponent-deck-select'), 'random')
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

  /**
   * Sharing games to train the bot is asked about once, on the deck screen, and the question must
   * never stand between the player and a game.
   */
  describe('the notice about sharing games', () => {
    it('is on the deck screen on a first visit, beside the decks and not over them', () => {
      render(<App />)

      expect(screen.getByTestId('share-games-notice')).toBeInTheDocument()
      expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    /**
     * It heads the right-hand column, so the deck and opponent columns start at the top of the
     * page and nothing is pushed down by it. Implemented cards follows it, then Card catalogue.
     */
    it('heads the card catalogue column, above Implemented cards and then the catalogue heading and its note', () => {
      render(<App />)

      const column = screen.getByTestId('catalogue-column')
      const notice = within(column).getByTestId('share-games-notice')
      const catalogue = within(column).getByTestId('card-catalogue')
      expect([...column.children]).toEqual([notice, within(column).getByTestId('implemented-cards'), catalogue])
      expect(within(catalogue).getByRole('heading', { name: 'Card catalogue' })).toBeInTheDocument()
      expect(within(catalogue).getByText(/cached on this device/i)).toBeInTheDocument()
      expect(within(screen.getByTestId('player-column')).queryByTestId('share-games-notice')).toBeNull()
      expect(within(screen.getByTestId('opponent-column')).queryByTestId('share-games-notice')).toBeNull()
    })

    /**
     * The card brings no margin of its own: the column spaces its sections, so the gap under the
     * card is the gap between any two of them.
     */
    it('leaves the gap below the card to the column', () => {
      render(<App />)

      const column = screen.getByTestId('catalogue-column')
      expect(column.className).toMatch(/(^| )space-y-8( |$)/)
      expect(within(column).getByTestId('share-games-notice').className).not.toMatch(/(^| )m[tby]-/)
    })

    /** While the card is asking, there is no pill anywhere: the header holds the two buttons only. */
    it('shows no pill while the notice is unanswered', () => {
      render(<App />)

      expect(screen.getByTestId('share-games-notice')).toBeInTheDocument()
      expect(screen.queryByTestId('share-games-pill')).toBeNull()
    })

    /**
     * Once answered, the pill sits in the app header alongside the settings and help buttons, just
     * to their left, and not in the page below.
     */
    it.each([
      ['no', 'Improve the bot'],
      ['yes', 'Your games are improving the bot'],
    ] as const)('puts the pill in the header beside the settings and help buttons after a %s', (stored, label) => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), shareGames: stored }))
      render(<App />)
      const header = screen.getByRole('banner')

      const pill = within(header).getByTestId('share-games-pill')
      expect(pill).toHaveTextContent(label)
      const settings = within(header).getByRole('button', { name: 'Settings' })
      const help = within(header).getByRole('button', { name: 'Help' })
      // One row of three: the pill, then the cog, then the question mark.
      expect([...pill.parentElement!.children]).toEqual([pill, settings, help])
      expect(pill.parentElement!.className).toContain('items-center')
      expect(within(screen.getByTestId('deck-select-screen')).queryByTestId('share-games-pill')).toBeNull()
    })

    /** With the pill in the header, an answered notice leaves nothing above the column's first heading. */
    it.each(['yes', 'no'] as const)('starts the catalogue column at Implemented cards after a %s, level with the other columns', stored => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), shareGames: stored }))
      render(<App />)
      const column = screen.getByTestId('catalogue-column')

      expect([...column.children]).toEqual([within(column).getByTestId('implemented-cards'), within(column).getByTestId('card-catalogue')])
    })

    it('moves the pill into the header as the card is answered', async () => {
      const user = userEvent.setup()
      render(<App />)
      const column = screen.getByTestId('catalogue-column')

      await user.click(within(column).getByRole('button', { name: 'Not now' }))

      expect(within(column).queryByTestId('share-games-pill')).toBeNull()
      expect(within(screen.getByRole('banner')).getByTestId('share-games-pill')).toHaveTextContent('Improve the bot')
      expect(column.firstElementChild).toBe(within(column).getByTestId('implemented-cards'))
    })

    /** The pill belongs to the deck screen. A game has its own header, and the pill is not in it. */
    it.each(['yes', 'no'] as const)('shows no pill during a game after a %s', async stored => {
      const user = userEvent.setup()
      await startGame(user, { shareGames: stored })

      expect(screen.queryByTestId('share-games-pill')).toBeNull()
    })

    /** Ignoring it means no: a game starts with the notice untouched, and nobody is opted in. */
    it('lets a game start without being answered, and takes that as a no', async () => {
      const user = userEvent.setup()
      for (const card of SWU_CARDS) {
        await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
      }
      saveDeck({ name: 'Playable', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_900', count: 30 }] })
      render(<App />)
      expect(screen.getByTestId('share-games-notice')).toBeInTheDocument()

      await user.selectOptions(screen.getByTestId('opponent-deck-select'), 'random')
      const row = within(screen.getByTestId('deck-list')).getByText('Playable').closest('li')!
      const play = within(row).getByRole('button', { name: /^play$/i })
      expect(play).toBeEnabled()
      await user.click(play)
      await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())

      expect(loadSettings().shareGames).toBe('no')

      // Back on the deck screen it is the pill, and the question is not asked again.
      await user.click(screen.getByTestId('exit-btn'))
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toHaveTextContent('Improve the bot')
    })

    it('leaves an opted-in player opted in when a game starts', async () => {
      const user = userEvent.setup()
      await startGame(user, { shareGames: 'yes' })

      expect(loadSettings().shareGames).toBe('yes')
    })

    it('opens Settings from the pill', async () => {
      const user = userEvent.setup()
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), shareGames: 'no' }))
      render(<App />)

      await user.click(screen.getByTestId('share-games-pill'))

      expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Share games to improve the bot' })).not.toBeChecked()
    })

    it('opens the Help section on what is sent from Settings', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByRole('button', { name: /settings/i }))
      await user.click(screen.getByRole('button', { name: 'What is sent?' }))

      const content = screen.getByTestId('help-content')
      expect(within(content).getByRole('heading', { name: 'Improving the bot' })).toBeInTheDocument()
      expect(content.innerHTML).not.toContain('Importing a deck')

      // The header's help is the deck screen's whole help again afterwards.
      await user.click(screen.getByTestId('help-overlay'))
      await user.click(screen.getByTestId('settings-close'))
      await user.click(screen.getByRole('button', { name: /help/i }))
      expect(screen.getByTestId('help-content').innerHTML).toContain('Importing a deck')
    })

    /** Settings opens in a game too, where the game's own help does not carry this section. */
    it('opens the same Help section from Settings during a game', async () => {
      const user = userEvent.setup()
      await startGame(user)

      await user.click(screen.getByRole('button', { name: /settings/i }))
      await user.click(screen.getByRole('button', { name: 'What is sent?' }))

      const content = screen.getByTestId('help-content')
      expect(within(content).getByRole('heading', { name: 'Improving the bot' })).toBeInTheDocument()
      expect(content.innerHTML).not.toContain('Turn structure')
      expect(screen.getByTestId('game-board')).toBeInTheDocument()
    })
  })
})
