// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { GameLoading, GameLoadError, PrintedStatsNotice } from '../components/game/gameEdgeStates'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import { SettingsProvider } from '../hooks/useSettings'
import { defaultSettings, STORAGE_KEY as SETTINGS_KEY } from '../data/settingsStore'
import { PHONE_LANDSCAPE_QUERY } from '../hooks/useMediaQuery'

/**
 * The states around a game: starting it, failing to start it, cards that play with printed stats
 * only, and the bug report (desktop only, and only when turned on).
 */

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', VariantType: 'Normal', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', VariantType: 'Normal', HP: '30' },
  { Set: 'TST', Number: '901', Name: 'Pricey Unit', Type: 'Unit', VariantType: 'Normal', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]
// A printing of a set with no index anywhere: it plays, as a vanilla body, and is named in the notice.
const UNKNOWN_PRINTING: SwuCard = { Set: 'ZZZ', Number: '308', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Hyperspace', Arenas: ['Ground'], Cost: '0', Power: '3', HP: '4' }

const DECK: SavedDeck = {
  id: 'deck-1', name: 'Kanan pool', leader: 'TST_001', base: 'TST_002',
  cards: [{ id: 'TST_901', count: 30 }], importedAt: 1,
}
const OPPONENT: SavedDeck = { ...DECK, id: 'deck-2', name: 'Generated LOF' }

const OPTS: UseGameOptions = {
  shuffle: <T,>(a: T[]) => a,
  firstPlayer: 'player',
  opponentDelayMs: 0,
  ai: s => { const m = legalMoves(s); return m.length > 0 ? m[m.length - 1] : null },
}

function withMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: matching.includes(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const renderGame = (ui: ReactElement) => render(<SettingsProvider>{ui}</SettingsProvider>)

async function seed(cards: SwuCard[]) {
  for (const c of cards) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })
}

describe('the game edge states, on their own', () => {
  it('names both decks while starting, with how many cards have loaded', async () => {
    const onExit = vi.fn()
    render(<GameLoading title="Kanan pool against Generated LOF" progress={{ done: 18, total: 31 }} onExit={onExit} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('STARTING THE GAME')
    expect(status).toHaveTextContent('Kanan pool against Generated LOF')
    expect(status).toHaveTextContent('Loading cards · 18 of 31')
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '18')
    expect(bar).toHaveAttribute('aria-valuemax', '31')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to setup' }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('says why a game could not start, and offers Try again and Back to setup', async () => {
    const onRetry = vi.fn()
    const onExit = vi.fn()
    render(<GameLoadError deckName="Kanan pool" detail="Card TST_404 not found" offline={false} onRetry={onRetry} onExit={onExit} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("This game couldn't start")
    expect(alert).toHaveTextContent(/some cards in Kanan pool couldn't be loaded/i)
    expect(screen.getByTestId('game-error-detail')).toHaveTextContent('TST_404')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
    // Two ways back: the corner and the primary button.
    for (const b of screen.getAllByRole('button', { name: 'Back to setup' })) await user.click(b)
    expect(onExit).toHaveBeenCalledTimes(2)
  })

  it('says so when the device is offline', () => {
    render(<GameLoadError deckName="Kanan pool" detail="x" offline onRetry={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/you're offline/i)
  })

  it('names the cards that play with printed stats only, and can be dismissed', async () => {
    const onDismiss = vi.fn()
    render(<PrintedStatsNotice names={['Padawan Starfighter', 'Gungan Warrior']} onDismiss={onDismiss} />)
    const notice = screen.getByTestId('unresolved-printings')
    expect(notice).toHaveTextContent('2 cards play with their printed stats and keywords only: Padawan Starfighter and Gungan Warrior.')
    await userEvent.setup().click(within(notice).getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('says one card in the singular', () => {
    render(<PrintedStatsNotice names={['Barriss Offee']} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('unresolved-printings')).toHaveTextContent('1 card plays with its printed stats and keywords only: Barriss Offee.')
  })
})

describe.each([
  ['on a desktop', [] as string[]],
  ['on a phone', [PHONE_LANDSCAPE_QUERY]],
])('GameScreen edge states %s', (_where, media) => {
  beforeEach(async () => {
    withMedia(media)
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    await seed(SWU_CARDS)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    withMedia([])
  })

  it('starts on a screen naming both decks, then shows the board', async () => {
    renderGame(<GameScreen deck={DECK} opponentDeck={OPPONENT} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    expect(screen.getByTestId('game-loading')).toHaveTextContent('Kanan pool against Generated LOF')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  })

  it('tries again from the error, and starts once the cards can be had', async () => {
    await db.cards.clear()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderGame(<GameScreen deck={DECK} opponentDeck={OPPONENT} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-error')).toBeInTheDocument())

    await seed(SWU_CARDS)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  })

  it('names the cards playing with printed stats only, until dismissed', async () => {
    await seed([UNKNOWN_PRINTING])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const deck: SavedDeck = { ...DECK, cards: [{ id: 'ZZZ_308', count: 4 }, { id: 'TST_901', count: 26 }] }
    renderGame(<GameScreen deck={deck} opponentDeck={OPPONENT} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())

    const notice = screen.getByTestId('unresolved-printings')
    expect(notice).toHaveTextContent('Barriss Offee')
    await userEvent.setup().click(within(notice).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('unresolved-printings')).toBeNull()
  })
})

describe('the bug report', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), showBugReport: true }))
    await seed(SWU_CARDS)
  })
  afterEach(() => withMedia([]))

  it('asks for a title and what happened, and says what submitting does', async () => {
    withMedia([])
    renderGame(<GameScreen deck={DECK} opponentDeck={OPPONENT} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    await userEvent.setup().click(screen.getByTestId('bug-report-btn'))

    const form = screen.getByRole('dialog', { name: 'Report a bug' })
    expect(within(form).getByLabelText('Title')).toBeInTheDocument()
    expect(within(form).getByLabelText('What happened')).toBeInTheDocument()
    expect(form).toHaveTextContent(/copies the whole game so far to your clipboard and opens a new GitHub issue/i)
    expect(within(form).getByRole('button', { name: 'Copy report and open GitHub' })).toBeDisabled()
    expect(within(form).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('is not offered on a phone, even when turned on', async () => {
    withMedia([PHONE_LANDSCAPE_QUERY])
    renderGame(<GameScreen deck={DECK} opponentDeck={OPPONENT} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    await userEvent.setup().click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.queryByTestId('bug-report-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: /report a bug/i })).toBeNull()
  })
})
