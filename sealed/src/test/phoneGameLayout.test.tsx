// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { phoneHandOverlap } from '../components/boardLayout'
import type { UnitInteraction } from '../components/gameScreen'
import { PhoneArena, PhoneUnit, PlayerSummary, GameLogDrawer } from '../components/game/phoneLayout'
import { PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from '../hooks/useMediaQuery'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions, LogEntry } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import { SettingsProvider } from '../hooks/useSettings'
import { defaultSettings, STORAGE_KEY as SETTINGS_KEY } from '../data/settingsStore'
import type { Settings } from '../data/settingsStore'
import { state, player, unit, card, CARDS, ready } from './helpers/engineFixtures'
import { TOKEN_SHIELD, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import type { TargetIntent } from '../engine/types'

/** The media queries the screen lays itself out by, matched as a test says. */
function withMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: matching.includes(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const noInteract: UnitInteraction = { actionable: false, selected: false, isTarget: false }

describe('phone board pieces', () => {
  it('shows the counts for each side, with the hand only for the opponent', () => {
    const s = state({
      players: {
        player: player({ resources: [...ready(3), { cardId: 'R9', exhausted: true }], discard: ['TST_U1', 'TST_U1'] }),
        opponent: player({ resources: ready(2), hand: ['TST_U1', 'TST_U1', 'TST_U1', 'TST_U1'] }),
      },
    })
    render(<><PlayerSummary state={s} side="opponent" onDiscard={vi.fn()} /><PlayerSummary state={s} side="player" onDiscard={vi.fn()} /></>)
    const opp = screen.getByTestId('opponent-summary')
    expect(within(opp).getByTestId('stat-res')).toHaveTextContent('2/2RES')
    expect(within(opp).getByTestId('stat-hand')).toHaveTextContent('4HAND')
    expect(within(opp).getByTestId('stat-deck')).toHaveTextContent('3DECK')
    expect(within(opp).getByTestId('stat-disc')).toHaveTextContent('0DISC')
    const mine = screen.getByTestId('player-summary')
    expect(within(mine).getByTestId('stat-res')).toHaveTextContent('3/4RES')
    expect(within(mine).queryByTestId('stat-hand')).toBeNull()
    expect(within(mine).getByTestId('stat-disc')).toHaveTextContent('2DISC')
  })

  it('puts the INITIATIVE, FORCE and CRED pills beside the holder', () => {
    const s = state({
      initiative: 'opponent',
      players: { player: player({ creditTokens: 2 }), opponent: player({ forceToken: true }) },
    })
    render(<><PlayerSummary state={s} side="opponent" onDiscard={vi.fn()} /><PlayerSummary state={s} side="player" onDiscard={vi.fn()} /></>)
    const opp = within(screen.getByTestId('opponent-summary'))
    const mine = within(screen.getByTestId('player-summary'))
    expect(opp.getByText('INITIATIVE')).toBeInTheDocument()
    expect(opp.getByText('FORCE')).toBeInTheDocument()
    expect(opp.queryByText(/CRED/)).toBeNull()
    expect(mine.queryByText('INITIATIVE')).toBeNull()
    expect(mine.queryByText('FORCE')).toBeNull()
    expect(mine.getByText('CRED 2')).toBeInTheDocument()
  })

  it('opens the discard pile from its count', async () => {
    const onDiscard = vi.fn()
    render(<PlayerSummary state={state()} side="opponent" onDiscard={onDiscard} />)
    await userEvent.setup().click(screen.getByTestId('stat-disc'))
    expect(onDiscard).toHaveBeenCalledWith('opponent')
  })

  it('badges a unit with its damage, tokens, upgrades and keywords', () => {
    const cards = {
      ...CARDS,
      TST_S: card({ id: 'TST_S', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Sentinel' }] }),
      TST_UP: card({ id: 'TST_UP', type: 'upgrade' }),
    }
    const u = unit('u1', 'TST_S', {
      damage: 2,
      hidden: true,
      upgrades: [
        { cardId: TOKEN_SHIELD, owner: 'player' },
        { cardId: TOKEN_EXPERIENCE, owner: 'player' },
        { cardId: TOKEN_EXPERIENCE, owner: 'player' },
        { cardId: 'TST_UP', owner: 'player' },
      ],
    })
    const s = state({ cards, players: { player: player({ units: [u] }), opponent: player() } })
    render(<PhoneUnit state={s} unit={u} interact={noInteract} />)
    const tile = within(screen.getByTestId('board-unit-u1'))
    expect(tile.getByTestId('unit-badge-damage')).toHaveTextContent('2')
    expect(tile.getByTestId('unit-badge-shield')).toHaveTextContent('Shd 1')
    expect(tile.getByTestId('unit-badge-experience')).toHaveTextContent('Exp 2')
    expect(tile.getByTestId('unit-badge-upgrades')).toHaveTextContent('+1')
    expect(tile.getByTestId('unit-badge-sentinel')).toBeInTheDocument()
    // Hidden does nothing for a Sentinel, so the Sentinel badge stands alone, as on the desktop board.
    expect(tile.queryByTestId('unit-badge-hidden')).toBeNull()
    expect(tile.queryByTestId('unit-badge-leader')).toBeNull()
  })

  it('badges a Hidden unit', () => {
    const u = unit('u2', 'TST_U1', { hidden: true })
    const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
    render(<PhoneUnit state={s} unit={u} interact={noInteract} />)
    expect(within(screen.getByTestId('board-unit-u2')).getByTestId('unit-badge-hidden')).toHaveTextContent('Hidden')
  })

  it('tags a deployed leader and turns an exhausted unit sideways', () => {
    const u = unit('u1', 'TST_L', { isLeader: true, exhausted: true })
    const s = state({ players: { player: player({ units: [u], leader: { cardId: 'TST_L', deployed: true, epicActionUsed: true, exhausted: false } }), opponent: player() } })
    render(<PhoneUnit state={s} unit={u} interact={noInteract} />)
    const tile = within(screen.getByTestId('board-unit-u1'))
    expect(tile.getByTestId('unit-badge-leader')).toHaveTextContent('LEADER')
    expect(tile.getByTestId('card-face')).toHaveAttribute('data-orientation', 'landscape')
  })

  it('rings the attacker white and each target in its colour', () => {
    const u = unit('u1', 'TST_U1')
    const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
    const highlight = (interact: UnitInteraction) => {
      const { unmount } = render(<PhoneUnit state={s} unit={u} interact={interact} />)
      const value = within(screen.getByTestId('board-unit-u1')).getByTestId('card-face').getAttribute('data-highlight')
      unmount()
      return value
    }
    expect(highlight({ ...noInteract, actionable: true, selected: true })).toBe('white')
    expect(highlight({ ...noInteract, actionable: true })).toBe('accent')
    const target = (intent?: TargetIntent) => highlight({ ...noInteract, isTarget: true, intent })
    expect(target()).toBe('red')
    expect(target('harm')).toBe('red')
    expect(target('help')).toBe('green')
    expect(target('attach')).toBe('white')
    expect(target('cunning')).toBe('yellow')
  })

  it('lays four units to a row, and five once a half holds more than eight', () => {
    const units = (n: number) => Array.from({ length: n }, (_, i) => unit(`u${i}`, 'TST_U1'))
    const arena = (n: number) => {
      const s = state({ players: { player: player({ units: units(n) }), opponent: player() } })
      const { unmount } = render(<PhoneArena state={s} side="player" arena="ground" unitInteraction={() => noInteract} />)
      const zone = screen.getByTestId('player-ground-units')
      const result = { perRow: zone.dataset.perRow, shown: within(zone).getAllByTestId(/^board-unit-/).length }
      unmount()
      return result
    }
    expect(arena(8)).toEqual({ perRow: '4', shown: 8 })
    expect(arena(9)).toEqual({ perRow: '5', shown: 9 })
  })

  it('fans a long hand to fit its row, and leaves a short one spread', () => {
    for (let n = 1; n <= 9; n++) expect(phoneHandOverlap(n)).toBe(0)
    for (let n = 10; n <= 20; n++) {
      const overlap = phoneHandOverlap(n)
      expect(overlap).toBeGreaterThan(0)
      expect(n * 60 + (n - 1) * (6 - overlap)).toBeLessThanOrEqual(600)
    }
  })

  it('groups the log by round, newest first, with Undo at its foot', async () => {
    const entry = (round: number, text: string, extra: Partial<LogEntry> = {}): LogEntry => ({ by: 'player', text, parts: [text], round, ...extra })
    const log = [
      entry(0, 'Keep hand'),
      entry(1, 'Play Unit A'),
      entry(1, 'Unit A enters play', { outcome: true }),
      entry(2, 'Pass', { by: 'opponent' }),
    ]
    const onUndo = vi.fn()
    render(<GameLogDrawer open state={state()} log={log} onClose={vi.fn()} onUndo={onUndo} />)
    const rounds = screen.getAllByTestId('log-round').map(el => el.textContent)
    expect(rounds).toEqual(['Round 2', 'Round 1', 'Setup'])
    const rows = screen.getAllByTestId('log-row').map(el => el.textContent)
    expect(rows[0]).toContain('Pass')
    // An action and what it changed share one row.
    expect(rows[1]).toContain('Play Unit A')
    expect(rows[1]).toContain('Unit A enters play')
    expect(rows).toHaveLength(3)
    await userEvent.setup().click(screen.getByTestId('log-undo-btn'))
    expect(onUndo).toHaveBeenCalled()
  })

  it('has no Undo when it is off', () => {
    render(<GameLogDrawer open state={state()} log={[]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('log-undo-btn')).toBeNull()
  })
})

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '40', HP: '30' },
  { Set: 'TST', Number: '901', Name: 'Pricey Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]

// Deal order (identity shuffle): 901 ×3 then 900; resourcing two leaves 901, 900, 900, 900 in hand.
const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Big Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [{ id: 'TST_901', count: 3 }, { id: 'TST_900', count: 27 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
const PASSIVE: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.length > 0 ? moves[moves.length - 1] : null
  },
}
const OPTS: UseGameOptions = { ...PASSIVE, opponentDelayMs: 0 }

const renderGame = (ui: ReactElement) => render(<SettingsProvider>{ui}</SettingsProvider>)
const seedSettings = (patch: Partial<Settings>) => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings(), ...patch }))

async function renderPhone(options: UseGameOptions = OPTS) {
  const onExit = vi.fn()
  const onHelp = vi.fn()
  renderGame(<GameScreen deck={DECK} opponentDeck={DECK} onExit={onExit} onHelp={onHelp} gameOptions={options} />)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  return { onExit, onHelp, user: userEvent.setup() }
}

describe('GameScreen on a phone in landscape', () => {
  beforeEach(async () => {
    withMedia([PHONE_LANDSCAPE_QUERY])
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of SWU_CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })
  afterEach(() => withMedia([]))

  it('lays out the controls column beside the board and hand', async () => {
    await renderPhone()
    expect(screen.getByTestId('phone-layout')).toBeInTheDocument()
    const controls = within(screen.getByTestId('phone-controls'))
    expect(controls.getByRole('button', { name: /leave the game/i })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: /^log$/i })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: /more/i })).toBeInTheDocument()
    expect(controls.getByTestId('round-phase')).toHaveTextContent('Round 1 · Setup')
    expect(screen.getByRole('region', { name: 'Space arena' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ground arena' })).toBeInTheDocument()
    expect(screen.getByTestId('player-hand')).toBeInTheDocument()
    // The desktop mats and log column are not drawn.
    expect(screen.queryByTestId('player-mat')).toBeNull()
    expect(screen.queryByTestId('game-log-panel')).toBeNull()
  })

  it('mulligans and resources one of two from the controls column', async () => {
    const { user } = await renderPhone()
    const controls = within(screen.getByTestId('phone-controls'))
    expect(controls.getByRole('button', { name: /mulligan/i })).toBeInTheDocument()
    await user.click(controls.getByRole('button', { name: /keep hand/i }))
    expect(screen.getByTestId('action-prompt')).toHaveTextContent('0 of 2')
    await user.click(screen.getByTestId('hand-card-0'))
    expect(screen.getByTestId('action-prompt')).toHaveTextContent('1 of 2')
    // A resourcing pick is ringed green; nothing to play is dimmed.
    expect(within(screen.getByTestId('hand-card-0')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'green')
    await user.click(screen.getByTestId('hand-card-0'))
    expect(controls.getByTestId('round-phase')).toHaveTextContent('Round 1 · Action')
    expect(controls.getByRole('button', { name: /^pass$/i })).toBeInTheDocument()
    expect(screen.getByTestId('hand-card-0')).toHaveAttribute('data-playable', 'false')
  })

  it('attacks: the attacker ringed white, Cancel attack, the target red', async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-3'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    await user.click(screen.getByTestId('board-unit-u1'))
    expect(within(screen.getByTestId('board-unit-u1')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'white')
    await user.click(screen.getByRole('button', { name: /cancel attack/i }))
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-selected', 'false')
    expect(screen.queryByTestId('target-opponent-base')).toBeNull()

    await user.click(screen.getByTestId('board-unit-u1'))
    const base = screen.getByTestId('target-opponent-base')
    expect(within(base).getByTestId('card-face')).toHaveAttribute('data-highlight', 'red')
    await user.click(base)
    // Game over offers a rematch and a new setup.
    expect(screen.getByTestId('game-over-banner')).toHaveTextContent(/you won/i)
    expect(screen.getByTestId('rematch-btn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new setup/i })).toBeInTheDocument()
  })

  it('shows the opponent acting with no buttons to press', async () => {
    seedSettings({ opponentDelayMs: 2000 })
    const { user } = await renderPhone(PASSIVE)
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    const controls = within(screen.getByTestId('phone-controls'))
    expect(controls.getByText('Opponent…')).toBeInTheDocument()
    expect(within(screen.getByTestId('phone-actions')).queryAllByRole('button')).toEqual([])
  })

  it('opens the log from the left with the game so far', async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByRole('button', { name: /^log$/i }))
    const drawer = within(screen.getByTestId('game-log-drawer'))
    expect(drawer.getAllByTestId('log-round').map(el => el.textContent)).toContain('Setup')
    expect(drawer.getAllByTestId('log-row')[0]).toHaveTextContent(/keep/i)
  })

  it('opens a discard pile as a sheet from its count', async () => {
    const { user } = await renderPhone()
    await user.click(within(screen.getByTestId('player-summary')).getByTestId('stat-disc'))
    expect(screen.getByRole('dialog', { name: 'Your discard' })).toHaveTextContent(/empty/i)
  })

  it('holds Help, Settings and Concede under More, with no bug report', async () => {
    seedSettings({ showBugReport: true })
    const { user, onHelp } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /more/i }))
    const more = within(screen.getByRole('dialog', { name: 'More' }))
    expect(more.queryByRole('button', { name: /report a bug/i })).toBeNull()
    expect(screen.queryByTestId('bug-report-btn')).toBeNull()
    await user.click(more.getByRole('button', { name: /^help$/i }))
    expect(onHelp).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: /^settings$/i }))
    expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
  })

  it('concedes from More only after confirming', async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /more/i }))
    const more = within(screen.getByRole('dialog', { name: 'More' }))
    await user.click(more.getByRole('button', { name: /^concede$/i }))
    expect(screen.queryByTestId('game-over-banner')).toBeNull()
    await user.click(more.getByRole('button', { name: /keep playing/i }))
    expect(more.getByRole('button', { name: /^concede$/i })).toBeInTheDocument()
    await user.click(more.getByRole('button', { name: /^concede$/i }))
    await user.click(more.getByTestId('concede-confirm-btn'))
    expect(screen.getByTestId('game-over-banner')).toBeInTheDocument()
  })
})

describe('GameScreen on a phone held upright', () => {
  beforeEach(async () => {
    withMedia([PHONE_PORTRAIT_QUERY])
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of SWU_CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })
  afterEach(() => withMedia([]))

  it('asks for the phone to be turned sideways, and keeps the game', async () => {
    renderGame(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByText('Turn your phone sideways')).toBeInTheDocument())
    expect(screen.queryByTestId('game-board')).toBeNull()
  })
})
