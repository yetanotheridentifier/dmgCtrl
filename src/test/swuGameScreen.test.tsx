import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import SwuGameScreen from '../components/swuGameScreen'
import { EPIC_TEXT_TOP, READOUT_BOTTOM } from '../components/swuGameStyles'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockOnGameStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnDamageDealt = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnDamageHealed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnRoundIncremented = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnUndoUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnEpicActionUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceGained = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnGameEnd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnMatchCompleted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onGameStart: mockOnGameStart,
  onGameEnd: mockOnGameEnd,
  onDamageDealt: mockOnDamageDealt,
  onDamageHealed: mockOnDamageHealed,
  onRoundIncremented: mockOnRoundIncremented,
  onUndoUsed: mockOnUndoUsed,
  onEpicActionUsed: mockOnEpicActionUsed,
  onForceGained: mockOnForceGained,
  onForceUsed: mockOnForceUsed,
  onMatchCompleted: mockOnMatchCompleted,
  onImageLoadFailed: vi.fn().mockResolvedValue(undefined),
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: false,
  forceTokenDisplay: 'lof-only' as 'always-on' | 'lof-only' | 'always-off',
  enableInitiativeBar: true,
  enableDamageButtons: false,
  bo1TimerMinutes: 25,
  bo3TimerMinutes: 55,
  setBo1TimerMinutes: vi.fn(),
  setBo3TimerMinutes: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

