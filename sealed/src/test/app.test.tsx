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
import { retryPendingCollection } from '../data/collectionSend'

/**
 * The setup screen caches the set its generators are pointed at as soon as it opens, which would put
 * a real SWUDB call in the middle of every shell test. These tests are about the shell, so the
 * cache reads as empty and the fetch is a no-op: the seeded `TST_*` cards below are all they need.
 */
vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 0, total: 0 }),
  cachedSetCount: vi.fn().mockResolvedValue(0),
  cachedSetCards: vi.fn().mockResolvedValue([]),
}))

// The sender has its own tests (`collectionSend.test.ts`). Here it is a spy: the shell only starts it.
vi.mock('../data/collectionSend', () => ({
  retryPendingCollection: vi.fn().mockResolvedValue(undefined),
  sendForCollection: vi.fn().mockResolvedValue(undefined),
}))

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '4', HP: '3' },
]

type User = ReturnType<typeof userEvent.setup>

/** Choose a saved deck on the setup screen and go to the game. */
async function goWith(user: User, deckId: string) {
  await user.click(within(screen.getByTestId('deck-card')).getByRole('button', { name: /Choose a deck|Change deck/ }))
  await user.click(screen.getByTestId(`deck-option-${deckId}`))
  await user.click(screen.getByRole('button', { name: 'Go to game' }))
}

/** Open one of More's entries. */
/** More, on setup or in a game, where its name also lists what it holds. */
async function fromMore(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: /^more/i }))
  await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name }))
}

/**
 * Start a real game through the setup screen. The cards are seeded so no network is needed. With no
 * set cached the generated opponent falls back to one of the saved decks, which with one saved deck
 * mirrors it: these tests are about the shell, not the generator.
 */
