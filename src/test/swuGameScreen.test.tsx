import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameScreen from '../components/swuGameScreen'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  enableForceToken: true,
  enableEpicActions: true,
  enableWakeLock: true,
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
  enableLongPress: true,
  setEnableLongPress: vi.fn(),
  enableActionLog: true,
  setEnableActionLog: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
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
    mockUserSettings.enableForceToken = true
    mockUserSettings.enableEpicActions = true
    mockUserSettings.enableWakeLock = true
    mockUserSettings.useHyperspace = false
    mockUserSettings.enableLongPress = true
    mockUserSettings.enableActionLog = true
  })

  // --- Rendering ---

  it('Renders with counter at zero', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Displays the correct remaining health at start', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Displays correct remaining for non-default starting health', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    await user.click(screen.getByText('+'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Decrements the counter when − is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Does not decrement below zero', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Decreases remaining health when counter increments', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    expect(screen.getByText('Remaining: 27')).toBeInTheDocument()
  })

  it('Increases remaining health when counter decrements', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 29')).toBeInTheDocument()
  })

  it('Remaining health does not exceed starting health', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Counter does not exceed base HP', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 30; i++) fireEvent.click(plusBtn)
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Remaining: 0')).toBeInTheDocument()
  })

  it('Remaining health uses base hp not a hardcoded value', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
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

  it('Clicking epic action button shows the used overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(screen.getByTestId('epic-action-overlay')).toBeInTheDocument()
  })

  it('Clicking epic action button again hides the overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Clicking the overlay also hides it', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-overlay'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Non-Force base with epic action still shows epic action button alongside locked Force button', () => {
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

  it('Clicking active Force button shows the Force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Active Force button is hidden when token is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Greyed Force button is visible when Force token overlay is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-btn-active')).toBeInTheDocument()
  })

  it('Tapping greyed Force button dismisses the Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Clicking the Force token removes it and restores the active button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  // --- Force — non-Force bases (require enable tap first) ---

  it('Shows a locked Force button for a non-Force base', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  it('Locked Force button is not the active Force button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button does not immediately show Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button enables Force and shows the active button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, tapping active button shows the Force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, token can be dismissed and Force button restores', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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

  it('Shows Force button immediately for Mystic Monastery without requiring an enable tap', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Does not show locked Force button for Mystic Monastery', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for Mystic Monastery', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Action counter button initially shows 3 uses remaining', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('3')
  })

  it('Action counter button is enabled initially', () => {
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('mystic-action-btn')).not.toBeDisabled()
  })

  it('Tapping action counter button shows the Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Action counter button is visible but disabled when Force token overlay is active', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).toBeDisabled()
  })

  it('Force button is hidden when Force token overlay is active', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Dismissing Force overlay restores both buttons when uses remain', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).not.toBeDisabled()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Tapping action counter button decrements the use count', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('2')
  })

  it('Tapping Force button shows the Force token overlay without decrementing the use count', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('3')
  })

  it('Action counter button shows 0 and is disabled when all uses are exhausted', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId('mystic-action-btn'))
      await user.click(screen.getByTestId('force-token'))
    }
    expect(screen.getByTestId('mystic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('mystic-action-btn')).toHaveTextContent('0')
    expect(screen.getByTestId('mystic-action-btn')).toBeDisabled()
  })

  it('Force button remains visible when all uses are exhausted and Force is absent', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId('mystic-action-btn'))
      await user.click(screen.getByTestId('force-token'))
    }
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Force can still be gained via Force button after all action uses are exhausted', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
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

  it('Force button is hidden when enableForceToken is false', () => {
    mockUserSettings.enableForceToken = false
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Force button is shown for a Force base when enableForceToken is true', () => {
    mockUserSettings.enableForceToken = true
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Epic action button is hidden when enableEpicActions is false', () => {
    mockUserSettings.enableEpicActions = false
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Epic action button is still shown when Force token is disabled', () => {
    mockUserSettings.enableForceToken = false
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


  it('Epic action button shifts to slot 1 position when Force is disabled', () => {
    mockUserSettings.enableForceToken = false
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    const btn = screen.getByTestId('epic-action-btn')
    expect(btn).toHaveStyle({ top: 'calc(env(safe-area-inset-top) + 9vw)' })
  })

  it('Epic action button stays at slot 2 position when Force is enabled', () => {
    mockUserSettings.enableForceToken = true
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    const btn = screen.getByTestId('epic-action-btn')
    expect(btn).toHaveStyle({ top: 'calc(env(safe-area-inset-top) + 16vw)' })
  })

  it('Mystic Monastery counter button is hidden when Force is disabled', () => {
    mockUserSettings.enableForceToken = false
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('mystic-action-btn')).not.toBeInTheDocument()
  })


  // --- Drag scrubber ---
  // Constants: DRAG_DEAD_ZONE=15px, DRAG_PX_PER_STEP=24px, min value=2 once crossed.
  // delta = startY - currentY; dragging up gives positive delta.
  // At clientY=261 from startY=300: delta=39 -> value = round((39-15)/24)+2 = 3

  it('Dragging + button up past dead zone applies multiple increments on release', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('Dragging - button up past dead zone applies multiple decrements on release', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('Drag within dead zone does not suppress subsequent click', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 290, pointerId: 1 })
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('pointerCancel during drag does not apply any change', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerCancel(plusBtn, { pointerId: 1 })
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Click is not suppressed after pointerCancel', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    fireEvent.pointerCancel(plusBtn, { pointerId: 1 })
    fireEvent.click(plusBtn)
    expect(screen.getByTestId('game-counter')).toHaveTextContent('1')
  })

  it('Drag indicator shows correct label while dragging past dead zone', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('Drag indicator is not shown when within dead zone', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 290, pointerId: 1 })
    expect(screen.queryByText('+2')).not.toBeInTheDocument()
  })

  it('Drag indicator disappears after pointerUp', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 272, pointerId: 1 })
    expect(screen.getByText('+3')).toBeInTheDocument()
    fireEvent.pointerUp(plusBtn, { pointerId: 1 })
    expect(screen.queryByText('+3')).not.toBeInTheDocument()
  })

  it('Drag indicator disappears after pointerCancel', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    const plusBtn = screen.getByText('+')
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('+ scrubber max is capped at remaining HP', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 25; i++) fireEvent.click(plusBtn)
    // count=25, remaining=5; delta=200 gives raw value 10, should cap at 5
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('- scrubber max is capped at current count', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 29; i++) fireEvent.click(plusBtn)
    fireEvent.pointerDown(plusBtn, { clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(plusBtn, { clientY: 100, pointerId: 1 })
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('- scrubber does not activate when count is 1', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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

  it('Round counter shows 1 initially', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  it('Clicking the round counter increments it', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('2')
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
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Undo after decrementing reverts the counter', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Undo after epic action used removes the overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Undo after force gain removes the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Undo after force dismiss restores the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Undo after force dismiss via token click restores the force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Undo after monastery action restores the use count', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('round-counter')).toHaveTextContent('1')
  })

  // --- Log entry content ---

  it('Single tap increment adds a Hit +1 entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
  })

  it('Single tap decrement adds a Heal −1 entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Heal −1')).toBeInTheDocument()
  })

  it('Drag increment logs the full drag amount as a single entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
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
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Epic action used')).toBeInTheDocument()
  })

  it('Force gain adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force gained')).toBeInTheDocument()
  })

  it('Force dismiss adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force used')).toBeInTheDocument()
  })

  it('Monastery action adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseMysticMonastery} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('mystic-action-btn'))
    await user.click(screen.getByTestId('force-token'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Force gained (monastery)')).toBeInTheDocument()
  })

  it('Round increment adds an entry to the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('round-counter'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('Multiple actions appear as separate entries in the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
    expect(screen.getByText('Force gained')).toBeInTheDocument()
  })

  it('After undo, the undone entry is no longer shown in the log', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Hit +1')).toBeInTheDocument()
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByText('Hit +1')).not.toBeInTheDocument()
  })

  // --- Round 1 initial entry ---

  it('log starts with a Round 1 entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
  })

  it('undo button is not shown when Round 1 is the last entry', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.queryByTestId('log-undo-btn')).not.toBeInTheDocument()
  })

})