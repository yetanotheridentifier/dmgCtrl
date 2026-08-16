import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { TriggerOrderOverlay } from '../components/gameScreen'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { PendingChoice } from '../engine/types'
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

// The unit that RAISED a choice is what names it, ahead of any `source` field, so the fixture's units
// have to be the cards the prompts should read as: our Green Leader, their Ant Droid.
const board = () => state({
  cards,
  players: {
    player: player({ units: [unit('a', 'ASH_153')] }),
    opponent: player({ units: [unit('e', 'ASH_116')] }),
  },
})

const mine: PendingChoice[] = [{
  kind: 'mayDamage', id: 'ours', controller: 'player', unitId: 'a', targets: ['e'], amount: 2, optional: true,
  source: { cardId: 'ASH_153', controller: 'player' },
}]

const theirs: PendingChoice[] = [{
  kind: 'mayGiveTokens', id: 'theirs', controller: 'opponent', token: 'Advantage', count: 1, targets: ['e'], optional: false,
  source: { cardId: 'ASH_116', controller: 'opponent' },
}]

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
})
