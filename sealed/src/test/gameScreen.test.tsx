import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  // 40 power vs a 30-HP base → a base attack overkills it, so remaining health
  // would go negative without clamping (#323).
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '40', HP: '30', FrontArt: 'https://cdn.swu-db.com/images/cards/TST/900.png' },
  { Set: 'TST', Number: '901', Name: 'Pricey Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]

// Deal order (identity shuffle): 901, 901, 901, 900, 900, 900.
// Default setup chooser resources the last two → hand: 901 ×3 + 900 ×1.
const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Big Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [
    { id: 'TST_901', count: 3 },
    { id: 'TST_900', count: 27 },
  ],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
const OPTS: UseGameOptions = { shuffle: identity, rng: () => 0.999999, firstPlayer: 'player' }

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

async function renderBoard(onExit = vi.fn()) {
  render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={onExit} onHelp={vi.fn()} gameOptions={OPTS} />)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  // Setup phase (#304): keep the opening hand, then resource two cards by clicking
  // them in the hand (index 0 is a Pricey Unit each time). The AI's setup heuristic
  // does the same, landing in round 1's action phase with hand 901,900,900,900.
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-0'))
  await user.click(screen.getByTestId('hand-card-0'))
  return onExit
}

describe('GameScreen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  it('shows a loading state then the board', async () => {
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    expect(screen.getByTestId('game-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  })

  it('offers the mulligan decision during setup', async () => {
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /mulligan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep hand/i })).toBeInTheDocument()
  })

  it('displays base damage counters, starting at 0', async () => {
    await renderBoard()
    expect(screen.getByTestId('player-base-hp')).toHaveTextContent(/^0$/)
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent(/^0$/)
  })

  it('shows resources on the mat and the opponent hand face-down (#332)', async () => {
    await renderBoard()
    // Player mat: 2 ready resources, none exhausted yet.
    const playerMat = screen.getByTestId('player-mat')
    expect(within(playerMat).getByTestId('resources-ready')).toHaveTextContent('2')
    expect(within(playerMat).queryByTestId('resources-exhausted')).toBeNull()
    // Opponent hand is face-down: one card back per card (4 in hand after setup).
    const oppFan = within(screen.getByTestId('opponent-mat')).getByTestId('opponent-hand-fan')
    expect(oppFan.children).toHaveLength(4)
  })

  it('labels the mat columns; the opponent leader column is unlabelled (#332)', async () => {
    await renderBoard()
    const playerMat = screen.getByTestId('player-mat')
    for (const label of ['Deck', 'Resources', 'Hand', 'Action', 'Discard']) {
      expect(within(playerMat).getByText(label)).toBeInTheDocument()
    }
    // The opponent's leader column carries no label (it's obviously the leader);
    // the other four columns are labelled, and there's no Action column.
    const opponentMat = screen.getByTestId('opponent-mat')
    for (const label of ['Deck', 'Resources', 'Hand', 'Discard']) {
      expect(within(opponentMat).getByText(label)).toBeInTheDocument()
    }
    expect(within(opponentMat).queryByText('Action')).toBeNull()
    expect(within(opponentMat).queryByText('Leader')).toBeNull()
    // ...but the leader card itself is present in the mat.
    expect(within(opponentMat).getByTestId('opponent-leader-card')).toBeInTheDocument()
  })

  it('lists the hand with unplayable cards marked', async () => {
    await renderBoard()
    const hand = screen.getByTestId('player-hand')
    const cards = within(hand).getAllByTestId(/hand-card-/)
    expect(cards).toHaveLength(4)
    // Pricey Unit has no art → textual fallback shows its name.
    expect(cards[0]).toHaveTextContent('Pricey Unit')
    expect(cards[0]).toHaveAttribute('data-playable', 'false')
    // Big Test Unit has art → the card is the art image (name via alt).
    expect(within(cards[3]).getByRole('img', { name: /big test unit/i })).toBeInTheDocument()
    expect(cards[3]).toHaveAttribute('data-playable', 'true')
  })

  it('playing a hand card resolves the move and the AI responds', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByTestId('hand-card-3'))

    // Unit hits the board; passive AI passed; turn is back with the human.
    expect(within(screen.getByTestId('player-ground-units')).getByRole('img', { name: /big test unit/i })).toBeInTheDocument()
    expect(within(screen.getByTestId('game-log')).getAllByText(/pass/i).length).toBeGreaterThan(0)
  })

  it('keeps the pass/initiative choices in the mat Action column, not play/attack (#332)', async () => {
    await renderBoard()
    const actionCol = within(screen.getByTestId('player-mat'))
    // Menu-only choices are buttons; playing/attacking are click affordances, not buttons.
    expect(actionCol.getByRole('button', { name: /^pass$/i })).toBeInTheDocument()
    expect(actionCol.queryByRole('button', { name: /play big test unit/i })).toBeNull()
    expect(actionCol.queryByRole('button', { name: /attack/i })).toBeNull()
  })

  it('plays through to a win, shows the banner, and can rematch', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByTestId('hand-card-3'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))
    // Attack the base by clicking the ready unit then the highlighted base target.
    await user.click(screen.getByTestId('board-unit-u1'))
    await user.click(screen.getByTestId('target-opponent-base'))

    const banner = screen.getByTestId('game-over-banner')
    expect(banner).toHaveTextContent(/you won/i)
    // The outcome is a modal overlay over the screen, not an in-flow section (#332).
    expect(banner.parentElement).toHaveClass('fixed')

    await user.click(screen.getByTestId('rematch-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('game-over-banner')).not.toBeInTheDocument()
      expect(screen.getByTestId('player-base-hp')).toHaveTextContent(/^0$/) // fresh game: no damage
    })
  })

  it('clicking a playable hand card plays it (shortcut for the action button)', async () => {
    const user = userEvent.setup()
    await renderBoard()

    // hand: 901,900,900,900 — index 3 is a playable Big Test Unit
    await user.click(screen.getByTestId('hand-card-3'))

    expect(within(screen.getByTestId('player-ground-units')).getByRole('img', { name: /big test unit/i })).toBeInTheDocument()
  })

  it('resources a card by clicking it in the setup phase, highlighted green (#328)', async () => {
    const user = userEvent.setup()
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /keep hand/i }))

    // In the setup resource step, hand cards are clickable and highlighted GREEN.
    expect(within(screen.getByTestId('hand-card-0')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'green')
    await user.click(screen.getByTestId('hand-card-0'))
    expect(within(screen.getByTestId('player-mat')).getByTestId('resources-ready')).toHaveTextContent('1')
  })

  it('highlights playable hand cards blue (accent) in the action phase (#328)', async () => {
    await renderBoard()
    // hand: 901,900,900,900 — index 3 is a playable Big Test Unit
    expect(within(screen.getByTestId('hand-card-3')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'accent')
  })

  it('renders hand cards in a tight portrait frame — no square-slot padding (#328)', async () => {
    await renderBoard()
    const face = within(screen.getByTestId('hand-card-3')).getByTestId('card-face')
    // Portrait card, tight: the frame is the card itself (120×168), not the 168 square slot.
    expect(face).toHaveStyle({ width: '120px', height: '168px' })
  })

  it('clicking a hand card in the regroup phase resources it (#6)', async () => {
    const user = userEvent.setup()
    await renderBoard()

    // Reach the regroup phase: play a unit, then pass (AI passes → regroup).
    await user.click(screen.getByTestId('hand-card-3'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))

    // Now the human's regroup resource choice — clicking any hand card resources it.
    await user.click(screen.getByTestId('hand-card-0'))

    // Started round 2 with a third resource (2 starting + 1 just resourced), all ready.
    expect(within(screen.getByTestId('player-mat')).getByTestId('resources-ready')).toHaveTextContent('3')
  })

  it('clicking an unplayable hand card does nothing', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByTestId('hand-card-0')) // Pricey Unit, unaffordable

    expect(screen.getByTestId('player-ground-units')).not.toHaveTextContent(/pricey unit/i)
    expect(screen.getByTestId('game-board')).toBeInTheDocument()
  })

  it('renders card art in the hand via the worker art proxy (#312)', async () => {
    await renderBoard()
    const hand = screen.getByTestId('player-hand')
    const art = within(hand).getAllByRole('img', { name: /big test unit/i })
    expect(art.length).toBeGreaterThan(0)
    expect(art[0]).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/TST/900.png')
  })

  it('renders card art for units on the board (#312)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    const units = screen.getByTestId('player-ground-units')
    expect(within(units).getByRole('img', { name: /big test unit/i }))
      .toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/TST/900.png')
  })

  it('shows exhausted units rotated and dimmed; ready units upright (#313)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    // Just played → enters exhausted: the card lies landscape (rotated).
    const units = screen.getByTestId('player-ground-units')
    expect(within(units).getByTestId('card-face')).toHaveAttribute('data-orientation', 'landscape')

    // Pass through regroup so the unit readies for round 2
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    expect(within(screen.getByTestId('player-ground-units')).getByTestId('card-face'))
      .toHaveAttribute('data-orientation', 'portrait')
  })

  it('board affordance: click a ready unit, then a highlighted target, to attack (#314)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))
    // pass through regroup so the unit readies
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    // The ready unit is actionable — and its card (not the slot) carries the highlight (#326)
    const unitTile = screen.getByTestId('board-unit-u1')
    expect(unitTile.tagName).toBe('DIV') // no <li> marker dots (#326)
    expect(unitTile).toHaveAttribute('data-actionable', 'true')
    await user.click(unitTile)
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-selected', 'true')
    expect(within(screen.getByTestId('board-unit-u1')).getAllByTestId('card-face')[0]).toHaveAttribute('data-highlight', 'accent')

    // The enemy base is now a highlighted target — its card shows the red highlight
    const baseTarget = screen.getByTestId('target-opponent-base')
    expect(within(baseTarget).getByTestId('card-face')).toHaveAttribute('data-highlight', 'red')
    await user.click(baseTarget)
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent(/^30$/) // 40 dmg capped at the 30-HP base, not shown as 40
  })

  it('clicking a selected unit deselects it (#314)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    await user.click(screen.getByTestId('board-unit-u1'))
    await user.click(screen.getByTestId('board-unit-u1'))
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-selected', 'false')
    expect(screen.queryByTestId('target-opponent-base')).not.toBeInTheDocument()
  })

  it('an exhausted unit is not actionable (#314)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    // just played → exhausted → no action available
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-actionable', 'false')
  })

  it('shows bases in a central strip with your leader below, opponent leader in their mat (#4, #332)', async () => {
    await renderBoard()
    // The opponent's leader has moved to their mat, so the strip holds both bases
    // and only your leader (below your base).
    const order = within(screen.getByTestId('battlefield'))
      .getAllByTestId(/-(base|leader)-card$/)
      .map(el => el.getAttribute('data-testid'))
    expect(order).toEqual([
      'opponent-base-card',
      'player-base-card',
      'player-leader-card',
    ])
    // The opponent leader is in their mat's Leader column, not the battlefield.
    expect(within(screen.getByTestId('opponent-mat')).getByTestId('opponent-leader-card')).toBeInTheDocument()
  })

  it('renders the log in a left-hand side panel (#315, #332)', async () => {
    await renderBoard()
    const panel = screen.getByTestId('game-log-panel')
    expect(panel.tagName).toBe('ASIDE')
    expect(within(panel).getByTestId('game-log')).toBeInTheDocument()
  })

  it('puts the game state (round/phase/initiative) between the bases in the battlefield (#332)', async () => {
    await renderBoard()
    const gameState = within(screen.getByTestId('battlefield')).getByTestId('game-state')
    expect(gameState).toHaveTextContent(/round/i)
    expect(gameState).toHaveTextContent(/action/i) // phase
    expect(gameState).toHaveTextContent(/init/i)
  })

  it('does not label an empty arena "empty" (#332)', async () => {
    await renderBoard()
    expect(screen.getByTestId('player-space-units')).not.toHaveTextContent(/empty/i)
  })

  it('logs the actor as capitalised You/Opp in a separate column (#332)', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))
    const log = screen.getByTestId('game-log')
    expect(within(log).getAllByText('You').length).toBeGreaterThan(0)
    expect(within(log).getAllByText('Opp').length).toBeGreaterThan(0)
  })

  // Exit moved to the app header (#332) — covered in app.test.tsx.

  it('shows the diagnostic detail when card loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }))
    const badDeck = { ...DECK, cards: [{ id: 'TST_404', count: 30 }] }
    render(<GameScreen deck={badDeck} opponentDeck={badDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)

    await waitFor(() => expect(screen.getByTestId('game-error')).toBeInTheDocument())
    expect(screen.getByTestId('game-error-detail')).toHaveTextContent(/TST_404/)
    vi.unstubAllGlobals()
  })
})
