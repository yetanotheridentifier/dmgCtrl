// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeaderCard } from '../components/gameScreen'
import { cardRadius } from '../components/cardSizing'
import { state, player, card, CARDS } from './helpers/engineFixtures'

/** The undeployed leader card is clickable when it has an available activated ability. */
describe('LeaderCard interaction', () => {
  const s = state({ cards: { ...CARDS, LDR: card({ id: 'LDR', name: 'Boss', type: 'leader', cost: 6 }) }, players: { player: player({ leader: { cardId: 'LDR', deployed: false, epicActionUsed: false, exhausted: false } }), opponent: player() } })

  it('renders actionable + fires onClick when it has an ability', () => {
    const onClick = vi.fn()
    render(<LeaderCard state={s} side="player" interact={{ actionable: true, selected: false, isTarget: false, onClick }} />)
    const cardEl = screen.getByTestId('player-leader-card')
    expect(cardEl).toHaveAttribute('data-actionable', 'true')
    fireEvent.click(cardEl)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('rounds a deployed leader\'s empty outline by the one card radius', () => {
    const deployed = state({ cards: s.cards, players: { player: player({ leader: { cardId: 'LDR', deployed: true, epicActionUsed: true, exhausted: false } }), opponent: player() } })
    render(<LeaderCard state={deployed} side="player" widthPx={50} />)
    const outline = screen.getByTestId('player-leader-card').firstElementChild as HTMLElement
    expect(outline).toHaveStyle({ borderRadius: `${cardRadius(50)}px` })
    expect(outline.className).not.toMatch(/\brounded/)
  })

  it('is not clickable with no interaction', () => {
    const onClick = vi.fn()
    render(<LeaderCard state={s} side="player" />)
    fireEvent.click(screen.getByTestId('player-leader-card'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
