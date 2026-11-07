// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { actionFocus, BOARD_SCALE, handOverlap } from '../components/boardLayout'
import type { UnitInteraction } from '../components/gameScreen'
import { PhoneArena, PhoneUnit, PlayerSummary, GameLogDrawer, CardDetail, LeaderMenu, PileSheet } from '../components/game/phoneLayout'
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
import { TOKEN_SHIELD, TOKEN_EXPERIENCE, TOKEN_ADVANTAGE, TOKEN_WEAKNESS, TOKEN_CARDS } from '../engine/tokenUpgrades'
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

  it('holds the heading at one height whether or not a pill is beside it', () => {
    const s = state({ initiative: 'opponent' })
    render(<><PlayerSummary state={s} side="opponent" onDiscard={vi.fn()} /><PlayerSummary state={s} side="player" onDiscard={vi.fn()} /></>)
    // A pill is taller than the bare heading: a fixed height keeps the counts, and the prompt
    // under the opponent's, from moving when the initiative or a token changes hands.
    for (const side of ['opponent', 'player']) {
      expect(within(screen.getByTestId(`${side}-summary`)).getByTestId('summary-heading').className).toMatch(/(^| )h-/)
    }
  })

  it('opens the discard pile from its count', async () => {
    const onDiscard = vi.fn()
    render(<PlayerSummary state={state()} side="opponent" onDiscard={onDiscard} />)
    await userEvent.setup().click(screen.getByTestId('stat-disc'))
    expect(onDiscard).toHaveBeenCalledWith('opponent')
  })

  it("opens your resources from your count, and never the opponent's", async () => {
    const onResources = vi.fn()
    render(<><PlayerSummary state={state()} side="opponent" onDiscard={vi.fn()} /><PlayerSummary state={state()} side="player" onDiscard={vi.fn()} onResources={onResources} /></>)
    expect(within(screen.getByTestId('opponent-summary')).getByTestId('stat-res')).toBeDisabled()
    await userEvent.setup().click(within(screen.getByTestId('player-summary')).getByTestId('stat-res'))
    expect(onResources).toHaveBeenCalled()
  })

  it('turns the exhausted resources in a pile', () => {
    render(<PileSheet state={state()} title="Your resources" cards={[{ cardId: 'TST_U1', exhausted: true }, { cardId: 'TST_U1', exhausted: false }]} onClose={vi.fn()} />)
    const faces = within(screen.getByRole('dialog', { name: 'Your resources' })).getAllByTestId('card-face')
    expect(faces.map(f => f.dataset.orientation)).toEqual(['landscape', 'portrait'])
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

  it('badges a unit with each kind of token upgrade on it and its count, Weakness included', () => {
    const tokens = (u: ReturnType<typeof unit>) => {
      const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
      const { unmount } = render(<PhoneUnit state={s} unit={u} interact={noInteract} />)
      const tile = within(screen.getByTestId(`board-unit-${u.instanceId}`))
      const read = (kind: string) => tile.queryByTestId(`unit-badge-${kind}`)?.textContent ?? null
      const found = { weakness: read('weakness'), advantage: read('advantage'), experience: read('experience'), shield: read('shield') }
      unmount()
      return found
    }
    const weak = (n: number) => Array.from({ length: n }, () => ({ cardId: TOKEN_WEAKNESS, owner: 'opponent' as const }))
    expect(tokens(unit('u1', 'TST_U1', { upgrades: weak(1) }))).toEqual({ weakness: 'Weak 1', advantage: null, experience: null, shield: null })
    expect(tokens(unit('u1', 'TST_U1', { upgrades: [...weak(2), { cardId: TOKEN_EXPERIENCE, owner: 'player' }] })))
      .toEqual({ weakness: 'Weak 2', advantage: null, experience: 'Exp 1', shield: null })
    expect(tokens(unit('u1', 'TST_U1', { upgrades: [{ cardId: TOKEN_ADVANTAGE, owner: 'player' }] })).advantage).toBe('Adv 1')
  })

  it('has a board badge for every token upgrade there is', () => {
    const u = unit('u1', 'TST_U1', { upgrades: Object.keys(TOKEN_CARDS).map(cardId => ({ cardId, owner: 'player' as const })) })
    const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
    render(<PhoneUnit state={s} unit={u} interact={noInteract} />)
    const tile = within(screen.getByTestId('board-unit-u1'))
    for (const token of Object.values(TOKEN_CARDS)) {
      expect(tile.getByTestId(`unit-badge-${token.name.toLowerCase()}`)).toHaveAccessibleName(`1 ${token.name}`)
    }
    // Tokens have their own badges; the +n badge counts the upgrade cards.
    expect(tile.queryByTestId('unit-badge-upgrades')).toBeNull()
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

  it("rings the opponent's acting unit amber and its target red", () => {
    const u = unit('u1', 'TST_U1')
    const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
    const { unmount } = render(<PhoneUnit state={s} unit={u} interact={{ ...noInteract, acting: 'actor' }} />)
    expect(within(screen.getByTestId('board-unit-u1')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'amber')
    unmount()
    render(<PhoneUnit state={s} unit={u} interact={{ ...noInteract, acting: 'target' }} />)
    expect(within(screen.getByTestId('board-unit-u1')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'red')
  })

  it('finds the acting unit and the target of an action', () => {
    expect(actionFocus({ type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'b' } })).toEqual({ actorId: 'a', targetId: 'b' })
    expect(actionFocus({ type: 'attack', attackerId: 'a', target: { kind: 'base' } })).toEqual({ actorId: 'a', targetBase: true })
    expect(actionFocus({ type: 'pass' })).toEqual({})
  })

  it('shows a unit full size beside what is on it, and closes on a tap', async () => {
    const cards = { ...CARDS, TST_S: card({ id: 'TST_S', name: 'Big Brute', type: 'unit', arena: 'ground', power: 2, hp: 5 }) }
    const u = unit('u1', 'TST_S', { damage: 2, upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })
    const s = state({ cards, players: { player: player({ units: [u] }), opponent: player() } })
    const onClose = vi.fn()
    render(<CardDetail state={s} cardId="TST_S" unit={u} onClose={onClose} />)
    const dialog = within(screen.getByRole('dialog', { name: 'Big Brute, full size' }))
    expect(dialog.getByText('ON THE BOARD')).toBeInTheDocument()
    expect(dialog.getByTestId('detail-damage')).toHaveTextContent('2 damage, 3 HP left')
    expect(dialog.getByText('Ready, in your ground arena')).toBeInTheDocument()
    expect(dialog.getByText('Shield')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close the card' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the upgrade cards on a held unit and the cards it holds captive, each as a card', async () => {
    const cards = {
      ...CARDS,
      TST_S: card({ id: 'TST_S', name: 'Big Brute', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
      TST_UP1: card({ id: 'TST_UP1', name: 'Heavy Plating', type: 'upgrade' }),
      TST_UP2: card({ id: 'TST_UP2', name: 'Long Rifle', type: 'upgrade' }),
      TST_P: card({ id: 'TST_P', name: 'Clone Deserter', type: 'unit', arena: 'ground', power: 1, hp: 2 }),
    }
    const u = unit('u1', 'TST_S', {
      upgrades: [{ cardId: 'TST_UP1', owner: 'player' }, { cardId: TOKEN_SHIELD, owner: 'player' }, { cardId: 'TST_UP2', owner: 'opponent' }],
      captured: [{ cardId: 'TST_P', owner: 'opponent' }],
    })
    const s = state({ cards, players: { player: player({ units: [u] }), opponent: player() } })
    const onClose = vi.fn()
    render(<CardDetail state={s} cardId="TST_S" unit={u} onClose={onClose} />)
    const dialog = within(screen.getByRole('dialog', { name: 'Big Brute, full size' }))
    const attached = within(dialog.getByRole('list', { name: 'On Big Brute' }))
    const items = attached.getAllByRole('listitem')
    expect(items.map(i => i.getAttribute('aria-label'))).toEqual(['Upgrade: Heavy Plating', 'Upgrade: Long Rifle', 'Captured: Clone Deserter'])
    // Each is the card itself, not just its name; a token has no card here, only its row under UPGRADES.
    for (const item of items) expect(within(item).getByTestId('card-face')).toBeInTheDocument()
    expect(items[2]).toHaveTextContent("Clone Deserter, the opponent's card. It comes back into play for them, exhausted, when Big Brute leaves play.")
    expect(attached.queryByText('Shield')).toBeNull()
    // A tap on the cards closes, as anywhere else does.
    await userEvent.setup().click(items[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('lists every upgrade on a held unit, tokens with the cards, each kind with its count', () => {
    const cards = {
      ...CARDS,
      TST_S: card({ id: 'TST_S', name: 'Big Brute', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
      TST_UP1: card({ id: 'TST_UP1', name: 'Heavy Plating', type: 'upgrade' }),
    }
    const u = unit('u1', 'TST_S', {
      upgrades: [
        { cardId: TOKEN_WEAKNESS, owner: 'opponent' },
        { cardId: 'TST_UP1', owner: 'player' },
        { cardId: TOKEN_WEAKNESS, owner: 'opponent' },
        { cardId: TOKEN_EXPERIENCE, owner: 'player' },
      ],
    })
    const s = state({ cards, players: { player: player({ units: [u] }), opponent: player() } })
    render(<CardDetail state={s} cardId="TST_S" unit={u} onClose={vi.fn()} />)
    const dialog = within(screen.getByRole('dialog', { name: 'Big Brute, full size' }))
    const rows = dialog.getAllByTestId('detail-upgrade')
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['2 Weakness', '1 Heavy Plating', '1 Experience'])
    expect(rows.map(r => r.textContent)).toEqual(['2Weakness', '1Heavy Plating', '1Experience'])
    expect(dialog.getByText('UPGRADES')).toBeInTheDocument()
  })

  it('shows no attached cards for a unit with only tokens on it', () => {
    const u = unit('u1', 'TST_U1', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })
    const s = state({ players: { player: player({ units: [u] }), opponent: player() } })
    render(<CardDetail state={s} cardId="TST_U1" unit={u} onClose={vi.fn()} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows a card with nothing on it on its own', () => {
    render(<CardDetail state={state()} cardId="TST_U1" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /full size/ })).toBeInTheDocument()
    expect(screen.queryByText('ON THE BOARD')).toBeNull()
  })

  it("lists the leader's actions, with a reason on one that can't be taken", async () => {
    const onUse = vi.fn()
    const onSee = vi.fn()
    render(<LeaderMenu name="Kanan Jarrus" onClose={vi.fn()} onSee={onSee} items={[
      { label: 'Use action', detail: 'Give a Shield token', onSelect: onUse },
      { label: 'Deploy', detail: 'Needs 6 resources; you have 4' },
    ]} />)
    const menu = within(screen.getByRole('menu', { name: 'Kanan Jarrus' }))
    expect(menu.getByText('KANAN JARRUS · LEADER')).toBeInTheDocument()
    const deploy = menu.getByRole('menuitem', { name: /deploy/i })
    expect(deploy).toHaveAttribute('aria-disabled', 'true')
    expect(deploy).toHaveTextContent('Needs 6 resources; you have 4')
    const user = userEvent.setup()
    await user.click(deploy)
    await user.click(menu.getByRole('menuitem', { name: /use action/i }))
    expect(onUse).toHaveBeenCalledTimes(1)
    await user.click(menu.getByRole('menuitem', { name: /see the card/i }))
    expect(onSee).toHaveBeenCalled()
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

  it.each(['phone', 'desktop'] as const)('fans a long hand to fit its row, and leaves a short one spread (%s)', scale => {
    const { handCard, handWidth } = BOARD_SCALE[scale]
    for (let n = 1; n <= 9; n++) expect(handOverlap(n, scale)).toBe(0)
    for (let n = 10; n <= 20; n++) {
      const overlap = handOverlap(n, scale)
      expect(overlap).toBeGreaterThan(0)
      expect(n * handCard + (n - 1) * (6 - overlap)).toBeLessThanOrEqual(handWidth)
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
  { Set: 'TST', Number: '902', Name: 'Secret Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
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
const SECRET_DECK: SavedDeck = { ...DECK, id: 'deck-2', cards: [{ id: 'TST_902', count: 30 }] }

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

/**
 * The prompt has no ring and hangs straight under the opponent's counts, so its length cannot move its
 * top. Its text is inset at both sides (`promptInset`), so it runs no wider than those counts read.
 */
function expectPromptPinned(scale: 'phone' | 'desktop') {
  const prompt = screen.getByTestId('action-prompt')
  expect(prompt.className).not.toMatch(/(^| )border( |$)/)
  expect(prompt.parentElement).toBe(screen.getByTestId('phone-controls'))
  expect(prompt.previousElementSibling).toBe(screen.getByTestId('opponent-summary'))
  const inset = BOARD_SCALE[scale].promptInset
  expect(inset).toBeGreaterThan(0)
  expect(prompt.style.paddingLeft).toBe(`${inset}px`)
  expect(prompt.style.paddingRight).toBe(`${inset}px`)
}

/**
 * Each arena is named across the gap between the opponent's half and yours, in clear text: nothing is
 * drawn behind it but the page's own starfield, so it carries no band of another colour.
 */
function expectArenaLabels(scale: 'phone' | 'desktop') {
  for (const [name, text, arena] of [['Space arena', 'SPACE', 'space'], ['Ground arena', 'GROUND', 'ground']] as const) {
    const label = within(screen.getByRole('region', { name })).getByText(text)
    expect(label.getAttribute('aria-hidden')).toBe('true')
    expect(label.style.writingMode).toBe('')
    expect(label.previousElementSibling).toBe(screen.getByTestId(`opponent-${arena}-units`))
    expect(label.nextElementSibling).toBe(screen.getByTestId(`player-${arena}-units`))
    expect(label.style.height).toBe(`${BOARD_SCALE[scale].arenaGap}px`)
    for (let el: HTMLElement | null = label; el && el.getAttribute('role') !== 'region'; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^| )bg-/)
      expect(el.style.background + el.style.backgroundColor + el.style.borderRadius).toBe('')
    }
  }
}

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

  it('labels each arena across the gap between the halves, in clear text over the page, hidden from the reader', async () => {
    await renderPhone()
    expectArenaLabels('phone')
  })

  it('pins the prompt, unringed and inset, under the opponent\'s counts', async () => {
    await renderPhone()
    expectPromptPinned('phone')
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
    // Regroup: the two cards just drawn are tagged NEW, and resourcing none reads Don't resource.
    expect(screen.getByTestId('action-prompt')).toBeInTheDocument()
    const newTags = [0, 1, 2, 3, 4].map(i => within(screen.getByTestId(`hand-card-${i}`)).queryByTestId('hand-card-new') !== null)
    expect(newTags).toEqual([false, false, false, true, true])
    expect(screen.queryByRole('button', { name: /skip resourcing/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /don't resource/i }))
    expect(screen.queryByTestId('hand-card-new')).toBeNull()

    await user.click(screen.getByTestId('board-unit-u1'))
    expect(within(screen.getByTestId('board-unit-u1')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'white')
    await user.click(screen.getByRole('button', { name: /cancel attack/i }))
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-selected', 'false')
    expect(screen.queryByTestId('target-opponent-base')).toBeNull()

    await user.click(screen.getByTestId('board-unit-u1'))
    const base = screen.getByTestId('target-opponent-base')
    expect(within(base).getByTestId('card-face')).toHaveAttribute('data-highlight', 'red')
    await user.click(base)
    // Game over offers a rematch and a new setup, over the board, with the log still to hand.
    const over = within(screen.getByRole('dialog', { name: 'Game over: you won' }))
    expect(screen.getByTestId('game-over-banner')).toHaveTextContent(/you won/i)
    expect(over.getByText('GAME OVER')).toBeInTheDocument()
    expect(over.getByTestId('outcome-detail')).toHaveTextContent('Test Base destroyed in round 2')
    expect(over.getByText('Big Deck against Test Leader · Test Base')).toBeInTheDocument()
    expect(screen.getByTestId('rematch-btn')).toBeInTheDocument()
    expect(over.getByRole('button', { name: /new setup/i })).toBeInTheDocument()
    expect(screen.getByTestId('phone-layout')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^log$/i }))
    expect(screen.getByTestId('game-log-drawer')).toBeInTheDocument()
  })

  it('fills every button in the controls column, none of them an outline', async () => {
    seedSettings({ allowUndo: true })
    const { user } = await renderPhone()
    const filled = () => {
      const buttons = within(screen.getByTestId('phone-actions')).getAllByRole('button')
      for (const b of buttons) {
        expect(b.style.background).toBe('var(--color-tonal)')
        expect(b.className).not.toMatch(/border/)
      }
      return buttons.map(b => b.textContent)
    }
    expect(filled()).toEqual(['Mulligan', 'Keep hand'])
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-3'))
    expect(filled()).toEqual(expect.arrayContaining(['Pass', 'Undo']))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /don't resource/i }))
    await user.click(screen.getByTestId('board-unit-u1'))
    expect(filled()).toEqual(expect.arrayContaining(['Cancel attack']))
  })

  it('holds a card to see it full size, without playing it', async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    const card0 = screen.getByTestId('hand-card-0')
    fireEvent.pointerDown(card0, { pointerType: 'touch' })
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Pricey Unit, full size' })).toBeInTheDocument())
    fireEvent.pointerUp(card0, { pointerType: 'touch' })
    fireEvent.click(card0)
    // The press opened the card; it did not resource it.
    expect(screen.getByTestId('action-prompt')).toHaveTextContent('0 of 2')
    await user.click(screen.getByRole('button', { name: 'Close the card' }))
    expect(screen.queryByRole('dialog', { name: /full size/ })).toBeNull()
  })

  it("opens the leader's menu from the leader, with deploy's reason", async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-0'))
    // No deploy button in the column: deploying is the leader's.
    expect(within(screen.getByTestId('phone-actions')).queryByRole('button', { name: /deploy/i })).toBeNull()
    await user.click(screen.getByTestId('player-leader-card'))
    const menu = within(screen.getByRole('menu', { name: 'Test Leader' }))
    const deploy = menu.getByRole('menuitem', { name: /deploy/i })
    expect(deploy).toHaveAttribute('aria-disabled', 'true')
    expect(deploy).toHaveTextContent('Needs 5 resources; you have 2')
    await user.click(menu.getByRole('menuitem', { name: /see the card/i }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Test Leader, full size' })).toBeInTheDocument()
  })

  it('opens a card named in the log with a tap', async () => {
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByRole('button', { name: /^log$/i }))
    const ref = within(screen.getByTestId('game-log-drawer')).getAllByTestId('card-ref')[0]
    await user.click(ref)
    expect(screen.getByRole('dialog', { name: 'Pricey Unit, full size' })).toBeInTheDocument()
  })

  it('shows the opponent acting with no buttons to press', async () => {
    seedSettings({ opponentDelayMs: 2000 })
    const { user } = await renderPhone(PASSIVE)
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    const controls = within(screen.getByTestId('phone-controls'))
    expect(controls.getByText('Opponent…')).toBeInTheDocument()
    expect(within(screen.getByTestId('phone-actions')).queryAllByRole('button')).toEqual([])
    // Once it has chosen, the prompt says what it is doing before it is done.
    await waitFor(() => expect(screen.getByTestId('action-prompt')).toHaveTextContent(/^Opponent: /))
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

  it("opens your resources as a sheet from the count, and keeps the opponent's hidden", async () => {
    const onExit = vi.fn()
    renderGame(<GameScreen deck={DECK} opponentDeck={SECRET_DECK} onExit={onExit} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-0'))
    expect(screen.getByTestId('round-phase')).toHaveTextContent('Round 1 · Action')
    expect(within(screen.getByTestId('opponent-summary')).getByTestId('stat-res')).toBeDisabled()
    await user.click(within(screen.getByTestId('player-summary')).getByTestId('stat-res'))
    const sheet = screen.getByRole('dialog', { name: 'Your resources' })
    expect(within(sheet).getAllByTestId('card-face')).toHaveLength(2)
    expect(sheet).toHaveTextContent('Pricey Unit')
    // The opponent resourced two Secret Units: hidden information, so nowhere in the page.
    expect(document.body.innerHTML).not.toMatch(/Secret Unit|TST_902/)
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
    expect(screen.getByRole('dialog', { name: 'Sealed settings' })).toBeInTheDocument()
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

describe('GameScreen on a desktop', () => {
  beforeEach(async () => {
    withMedia([])
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of SWU_CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('runs the phone layout grown, with the log docked in a wider column', async () => {
    const { user } = await renderPhone()
    expect(screen.getByTestId('phone-layout')).toHaveAttribute('data-scale', 'desktop')
    expect(screen.getByTestId('phone-controls')).toHaveStyle({ width: '300px' })
    const controls = within(screen.getByTestId('phone-controls'))
    expect(controls.getByRole('button', { name: /leave the game/i })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: /more/i })).toBeInTheDocument()
    expect(controls.queryByRole('button', { name: /^log$/i })).toBeNull()
    expect(controls.getByTestId('round-phase')).toHaveTextContent('Round 1 · Setup')
    await user.click(controls.getByRole('button', { name: /keep hand/i }))
    const log = within(controls.getByRole('log', { name: 'Log' }))
    expect(log.getAllByTestId('log-round').map(el => el.textContent)).toContain('Setup')
    expect(log.getAllByTestId('log-row')[0]).toHaveTextContent(/keep/i)
    expectPromptPinned('desktop')
    expectArenaLabels('desktop')
    // The header's bug, cog and ? buttons are gone: they live under More.
    expect(screen.queryByTestId('settings-btn')).toBeNull()
    expect(screen.queryByTestId('bug-report-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: /^help$/i })).toBeNull()
  })

  it('grows the cards: the hand in its taller row, units in larger slots', async () => {
    const { user } = await renderPhone()
    expect(screen.getByTestId('player-hand')).toHaveStyle({ height: '132px' })
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('hand-card-3'))
    expect(screen.getByTestId('board-unit-u1')).toHaveStyle({ width: '84px', height: '84px' })
  })

  it('holds Report a bug under More when it is turned on, and opens the form', async () => {
    seedSettings({ showBugReport: true })
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: /report a bug/i }))
    expect(screen.getByTestId('bug-report-overlay')).toBeInTheDocument()
  })

  it('has no Report a bug under More while it is turned off', async () => {
    seedSettings({ showBugReport: false })
    const { user } = await renderPhone()
    await user.click(screen.getByRole('button', { name: /more/i }))
    expect(within(screen.getByRole('dialog', { name: 'More' })).queryByRole('button', { name: /report a bug/i })).toBeNull()
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
