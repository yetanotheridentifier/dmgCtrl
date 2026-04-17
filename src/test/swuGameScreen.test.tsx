import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameScreen from '../components/swuGameScreen'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')

const mockBase: Base = {
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
  rarity: 'Common',
}

const mockBaseNoHyperspace: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  hyperspaceArt: undefined,
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
  epicAction: 'Epic Action: Play a unit that costs 6 or less from your hand.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

const mockBaseNoImage: Base = {
  set: 'LAW',
  number: '021',
  name: 'Coaxium Mine',
  subtitle: 'Kessel',
  hp: 27,
  frontArt: 'https://cdn.swu-db.com/images/cards/LAW/021.png',
  epicAction: 'Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.',
  aspects: ['Vigilance'],
  rarity: 'Common',
}


const mockBaseWithHyperspaceHiRes: Base = {
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
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()}  onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Displays correct remaining for non-default starting health', () => {
    render(<SwuGameScreen base={mockBaseWithEpicAction} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Renders the back button', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()}  onHelp={vi.fn()} useHyperspace={false} />)
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
    const img = screen.getByAltText(mockBase.name)
    expect(img).toBeInTheDocument()
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

  // --- Image error fallback ---

 it('Shows base name when image fails to load', () => {
    render(<SwuGameScreen base={mockBaseNoImage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoImage.name))
    expect(screen.getByText('Coaxium Mine')).toBeInTheDocument()
  })

  it('Shows base subtitle when image fails to load', () => {
    render(<SwuGameScreen base={mockBaseNoImage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoImage.name))
    expect(screen.getByText('Kessel')).toBeInTheDocument()
  })

  it('Shows epic action when image fails to load and epic action exists', () => {
    render(<SwuGameScreen base={mockBaseNoImage} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.error(screen.getByAltText(mockBaseNoImage.name))
    expect(screen.getByText(mockBaseNoImage.epicAction)).toBeInTheDocument()
  })

  it('Does not show fallback text when image loads successfully', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    fireEvent.load(screen.getByAltText(mockBase.name))
    expect(screen.queryByText('Catacombs of Cadera')).not.toBeInTheDocument()
  })

  // --- Hyperspace image ---

  it('Uses frontArt when useHyperspace is false', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={false} />)
    const img = screen.getByAltText(mockBase.name)
    expect(img).toHaveAttribute('src', mockBase.frontArt)
  })

  it('Uses hyperspaceArtHiRes as initial src when useHyperspace is true', () => {
    render(<SwuGameScreen base={mockBase} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    const img = screen.getByAltText(mockBase.name)
    expect(img).toHaveAttribute('src', mockBase.hyperspaceArtHiRes)
  })

  it('Falls back to frontArt when useHyperspace is true but hyperspaceArt is undefined', () => {
    render(<SwuGameScreen base={mockBaseNoHyperspace} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    const img = screen.getByAltText(mockBaseNoHyperspace.name)
    expect(img).toHaveAttribute('src', mockBaseNoHyperspace.frontArt)
  })


  // --- Hyperspace fallback chain ---

  it('Falls back to hyperspaceArt when hyperspaceArtHiRes fails to load', () => {
    render(<SwuGameScreen base={mockBaseWithHyperspaceHiRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    const img = screen.getByAltText(mockBaseWithHyperspaceHiRes.name)
    expect(img).toHaveAttribute('src', mockBaseWithHyperspaceHiRes.hyperspaceArt)
  })

  it('Shows frontArt when both hyperspace URLs fail', () => {
    render(<SwuGameScreen base={mockBaseWithHyperspaceHiRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    const img = screen.getByAltText(mockBaseWithHyperspaceHiRes.name)
    expect(img).toHaveAttribute('src', mockBaseWithHyperspaceHiRes.frontArt)
  })

  it('Shows text fallback when all image URLs fail', () => {
    render(<SwuGameScreen base={mockBaseWithHyperspaceHiRes} onBack={vi.fn()} onHelp={vi.fn()} useHyperspace={true} />)
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    fireEvent.error(screen.getByAltText(mockBaseWithHyperspaceHiRes.name))
    expect(screen.getByText(mockBaseWithHyperspaceHiRes.name)).toBeInTheDocument()
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

})