const mockTimerReset = vi.hoisted(() => vi.fn())
const mockUseTimer = vi.hoisted(() => vi.fn())
vi.mock('../hooks/useTimer', () => ({
  useTimer: mockUseTimer,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFields = {
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  rarity: 'Common',
}

// No epic action
const mockBase: Base = {
  ...baseFields,
  set: 'SOR',
  number: '026',
  name: 'Catacombs of Cadera',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
  hyperspaceArt: 'https://cdn.starwarsunlimited.com/catacombs-hyperspace.png',
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
  epicAction: '',
  aspects: ['Aggression'],
}

const mockBaseWithEpicAction: Base = {
  ...baseFields,
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  epicAction: 'Epic Action: Play a unit that costs 6 or less from your hand.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

// A passive ability in the epicAction field: no epic action button
const mockBasePassiveEffect: Base = {
  ...baseFields,
  set: 'SOR',
  number: '027',
  name: 'Echo Base',
  subtitle: 'Hoth',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/027.png',
  epicAction: 'When a friendly unit enters play: Gain 1 shield.',
  aspects: ['Vigilance'],
}

// Only frontArt: one error exhausts the art
const mockBaseNoLowRes: Base = {
  ...baseFields,
  set: 'SOR',
  number: '021',
  name: 'Dagobah Swamp',
  subtitle: 'Dagobah',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/021.png',
  epicAction: '',
  aspects: ['Vigilance'],
}

const mockBaseForce: Base = {
  ...baseFields,
  set: 'LOF',
  number: '026',
  name: 'Lothal Airfield',
  subtitle: 'Lothal',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/LOF/026.png',
  epicAction: 'When a friendly Force unit attacks: The Force is with you (create your Force token).',
  aspects: ['Vigilance'],
}

const mockBaseMysticMonastery: Base = {
  ...baseFields,
  set: 'LOF',
  number: '022',
  name: 'Mystic Monastery',
  subtitle: 'Lothal',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/LOF/022.png',
  epicAction: 'Action: The Force is with you (create your Force token). Use this ability no more than 3 times each game.',
  aspects: ['Vigilance'],
}

const otherSorBase: Base = { ...mockBaseWithEpicAction, number: '028', name: 'Jedha City', hp: 28 }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Props = Partial<React.ComponentProps<typeof SwuGameScreen>>

function renderGame(props: Props = {}) {
  const onBack = props.onBack ?? vi.fn()
  const onHelp = props.onHelp ?? vi.fn()
  render(<SwuGameScreen base={mockBase} {...props} onBack={onBack} onHelp={onHelp} />)
  return { onBack, onHelp }
}

const card = () => screen.getByTestId('game-card')
const counter = () => screen.getByTestId('game-counter')
const tapCard = () => fireEvent.click(card())
const startGame = tapCard

// delta = startY - endY; past the 15px dead zone, every 14px is one more: 40px is 3.
function dragCard(fromY: number, toY: number) {
  fireEvent.pointerDown(card(), { clientY: fromY, pointerId: 1 })
  fireEvent.pointerMove(card(), { clientY: toY, pointerId: 1 })
  fireEvent.pointerUp(card(), { clientY: toY, pointerId: 1 })
}

const endGameSheet = () => screen.getByRole('dialog', { name: /^End game/ })
const openEndGame = () => fireEvent.click(screen.getByRole('button', { name: 'End game' }))
const choose = (result: 'Won' | 'Lost' | 'Draw') =>
  fireEvent.click(within(endGameSheet()).getByRole('button', { name: result }))
const record = () =>
  fireEvent.click(within(endGameSheet()).getByRole('button', { name: /^Record/ }))
const recordResult = (result: 'Won' | 'Lost' | 'Draw') => {
  openEndGame()
  choose(result)
  record()
}

const openLog = () => fireEvent.click(screen.getByRole('button', { name: 'Log' }))
const undo = () => fireEvent.click(screen.getByTestId('log-undo-btn'))

beforeEach(() => {
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
  mockUserSettings.forceTokenDisplay = 'lof-only'
  mockUserSettings.useHyperspace = false
  mockUserSettings.enableInitiativeBar = true
  mockUserSettings.enableDamageButtons = false
  mockUserSettings.bo1TimerMinutes = 25
  mockUserSettings.bo3TimerMinutes = 55
  mockUserSettings.setBo1TimerMinutes.mockClear()
  mockUserSettings.setBo3TimerMinutes.mockClear()
  mockTimerReset.mockClear()
  mockUseTimer.mockReset()
  mockUseTimer.mockImplementation((duration: number) => ({
    remaining: duration,
    isRunning: false,
    isExpired: false,
    start: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    reset: mockTimerReset,
  }))
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe('SwuGameScreen: the card’s readout keeps clear of the epic action text', () => {
  const pct = (v: string) => Number(/^(-?[\d.]+)%$/.exec(v)?.[1] ?? NaN)
  const readoutBox = () => {
    const s = counter().style
    return { top: pct(s.top), bottom: 100 - pct(s.bottom), align: s.justifyContent }
  }

  it('the epic text line is where the card prints the text box: measured at 62.6% to 62.8% of the card', () => {
    expect(EPIC_TEXT_TOP).toBeGreaterThanOrEqual(62)
    expect(EPIC_TEXT_TOP).toBeLessThanOrEqual(62.6)
  })

  it('the readout’s bottom is pinned at or above the epic text line and it grows upward, below the top band', () => {
    renderGame({ base: mockBaseWithEpicAction })
    const box = readoutBox()
    expect(box.bottom).toBe(READOUT_BOTTOM)
    expect(box.bottom).toBeLessThanOrEqual(EPIC_TEXT_TOP)
    expect(box.align).toBe('flex-end')
    expect(box.top).toBeGreaterThanOrEqual(17)
  })

  it('every base, with or without an epic action, before and after the start, puts it in the same place', () => {
    const boxes = [mockBase, mockBaseWithEpicAction].flatMap(base => {
      const { unmount } = render(<SwuGameScreen base={base} onBack={vi.fn()} onHelp={vi.fn()} />)
      const before = readoutBox()
      startGame()
      const after = readoutBox()
      unmount()
      return [before, after]
    })
    for (const box of boxes) expect(box).toEqual(boxes[0])
  })

  it('the shading behind it ends at the epic text line', () => {
    renderGame({ base: mockBaseWithEpicAction })
    const s = screen.getByTestId('card-shading').style
    const [top, bottom] = [pct(s.top), 100 - pct(s.bottom)]
    const centre = (top + bottom) / 2
    expect(bottom).toBeLessThanOrEqual(EPIC_TEXT_TOP)
    expect(top).toBeGreaterThanOrEqual(17)
    expect(centre).toBeLessThan(READOUT_BOTTOM)
    expect(centre).toBeGreaterThan(READOUT_BOTTOM - 20)
  })

  it('the drag amount sits beside the readout, clear of the epic text', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    fireEvent.pointerDown(card(), { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(card(), { clientY: 240, pointerId: 1 })
    const top = pct(screen.getByTestId('drag-amount').style.top)
    expect(top).toBeGreaterThan(readoutBox().top)
    expect(top).toBeLessThan(READOUT_BOTTOM - 20)
  })
})

describe('SwuGameScreen: the card', () => {
  it('shows Start before the game', () => {
    renderGame()
    expect(counter()).toHaveTextContent('Start')
    expect(counter()).toHaveTextContent('tap the card')
  })

  it('tapping the card starts the game: damage 0 and HP left', () => {
    renderGame()
    startGame()
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(counter()).toHaveTextContent('30 HP left')
    expect(mockOnGameStart).toHaveBeenCalledWith('SOR-026', 'SOR', false, 'casual')
  })

  it('HP left uses the base’s own HP', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    expect(counter()).toHaveTextContent('25 HP left')
  })

  it('a tap adds 1 damage once the game has started', () => {
    renderGame()
    startGame()
    tapCard()
    tapCard()
    expect(screen.getByTestId('damage')).toHaveTextContent('2')
    expect(counter()).toHaveTextContent('28 HP left')
    expect(mockOnDamageDealt).toHaveBeenCalledWith('SOR-026', 'SOR', 1)
  })

  it('a tap before the game starts adds no damage', () => {
    renderGame()
    tapCard()
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(mockOnDamageDealt).not.toHaveBeenCalled()
  })

  it('a drag before the game starts does nothing', () => {
    renderGame()
    dragCard(300, 260)
    expect(counter()).toHaveTextContent('Start')
    expect(mockOnDamageDealt).not.toHaveBeenCalled()
  })

  it('dragging up adds several damage on release', () => {
    renderGame()
    startGame()
    dragCard(300, 260)
    expect(screen.getByTestId('damage')).toHaveTextContent('3')
    expect(mockOnDamageDealt).toHaveBeenCalledWith('SOR-026', 'SOR', 3)
  })

  it('shows the running amount while dragging, and clears it on release', () => {
    renderGame()
    startGame()
    fireEvent.pointerDown(card(), { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(card(), { clientY: 260, pointerId: 1 })
    expect(screen.getByTestId('drag-amount')).toHaveTextContent('+3')
    fireEvent.pointerUp(card(), { clientY: 260, pointerId: 1 })
    expect(screen.queryByTestId('drag-amount')).not.toBeInTheDocument()
  })

  it('dragging down removes damage, shown as a minus amount', () => {
    renderGame()
    startGame()
    dragCard(300, 146)
    expect(screen.getByTestId('damage')).toHaveTextContent('11')
    fireEvent.pointerDown(card(), { clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(card(), { clientY: 240, pointerId: 1 })
    expect(screen.getByTestId('drag-amount')).toHaveTextContent('−3')
    fireEvent.pointerUp(card(), { clientY: 240, pointerId: 1 })
    expect(screen.getByTestId('damage')).toHaveTextContent('8')
    expect(mockOnDamageHealed).toHaveBeenCalledWith('SOR-026', 'SOR', 3)
  })

  it('a drag inside the dead zone is a tap', () => {
    renderGame()
    startGame()
    dragCard(300, 290)
    tapCard()
    expect(screen.getByTestId('damage')).toHaveTextContent('1')
  })

  it('the click that ends a drag adds no extra damage', () => {
    renderGame()
    startGame()
    dragCard(300, 260)
    tapCard()
    expect(screen.getByTestId('damage')).toHaveTextContent('3')
  })

  it('pointer cancel applies nothing', () => {
    renderGame()
    startGame()
    fireEvent.pointerDown(card(), { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(card(), { clientY: 200, pointerId: 1 })
    fireEvent.pointerCancel(card(), { pointerId: 1 })
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(screen.queryByTestId('drag-amount')).not.toBeInTheDocument()
  })

  it('damage stops at full HP: a drag is capped and a tap adds nothing', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    dragCard(1000, 0)
    expect(screen.getByTestId('damage')).toHaveTextContent('25')
    expect(counter()).toHaveTextContent('0 HP left')
    expect(mockOnDamageDealt).toHaveBeenLastCalledWith('SOR-022', 'SOR', 25)
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }))
    mockOnDamageDealt.mockClear()
    tapCard()
    expect(screen.getByTestId('damage')).toHaveTextContent('25')
    expect(mockOnDamageDealt).not.toHaveBeenCalled()
  })

  it('damage stops at 0: dragging down at 0 removes nothing', () => {
    renderGame()
    startGame()
    dragCard(100, 300)
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(mockOnDamageHealed).not.toHaveBeenCalled()
  })

  it('the card art is drawn with the base’s name as its alt text', () => {
    renderGame()
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.frontArt)
  })

  it('uses the hyperspace art when that setting is on', () => {
    mockUserSettings.useHyperspace = true
    renderGame()
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.hyperspaceArtHiRes)
  })

  it('falls back to the base’s name, ability and subtitle when the art fails', () => {
    renderGame({ base: { ...mockBaseNoLowRes, epicAction: 'Epic Action: Draw a card.' } })
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah Swamp')).toBeInTheDocument()
    expect(screen.getByText('Epic Action: Draw a card.')).toBeInTheDocument()
    expect(screen.getByText('Dagobah')).toBeInTheDocument()
  })

  it('shows no fallback text once the art loads', () => {
    renderGame()
    fireEvent.load(screen.getByAltText(mockBase.name))
    expect(screen.queryByText('Catacombs of Cadera')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Left margin
// ---------------------------------------------------------------------------

describe('SwuGameScreen: back', () => {
  it('Back calls onBack with the games completed', () => {
    const { onBack } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledWith(0)
  })

  it('Back before the game sends no game end; after the start it does', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockOnGameEnd).not.toHaveBeenCalled()
    startGame()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockOnGameEnd).toHaveBeenCalledOnce()
  })

  it('keeps its landscape layout in portrait, turned a quarter, with no rotate prompt', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    const { onBack } = renderGame()
    expect(screen.getByTestId('turned-frame').style.transform).toMatch(/rotate\(90deg\)/)
    expect(screen.getByTestId('turned-frame')).toContainElement(card())
    expect(screen.queryByText(/rotate/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('is upright in landscape', () => {
    renderGame()
    expect(screen.getByTestId('turned-frame').style.transform).not.toMatch(/rotate/)
  })

  it('keeps the screen awake, whatever the old setting said', () => {
    renderGame()
    expect(vi.mocked(useWakeLock)).toHaveBeenCalledWith(true)
  })
})

describe('SwuGameScreen: epic action', () => {
  const epicReady = () => screen.getByRole('button', { name: 'Epic action: tap when used' })

  it('is shown, disabled, before the game', () => {
    renderGame({ base: mockBaseWithEpicAction })
    expect(screen.getByRole('button', { name: 'Epic action, from the game’s start' })).toBeDisabled()
  })

  it('is ready once the game starts', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    expect(epicReady()).toBeEnabled()
  })

  it('tapping it marks it used: the button greys and the token covers the text box', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    expect(screen.queryByTestId('epic-action-token')).not.toBeInTheDocument()
    fireEvent.click(epicReady())
    expect(screen.getByRole('button', { name: 'Epic action used' })).toBeDisabled()
    expect(screen.getByTestId('epic-action-token')).toHaveTextContent('EPIC ACTION USED')
    expect(mockOnEpicActionUsed).toHaveBeenCalledWith('SOR-022', 'SOR')
  })

  it('undo in the log takes it back', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    fireEvent.click(epicReady())
    openLog()
    expect(screen.getByText('Epic action used', { selector: 'span' })).toBeInTheDocument()
    undo()
    expect(epicReady()).toBeEnabled()
    expect(screen.queryByTestId('epic-action-token')).not.toBeInTheDocument()
  })

  it('is not shown for a base without an epic action, or with a passive ability', () => {
    renderGame()
    expect(screen.queryByRole('button', { name: /^Epic action/ })).not.toBeInTheDocument()
    renderGame({ base: mockBasePassiveEffect })
    expect(screen.queryByRole('button', { name: /^Epic action/ })).not.toBeInTheDocument()
  })
})

describe('SwuGameScreen: the Force', () => {
  const gain = () => screen.getByRole('button', { name: /^Gain the Force/ })
  const active = () => screen.getByRole('button', { name: 'The Force is with you: tap to clear' })

  it('a Force base shows the Force button, disabled before the game', () => {
    renderGame({ base: mockBaseForce })
    expect(gain()).toBeDisabled()
    startGame()
    expect(gain()).toBeEnabled()
  })

  it('tapping it gains the Force; tapping again uses it', () => {
    renderGame({ base: mockBaseForce })
    startGame()
    fireEvent.click(gain())
    expect(mockOnForceGained).toHaveBeenCalledWith('LOF-026', 'LOF')
    fireEvent.click(active())
    expect(mockOnForceUsed).toHaveBeenCalledWith('LOF-026', 'LOF')
    expect(gain()).toBeEnabled()
  })

  it('nothing covers the card when the Force is gained', () => {
    renderGame({ base: mockBaseForce })
    startGame()
    fireEvent.click(gain())
    expect(within(card()).queryByText(/Force/i)).not.toBeInTheDocument()
  })

  it('is hidden for a non-Force base with LOF bases only, and shown with Always', () => {
    renderGame()
    expect(screen.queryByRole('button', { name: /^Gain the Force/ })).not.toBeInTheDocument()
    mockUserSettings.forceTokenDisplay = 'always-on'
    renderGame()
    expect(gain()).toBeInTheDocument()
  })

  it('is hidden for every base with Off', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    renderGame({ base: mockBaseForce })
    expect(screen.queryByRole('button', { name: /^Gain the Force/ })).not.toBeInTheDocument()
  })

  it('undo in the log takes back a Force gained', () => {
    renderGame({ base: mockBaseForce })
    startGame()
    fireEvent.click(gain())
    openLog()
    undo()
    expect(gain()).toBeEnabled()
  })
})

describe('SwuGameScreen: Mystic Monastery', () => {
  const gain = () => screen.getByRole('button', { name: /^Gain the Force/ })
  const active = () => screen.getByRole('button', { name: 'The Force is with you: tap to clear' })

  it('shows the uses left, 3 at the start, disabled before the game', () => {
    renderGame({ base: mockBaseMysticMonastery })
    expect(gain()).toHaveAccessibleName('Gain the Force: 3 uses left')
    expect(gain()).toHaveTextContent('3 LEFT')
    expect(gain()).toBeDisabled()
  })

  it('each use gains the Force and counts down', () => {
    renderGame({ base: mockBaseMysticMonastery })
    startGame()
    fireEvent.click(gain())
    expect(active()).toHaveTextContent('2 LEFT')
    fireEvent.click(active())
    expect(gain()).toHaveAccessibleName('Gain the Force: 2 uses left')
  })

  it('after three uses the button is disabled', () => {
    renderGame({ base: mockBaseMysticMonastery })
    startGame()
    for (let i = 0; i < 3; i++) {
      fireEvent.click(gain())
      fireEvent.click(active())
    }
    expect(screen.getByRole('button', { name: 'No Force uses left' })).toBeDisabled()
  })

  it('undo restores a use', () => {
    renderGame({ base: mockBaseMysticMonastery })
    startGame()
    fireEvent.click(gain())
    openLog()
    undo()
    expect(gain()).toHaveAccessibleName('Gain the Force: 3 uses left')
  })

  it('is hidden with Force tokens Off', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    renderGame({ base: mockBaseMysticMonastery })
    expect(screen.queryByRole('button', { name: /Force/ })).not.toBeInTheDocument()
  })
})

describe('SwuGameScreen: initiative', () => {
  const opp = () => screen.getByRole('radio', { name: /^Opponent/ })
  const you = () => screen.getByRole('radio', { name: /^You/ })

  it('is on by default, with neither side holding it', () => {
    renderGame()
    expect(screen.getByRole('radiogroup', { name: 'Initiative' })).toBeInTheDocument()
    expect(opp()).toHaveAttribute('aria-checked', 'false')
    expect(you()).toHaveAttribute('aria-checked', 'false')
  })

  // The same look as the two-player game's: outlined solid until taken, then filled.
  it('has no dashed outline: each side is outlined solid until it takes the initiative, then filled', () => {
    renderGame()
    // One bar behind OPP, INIT and YOU ties the buttons to the label, whoever holds it.
    const bar = () => screen.getByRole('radiogroup', { name: 'Initiative' })
    expect(bar().style.border).not.toMatch(/dashed/)
    expect(bar().style.background).toBe('var(--color-surface)')
    expect(opp().style.border).toMatch(/^2px solid /)
    expect(opp().style.background).toBe('transparent')
    fireEvent.click(opp())
    expect(opp().style.background).toBe('var(--color-accent)')
    expect(you().style.border).toMatch(/^2px solid /)
    expect(bar().style.background).toBe('var(--color-surface)')
  })

  it('tapping OPP or YOU gives that side the initiative', () => {
    renderGame()
    fireEvent.click(opp())
    expect(opp()).toHaveAttribute('aria-checked', 'true')
    expect(opp()).toHaveAccessibleName('Opponent has initiative')
    fireEvent.click(you())
    expect(you()).toHaveAttribute('aria-checked', 'true')
    expect(opp()).toHaveAttribute('aria-checked', 'false')
  })

  it('a new round keeps it', () => {
    renderGame()
    startGame()
    fireEvent.click(opp())
    fireEvent.click(screen.getByRole('button', { name: /^Round 1/ }))
    expect(opp()).toHaveAttribute('aria-checked', 'true')
  })

  it('is hidden when the Initiative setting is off', () => {
    mockUserSettings.enableInitiativeBar = false
    renderGame()
    expect(screen.queryByRole('radiogroup', { name: 'Initiative' })).not.toBeInTheDocument()
  })
})

describe('SwuGameScreen: Damage −/+ buttons setting', () => {
  const minus = () => screen.getByRole('button', { name: 'Remove 1 damage, hold and drag for more' })
  const plus = () => screen.getByRole('button', { name: 'Add 1 damage, hold and drag for more' })

  it('are off by default', () => {
    renderGame()
    expect(screen.queryByRole('button', { name: /^Add 1 damage/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove 1 damage/ })).not.toBeInTheDocument()
  })

  it('when on, + and − add and remove 1, disabled before the game', () => {
    mockUserSettings.enableDamageButtons = true
    renderGame()
    expect(plus()).toBeDisabled()
    expect(minus()).toBeDisabled()
    startGame()
    fireEvent.click(plus())
    fireEvent.click(plus())
    fireEvent.click(minus())
    expect(screen.getByTestId('damage')).toHaveTextContent('1')
  })

  it('hold and drag on + adds several', () => {
    mockUserSettings.enableDamageButtons = true
    renderGame()
    startGame()
    fireEvent.pointerDown(plus(), { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plus(), { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plus(), { pointerId: 1 })
    expect(screen.getByTestId('damage')).toHaveTextContent('3')
  })
})

// ---------------------------------------------------------------------------
// Right margin
// ---------------------------------------------------------------------------

describe('SwuGameScreen: log, More, round', () => {
  it('Log opens and closes the log', () => {
    renderGame()
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
    openLog()
    expect(screen.getByTestId('log-overlay')).toBeInTheDocument()
    openLog()
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
  })

  it('More holds Help and Settings', () => {
    const onSettings = vi.fn()
    const { onHelp } = renderGame({ onSettings })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('before the game there is no Round or End game in casual play', () => {
    renderGame()
    expect(screen.queryByRole('button', { name: /^Round/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End game' })).not.toBeInTheDocument()
  })

  it('Round shows the round and moves to the next on a tap', () => {
    renderGame()
    startGame()
    const round = screen.getByRole('button', { name: 'Round 1: tap for round 2' })
    fireEvent.click(round)
    expect(screen.getByRole('button', { name: 'Round 2: tap for round 3' })).toHaveTextContent('2')
    expect(mockOnRoundIncremented).toHaveBeenCalledWith('SOR-026', 'SOR', 2)
  })

  it('the round stops at 99', () => {
    renderGame()
    startGame()
    for (let i = 0; i < 100; i++) fireEvent.click(screen.getByRole('button', { name: /^Round \d+:/ }))
    expect(screen.getByRole('button', { name: /^Round 99/ })).toBeInTheDocument()
  })

  it('casual play has no timer and no games chip', () => {
    renderGame()
    expect(screen.queryByRole('button', { name: 'Timer and round tracker' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Games:/)).not.toBeInTheDocument()
  })

  it('best of 1 and 3 show the timer and the games chip', () => {
    renderGame({ playMode: 'bo3' })
    expect(screen.getByRole('button', { name: 'Timer and round tracker' })).toHaveTextContent('55:00')
    expect(screen.getByLabelText('Games: you 0, opponent 0')).toHaveTextContent('0–0')
  })

  it('the log records each action, and undo steps back through them', () => {
    renderGame()
    startGame()
    tapCard()
    dragCard(300, 260)
    fireEvent.click(screen.getByRole('button', { name: /^Round 1/ }))
    openLog()
    const log = screen.getByTestId('log-overlay')
    expect(log).toHaveTextContent('Round 1')
    expect(log).toHaveTextContent('Hit +1')
    expect(log).toHaveTextContent('Hit +3')
    expect(log).toHaveTextContent('Round 2')
    undo()
    undo()
    expect(screen.getByTestId('damage')).toHaveTextContent('1')
    expect(mockOnUndoUsed).toHaveBeenCalledWith('SOR-026', 'SOR', 'hit')
  })

  it('undoing Round 1 goes back to Start and resets the timer', () => {
    renderGame({ playMode: 'bo1' })
    startGame()
    openLog()
    undo()
    expect(counter()).toHaveTextContent('Start')
    expect(mockTimerReset).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

describe('SwuGameScreen: timer', () => {
  const openTimer = () => fireEvent.click(screen.getByRole('button', { name: 'Timer and round tracker' }))
  const sheet = () => screen.getByRole('dialog', { name: 'Round and timer' })

  it('runs for the remembered length of the match type', () => {
    renderGame({ playMode: 'bo1' })
    expect(mockUseTimer).toHaveBeenLastCalledWith(25 * 60)
    renderGame({ playMode: 'bo3' })
    expect(mockUseTimer).toHaveBeenLastCalledWith(55 * 60)
  })

  it('before the first game, the timer opens a game length stepper that remembers bo3', () => {
    renderGame({ playMode: 'bo3' })
    openTimer()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Increase game length' }))
    expect(mockUserSettings.setBo3TimerMinutes).toHaveBeenCalledWith(60)
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Decrease game length' }))
    expect(mockUserSettings.setBo3TimerMinutes).toHaveBeenCalledWith(50)
  })

  it('the stepper remembers bo1 separately', () => {
    renderGame({ playMode: 'bo1' })
    openTimer()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Increase game length' }))
    expect(mockUserSettings.setBo1TimerMinutes).toHaveBeenCalledWith(30)
    expect(mockUserSettings.setBo3TimerMinutes).not.toHaveBeenCalled()
  })

  it('once the game has started, the timer sheet shows the round but no stepper', () => {
    renderGame({ playMode: 'bo1' })
    startGame()
    openTimer()
    expect(sheet()).toHaveTextContent('Round 1')
    expect(within(sheet()).queryByRole('button', { name: 'Increase game length' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Ending a game
// ---------------------------------------------------------------------------

describe('SwuGameScreen: End game sheet', () => {
  it('opens with Won, Lost and Draw, and Record waits for a choice', () => {
    renderGame()
    startGame()
    openEndGame()
    const s = endGameSheet()
    expect(within(s).getByRole('button', { name: 'Won' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Lost' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Draw' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Record' })).toBeDisabled()
    choose('Won')
    expect(within(s).getByRole('button', { name: 'Record win' })).toBeEnabled()
  })

  it('opens itself with Lost chosen when your base reaches 0', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    dragCard(1000, 0)
    const s = endGameSheet()
    expect(s).toHaveTextContent('Your base is destroyed')
    expect(within(s).getByRole('button', { name: 'Lost' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(s).getByRole('button', { name: 'Record loss' })).toBeEnabled()
  })

  it('Keep playing closes it, and it stays closed', () => {
    renderGame({ base: mockBaseWithEpicAction })
    startGame()
    dragCard(1000, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }))
    expect(screen.queryByRole('dialog', { name: /^End game/ })).not.toBeInTheDocument()
    tapCard()
    expect(screen.queryByRole('dialog', { name: /^End game/ })).not.toBeInTheDocument()
  })

  it('recording sends the game end', () => {
    renderGame({ playMode: 'bo1', format: 'premier' })
    startGame()
    recordResult('Won')
    expect(mockOnGameEnd).toHaveBeenCalledWith('SOR-026', 'SOR', false, expect.any(Number), 'bo1', 'premier')
  })
})

describe('SwuGameScreen: casual game over', () => {
  const gameOver = () => screen.getByRole('dialog', { name: /^Game (won|lost|drawn)$/ })

  it('shows the result, the round and the damage taken', () => {
    renderGame()
    startGame()
    dragCard(300, 146)
    fireEvent.click(screen.getByRole('button', { name: /^Round 1/ }))
    recordResult('Won')
    expect(gameOver()).toHaveAccessibleName('Game won')
    expect(gameOver()).toHaveTextContent('Ended in round 2 · 11 damage taken')
  })

  it('Rematch resets the damage and goes back to Start on the same base', () => {
    renderGame()
    startGame()
    tapCard()
    recordResult('Lost')
    fireEvent.click(within(gameOver()).getByRole('button', { name: 'Rematch' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(counter()).toHaveTextContent('Start')
    startGame()
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(screen.getByAltText(mockBase.name)).toBeInTheDocument()
  })

  it('New setup goes back', () => {
    const { onBack } = renderGame()
    startGame()
    recordResult('Draw')
    fireEvent.click(within(gameOver()).getByRole('button', { name: 'New setup' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('undo in the log takes back the recorded result', () => {
    renderGame()
    startGame()
    tapCard()
    tapCard()
    recordResult('Won')
    fireEvent.click(within(gameOver()).getByRole('button', { name: 'Close' }))
    openLog()
    expect(screen.getByTestId('log-overlay')).toHaveTextContent('Game won')
    undo()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('damage')).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('there is no match to complete in casual play', () => {
    const onMatchComplete = vi.fn()
    renderGame({ onMatchComplete })
    startGame()
    recordResult('Won')
    expect(onMatchComplete).not.toHaveBeenCalled()
    expect(mockOnMatchCompleted).not.toHaveBeenCalled()
  })
})

describe('SwuGameScreen: best of 1 and 3', () => {
  it('best of 3: a win advances the games chip and the next game starts from the card', () => {
    renderGame({ playMode: 'bo3' })
    startGame()
    tapCard()
    openEndGame()
    expect(endGameSheet()).toHaveAccessibleName('End game 1')
    choose('Won')
    expect(endGameSheet()).toHaveTextContent('Match 1–0 after this; damage resets for game 2.')
    record()
    expect(screen.getByLabelText('Games: you 1, opponent 0')).toHaveTextContent('1–0')
    expect(counter()).toHaveTextContent('GAME 1 WON · 1–0')
    expect(counter()).toHaveTextContent('Start game 2')
    startGame()
    expect(screen.getByTestId('damage')).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('between games there is no End game, and the epic action waits for the start', () => {
    renderGame({ playMode: 'bo3', base: mockBaseWithEpicAction })
    startGame()
    fireEvent.click(screen.getByRole('button', { name: 'Epic action: tap when used' }))
    recordResult('Lost')
    expect(screen.queryByRole('button', { name: 'End game' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Epic action, from the game’s start' })).toBeDisabled()
    expect(screen.queryByTestId('epic-action-token')).not.toBeInTheDocument()
  })

  it('best of 3: two wins complete the match', () => {
    const onMatchComplete = vi.fn()
    renderGame({ playMode: 'bo3', onMatchComplete })
    startGame()
    recordResult('Won')
    startGame()
    recordResult('Won')
    expect(onMatchComplete).toHaveBeenCalledWith('won', 2, 0)
    expect(mockOnMatchCompleted).toHaveBeenCalledWith('bo3', 'won', 2, 0)
    expect(mockOnMatchCompleted).toHaveBeenCalledTimes(1)
  })

  it('best of 1: a loss completes the match', () => {
    const onMatchComplete = vi.fn()
    renderGame({ playMode: 'bo1', onMatchComplete })
    startGame()
    recordResult('Lost')
    expect(onMatchComplete).toHaveBeenCalledWith('lost', 0, 1)
  })

  it('a draw completes the match drawn', () => {
    const onMatchComplete = vi.fn()
    renderGame({ playMode: 'bo3', onMatchComplete })
    startGame()
    recordResult('Draw')
    expect(onMatchComplete).toHaveBeenCalledWith('drawn', 0, 0)
  })

  it('an intentional draw before game 1 goes through End game', () => {
    const onMatchComplete = vi.fn()
    renderGame({ playMode: 'bo1', onMatchComplete })
    recordResult('Draw')
    expect(onMatchComplete).toHaveBeenCalledWith('drawn', 0, 0)
  })

  it('a result recorded after time is called closes the match', () => {
    mockUseTimer.mockImplementation((duration: number) => ({
      remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), stop: vi.fn(), resume: vi.fn(), reset: vi.fn(), duration,
    }))
    const onMatchComplete = vi.fn()
    renderGame({ playMode: 'bo3', onMatchComplete })
    startGame()
    recordResult('Won')
    expect(onMatchComplete).toHaveBeenCalledWith('won', 1, 0)
  })

  it('undo in the log takes back a game result between games', () => {
    renderGame({ playMode: 'bo3' })
    startGame()
    tapCard()
    recordResult('Lost')
    openLog()
    undo()
    expect(screen.getByLabelText('Games: you 0, opponent 0')).toBeInTheDocument()
    expect(screen.getByTestId('damage')).toHaveTextContent('1')
  })
})

describe('SwuGameScreen: changing base between games (Limited best of 3)', () => {
  const more = () => fireEvent.click(screen.getByRole('button', { name: 'More' }))

  it('More offers Change base between games, and the choice goes to onChangeBase', () => {
    const onChangeBase = vi.fn()
    renderGame({ playMode: 'bo3', base: mockBaseWithEpicAction, changeBaseOptions: [mockBaseWithEpicAction, otherSorBase], onChangeBase })
    startGame()
    recordResult('Lost')
    more()
    fireEvent.click(screen.getByRole('button', { name: 'Change base' }))
    fireEvent.click(screen.getByRole('button', { name: /Jedha City/ }))
    expect(onChangeBase).toHaveBeenCalledWith(otherSorBase)
  })

  it('is not offered before game 1 or during a game', () => {
    renderGame({ playMode: 'bo3', changeBaseOptions: [otherSorBase], onChangeBase: vi.fn() })
    more()
    expect(screen.queryByRole('button', { name: 'Change base' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    startGame()
    more()
    expect(screen.queryByRole('button', { name: 'Change base' })).not.toBeInTheDocument()
  })

  it('is not offered without base options (not Limited best of 3)', () => {
    renderGame({ playMode: 'bo3' })
    startGame()
    recordResult('Lost')
    more()
    expect(screen.queryByRole('button', { name: 'Change base' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Two players: one phone flat between you
// ---------------------------------------------------------------------------

// Your base is Catacombs of Cadera (30 HP), theirs Energy Conversion Lab (25 HP).
const render2p = (props: Props = {}) => renderGame({ theirBase: mockBaseWithEpicAction, ...props })
const yourHalf = () => screen.getByRole('region', { name: 'Your half' })
const theirHalf = () => screen.getByRole('region', { name: 'Their half' })
const cardIn = (half: HTMLElement) => within(half).getByTestId('game-card')
const damageIn = (half: HTMLElement) => within(half).getByTestId('damage')
const hit = (half: HTMLElement, times = 1) => { for (let i = 0; i < times; i++) fireEvent.click(cardIn(half)) }
const roundButton = () => screen.getByRole('button', { name: /^Round/ })

describe('SwuGameScreen: two players, layout', () => {
  it('splits the screen: your half the right way up, their half turned to face them', () => {
    render2p()
    expect(yourHalf()).not.toHaveStyle({ transform: 'rotate(180deg)' })
    expect(theirHalf()).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(within(yourHalf()).getByRole('button', { name: /Catacombs of Cadera/ })).toBeInTheDocument()
    expect(within(theirHalf()).getByRole('button', { name: /Energy Conversion Lab/ })).toBeInTheDocument()
  })

  it('stays the two-player layout in portrait and in landscape: the mode chooses it, not the orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    const { unmount } = render(<SwuGameScreen base={mockBase} theirBase={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(theirHalf()).toBeInTheDocument()
    expect(screen.queryByText(/rotate/i)).not.toBeInTheDocument()
    unmount()
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
    render2p()
    expect(theirHalf()).toBeInTheDocument()
  })

  it('the middle strip holds Back, Log, Round, End game and More', () => {
    render2p()
    const strip = screen.getByRole('navigation', { name: 'Game' })
    for (const name of ['Back to setup', 'Log', 'End game', 'More']) {
      expect(within(strip).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(strip).getByRole('button', { name: /^Round/ })).toBeInTheDocument()
  })
})

describe('SwuGameScreen: two players, starting', () => {
  it('before the game both cards say Start, and Round and End game are disabled', () => {
    render2p()
    expect(within(yourHalf()).getByTestId('game-counter')).toHaveTextContent('Start')
    expect(within(theirHalf()).getByTestId('game-counter')).toHaveTextContent('Start')
    expect(roundButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End game' })).toBeDisabled()
  })

  it('tapping their card starts the game', () => {
    render2p()
    hit(theirHalf())
    expect(damageIn(theirHalf())).toHaveTextContent('0')
    expect(damageIn(yourHalf())).toHaveTextContent('0')
    expect(roundButton()).toBeEnabled()
    expect(mockOnGameStart).toHaveBeenCalledTimes(1)
  })

  it('tapping your card starts the game', () => {
    render2p()
    hit(yourHalf())
    expect(within(theirHalf()).getByTestId('game-counter')).toHaveTextContent('25 HP left')
    expect(within(yourHalf()).getByTestId('game-counter')).toHaveTextContent('30 HP left')
  })
})

describe('SwuGameScreen: two players, damage', () => {
  it('each half counts its own damage', () => {
    render2p()
    hit(yourHalf())
    hit(yourHalf(), 2)
    hit(theirHalf())
    expect(damageIn(yourHalf())).toHaveTextContent('2')
    expect(damageIn(theirHalf())).toHaveTextContent('1')
    expect(within(theirHalf()).getByTestId('game-counter')).toHaveTextContent('24 HP left')
  })

  it('dragging up on your card adds damage', () => {
    render2p()
    hit(yourHalf())
    fireEvent.pointerDown(cardIn(yourHalf()), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(cardIn(yourHalf()), { clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(cardIn(yourHalf()), { clientY: 60, pointerId: 1 })
    expect(damageIn(yourHalf())).toHaveTextContent('3')
  })

  // Their half is turned round, so up for them is down the screen.
  it('dragging up on their card, from their side, adds damage', () => {
    render2p()
    hit(theirHalf())
    fireEvent.pointerDown(cardIn(theirHalf()), { clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(cardIn(theirHalf()), { clientY: 140, pointerId: 2 })
    fireEvent.pointerUp(cardIn(theirHalf()), { clientY: 140, pointerId: 2 })
    expect(damageIn(theirHalf())).toHaveTextContent('3')
    expect(damageIn(yourHalf())).toHaveTextContent('0')
  })

  it('the Damage −/+ buttons act on their own half', () => {
    mockUserSettings.enableDamageButtons = true
    render2p()
    hit(yourHalf())
    fireEvent.click(within(theirHalf()).getByRole('button', { name: /^Add 1 damage/ }))
    fireEvent.click(within(theirHalf()).getByRole('button', { name: /^Add 1 damage/ }))
    fireEvent.click(within(theirHalf()).getByRole('button', { name: /^Remove 1 damage/ }))
    expect(damageIn(theirHalf())).toHaveTextContent('1')
    expect(damageIn(yourHalf())).toHaveTextContent('0')
  })

  it('each half has its own epic action', () => {
    render2p({ base: mockBaseWithEpicAction, theirBase: { ...mockBaseWithEpicAction, number: '028', name: 'Jedha City' } })
    hit(yourHalf())
    fireEvent.click(within(theirHalf()).getByRole('button', { name: 'Epic action: tap when used' }))
    expect(within(theirHalf()).getByRole('button', { name: 'Epic action used' })).toBeInTheDocument()
    expect(within(yourHalf()).getByRole('button', { name: 'Epic action: tap when used' })).toBeInTheDocument()
  })
})

describe('SwuGameScreen: two players, initiative', () => {
  const initiativeIn = (half: HTMLElement) => within(half).getByRole('radio')

  it('neither holds it to begin with: both offer Take initiative', () => {
    render2p()
    expect(initiativeIn(yourHalf())).toHaveTextContent('TAKE INITIATIVE')
    expect(initiativeIn(theirHalf())).toHaveTextContent('TAKE INITIATIVE')
  })

  it('taking it on one half takes it from the other', () => {
    render2p()
    fireEvent.click(initiativeIn(theirHalf()))
    expect(initiativeIn(theirHalf())).toHaveAttribute('aria-checked', 'true')
    expect(initiativeIn(theirHalf())).toHaveTextContent(/^INITIATIVE$/)
    expect(initiativeIn(yourHalf())).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(initiativeIn(yourHalf()))
    expect(initiativeIn(yourHalf())).toHaveAttribute('aria-checked', 'true')
    expect(initiativeIn(theirHalf())).toHaveAttribute('aria-checked', 'false')
    expect(initiativeIn(theirHalf())).toHaveTextContent('TAKE INITIATIVE')
  })

  it('is hidden when the Initiative setting is off', () => {
    mockUserSettings.enableInitiativeBar = false
    render2p()
    expect(within(yourHalf()).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(theirHalf()).queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('SwuGameScreen: two players, ending a game', () => {
  const dragTo = (half: HTMLElement, amount: number, flipped: boolean) => {
    // 15px dead zone, then 14px a step from 1: 15 + 14 * (amount - 1) + 1 lands on amount.
    const d = 16 + 14 * (amount - 1)
    fireEvent.pointerDown(cardIn(half), { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(cardIn(half), { clientY: flipped ? 500 + d : 500 - d, pointerId: 1 })
    fireEvent.pointerUp(cardIn(half), { clientY: flipped ? 500 + d : 500 - d, pointerId: 1 })
  }

  it('their base reaching 0 opens End game with Won chosen', () => {
    render2p()
    hit(yourHalf())
    dragTo(theirHalf(), 25, true)
    expect(damageIn(theirHalf())).toHaveTextContent('25')
    expect(endGameSheet()).toHaveTextContent('Their base is destroyed')
    expect(within(endGameSheet()).getByRole('button', { name: 'Won' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('your base reaching 0 opens End game with Lost chosen', () => {
    render2p()
    hit(yourHalf())
    dragTo(yourHalf(), 30, false)
    expect(endGameSheet()).toHaveTextContent('Your base is destroyed')
    expect(within(endGameSheet()).getByRole('button', { name: 'Lost' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Keep playing closes it', () => {
    render2p()
    hit(yourHalf())
    dragTo(theirHalf(), 25, true)
    fireEvent.click(within(endGameSheet()).getByRole('button', { name: 'Keep playing' }))
    expect(screen.queryByRole('dialog', { name: /^End game/ })).not.toBeInTheDocument()
  })

  it('game over: each half shows its own result, with New setup and Rematch in the middle', () => {
    render2p()
    hit(yourHalf())
    recordResult('Won')
    expect(yourHalf()).toHaveTextContent('Game won')
    expect(theirHalf()).toHaveTextContent('Game lost')
    const strip = screen.getByRole('navigation', { name: 'Game over' })
    expect(within(strip).getByRole('button', { name: 'New setup' })).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Rematch' })).toBeInTheDocument()
  })

  it('Rematch keeps both bases and resets both damage counters', () => {
    render2p()
    hit(yourHalf(), 3)
    hit(theirHalf(), 2)
    recordResult('Lost')
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }))
    expect(within(yourHalf()).getByRole('button', { name: /Catacombs of Cadera/ })).toBeInTheDocument()
    expect(within(theirHalf()).getByRole('button', { name: /Energy Conversion Lab/ })).toBeInTheDocument()
    expect(within(yourHalf()).getByTestId('game-counter')).toHaveTextContent('Start')
    hit(theirHalf())
    expect(damageIn(yourHalf())).toHaveTextContent('0')
    expect(damageIn(theirHalf())).toHaveTextContent('0')
  })

  it('New setup goes back', () => {
    const { onBack } = render2p()
    hit(yourHalf())
    recordResult('Won')
    fireEvent.click(screen.getByRole('button', { name: 'New setup' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('a best of 3 records from your side', () => {
    render2p({ playMode: 'bo3' })
    hit(yourHalf())
    recordResult('Won')
    expect(within(yourHalf()).getByTestId('game-counter')).toHaveTextContent('Start game 2')
    expect(within(theirHalf()).getByTestId('game-counter')).toHaveTextContent('Start game 2')
  })
})

describe('SwuGameScreen: two players, log', () => {
  it('entries name the base', () => {
    render2p()
    hit(yourHalf())
    hit(theirHalf(), 3)
    hit(yourHalf())
    openLog()
    const log = screen.getByTestId('log-overlay')
    expect(log).toHaveTextContent('Their base: 1 damage')
    expect(log).toHaveTextContent('Your base: 1 damage')
  })

  it('undo takes back the newest entry, on the half it was on', () => {
    render2p()
    hit(yourHalf())
    hit(theirHalf(), 2)
    hit(yourHalf())
    openLog()
    undo()
    expect(damageIn(yourHalf())).toHaveTextContent('0')
    expect(damageIn(theirHalf())).toHaveTextContent('2')
    undo()
    expect(damageIn(theirHalf())).toHaveTextContent('1')
  })
})
