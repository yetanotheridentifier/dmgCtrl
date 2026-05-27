import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameScreen from '../components/swuGameScreen'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockOnDamageDealt = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnDamageHealed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnRoundIncremented = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnUndoUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnEpicActionUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceGained = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnMatchCompleted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
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
  useHyperspace: true,
  forceTokenDisplay: 'lof-only' as 'always-on' | 'lof-only' | 'always-off',
  enableEpicActions: true,
  enableWakeLock: true,
  setUseHyperspace: vi.fn(),
  setForceTokenDisplay: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
  enableLongPress: true,
  setEnableLongPress: vi.fn(),
  enableActionLog: true,
  setEnableActionLog: vi.fn(),
  enableInitiativeBar: true,
  bo1TimerMinutes: 25,
  bo3TimerMinutes: 55,
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

const mockUseTimer = vi.hoisted(() =>
  vi.fn().mockImplementation((duration: number) => ({
    remaining: duration,
    isRunning: false,
    isExpired: false,
    start: vi.fn(),
    reset: vi.fn(),
  }))
)
vi.mock('../hooks/useTimer', () => ({
  useTimer: mockUseTimer,
}))


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// SOR base — hi-res normal + hi-res hyperspace; no low-res (SOR not in swuapi.com)
const mockBase: Base = {
  set: 'SOR',
  number: '026',
  name: 'Catacombs of Cadera',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
  frontArtLowRes: null,
  hyperspaceArt: 'https://cdn.starwarsunlimited.com/catacombs-hyperspace.png',
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

// SOR base with no hyperspace variant
const mockBaseNoHyperspace: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'Epic Action: Play a unit that costs 6 or less.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

const mockBaseWithEpicAction: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'Epic Action: Play a unit that costs 6 or less from your hand.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

// Base whose only art is frontArt (null low-res, no hyperspace) — simulates a total art failure in one error
const mockBaseNoLowRes: Base = {
  set: 'SOR',
  number: '021',
  name: 'Dagobah Swamp',
  subtitle: 'Dagobah',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/021.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: '',
  aspects: ['Vigilance'],
  rarity: 'Common',
}

// Base with a passive epicAction field — no "Epic Action" keyword, should NOT show epic action button
const mockBasePassiveEffect: Base = {
  set: 'SOR',
  number: '027',
  name: 'Echo Base',
  subtitle: 'Hoth',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/027.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'When a friendly unit enters play: Gain 1 shield.',
  aspects: ['Vigilance'],
  rarity: 'Common',
}

// LOF Force base — epicAction text matches the consistent phrase used by all Force bases
const mockBaseForce: Base = {
  set: 'LOF',
  number: '026',
  name: 'Lothal Airfield',
  subtitle: 'Lothal',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/LOF/026.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'When a friendly Force unit attacks: The Force is with you (create your Force token).',
  aspects: ['Vigilance'],
  rarity: 'Common',
}

// Mystic Monastery (LOF #022) — limited-use Force action base
const mockBaseMysticMonastery: Base = {
  set: 'LOF',
  number: '022',
  name: 'Mystic Monastery',
  subtitle: 'Lothal',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/LOF/022.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'Action: The Force is with you (create your Force token). Use this ability no more than 3 times each game.',
  aspects: ['Vigilance'],
  rarity: 'Common',
}

// LAW base with full coverage: hi-res + low-res normal, hi-res + low-res hyperspace
const mockBaseFullCoverage: Base = {
  set: 'LAW',
  number: '021',
  name: 'Coaxium Mine',
  subtitle: 'Kessel',
  hp: 27,
  frontArt: 'https://cdn.swu-db.com/images/cards/LAW/021.png',
  frontArtLowRes: 'https://cdn.starwarsunlimited.com/coaxium-mine.png',
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/LAW/285.png',
  hyperspaceArt: 'https://cdn.starwarsunlimited.com/coaxium-mine-hs.png',
  epicAction: 'Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.',
  aspects: ['Vigilance'],
  rarity: 'Common',
}

describe('SwuGameScreen', () => {

  beforeEach(() => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
    mockUserSettings.forceTokenDisplay = 'lof-only'
    mockUserSettings.enableEpicActions = true
    mockUserSettings.enableWakeLock = true
    mockUserSettings.useHyperspace = false
    mockUserSettings.enableLongPress = true
    mockUserSettings.enableActionLog = true
    mockUserSettings.enableInitiativeBar = true
    mockUserSettings.bo1TimerMinutes = 25
    mockUserSettings.bo3TimerMinutes = 55
    mockUseTimer.mockImplementation((duration: number) => ({
      remaining: duration,
      isRunning: false,
      isExpired: false,
      start: vi.fn(),
      reset: vi.fn(),
    }))
    mockOnDamageDealt.mockClear()
    mockOnDamageHealed.mockClear()
    mockOnRoundIncremented.mockClear()
    mockOnUndoUsed.mockClear()
    mockOnEpicActionUsed.mockClear()
    mockOnForceGained.mockClear()
    mockOnForceUsed.mockClear()
  })

  const startGame = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText('Start'))
  }

  // --- Rendering ---

  it('Shows Start on the game counter initially', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start')
  })

  it('Displays the correct remaining health after starting', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Displays correct remaining for non-default starting health', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Renders the back button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('Renders a + button and a − button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('−')).toBeInTheDocument()
  })

  it('Renders the card image with correct src', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const img = screen.getByAltText(mockBase.name)
    expect(img).toHaveAttribute('src', mockBase.frontArt)
  })

  it('Renders the card image with correct alt text', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText(mockBase.name)).toBeInTheDocument()
  })

  // --- Counter behaviour ---

  it('Increments the counter when + is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Decrements the counter when − is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Does not decrement below zero', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('0')
  })

  it('Decreases remaining health when counter increments', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    expect(screen.getByText('Remaining: 27')).toBeInTheDocument()
  })

  it('Increases remaining health when counter decrements', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 29')).toBeInTheDocument()
  })

  it('Remaining health does not exceed starting health', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Counter does not exceed base HP', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 30; i++) fireEvent.click(plusBtn)
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Remaining: 0')).toBeInTheDocument()
  })

  it('Remaining health uses base hp not a hardcoded value', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    expect(screen.getByText('Remaining: 24')).toBeInTheDocument()
  })

  // --- Navigation ---

  it('Calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('Calls onBack with 0 games completed when no games have been played', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledWith(0)
  })

  // --- Image error fallback (text) ---

  it('Shows base name when all image URLs fail', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah Swamp')).toBeInTheDocument()
  })

  it('Shows base subtitle when all image URLs fail', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah')).toBeInTheDocument()
  })

  it('Shows epic action when all image URLs fail and epic action exists', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseWithEpicAction.name))
    expect(screen.getByText(mockBaseWithEpicAction.epicAction)).toBeInTheDocument()
  })

  it('Does not show fallback text when image loads successfully', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.load(screen.getByAltText(mockBase.name))
    expect(screen.queryByText('Catacombs of Cadera')).not.toBeInTheDocument()
  })

  // --- Normal-preferred fallback chain: frontArt → frontArtLowRes → hyperspaceArtHiRes → hyperspaceArt → text ---

  it('Uses frontArt as initial src when useHyperspace is false', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.frontArt)
  })

  it('Shows text fallback when all four art URLs fail (normal preferred)', () => {
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByText('Coaxium Mine')).toBeInTheDocument()
  })

  it('Shows text fallback after single error when base has only frontArt and no other URLs', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah Swamp')).toBeInTheDocument()
  })

  // --- Hyperspace-preferred fallback chain: hyperspaceArtHiRes → hyperspaceArt → frontArt → frontArtLowRes → text ---

  it('Uses hyperspaceArtHiRes as initial src when useHyperspace is true', () => {
    mockUserSettings.useHyperspace = true
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.hyperspaceArtHiRes)
  })

  it('Falls back to frontArtLowRes when hyperspace and frontArt all fail (hyperspace preferred)', () => {
    mockUserSettings.useHyperspace = true
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByAltText(mockBaseFullCoverage.name)).toHaveAttribute('src', mockBaseFullCoverage.frontArtLowRes)
  })

  it('Shows text fallback when all four art URLs fail (hyperspace preferred)', () => {
    mockUserSettings.useHyperspace = true
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByText('Coaxium Mine')).toBeInTheDocument()
  })

  it('Uses frontArt when useHyperspace is true but both hyperspace fields are null', () => {
    mockUserSettings.useHyperspace = true
    render(<SwuGameScreen base={mockBaseNoHyperspace} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText(mockBaseNoHyperspace.name)).toHaveAttribute('src', mockBaseNoHyperspace.frontArt)
  })

  // --- Help button ---

  it('Renders a help button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('Calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={onHelp} />)
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  // --- Portrait orientation ---

  it('Shows rotate prompt when in portrait orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText(/rotate/i)).toBeInTheDocument()
  })

  it('Does not show game controls when in portrait orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByText('+')).not.toBeInTheDocument()
    expect(screen.queryByText('−')).not.toBeInTheDocument()
  })

  it('Shows a back button on the portrait rotation prompt', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('Calls onBack when back button is clicked on the portrait rotation prompt', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<SwuGameScreen base={mockBase} onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  // --- Epic Action ---

  it('Shows epic action button when base has an epic action', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('epic-action-btn')).toBeInTheDocument()
  })

  it('Does not show epic action button when base has no epic action', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for a base with a passive epicAction field', () => {
    render(<SwuGameScreen base={mockBasePassiveEffect} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Epic action overlay is not visible by default', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Epic action button is disabled before game starts', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('epic-action-btn')).toBeDisabled()
  })

  it('Epic action button is enabled after game starts', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('epic-action-btn')).not.toBeDisabled()
  })

  it('Clicking epic action button shows the used overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(screen.getByTestId('epic-action-overlay')).toBeInTheDocument()
  })



  it('Clicking epic action button when already used does not add another log entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getAllByText('Epic action used')).toHaveLength(1)
  })
  it('Clicking the overlay dismisses it when action log is disabled', async () => {
    mockUserSettings.enableActionLog = false
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-overlay'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Non-Force base with epic action still shows epic action button alongside locked Force button when always-on', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('epic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  // --- Force — Force bases (always enabled) ---

  it('Shows active Force button for a Force base without requiring an enable tap', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Does not show locked Force button for a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('No Force token is visible initially on a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Force button (gain force) is disabled before game starts', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeDisabled()
  })

  it('Force button (gain force) is enabled after game starts', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('force-btn')).not.toBeDisabled()
  })

  it('Clicking active Force button shows the Force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Active Force button is hidden when token is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Greyed Force button is visible when Force token overlay is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-btn-active')).toBeInTheDocument()
  })

  it('Tapping greyed Force button dismisses the Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Clicking the Force token removes it and restores the active button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  // --- Force — non-Force bases (require enable tap first, only when always-on) ---

  it('Shows a locked Force button for a non-Force base when always-on', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  it('Locked Force button is not the active Force button', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('No force button shown for a non-Force base with lof-only (default)', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button does not immediately show Force token overlay', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button enables Force and shows the active button', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, tapping active button shows the Force token', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, token can be dismissed and Force button restores', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })


  // --- Mystic Monastery ---

  it('Shows action counter button for Mystic Monastery', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
  })

  it('Does not show action counter button for a standard Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('mystic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show action counter button for a non-Force base', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('mystic-action-btn')).not.toBeInTheDocument()
  })

  it('With lof-only, does not show Force button for Mystic Monastery (uses counter instead)', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('With always-on, shows active Force button immediately for Mystic Monastery', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('With always-off, hides mystic counter for Mystic Monastery', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('mystic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for Mystic Monastery', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Action counter button initially shows 3 uses remaining', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('3')
  })

  it('Action counter button is disabled before game starts', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('mystic-action-btn')).toBeDisabled()
  })

  it('Action counter button is enabled after game starts', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('mystic-action-btn')).not.toBeDisabled()
  })

  it('Tapping action counter button shows the Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Action counter button is visible but disabled when Force token overlay is active', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).toBeDisabled()
  })

  it('Force button is hidden when Force token overlay is active', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Dismissing Force overlay restores both buttons when uses remain', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).not.toBeDisabled()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Tapping action counter button decrements the use count', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('2')
  })

  it('Tapping Force button shows the Force token overlay without decrementing the use count', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('3')
  })

  it('Action counter button shows 0 and is disabled when all uses are exhausted', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId('mystic-action-btn'))
      await user.click(screen.getByTestId('force-token'))
    }
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('0')
    expect(screen.getByTestId('mystic-action-btn')).toBeDisabled()
  })

  it('Force button remains visible when all uses are exhausted and Force is absent', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId('mystic-action-btn'))
      await user.click(screen.getByTestId('force-token'))
    }
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Force can still be gained via Force button after all action uses are exhausted', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId('mystic-action-btn'))
      await user.click(screen.getByTestId('force-token'))
    }
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  // --- Settings button ---

  it('Settings button is not visible when onSettings is not provided', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '⚙' })).not.toBeInTheDocument()
  })

  it('Settings button is visible when onSettings is provided', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} />)
    expect(screen.getByRole('button', { name: '⚙' })).toBeInTheDocument()
  })

  it('Settings button calls onSettings when clicked', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} onSettings={onSettings} />)
    await user.click(screen.getByRole('button', { name: '⚙' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })


  // --- User settings ---

  it('Force button is hidden for all bases when forceTokenDisplay is always-off', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Force button is shown for a Force base with lof-only (default)', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Force button is shown for a non-Force base with always-on', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  it('Epic action button is hidden when enableEpicActions is false', () => {
    mockUserSettings.enableEpicActions = false
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Epic action button is still shown when forceTokenDisplay is always-off', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    mockUserSettings.enableEpicActions = true
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
    expect(screen.getByTestId('epic-action-btn')).toBeInTheDocument()
  })

  it('Passes enableWakeLock=true to useWakeLock by default', () => {
    mockUserSettings.enableWakeLock = true
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(vi.mocked(useWakeLock)).toHaveBeenCalledWith(true)
  })

  it('Passes enableWakeLock=false to useWakeLock when setting is disabled', () => {
    mockUserSettings.enableWakeLock = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(vi.mocked(useWakeLock)).toHaveBeenCalledWith(false)
  })

  it('Epic action button shifts to slot 1 position when Force is hidden (always-off)', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    const btn = screen.getByTestId('epic-action-btn')
    expect(btn).toHaveStyle({ top: 'calc(env(safe-area-inset-top) + 9vw)' })
  })

  it('Epic action button stays at slot 2 position when Force is shown (always-on)', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    const btn = screen.getByTestId('epic-action-btn')
    expect(btn).toHaveStyle({ top: 'calc(env(safe-area-inset-top) + 16vw)' })
  })

  it('Mystic Monastery counter button is hidden when forceTokenDisplay is always-off', () => {
    mockUserSettings.forceTokenDisplay = 'always-off'
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('mystic-action-btn')).not.toBeInTheDocument()
  })


  // --- Drag scrubber ---
  // Constants: DRAG_DEAD_ZONE=15px, DRAG_PX_PER_STEP=24px, min value=2 once crossed.
  // delta = startY - currentY; dragging up gives positive delta.
  // At clientY=261 from startY=300: delta=39 -> value = round((39-15)/24)+2 = 3

  it('Dragging + button up past dead zone applies multiple increments on release', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('Dragging - button up past dead zone applies multiple decrements on release', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 10; i++) fireEvent.click(plusBtn)
    const minusBtn = screen.getByText('−')
    fireEvent.pointerDown(minusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(minusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(minusBtn, { pointerId: 1 })
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('Click immediately after a drag is suppressed', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('Drag within dead zone does not suppress subsequent click', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 290, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('pointerCancel during drag does not apply any change', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerCancel(plusBtn, { pointerId: 1 })
    expect(screen.getByTestId('game-counter')).toHaveTextContent('0')
  })

  it('Click is not suppressed after pointerCancel', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerCancel(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Drag indicator shows correct label while dragging past dead zone', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('Drag indicator is not shown when within dead zone', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 290, pointerId: 1 })
    expect(screen.queryByText('+2')).not.toBeInTheDocument()
  })

  it('Drag indicator disappears after pointerUp', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    expect(screen.getByText('+3')).toBeInTheDocument()
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    expect(screen.queryByText('+3')).not.toBeInTheDocument()
  })

  it('Drag indicator disappears after pointerCancel', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerCancel(plusBtn, { pointerId: 1 })
    expect(screen.queryByText('+3')).not.toBeInTheDocument()
  })


  // --- Long press adjustments (settings wiring + game-screen integration) ---

  it('Scrubber does not activate when enableLongPress is false', () => {
    mockUserSettings.enableLongPress = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('+ scrubber max is capped at remaining HP', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 25; i++) fireEvent.click(plusBtn)
    // count=25, remaining=5; delta=200 gives raw value 10, should cap at 5
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('- scrubber max is capped at current count', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 3; i++) fireEvent.click(plusBtn)
    // count=3; delta=200 gives raw value 10, should cap at 3
    const minusBtn = screen.getByText('−')
    fireEvent.pointerDown(minusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(minusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.getByText('−3')).toBeInTheDocument()
  })

  it('+ scrubber does not activate when only 1 HP remains', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 29; i++) fireEvent.click(plusBtn)
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('- scrubber does not activate when count is 1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    fireEvent.click(screen.getByText('+'))
    const minusBtn = screen.getByText('−')
    fireEvent.pointerDown(minusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(minusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.queryByText(/^−\d/)).not.toBeInTheDocument()
  })


  // --- Action log setting ---

  it('Log button is visible in landscape when enableActionLog is true', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('log-btn')).toBeInTheDocument()
  })

  it('Log button is not visible when enableActionLog is false', () => {
    mockUserSettings.enableActionLog = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('log-btn')).not.toBeInTheDocument()
  })

  it('Log button is not visible in portrait orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('log-btn')).not.toBeInTheDocument()
  })

  // --- Log overlay ---

  it('Log overlay is not visible by default', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
  })

  it('Clicking log button shows the log overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByTestId('log-overlay')).toBeInTheDocument()
  })

  it('Clicking log button again hides the log overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
  })

  // --- Round counter ---

  it('Round counter shows 0 initially', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('round-counter')).toHaveTextContent('0')
  })

  it('Clicking the round counter when at 0 starts the game (round becomes 1)', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  it('Round counter caps at 99', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const counter = screen.getByTestId('round-counter')
    for (let i = 0; i < 100; i++) fireEvent.click(counter)
    expect(counter).toHaveTextContent('99')
  })

  // --- Undo ---

  it('Undo button is absent when the log is empty', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByTestId('log-undo-btn')).not.toBeInTheDocument()
  })

  it('Undo after incrementing reverts the counter to 0', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('0')
  })

  it('Undo after decrementing reverts the counter', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('Undo can be applied twice to step back through two actions', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('0')
  })

  it('Undo after epic action used removes the overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Undo after force gain removes the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Undo after force dismiss restores the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Undo after force dismiss via token click restores the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Undo after monastery action restores the use count', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn')) // undo force dismiss
    await user.click(screen.getByTestId('log-undo-btn')) // undo monastery action
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('3')
  })

  it('Undo after round increment restores the round counter', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter')) // start game → round 1
    await user.click(screen.getByTestId('round-counter')) // round 2
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  it('Round 1 entry has an undo button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  it('Undoing Round 1 returns the round counter to 0', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('0')
  })

  it('Undoing Round 1 resets the timer', async () => {
    const timerMock = { remaining: 1500, isRunning: false, isExpired: false, start: vi.fn(), reset: vi.fn() }
    mockUseTimer.mockReturnValue(timerMock)
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(timerMock.reset).toHaveBeenCalledOnce()
  })

  it('Undoing a damage action does not reset the timer', async () => {
    const timerMock = { remaining: 1500, isRunning: false, isExpired: false, start: vi.fn(), reset: vi.fn() }
    mockUseTimer.mockReturnValue(timerMock)
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(timerMock.reset).not.toHaveBeenCalled()
  })

  // --- Log entry content ---

  it('Single tap increment adds a Hit +1 entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
  })

  it('Single tap decrement adds a Heal −1 entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Heal −1')).toBeInTheDocument()
  })

  it('Drag increment logs the full drag amount as a single entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +3')).toBeInTheDocument()
    expect(screen.queryByText('Hit +1')).not.toBeInTheDocument()
  })

  it('Drag decrement logs the full drag amount as a single entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 5; i++) fireEvent.click(plusBtn)
    const minusBtn = screen.getByText('−')
    fireEvent.pointerDown(minusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(minusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(minusBtn, { pointerId: 1 })
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Heal −3')).toBeInTheDocument()
    expect(screen.queryByText('Heal −1')).not.toBeInTheDocument()
  })

  it('Epic action adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Epic action used')).toBeInTheDocument()
  })

  it('Force gain adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force gained')).toBeInTheDocument()
  })

  it('Force dismiss adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force used')).toBeInTheDocument()
  })

  it('Monastery action adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force gained (Monastery)')).toBeInTheDocument()
  })

  it('Round counter is not shown when action log is disabled', () => {
    mockUserSettings.enableActionLog = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('round-counter')).not.toBeInTheDocument()
  })

  it('Round increment adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter')) // start game → Round 1
    await user.click(screen.getByTestId('round-counter')) // → Round 2
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('Multiple actions appear as separate entries in the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
    expect(screen.getByText('Force gained')).toBeInTheDocument()
  })

  it('After undo, the undone entry is no longer shown in the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByText('Hit +1')).not.toBeInTheDocument()
  })

  // --- Score panel ---

  it('score panel is not shown when playMode is not provided', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('score-panel')).not.toBeInTheDocument()
  })

  it('score panel is shown when playMode is bo1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByTestId('score-panel')).toBeInTheDocument()
  })

  it('score panel is shown when playMode is bo3', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    expect(screen.getByTestId('score-panel')).toBeInTheDocument()
  })

  it('score panel shows OPP label', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    const panel = screen.getByTestId('score-panel')
    expect(within(panel).getByText('OPP')).toBeInTheDocument()
  })

  it('score panel shows YOU label', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    const panel = screen.getByTestId('score-panel')
    expect(within(panel).getByText('YOU')).toBeInTheDocument()
  })

  it('bo1 shows 1 opponent marker', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getAllByTestId('score-opp-marker')).toHaveLength(1)
  })

  it('bo1 shows 1 player marker', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getAllByTestId('score-player-marker')).toHaveLength(1)
  })

  it('bo3 shows 2 opponent markers', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    expect(screen.getAllByTestId('score-opp-marker')).toHaveLength(2)
  })

  it('bo3 shows 2 player markers', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    expect(screen.getAllByTestId('score-player-marker')).toHaveLength(2)
  })

  // --- Timer ---

  it('score panel shows a timer when playMode is bo1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByTestId('score-timer')).toBeInTheDocument()
  })

  it('score panel shows a timer when playMode is bo3', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    expect(screen.getByTestId('score-timer')).toBeInTheDocument()
  })

  it('timer shows DRAW initially for bo1 (before game starts)', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByTestId('score-timer')).toHaveTextContent('DRAW')
  })

  it('timer shows DRAW initially for bo3 (before game starts)', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    expect(screen.getByTestId('score-timer')).toHaveTextContent('DRAW')
  })

  it('timer shows formatted time during game', async () => {
    mockUseTimer.mockReturnValue({ remaining: 1440, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveTextContent('24:00')
  })

  it('timer text is neutral above 300 seconds remaining', async () => {
    mockUseTimer.mockReturnValue({ remaining: 301, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveStyle({ color: 'var(--color-text-muted)' })
  })

  it('timer text is amber at exactly 300 seconds remaining', async () => {
    mockUseTimer.mockReturnValue({ remaining: 300, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveStyle({ color: 'var(--color-warning)' })
  })

  it('timer text is amber between 300 and 60 seconds remaining', async () => {
    mockUseTimer.mockReturnValue({ remaining: 180, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveStyle({ color: 'var(--color-warning)' })
  })

  it('timer text is red at exactly 60 seconds remaining', async () => {
    mockUseTimer.mockReturnValue({ remaining: 60, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveStyle({ color: 'var(--color-error)' })
  })

  it('timer text is red below 60 seconds remaining', async () => {
    mockUseTimer.mockReturnValue({ remaining: 59, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    expect(screen.getByTestId('score-timer')).toHaveStyle({ color: 'var(--color-error)' })
  })

  it('timer is not shown when playMode is not provided', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('score-timer')).not.toBeInTheDocument()
  })

  it('tapping the timer before game starts shows dismiss overlay (DRAW pending)', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('score-timer')).toHaveTextContent('DRAW')
  })

  it('tapping the timer during the game does not activate draw pending', async () => {
    mockUseTimer.mockReturnValue({ remaining: 1400, isRunning: true, isExpired: false, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.queryByTestId('score-dismiss-overlay')).not.toBeInTheDocument()
  })

  it('dismiss overlay cancels the timer draw pending', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
    await user.click(screen.getByTestId('score-dismiss-overlay'))
    expect(screen.queryByTestId('score-dismiss-overlay')).not.toBeInTheDocument()
  })

  it('tapping Confirm after timer draw (pre-game intentional draw) shows Match Drawn', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByTestId('score-timer'))
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Drawn')
  })

  it('timer shows DRAW when expired', () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByTestId('score-timer')).toHaveTextContent('DRAW')
  })

  it('tapping the timer when expired shows dismiss overlay (DRAW pending)', async () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
  })

  it('tapping Confirm after expired timer draw shows Match Drawn', async () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByTestId('score-timer'))
    await user.click(screen.getByTestId('score-timer'))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Drawn')
  })

  it('in bo3 without timer expired, recording a win continues the match', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start Game 2')
    expect(screen.queryByTestId('match-result-label')).not.toBeInTheDocument()
  })

  it('in bo3 between games, timer shows time not DRAW', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    // Between games: game counter shows "Start Game 2" but timer must not show DRAW
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start Game 2')
    expect(screen.getByTestId('score-timer')).not.toHaveTextContent('DRAW')
    expect(screen.getByTestId('score-timer')).toHaveTextContent('55:00')
  })

  it('in bo3 with timer expired, recording a win closes the match', async () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Won')
  })

  it('in bo3 with timer expired, recording a loss closes the match', async () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Lost')
  })

  it('auto-loss at 0 HP with timer expired closes the match', async () => {
    mockUseTimer.mockReturnValue({ remaining: 0, isRunning: false, isExpired: true, start: vi.fn(), reset: vi.fn() })
    const lowHpBase = { ...mockBase, hp: 1 }
    const user = userEvent.setup()
    render(<SwuGameScreen base={lowHpBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Lost')
  })

  // --- Start phase / log initial state ---

  it('log is empty on mount', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByText('Round 1')).not.toBeInTheDocument()
  })

  it('Round 1 entry appears in log after starting the game', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
  })

  it('undo button is still shown after undoing the last damage entry (Round 1 is undoable)', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  // --- Start phase ---

  it('Health remaining is not visible in start phase', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Health remaining is visible after starting the game', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    expect(screen.getByText(/Remaining:/)).toBeInTheDocument()
  })

  it('+ button is disabled in start phase', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('+')).toBeDisabled()
  })

  it('− button is disabled in start phase', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('−')).toBeDisabled()
  })

  it('clicking the game counter in start phase starts the game', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('game-counter'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  it('clicking the game counter in start phase enables + and −', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('game-counter'))
    expect(screen.getByText('+')).not.toBeDisabled()
    expect(screen.getByText('−')).not.toBeDisabled()
  })

  it('clicking the round counter when at 0 adds an undoable Round 1 entry to log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  it('counter shows 0 after starting the game', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('0')
  })

  // --- Win / Loss confirmation ---

  it('YOU label in score panel is a button in bo1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByRole('button', { name: 'YOU' })).toBeInTheDocument()
  })

  it('OPP label in score panel is a button in bo1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    expect(screen.getByRole('button', { name: 'OPP' })).toBeInTheDocument()
  })

  it('clicking YOU shows WIN button and dismiss overlay (pending confirm)', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    expect(screen.getByRole('button', { name: 'WIN' })).toBeInTheDocument()
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
  })

  it('clicking OPP shows LOSE button and dismiss overlay (pending confirm)', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    expect(screen.getByRole('button', { name: 'LOSE' })).toBeInTheDocument()
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
  })

  it('clicking YOU then WIN fills a player score marker', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    const playerMarkers = screen.getAllByTestId('score-player-marker')
    expect(playerMarkers[0]).toHaveStyle({ background: 'linear-gradient(160deg, #4ade80 0%, #16a34a 100%)' })
  })

  it('clicking OPP then LOSE fills an opponent score marker', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    const oppMarkers = screen.getAllByTestId('score-opp-marker')
    expect(oppMarkers[0]).toHaveStyle({ background: 'linear-gradient(160deg, #4ade80 0%, #16a34a 100%)' })
  })

  it('clicking YOU then WIN resets the game to start phase', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start Game 2')
  })

  it('clicking elsewhere after clicking YOU dismisses pending confirm', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByTestId('score-dismiss-overlay'))
    expect(screen.queryByTestId('score-dismiss-overlay')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YOU' })).toBeInTheDocument()
  })

  it('clicking YOU then WIN adds Game 1 Won to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Game 1 Won')).toBeInTheDocument()
  })

  it('clicking OPP then LOSE adds Game 1 Lost to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Game 1 Lost')).toBeInTheDocument()
  })

  it('clicking YOU then WIN clears previous log entries', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByText('Hit +1')).not.toBeInTheDocument()
    expect(screen.queryByText('Round 1')).not.toBeInTheDocument()
  })

  // --- Undo game result ---

  it('undo button appears on the game result entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  it('undo after game result reverts player score', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    const playerMarkers = screen.getAllByTestId('score-player-marker')
    expect(playerMarkers[0]).toHaveStyle({ background: 'transparent' })
  })

  it('undo after game result restores previous log entries', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
  })

  it('undo after game result restores damage', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('2')
  })

  // --- Between-game state (Bo3) ---

  it('after a win in bo3 game resets to start phase', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start')
  })

  it('after a win in bo3 round counter resets to 0', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await startGame(user)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('0')
  })

  it('after a win in bo3 shows Game 1 Won label', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('game-result-label')).toHaveTextContent('Game 1 Won')
  })

  it('after a loss in bo3 shows Game 1 Lost label', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByTestId('game-result-label')).toHaveTextContent('Game 1 Lost')
  })

  it('after a win in bo3, counter shows Start Game 2', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('Start Game 2')
  })

  it('clicking the counter in between-game state advances round to 1', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('game-counter'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  it('starting the next game removes the game result entry from the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('game-counter'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByText('Game 1 Won')).not.toBeInTheDocument()
  })

  it('game result label is hidden after starting the next game', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('game-counter'))
    expect(screen.queryByTestId('game-result-label')).not.toBeInTheDocument()
  })

  // --- Match over ---

  it('game counter is hidden when match is over', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.queryByTestId('game-counter')).not.toBeInTheDocument()
  })

  it('round counter is hidden when match is over', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.queryByTestId('round-counter')).not.toBeInTheDocument()
  })

  it('shows Match Won after 2 wins in bo3', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByTestId('game-counter'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Won')
  })

  it('shows Match Lost after 2 losses in bo3', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo3" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    await user.click(screen.getByTestId('game-counter'))
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Lost')
  })

  it('shows Match Won after 1 win in bo1', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Won')
  })

  it('shows Match Lost after 1 loss in bo1', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByTestId('match-result-label')).toHaveTextContent('Match Lost')
  })

  // --- Auto-loss at 0 HP ---

  it('LOSE button auto-appears (OPP replaced) when base reaches 0 HP in bo1', async () => {
    const user = userEvent.setup()
    const lowHpBase = { ...mockBase, hp: 1 }
    render(<SwuGameScreen base={lowHpBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    expect(screen.getByRole('button', { name: 'LOSE' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OPP' })).not.toBeInTheDocument()
    expect(screen.getByTestId('score-dismiss-overlay')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YOU' })).toBeInTheDocument()
  })

  it('does not auto-activate confirm state in casual mode when base reaches 0 HP', async () => {
    const user = userEvent.setup()
    const lowHpBase = { ...mockBase, hp: 1 }
    render(<SwuGameScreen base={lowHpBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await startGame(user)
    await user.click(screen.getByText('+'))
    expect(screen.queryByTestId('score-dismiss-overlay')).not.toBeInTheDocument()
  })

  it('YOU button is disabled after match is over', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(screen.getByRole('button', { name: 'YOU' })).toBeDisabled()
  })

  it('OPP button is disabled after match is over', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(screen.getByRole('button', { name: 'OPP' })).toBeDisabled()
  })

})

describe('SwuGameScreen analytics', () => {

  beforeEach(() => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
    mockUserSettings.forceTokenDisplay = 'lof-only'
    mockUserSettings.enableEpicActions = true
    mockUserSettings.enableActionLog = true
    mockUserSettings.enableLongPress = true
    mockUserSettings.useHyperspace = false
    mockOnDamageDealt.mockClear()
    mockOnDamageHealed.mockClear()
    mockOnRoundIncremented.mockClear()
    mockOnUndoUsed.mockClear()
    mockOnEpicActionUsed.mockClear()
    mockOnForceGained.mockClear()
    mockOnForceUsed.mockClear()
    mockOnMatchCompleted.mockClear()
  })

  it('calls onDamageDealt with baseKey, baseSet and amount 1 on single tap of +', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByText('+'))
    expect(mockOnDamageDealt).toHaveBeenCalledWith('SOR-026', 'SOR', 1)
  })

  it('calls onDamageDealt with the drag scrub amount', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    expect(mockOnDamageDealt).toHaveBeenCalledWith('SOR-026', 'SOR', 3)
  })

  it('calls onDamageHealed with baseKey, baseSet and amount 1 on single tap of −', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(mockOnDamageHealed).toHaveBeenCalledWith('SOR-026', 'SOR', 1)
  })

  it('calls onDamageHealed with the drag scrub amount', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.click(screen.getByText('Start'))
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 5; i++) fireEvent.click(plusBtn)
    const minusBtn = screen.getByText('−')
    fireEvent.pointerDown(minusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(minusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(minusBtn, { pointerId: 1 })
    expect(mockOnDamageHealed).toHaveBeenCalledWith('SOR-026', 'SOR', 3)
  })

  it('calls onRoundIncremented with baseKey, baseSet and new round number', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter')) // start game → round 1
    await user.click(screen.getByTestId('round-counter')) // → round 2
    expect(mockOnRoundIncremented).toHaveBeenCalledWith('SOR-026', 'SOR', 2)
  })

  it('calls onEpicActionUsed with baseKey and baseSet when epic action is tapped', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(mockOnEpicActionUsed).toHaveBeenCalledWith('SOR-022', 'SOR')
  })

  it('does not call onEpicActionUsed a second time when epic action is already used', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(mockOnEpicActionUsed).toHaveBeenCalledTimes(1)
  })

  it('calls onForceGained when Force button is tapped on a Force base', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    expect(mockOnForceGained).toHaveBeenCalledWith('LOF-026', 'LOF')
  })

  it('calls onForceGained when Force button is tapped on a non-Force base after enabling', async () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    expect(mockOnForceGained).toHaveBeenCalledWith('SOR-026', 'SOR')
  })

  it('calls onForceGained when monastery action is used', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(mockOnForceGained).toHaveBeenCalledWith('LOF-022', 'LOF')
  })

  it('calls onForceUsed when Force token is dismissed', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    expect(mockOnForceUsed).toHaveBeenCalledWith('LOF-026', 'LOF')
  })

  it('calls onUndoUsed with undoneAction hit when a hit is undone', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockOnUndoUsed).toHaveBeenCalledWith('SOR-026', 'SOR', 'hit')
  })

  it('calls onUndoUsed with undoneAction heal when a heal is undone', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockOnUndoUsed).toHaveBeenCalledWith('SOR-026', 'SOR', 'heal')
  })

  it('calls onMatchCompleted with playMode, matchResult, playerScore, opponentScore when bo1 match is won', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(mockOnMatchCompleted).toHaveBeenCalledWith('bo1', 'won', 1, 0)
  })

  it('calls onMatchCompleted with matchResult lost when bo1 match is lost', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(mockOnMatchCompleted).toHaveBeenCalledWith('bo1', 'lost', 0, 1)
  })

  it('calls onMatchCompleted with matchResult drawn when a draw is recorded', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByTestId('score-timer'))
    await user.click(screen.getByTestId('score-timer'))
    expect(mockOnMatchCompleted).toHaveBeenCalledWith('bo1', 'drawn', 0, 0)
  })

  it('calls onMatchCompleted only once even when the component re-renders', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(mockOnMatchCompleted).toHaveBeenCalledTimes(1)
  })

  it('does not call onMatchCompleted in casual play mode', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    expect(mockOnMatchCompleted).not.toHaveBeenCalled()
  })

  // --- onMatchComplete prop ---

  it('calls onMatchComplete prop when bo1 match is won', async () => {
    const onMatchComplete = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" onMatchComplete={onMatchComplete} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    expect(onMatchComplete).toHaveBeenCalledWith('won', 1, 0)
  })

  it('calls onMatchComplete prop with correct scores when bo1 match is lost', async () => {
    const onMatchComplete = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} playMode="bo1" onMatchComplete={onMatchComplete} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'OPP' }))
    await user.click(screen.getByRole('button', { name: 'LOSE' }))
    expect(onMatchComplete).toHaveBeenCalledWith('lost', 0, 1)
  })

  it('does not call onMatchComplete prop in casual play mode', async () => {
    const onMatchComplete = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} onMatchComplete={onMatchComplete} />)
    await user.click(screen.getByText('Start'))
    expect(onMatchComplete).not.toHaveBeenCalled()
  })

})

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

describe('SwuGameScreen initiative', () => {

  it('initiative bar is visible on the game screen', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toBeInTheDocument()
  })

  it('indicator position is none by default', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'none')
  })

  it('tapping OPP zone sets initiative to opponent', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('tapping YOU zone sets initiative to player', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-you-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

  it('tapping OPP zone when already opponent stays opponent', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('incrementing the round does not reset initiative', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('initiative bar is hidden when enableInitiativeBar is false', () => {
    mockUserSettings.enableInitiativeBar = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('initiative-indicator')).not.toBeInTheDocument()
  })

})