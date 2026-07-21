import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  // 40 power vs a 30-HP base → a base attack overkills it, so remaining health
  // would go negative without clamping.
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
// Passive opponent injected outright — the real AI draws from the state seed, so an rng near 1
// no longer steers it. legalMoves puts the do-nothing move (pass / skipResource) last, so the
// last move is passive in every phase — what the old `rng: () => 0.999999` meant.
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.length > 0 ? moves[moves.length - 1] : null
  },
}

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

async function renderBoard(onExit = vi.fn()) {
  render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={onExit} onHelp={vi.fn()} gameOptions={OPTS} />)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  // Setup phase: keep the opening hand, then resource two cards by clicking
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

  it('shows resources on the mat and the opponent hand face-down', async () => {
    await renderBoard()
    // Player mat: 2 ready resources, none exhausted yet.
    const playerMat = screen.getByTestId('player-mat')
    expect(within(playerMat).getByTestId('resources-ready')).toHaveTextContent('2')
    expect(within(playerMat).queryByTestId('resources-exhausted')).toBeNull()
    // Opponent hand is face-down: one card back per card (4 in hand after setup).
    const oppFan = within(screen.getByTestId('opponent-mat')).getByTestId('opponent-hand-fan')
    expect(oppFan.children).toHaveLength(4)
  })

  it('labels the mat columns; the opponent leader column is unlabelled', async () => {
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

  /**
   * Each of these renders its zoom popover inside the anchored element, so the popover has to
   * measure an anchor whose ref attaches after it. Assert it is actually visible: mounting a
   * popover that stays `visibility: hidden` is exactly how zoom failed in production.
   */
  it.each([
    ['a hand card', 'hand-card-0'],
    ['your base', 'player-base-card'],
    ['your leader', 'player-leader-card'],
  ])('zooms %s on Shift+hover', async (_label, testId) => {
    await renderBoard()
    // Setup ends by clicking a hand card, which leaves it hovered — release it, or Shift
    // would zoom that card as well as the one under test.
    fireEvent.pointerLeave(screen.getByTestId('hand-card-0'), { pointerType: 'mouse' })
    fireEvent.pointerEnter(screen.getByTestId(testId), { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    const zoom = screen.getByTestId('card-zoom')
    expect(zoom.style.visibility).not.toBe('hidden')
    expect(zoom.style.left).toMatch(/px$/) // measured against its anchor, not left centred
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
  })

  /** #366: undo is hidden rather than disabled when there is nothing to take back. */
  it('shows Undo only once the player has acted, and rewinds the board', async () => {
    const user = userEvent.setup()
    await renderBoard()
    // renderBoard finishes the setup phase, so there is already something to undo.
    const undo = screen.getByTestId('undo-btn')

    await user.click(screen.getByTestId('hand-card-3'))
    expect(within(screen.getByTestId('player-ground-units')).getAllByTestId('card-face')).toHaveLength(1)

    await user.click(undo)
    expect(within(screen.getByTestId('player-ground-units')).queryByTestId('card-face')).toBeNull()
  })

  it('hides Undo before the player has acted', async () => {
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    expect(screen.queryByTestId('undo-btn')).toBeNull()
  })

  /** #370: cards named in the log are hover-to-zoom references, coloured by who controls them. */
  it('renders card names in the log as hoverable references, coloured by controller', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    const refs = within(screen.getByTestId('game-log')).getAllByTestId('card-ref')
    const played = refs.find(r => r.getAttribute('data-card-id') === 'TST_900')!
    expect(played).toHaveTextContent('Big Test Unit')
    expect(played).toHaveClass('text-accent') // yours — the opponent's would be amber

    // Plain hover, no Shift: this is a line of text, not a card on the board.
    fireEvent.pointerEnter(played, { pointerType: 'mouse' })
    expect(screen.getByTestId('card-zoom').style.visibility).not.toBe('hidden')
    fireEvent.pointerLeave(played, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull()
  })

  /**
   * #370: the board highlights alone don't say what is being asked. The prompt appears for
   * decisions raised by a trigger — never for the base actions (playing a card, choosing an
   * attacker), which are self-evident and would just add noise.
   */
  it('shows no action prompt during ordinary play', async () => {
    const user = userEvent.setup()
    await renderBoard()
    expect(screen.queryByTestId('action-prompt')).toBeNull()

    await user.click(screen.getByTestId('hand-card-3'))
    expect(screen.queryByTestId('action-prompt')).toBeNull()
  })

  /**
   * The prompt floats over the board rather than sitting in the layout: appearing and
   * disappearing must not reflow the cards underneath, and it must not swallow clicks meant
   * for the board it is explaining.
   */
  it('overlays the board without displacing it or blocking clicks', async () => {
    const user = userEvent.setup()
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /keep hand/i }))

    const prompt = screen.getByTestId('action-prompt')
    expect(prompt).toHaveClass('absolute', 'pointer-events-none')
    // Opaque fill: `bg-surface` is itself rgba(…, 0.45), so it can never be opaque however it
    // is applied — the panel must use the solid token, or card art reads through the text.
    expect(prompt).toHaveClass('bg-surface-solid')
    expect(prompt).not.toHaveClass('bg-surface')
    // Taken out of flow, so the round tracker above it keeps its own box.
    expect(screen.getByTestId('game-state')).toHaveClass('relative')
  })

  it('prompts for the two setup resources, counting them off', async () => {
    const user = userEvent.setup()
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())

    // The mulligan decision is resolved from the Action buttons, not the board — say so, or a
    // new player is left clicking cards that won't respond.
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/mulligan.*keep.*action/i)

    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/choose a card to resource.*0 of 2/i)

    await user.click(screen.getByTestId('hand-card-0'))
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/1 of 2/i)

    // Second pick completes setup — the prompt goes with it.
    await user.click(screen.getByTestId('hand-card-0'))
    expect(screen.queryByTestId('action-prompt')).toBeNull()
  })

  it('prompts for the optional resource in the regroup phase', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByRole('button', { name: /^pass$/i }))

    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/resource.*or skip/i)

    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))
    expect(screen.queryByTestId('action-prompt')).toBeNull()
  })

  /**
   * #373: the report is filed by opening GitHub's own new-issue page (so it is authored by
   * whoever is signed in there, and no token lives in the app) with the full report on the
   * clipboard, because the replay payload is far too large for a URL.
   */
  describe('bug report', () => {
    const openReport = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByTestId('bug-report-btn'))
      await user.type(screen.getByTestId('bug-report-title'), 'Game hung')
      await user.type(screen.getByTestId('bug-report-description'), 'After the initiative.')
    }

    /** The form is modal: board decoration must not paint over it or distract from it. */
    it('hides the action prompt while the form is open', async () => {
      const user = userEvent.setup()
      render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
      await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
      expect(screen.getByTestId('action-prompt')).toBeInTheDocument() // the mulligan prompt

      await user.click(screen.getByTestId('bug-report-btn'))
      expect(screen.queryByTestId('action-prompt')).toBeNull()

      await user.click(screen.getByTestId('bug-report-cancel'))
      expect(screen.getByTestId('action-prompt')).toBeInTheDocument()
    })

    it('sits in the header beside Help and opens the form', async () => {
      const user = userEvent.setup()
      await renderBoard()
      expect(screen.queryByTestId('bug-report-overlay')).toBeNull()

      await user.click(screen.getByTestId('bug-report-btn'))
      expect(screen.getByTestId('bug-report-overlay')).toBeInTheDocument()
      await user.click(screen.getByTestId('bug-report-cancel'))
      expect(screen.queryByTestId('bug-report-overlay')).toBeNull()
    })

    it('copies the report and opens a prefilled issue', async () => {
      const open = vi.fn()
      vi.stubGlobal('open', open)
      const user = userEvent.setup()
      await renderBoard()
      await user.click(screen.getByTestId('hand-card-3')) // a move worth replaying

      // After the last userEvent.setup() (renderBoard calls one of its own), or its clipboard
      // stub replaces ours.
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      await openReport(user)
      // fireEvent, not user.click: userEvent owns the clipboard during its own API calls, which
      // would swap our stub back out mid-click.
      fireEvent.click(screen.getByTestId('bug-report-submit'))

      await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
      const report = writeText.mock.calls[0][0] as string
      expect(report).toContain('After the initiative.')
      expect(report).toContain('"initialState"') // the replay payload rides along
      expect(report).toMatch(/Build/)

      const url = new URL(open.mock.calls[0][0] as string)
      expect(url.searchParams.get('title')).toBe('bug: Game hung')
      expect(url.searchParams.get('labels')).toBe('bug')
      await waitFor(() => expect(screen.queryByTestId('bug-report-overlay')).toBeNull())
    })

    it('keeps the form open with the text to copy when the clipboard is refused', async () => {
      const open = vi.fn()
      vi.stubGlobal('open', open)
      const user = userEvent.setup()
      await renderBoard()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true,
      })
      await openReport(user)
      // fireEvent, not user.click: userEvent owns the clipboard during its own API calls, which
      // would swap our stub back out mid-click.
      fireEvent.click(screen.getByTestId('bug-report-submit'))

      const fallback = await screen.findByTestId('bug-report-fallback') as HTMLTextAreaElement
      expect(fallback.value).toContain('After the initiative.')
      expect(fallback.value).toContain('"initialState"') // the replay payload is still there to copy
      expect(screen.getByTestId('bug-report-overlay')).toBeInTheDocument() // nothing lost
      expect(open).not.toHaveBeenCalled() // no half-filed issue
    })
  })

  it('playing a hand card resolves the move and the AI responds', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByTestId('hand-card-3'))

    // Unit hits the board; passive AI passed; turn is back with the human.
    expect(within(screen.getByTestId('player-ground-units')).getByRole('img', { name: /big test unit/i })).toBeInTheDocument()
    expect(within(screen.getByTestId('game-log')).getAllByText(/pass/i).length).toBeGreaterThan(0)
  })

  it('keeps the pass/initiative choices in the mat Action column, not play/attack', async () => {
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
    // The outcome is a modal overlay over the screen, not an in-flow section.
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

  it('resources a card by clicking it in the setup phase, highlighted green', async () => {
    const user = userEvent.setup()
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /keep hand/i }))

    // In the setup resource step, hand cards are clickable and highlighted GREEN.
    expect(within(screen.getByTestId('hand-card-0')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'green')
    await user.click(screen.getByTestId('hand-card-0'))
    expect(within(screen.getByTestId('player-mat')).getByTestId('resources-ready')).toHaveTextContent('1')
  })

  it('highlights playable hand cards blue (accent) in the action phase', async () => {
    await renderBoard()
    // hand: 901,900,900,900 — index 3 is a playable Big Test Unit
    expect(within(screen.getByTestId('hand-card-3')).getByTestId('card-face')).toHaveAttribute('data-highlight', 'accent')
  })

  it('renders hand cards in a tight portrait frame — no square-slot padding', async () => {
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

  it('renders card art in the hand via the worker art proxy', async () => {
    await renderBoard()
    const hand = screen.getByTestId('player-hand')
    const art = within(hand).getAllByRole('img', { name: /big test unit/i })
    expect(art.length).toBeGreaterThan(0)
    expect(art[0]).toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/TST/900.png')
  })

  it('renders card art for units on the board', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    const units = screen.getByTestId('player-ground-units')
    expect(within(units).getByRole('img', { name: /big test unit/i }))
      .toHaveAttribute('src', 'https://worker.dmgctrl.app/art/images/cards/TST/900.png')
  })

  it('shows exhausted units rotated and dimmed; ready units upright', async () => {
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

  it('board affordance: click a ready unit, then a highlighted target, to attack', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))
    // pass through regroup so the unit readies
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    // The ready unit is actionable — and its card (not the slot) carries the highlight
    const unitTile = screen.getByTestId('board-unit-u1')
    expect(unitTile.tagName).toBe('DIV') // no <li> marker dots
    expect(unitTile).toHaveAttribute('data-actionable', 'true')
    await user.click(unitTile)
    // Choosing an attacker is a base action — no prompt, it would only add noise (#370).
    expect(screen.queryByTestId('action-prompt')).toBeNull()
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-selected', 'true')
    expect(within(screen.getByTestId('board-unit-u1')).getAllByTestId('card-face')[0]).toHaveAttribute('data-highlight', 'accent')

    // The enemy base is now a highlighted target — its card shows the red highlight
    const baseTarget = screen.getByTestId('target-opponent-base')
    expect(within(baseTarget).getByTestId('card-face')).toHaveAttribute('data-highlight', 'red')
    await user.click(baseTarget)
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent(/^30$/) // 40 dmg capped at the 30-HP base, not shown as 40
  })

  it('clicking a selected unit deselects it', async () => {
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

  it('an exhausted unit is not actionable', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))

    // just played → exhausted → no action available
    expect(screen.getByTestId('board-unit-u1')).toHaveAttribute('data-actionable', 'false')
  })

  it('shows bases in a central strip with your leader below, opponent leader in their mat (#4)', async () => {
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

  it('renders the log in a left-hand side panel', async () => {
    await renderBoard()
    const panel = screen.getByTestId('game-log-panel')
    expect(panel.tagName).toBe('ASIDE')
    expect(within(panel).getByTestId('game-log')).toBeInTheDocument()
  })

  it('puts the game state (round/phase/initiative) between the bases in the battlefield', async () => {
    await renderBoard()
    const gameState = within(screen.getByTestId('battlefield')).getByTestId('game-state')
    expect(gameState).toHaveTextContent(/round/i)
    expect(gameState).toHaveTextContent(/action/i) // phase
    expect(gameState).toHaveTextContent(/init/i)
  })

  it('does not label an empty arena "empty"', async () => {
    await renderBoard()
    expect(screen.getByTestId('player-space-units')).not.toHaveTextContent(/empty/i)
  })

  it('logs the actor as capitalised You/Opp in a separate column', async () => {
    const user = userEvent.setup()
    await renderBoard()
    await user.click(screen.getByTestId('hand-card-3'))
    const log = screen.getByTestId('game-log')
    expect(within(log).getAllByText('You').length).toBeGreaterThan(0)
    expect(within(log).getAllByText('Opp').length).toBeGreaterThan(0)
  })

  // Exit moved to the app header — covered in app.test.tsx.

  it('plays an upgrade from hand onto a unit via click-to-target', async () => {
    // A deck with a cheap unit + a cheap upgrade; the opponent's deck is inert
    // (all unaffordable) so the AI just passes and the turn comes back.
    const UP_CARDS: SwuCard[] = [
      { Set: 'TST', Number: '100', Name: 'Cheap Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '1', Power: '2', HP: '3' },
      { Set: 'TST', Number: '200', Name: 'Test Upgrade', Type: 'Upgrade', Cost: '1', Power: '2', HP: '2' },
      { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
    ]
    for (const c of UP_CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })

    // Deal order (identity): Cheap Unit, Upgrade, then Fillers.
    const playerDeck: SavedDeck = { id: 'p', name: 'Up', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_100', count: 1 }, { id: 'TST_200', count: 1 }, { id: 'TST_300', count: 28 }], importedAt: 1 }
    const inertDeck: SavedDeck = { id: 'o', name: 'Inert', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_300', count: 30 }], importedAt: 1 }

    const user = userEvent.setup()
    render(<GameScreen deck={playerDeck} opponentDeck={inertDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())

    // Setup: keep hand, resource two Fillers (index 2 twice), leaving Cheap Unit + Upgrade.
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-2'))
    await user.click(screen.getByTestId('hand-card-2'))

    // Play the Cheap Unit (hand-card-0); the AI passes, turn returns to the player.
    await user.click(screen.getByTestId('hand-card-0'))
    expect(within(screen.getByTestId('player-ground-units')).getByTestId(/^board-unit-u\d+$/)).toBeInTheDocument()

    // Click the Upgrade (now hand-card-0) → the friendly unit highlights as a target.
    await user.click(screen.getByTestId('hand-card-0'))
    const unitTile = within(screen.getByTestId('player-ground-units')).getByTestId(/^board-unit-u\d+$/)
    expect(unitTile).toHaveAttribute('data-upgrade-target', 'true')
    // …and the prompt says what the highlight is for (#370), naming the upgrade being placed.
    const prompt = screen.getByTestId('action-prompt')
    expect(prompt).toHaveTextContent(/choose a unit to attach/i)
    expect(within(prompt).getByTestId('card-ref')).toHaveTextContent('Test Upgrade')

    // Click the unit to attach; the log records it and the upgrade renders on the unit.
    await user.click(unitTile)
    // Card names are now their own elements (hover-to-zoom refs), so match the entry's whole
    // text rather than a single text node.
    expect(screen.getByTestId('game-log').textContent).toMatch(/test upgrade.*cheap unit/i)
    expect(within(screen.getByTestId('player-ground-units')).getByTestId(/^board-unit-upgrades-u\d+$/)).toBeInTheDocument()
  })

  it('shows the diagnostic detail when card loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }))
    const badDeck = { ...DECK, cards: [{ id: 'TST_404', count: 30 }] }
    render(<GameScreen deck={badDeck} opponentDeck={badDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} />)

    await waitFor(() => expect(screen.getByTestId('game-error')).toBeInTheDocument())
    expect(screen.getByTestId('game-error-detail')).toHaveTextContent(/TST_404/)
    vi.unstubAllGlobals()
  })
})
