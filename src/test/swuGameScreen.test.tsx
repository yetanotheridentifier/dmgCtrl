import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameScreen from '../components/swuGameScreen'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')
vi.mock('../flags', () => ({ FEATURE_EPIC_ACTION: true }))

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

// Base with a Force ability — should NOT trigger the epic action mechanic
const mockBaseForce: Base = {
  set: 'SOR',
  number: '025',
  name: 'Jedha City',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/025.png',
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction: 'Force: Heal 1 damage from a unit.',
  aspects: ['Cunning'],
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

})