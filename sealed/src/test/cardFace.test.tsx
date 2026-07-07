import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import CardFace from '../components/cardFace'
import type { EngineCard } from '../engine/types'

const UNIT: EngineCard = {
  id: 'ASH_118',
  name: 'Eviscerator',
  type: 'unit',
  arena: 'space',
  cost: 6,
  power: 6,
  hp: 4,
  aspects: ['Aggression'],
  traits: ['IMPERIAL'],
  keywords: [{ name: 'Raid', value: 2 }, { name: 'Saboteur' }],
  unique: false,
  frontArt: 'https://cdn.swu-db.com/images/cards/ASH/118.png',
  text: 'Ambush. When this unit attacks, deal 1 damage to a ground unit.',
}

describe('CardFace', () => {
  it('renders the card art dominantly via the worker proxy when art is present', () => {
    render(<CardFace card={UNIT} />)
    const img = screen.getByRole('img', { name: /eviscerator/i })
    expect(img).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/ASH/118.png')
    // The art fills its container; no textual fallback is shown alongside it.
    expect(screen.queryByTestId('card-fallback')).not.toBeInTheDocument()
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-art', 'true')
  })

  it('shows a textual fallback (cost, name, power/hp, keywords, abilities) when there is no art', () => {
    render(<CardFace card={{ ...UNIT, frontArt: undefined }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const fallback = screen.getByTestId('card-fallback')
    expect(within(fallback).getByText('Eviscerator')).toBeInTheDocument()
    expect(fallback).toHaveTextContent('6') // cost
    expect(fallback).toHaveTextContent('6/4') // power/hp
    expect(fallback).toHaveTextContent(/Raid 2/)
    expect(fallback).toHaveTextContent(/Saboteur/)
    expect(fallback).toHaveTextContent(/Ambush\. When this unit attacks/)
  })

  it('falls back to text if the art fails to load', () => {
    render(<CardFace card={UNIT} />)
    const img = screen.getByRole('img', { name: /eviscerator/i })
    fireEvent.error(img)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('card-fallback')).toHaveTextContent('Eviscerator')
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-art', 'false')
  })

  it('renders a unit portrait inside a fixed square slot (the long edge, so nothing overlaps)', () => {
    render(<CardFace card={UNIT} />)
    const face = screen.getByTestId('card-face')
    expect(face).toHaveAttribute('data-orientation', 'portrait')
    // Square slot = long edge (168 at 50%); the portrait card sits centred inside it.
    expect(face).toHaveStyle({ width: '168px', height: '168px' })
  })

  it('accepts a size override (used by the roll-over zoom feature) — the slot scales with it', () => {
    render(<CardFace card={UNIT} widthPx={240} />)
    // Full-size: 240 short edge → 336 long edge → 336px square slot.
    expect(screen.getByTestId('card-face')).toHaveStyle({ width: '336px', height: '336px' })
  })

  it('lays an exhausted unit landscape within the SAME square slot (no overlap, no layout shift)', () => {
    render(<CardFace card={UNIT} exhausted />)
    const face = screen.getByTestId('card-face')
    expect(face).toHaveAttribute('data-orientation', 'landscape')
    expect(face).toHaveStyle({ width: '168px', height: '168px' })
  })

  it('renders bases landscape (they are landscape cards) in the same square slot', () => {
    const base: EngineCard = { ...UNIT, type: 'base', frontArt: 'https://cdn.swu-db.com/images/cards/ASH/020.png' }
    render(<CardFace card={base} />)
    const face = screen.getByTestId('card-face')
    expect(face).toHaveAttribute('data-orientation', 'landscape')
    expect(face).toHaveStyle({ width: '168px', height: '168px' })
  })

  it('renders an undeployed leader landscape; a deployed leader portrait using its back art', () => {
    const leader: EngineCard = {
      ...UNIT,
      id: 'ASH_001',
      type: 'leader',
      frontArt: 'https://cdn.swu-db.com/images/cards/ASH/001.png',
      backArt: 'https://cdn.swu-db.com/images/cards/ASH/001-b.png',
    }
    const { unmount } = render(<CardFace card={leader} />)
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-orientation', 'landscape')
    unmount()

    render(<CardFace card={leader} deployed />)
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-orientation', 'portrait')
    // Deployed leaders show the unit side (back art).
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/ASH/001-b.png')
  })

  it('shows a fallback name when the card is unknown', () => {
    render(<CardFace card={undefined} fallbackName="ASH_999" />)
    expect(screen.getByTestId('card-fallback')).toHaveTextContent('ASH_999')
  })
})
