// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { TriggerOrderOverlay, NextTriggerOverlay } from '../components/gameScreen'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { PendingTrigger } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The "who resolves first" overlay (CR 7.6.10).
 *
 * The two buttons are the easy part. What makes the decision a decision rather than a coin flip with
 * buttons is **seeing what is waiting on each side**, so these tests are mostly about the listing.
 *
 * The order question itself names no card, because it exists precisely because two cards triggered at
 * once. Listing each waiting trigger with the card that raised it is therefore the only answer the
 * player gets to "why am I being asked this".
 */

const cards = {
  ...CARDS,
  ASH_116: card({ id: 'ASH_116', name: 'Ant Droid', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
  ASH_153: card({ id: 'ASH_153', name: 'Green Leader', type: 'unit', arena: 'ground', power: 3, hp: 3 }),
}

/**
 * Waiting ABILITIES, not the choices some of them raise. Ant Droid's When Defeated just draws a card:
 * under the old choice-based listing it contributed nothing to the overlay, so the side it was on read
 * "nothing waiting" while genuinely owing a trigger.
 */
const trigger = (over: Partial<PendingTrigger> & Pick<PendingTrigger, 'id' | 'controller' | 'cardId'>): PendingTrigger =>
  ({ point: 'whenDefeated', abilityIndex: 0, layer: 0, ...over })

const board = (owed: PendingTrigger[] = []) => state({
  cards,
  pendingTriggers: owed,
  players: {
    player: player({ units: [unit('a', 'ASH_153')] }),
    opponent: player({ units: [unit('e', 'ASH_116')] }),
  },
})

const mine: PendingTrigger[] = [trigger({ id: 'ours', controller: 'player', cardId: 'ASH_153' })]
const theirs: PendingTrigger[] = [trigger({ id: 'theirs', controller: 'opponent', cardId: 'ASH_116' })]

describe('TriggerOrderOverlay', () => {
  it('lists both sides, and names the card behind each waiting trigger', () => {
    render(<TriggerOrderOverlay state={board()} mine={mine} theirs={theirs} onPick={vi.fn()} />)
    expect(screen.getByTestId('trigger-order-overlay')).toBeInTheDocument()
    // The source card is the "why am I being asked this" answer, so it must actually reach the screen.
    expect(within(screen.getByTestId('trigger-order-mine')).getByText(/Green Leader/)).toBeInTheDocument()
    expect(within(screen.getByTestId('trigger-order-theirs')).getByText(/Ant Droid/)).toBeInTheDocument()
  })

  /** Option 0 is us, option 1 is them, and getting them the wrong way round would be invisible on
   *  screen and wrong in play. */
  it('reports which player was chosen', () => {
    const onPick = vi.fn()
    render(<TriggerOrderOverlay state={board()} mine={mine} theirs={theirs} onPick={onPick} />)
    fireEvent.click(screen.getByTestId('trigger-order-mine-btn'))
    expect(onPick).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByTestId('trigger-order-theirs-btn'))
    expect(onPick).toHaveBeenCalledWith(1)
  })

  /**
   * A side can legitimately be empty by the time this renders, since an earlier trigger may have
   * removed the unit whose ability was waiting. It must say so rather than render a bare heading that
   * reads as a rendering fault.
   */
  it('says so when a side has nothing waiting', () => {
    render(<TriggerOrderOverlay state={board()} mine={mine} theirs={[]} onPick={vi.fn()} />)
    expect(within(screen.getByTestId('trigger-order-theirs')).getByText(/nothing waiting/i)).toBeInTheDocument()
  })

  /**
   * The listing must survive an ability that raises no choice, because that is the case the whole fix
   * is about: Ant Droid's When Defeated draws a card and asks nothing, and the old choice-based
   * listing rendered it as an empty side.
   */
  it('lists an ability that raises no choice of its own', () => {
    render(<TriggerOrderOverlay state={board()} mine={[]} theirs={theirs} onPick={vi.fn()} />)
    expect(within(screen.getByTestId('trigger-order-theirs')).queryByText(/nothing waiting/i)).not.toBeInTheDocument()
    expect(within(screen.getByTestId('trigger-order-theirs')).getByText(/Ant Droid/)).toBeInTheDocument()
  })
})

/**
 * Ordering your own simultaneous abilities (CR 7.6.9).
 *
 * Naming each candidate by its own card is the point: the reported case was one unit carrying two When
 * Defeated abilities, its own and one granted by an upgrade, which are indistinguishable otherwise.
 */
describe('NextTriggerOverlay', () => {
  const owed = [
    trigger({ id: 'own', controller: 'player', cardId: 'ASH_153' }),
    trigger({ id: 'upgrade', controller: 'player', cardId: 'ASH_116' }),
  ]
  const candidates = owed.map(t => ({ triggerId: t.id, cardId: t.cardId }))

  it('offers one button per waiting ability, each naming its card', () => {
    render(<NextTriggerOverlay state={board(owed)} candidates={candidates} onPick={vi.fn()} />)
    expect(screen.getByTestId('next-trigger-btn-0')).toHaveTextContent(/Green Leader/)
    expect(screen.getByTestId('next-trigger-btn-1')).toHaveTextContent(/Ant Droid/)
  })

  /** No decline: both abilities resolve, the only question is which comes first. */
  it('reports the picked ability by index, and offers no way out', () => {
    const onPick = vi.fn()
    render(<NextTriggerOverlay state={board(owed)} candidates={candidates} onPick={onPick} />)
    fireEvent.click(screen.getByTestId('next-trigger-btn-1'))
    expect(onPick).toHaveBeenCalledWith(1)
    expect(screen.queryByText(/cancel|skip|decline/i)).not.toBeInTheDocument()
  })
})
