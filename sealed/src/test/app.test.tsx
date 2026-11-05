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
import { SHARING_HELP_SECTION } from '../utils/helpSections'

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

const helpPage = () => screen.queryByTestId('help-page')
const currentHelpSection = () =>
  within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')
    .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const settingsSheet = () => screen.queryByRole('dialog', { name: 'Sealed settings' })
const closeSettings = (user: User) => user.click(within(settingsSheet()!).getByRole('button', { name: 'Close' }))
const healthLeft = () => within(settingsSheet()!).getByRole('button', { name: 'Health left' })

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
    expect(helpPage()).toBeInTheDocument()
    // The setup screen stays mounted underneath, rather than being replaced.
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to setup' }))
    expect(helpPage()).not.toBeInTheDocument()
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
    expect(helpPage()).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to the game' }))
    expect(helpPage()).not.toBeInTheDocument()

    // Still the same game: past the mulligan, same log, never remounted.
    expect(screen.getByTestId('game-board')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep hand/i })).toBeNull()
    expect(screen.getByTestId('game-log').textContent).toBe(logBefore)
  })

  /** Help opens at the part for the screen you opened it from. */
  it('opens help at Decks from setup', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Help')
    expect(currentHelpSection()).toEqual(['Decks'])
  })

  it('opens help at Playing from a game', async () => {
    const user = userEvent.setup()
    await startGame(user)

    await fromMore(user, 'Help')
    expect(currentHelpSection()).toEqual(['Playing'])
  })

  /** Settings open over whatever is on screen rather than replacing it. */
  it('opens settings from More without leaving the current screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Settings')
    expect(settingsSheet()).toBeInTheDocument()
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()

    await closeSettings(user)
    expect(settingsSheet()).not.toBeInTheDocument()
  })

  it('keeps a setting changed from More, across screens', async () => {
    const user = userEvent.setup()
    render(<App />)

    await fromMore(user, 'Settings')
    await user.click(healthLeft())
    await closeSettings(user)

    await fromMore(user, 'Help')
    await user.click(screen.getByRole('button', { name: 'Back to setup' }))
    await fromMore(user, 'Settings')

    expect(healthLeft()).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * Sharing games to train the bot is asked about once, on the setup screen, and the question must
   * never stand between the player and a game.
   */
  describe('the notice about sharing games', () => {
    it('is on the setup screen on a first visit, last in the page and over nothing', () => {
      render(<App />)

      const setup = screen.getByTestId('setup-screen')
      const notice = within(setup).getByTestId('share-games-notice')
      expect(screen.queryByRole('dialog')).toBeNull()
      // After both cards and Go to game, so none of them is pushed down or off the screen by it.
      const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(follows(screen.getByTestId('deck-card'), notice)).toBe(true)
      expect(follows(screen.getByTestId('opponent-card'), notice)).toBe(true)
      expect(follows(screen.getByRole('button', { name: 'Go to game' }), notice)).toBe(true)
    })

    it('opens the Help section on what is sent from the notice, leaving it unanswered', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(within(screen.getByTestId('share-games-notice')).getByRole('button', { name: "What's sent" }))

      expect(currentHelpSection()).toEqual([SHARING_HELP_SECTION])
      await user.click(screen.getByRole('button', { name: 'Back to setup' }))
      expect(screen.getByTestId('share-games-notice')).toBeInTheDocument()
      expect(loadSettings().shareGames).toBe('unasked')
    })

    /**
     * The notice, the pill and the Settings switch are three views of one setting: an answer given
     * in any of them shows in the others at once, with nothing to reload.
     */
    it('keeps the notice, the pill and the Settings switch in step', async () => {
      const user = userEvent.setup()
      render(<App />)
      const shareSwitch = () => within(settingsSheet()!).getByRole('switch', { name: 'Share games to improve the bot' })
      const pill = () => screen.getByTestId('share-games-pill')

      await user.click(within(screen.getByTestId('share-games-notice')).getByRole('button', { name: 'Share my games' }))
      expect(pill()).toHaveTextContent('Your games are improving the bot')

      await user.click(pill())
      expect(shareSwitch()).toHaveAttribute('aria-checked', 'true')
      await user.click(shareSwitch())
      expect(shareSwitch()).toHaveAttribute('aria-checked', 'false')
      expect(loadSettings().shareGames).toBe('no')
      expect(pill()).toHaveTextContent('Improve the bot')

      await user.click(shareSwitch())
      expect(loadSettings().shareGames).toBe('yes')
      expect(pill()).toHaveTextContent('Your games are improving the bot')
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
    })

    /** Turning the switch is an answer too: the notice gives way to the pill without being touched. */
    it.each([
      [1, 'yes', 'Your games are improving the bot'],
      [2, 'no', 'Improve the bot'],
    ] as const)('answers the notice from the Settings switch (%i taps gives %s)', async (taps, stored, label) => {
      const user = userEvent.setup()
      render(<App />)

      await fromMore(user, 'Settings')
      for (let i = 0; i < taps; i++) {
        await user.click(within(settingsSheet()!).getByRole('switch', { name: 'Share games to improve the bot' }))
      }
      await closeSettings(user)

      expect(loadSettings().shareGames).toBe(stored)
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toHaveTextContent(label)
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

      expect(within(settingsSheet()!).getByRole('switch', { name: 'Share games to improve the bot' })).toHaveAttribute('aria-checked', 'false')
    })

    it('opens the Help section on what is sent from Settings', async () => {
      const user = userEvent.setup()
      render(<App />)

      await fromMore(user, 'Settings')
      await user.click(within(settingsSheet()!).getByRole('button', { name: "What's sent" }))

      expect(currentHelpSection()).toEqual(['After the game'])

      // Help from More opens at the setup screen's own section again afterwards.
      await user.click(screen.getByRole('button', { name: 'Back to setup' }))
      await closeSettings(user)
      await fromMore(user, 'Help')
      expect(currentHelpSection()).toEqual(['Decks'])
    })

    /** Settings opens in a game too, where the game's own help does not carry this section. */
    it('opens the same Help section from Settings during a game', async () => {
      const user = userEvent.setup()
      await startGame(user)

      await fromMore(user, 'Settings')
      await user.click(screen.getByRole('button', { name: "What's sent" }))

      expect(currentHelpSection()).toEqual(['After the game'])
      expect(screen.getByTestId('game-board')).toBeInTheDocument()
    })
  })
})