async function startGame(user: User, stored: Partial<Settings> = {}) {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
  const deck = saveDeck({ name: 'Playable', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_900', count: 30 }] })
  // The opponent replies at once: either side may open, and a paced reply would land mid-assertion.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), opponentDelayMs: 0, ...stored }))
  render(<App />)

  await goWith(user, deck.id)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
}

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.cards.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens on the Sealed setup screen', () => {
    render(<App />)
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sealed' })).toBeInTheDocument()
    expect(screen.queryByTestId('game-screen')).not.toBeInTheDocument()
  })

  it('shows the release (dev: fixed bottom-right badge), outside the setup screen', () => {
    render(<App />)
    const tag = screen.getByTestId('build-tag')
    // A release number in CI, or a `dev-` marker locally. Never a bare counter: that was the old
    // BUILD_TAG, which said nothing about which code was running.
    expect(tag).toHaveTextContent(/^(dev-[0-9a-f]+|\d+)$/)
    expect(tag).toHaveStyle({ position: 'fixed', right: '8px', bottom: '8px' })
    expect(within(screen.getByTestId('setup-screen')).queryByTestId('build-tag')).toBeNull()
  })

  /** Games that could not be delivered when they finished are offered again as the app opens. */
  it('offers undelivered games for collection once, when it opens', () => {
    vi.mocked(retryPendingCollection).mockClear()
    const { rerender } = render(<App />)
    rerender(<App />)
    expect(retryPendingCollection).toHaveBeenCalledTimes(1)
  })

  it('leaves the game from the back button, returning to setup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    const user = userEvent.setup()
    const deck = saveDeck({ name: 'Ready Deck', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<App />)
    await goWith(user, deck.id)

    await user.click(await screen.findByRole('button', { name: 'Leave the game' }))
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })

  it('shows the transparent dmgCtrl mark before the title', () => {
    render(<App />)
    const header = screen.getByRole('heading', { level: 1, name: 'Sealed' }).parentElement!
    const mark = header.querySelector('img')!
    expect(mark).toHaveAttribute('src', expect.stringContaining('dmgCtrl-icon-transparent-192.png'))
  })

  it('opens help from More without leaving the current screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Help')
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
    // The setup screen stays mounted underneath, rather than being replaced.
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()

    await user.click(screen.getByTestId('help-overlay'))
    expect(screen.queryByTestId('help-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })

  /**
   * Help used to be a screen, so opening it unmounted GameScreen and the game went with it (the
   * whole game lives in useGame's state and refs). Coming back started a *different* game, with a
   * fresh seed. Asserted on a decision already taken: a remounted game is back at the mulligan, so
   * the mulligan buttons reappearing is the defect.
   */
  it('leaves a game in progress alone when help is opened over it', async () => {
    const user = userEvent.setup()
    await startGame(user)

    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    expect(screen.queryByRole('button', { name: /keep hand/i })).toBeNull()
    const logBefore = screen.getByTestId('game-log').textContent

    await fromMore(user, 'Help')
    expect(screen.getByTestId('help-overlay')).toBeInTheDocument()
    await user.click(screen.getByTestId('help-overlay'))

    // Still the same game: past the mulligan, same log, never remounted.
    expect(screen.getByTestId('game-board')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep hand/i })).toBeNull()
    expect(screen.getByTestId('game-log').textContent).toBe(logBefore)
  })

  /** Help is for the screen you opened it from. */
  it('shows the setup screen’s help from setup', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Help')
    const content = screen.getByTestId('help-content').innerHTML
    expect(content).toContain('Choosing your deck')
    expect(content).not.toContain('Turn structure')
  })

  it('shows the game’s help from a game', async () => {
    const user = userEvent.setup()
    await startGame(user)

    await fromMore(user, 'Help')
    const content = screen.getByTestId('help-content').innerHTML
    expect(content).toContain('Turn structure')
    expect(content).not.toContain('Choosing your deck')
  })

  /** Settings open over whatever is on screen rather than replacing it. */
  it('opens settings from More without leaving the current screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Settings')
    expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()

    await user.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()
  })

  it('keeps a setting changed from More, across screens', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Settings')
    await user.selectOptions(screen.getByTestId('setting-base-health'), 'remaining')
    await user.click(screen.getByTestId('settings-close'))

    await fromMore(user, 'Help')
    await user.click(screen.getByTestId('help-overlay'))
    await fromMore(user, 'Settings')

    expect(screen.getByTestId('setting-base-health')).toHaveValue('remaining')
  })

  /**
   * Sharing games to train the bot is asked about once, on the setup screen, and the question must
   * never stand between the player and a game.
   */
  describe('the notice about sharing games', () => {
    it('is on the setup screen on a first visit, under the two cards and not over them', () => {
      render(<App />)

      const setup = screen.getByTestId('setup-screen')
      const notice = within(setup).getByTestId('share-games-notice')
      expect(screen.queryByRole('dialog')).toBeNull()
      // After both cards in the page, so neither is pushed down by it.
      const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(follows(screen.getByTestId('deck-card'), notice)).toBe(true)
      expect(follows(screen.getByTestId('opponent-card'), notice)).toBe(true)
    })

    /** While the card is asking, there is no pill anywhere. */
    it('shows no pill while the notice is unanswered', () => {
      render(<App />)

      expect(screen.getByTestId('share-games-notice')).toBeInTheDocument()
      expect(screen.queryByTestId('share-games-pill')).toBeNull()
    })

    /** Once answered, the pill sits in the setup header, just before More. */
    it.each([
      ['no', 'Improve the bot'],
      ['yes', 'Your games are improving the bot'],
    ] as const)('puts the pill in the header before More after a %s', (stored, label) => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), shareGames: stored }))
      render(<App />)

      const pill = screen.getByTestId('share-games-pill')
      expect(pill).toHaveTextContent(label)
      expect(pill.nextElementSibling).toBe(screen.getByRole('button', { name: 'More' }))
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
    })

    it('moves to the pill as the card is answered', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(within(screen.getByTestId('share-games-notice')).getByRole('button', { name: 'Not now' }))

      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toHaveTextContent('Improve the bot')
    })

    /** The pill belongs to the setup screen. A game has its own header, and the pill is not in it. */
    it.each(['yes', 'no'] as const)('shows no pill during a game after a %s', async stored => {
      const user = userEvent.setup()
      await startGame(user, { shareGames: stored })

      expect(screen.queryByTestId('share-games-pill')).toBeNull()
    })

    /** Ignoring it means no: a game starts with the notice untouched, and nobody is opted in. */
    it('lets a game start without being answered, and takes that as a no', async () => {
      const user = userEvent.setup()
      await startGame(user)

      expect(loadSettings().shareGames).toBe('no')

      // Back on setup it is the pill, and the question is not asked again.
      await user.click(screen.getByRole('button', { name: 'Leave the game' }))
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

      await fromMore(user, 'Settings')
      await user.click(screen.getByRole('button', { name: 'What is sent?' }))

      const content = screen.getByTestId('help-content')
      expect(within(content).getByRole('heading', { name: 'Improving the bot' })).toBeInTheDocument()
      expect(content.innerHTML).not.toContain('Choosing your deck')

      // Help from More is the setup screen's whole help again afterwards.
      await user.click(screen.getByTestId('help-overlay'))
      await user.click(screen.getByTestId('settings-close'))
      await fromMore(user, 'Help')
      expect(screen.getByTestId('help-content').innerHTML).toContain('Choosing your deck')
    })

    /** Settings opens in a game too, where the game's own help does not carry this section. */
    it('opens the same Help section from Settings during a game', async () => {
      const user = userEvent.setup()
      await startGame(user)

      await fromMore(user, 'Settings')
      await user.click(screen.getByRole('button', { name: 'What is sent?' }))

      const content = screen.getByTestId('help-content')
      expect(within(content).getByRole('heading', { name: 'Improving the bot' })).toBeInTheDocument()
      expect(content.innerHTML).not.toContain('Turn structure')
      expect(screen.getByTestId('game-board')).toBeInTheDocument()
    })
  })
})
