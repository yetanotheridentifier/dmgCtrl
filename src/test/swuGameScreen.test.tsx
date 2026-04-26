import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameScreen from '../components/swuGameScreen'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')
vi.mock('../flags', () => ({ FEATURE_EPIC_ACTION: true, FEATURE_FORCE_TOKEN: true }))

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
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: false })
  })

  // --- Rendering ---

  it('Renders with counter at zero', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Displays the correct remaining health at start', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Displays correct remaining for non-default starting health', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Renders the back button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('<')).toBeInTheDocument()
  })

  it('Renders a + button and a − button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('−')).toBeInTheDocument()
  })

  it('Renders the card image with correct src', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    const img = screen.getByAltText(mockBase.name)
    expect(img).toHaveAttribute('src', mockBase.frontArt)
  })

  it('Renders the card image with correct alt text', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByAltText(mockBase.name)).toBeInTheDocument()
  })

  // --- Counter behaviour ---

  it('Increments the counter when + is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('+'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('Decrements the counter when − is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('Does not decrement below zero', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Decreases remaining health when counter increments', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    expect(screen.getByText('Remaining: 27')).toBeInTheDocument()
  })

  it('Increases remaining health when counter decrements', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 29')).toBeInTheDocument()
  })

  it('Remaining health does not exceed starting health', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Counter does not exceed base HP', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    const plusBtn = screen.getByText('+')
    for (let i = 0; i < 30; i++) fireEvent.click(plusBtn)
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Remaining: 0')).toBeInTheDocument()
  })

  it('Remaining health uses base hp not a hardcoded value', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('+'))
    expect(screen.getByText('Remaining: 24')).toBeInTheDocument()
  })

  // --- Navigation ---

  it('Calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={onBack} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByText('<'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  // --- Image error fallback (text) ---

  it('Shows base name when all image URLs fail', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah Swamp')).toBeInTheDocument()
  })

  it('Shows base subtitle when all image URLs fail', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah')).toBeInTheDocument()
  })

  it('Shows epic action when all image URLs fail and epic action exists', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseWithEpicAction.name))
    expect(screen.getByText(mockBaseWithEpicAction.epicAction)).toBeInTheDocument()
  })

  it('Does not show fallback text when image loads successfully', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.load(screen.getByAltText(mockBase.name))
    expect(screen.queryByText('Catacombs of Cadera')).not.toBeInTheDocument()
  })

  // --- Normal-preferred fallback chain: frontArt → frontArtLowRes → hyperspaceArtHiRes → hyperspaceArt → text ---

  it('Uses frontArt as initial src when useHyperspace is false', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.frontArt)
  })

  it('Shows text fallback when all four art URLs fail (normal preferred)', () => {
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByText('Coaxium Mine')).toBeInTheDocument()
  })

  it('Shows text fallback after single error when base has only frontArt and no other URLs', () => {
    render(<SwuGameScreen base={mockBaseNoLowRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoLowRes.name))
    expect(screen.getByText('Dagobah Swamp')).toBeInTheDocument()
  })

  // --- Hyperspace-preferred fallback chain: hyperspaceArtHiRes → hyperspaceArt → frontArt → frontArtLowRes → text ---

  it('Uses hyperspaceArtHiRes as initial src when useHyperspace is true', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    expect(screen.getByAltText(mockBase.name)).toHaveAttribute('src', mockBase.hyperspaceArtHiRes)
  })

  it('Falls back to frontArtLowRes when hyperspace and frontArt all fail (hyperspace preferred)', () => {
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByAltText(mockBaseFullCoverage.name)).toHaveAttribute('src', mockBaseFullCoverage.frontArtLowRes)
  })

  it('Shows text fallback when all four art URLs fail (hyperspace preferred)', () => {
    render(<SwuGameScreen base={mockBaseFullCoverage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    fireEvent.error(screen.getByAltText(mockBaseFullCoverage.name))
    expect(screen.getByText('Coaxium Mine')).toBeInTheDocument()
  })

  it('Uses frontArt when useHyperspace is true but both hyperspace fields are null', () => {
    render(<SwuGameScreen base={mockBaseNoHyperspace} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    expect(screen.getByAltText(mockBaseNoHyperspace.name)).toHaveAttribute('src', mockBaseNoHyperspace.frontArt)
  })

  // --- Help button ---

  it('Renders a help button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('Calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={onHelp} useHyperspace={false} />)
    await user.click(screen.getByText('?'))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  // --- Portrait orientation ---

  it('Shows rotate prompt when in portrait orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText(/rotate/i)).toBeInTheDocument()
  })

  it('Does not show game controls when in portrait orientation', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByText('+')).not.toBeInTheDocument()
    expect(screen.queryByText('−')).not.toBeInTheDocument()
  })

  it('Shows a back button on the portrait rotation prompt', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true })
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByRole('button', { name: '<' })).toBeInTheDocument()
  })

  it('Calls onBack when back button is clicked on the portrait rotation prompt', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true })
    render(<SwuGameScreen base={mockBase} onBack={onBack} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByRole('button', { name: '<' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  // --- Epic Action ---

  it('Shows epic action button when base has an epic action', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByTestId('epic-action-btn')).toBeInTheDocument()
  })

  it('Does not show epic action button when base has no epic action', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Does not show epic action button for a base with a passive epicAction field', () => {
    render(<SwuGameScreen base={mockBasePassiveEffect} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('epic-action-btn')).not.toBeInTheDocument()
  })

  it('Epic action overlay is not visible by default', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Clicking epic action button shows the used overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(screen.getByTestId('epic-action-overlay')).toBeInTheDocument()
  })

  it('Clicking epic action button again hides the overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-btn'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Clicking the overlay also hides it', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('epic-action-btn'))
    await user.click(screen.getByTestId('epic-action-overlay'))
    expect(screen.queryByTestId('epic-action-overlay')).not.toBeInTheDocument()
  })

  it('Non-Force base with epic action still shows epic action button alongside locked Force button', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByTestId('epic-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  // --- Force — Force bases (always enabled) ---

  it('Shows active Force button for a Force base without requiring an enable tap', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Does not show locked Force button for a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('No Force token is visible initially on a Force base', () => {
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Clicking active Force button shows the Force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('Active Force button is hidden when token is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Greyed Force button is visible when Force token overlay is showing', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-btn-active')).toBeInTheDocument()
  })

  it('Tapping greyed Force button dismisses the Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-btn-active'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  it('Clicking the Force token removes it and restores the active button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBaseForce} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

  // --- Force — non-Force bases (require enable tap first) ---

  it('Shows a locked Force button for a non-Force base', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByTestId('force-btn-locked')).toBeInTheDocument()
  })

  it('Locked Force button is not the active Force button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.queryByTestId('force-btn')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button does not immediately show Force token overlay', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
  })

  it('Tapping locked Force button enables Force and shows the active button', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('force-btn-locked')).not.toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, tapping active button shows the Force token', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    expect(screen.getByTestId('force-token')).toBeInTheDocument()
  })

  it('After enabling Force on a non-Force base, token can be dismissed and Force button restores', async () => {
    const user = userEvent.setup()
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    await user.click(screen.getByTestId('force-btn-locked'))
    await user.click(screen.getByTestId('force-btn'))
    await user.click(screen.getByTestId('force-token'))
    expect(screen.queryByTestId('force-token')).not.toBeInTheDocument()
    expect(screen.getByTestId('force-btn')).toBeInTheDocument()
  })

})