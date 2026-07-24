import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import '../engine/cardDefinitions' // side-effect: registers Clan Vizsla Soldier's ability
import { db } from '../data/db'
import { legalMoves } from '../engine/legalMoves'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'

/**
 * #416: Clan Vizsla Soldier's "When Defeated: You may defeat an upgrade" is optional at the engine
 * level (`unitTriggeredAbilities.test.ts` covers that), but the UI had no reachable way to decline
 * it. The two-step upgrade picker's own Cancel only steps back to re-pick a host, it never
 * dispatched the actual decline, and the decline move was filtered out of the action menu with
 * nothing put in its place. This is the fix verified end to end: play it out for real, get Clan
 * Vizsla Soldier defeated with exactly one upgrade candidate in play, and confirm Decline is
 * reachable and works.
 */

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  // Real id so its registered ability fires; stats overridden to keep the combat math simple and
  // aspects cleared so it never takes a penalty against these plain test leaders/bases.
  { Set: 'ASH', Number: '165', Name: 'Clan Vizsla Soldier', Type: 'Unit', Arenas: ['Ground'], Cost: '2', Power: '2', HP: '3', Unique: false },
  // High HP: defending doesn't exhaust a unit, so the opponent's Defender is free to attack again
  // right after this test's own attack resolves. This just needs to survive that, not avoid it.
  { Set: 'TST', Number: '100', Name: 'Upgrade Host', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '20' },
  { Set: 'TST', Number: '200', Name: 'Test Upgrade', Type: 'Upgrade', Cost: '0' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  // Kills Clan Vizsla Soldier back (3 HP) while easily surviving its 2 power.
  { Set: 'TST', Number: '400', Name: 'Defender', Type: 'Unit', Arenas: ['Ground'], Cost: '2', Power: '5', HP: '20' },
]

const playerDeck: SavedDeck = {
  id: 'p', name: 'Vizsla', leader: 'TST_001', base: 'TST_002',
  cards: [{ id: 'ASH_165', count: 1 }, { id: 'TST_100', count: 1 }, { id: 'TST_200', count: 1 }, { id: 'TST_300', count: 27 }],
  importedAt: 1,
}
const opponentDeck: SavedDeck = {
  id: 'o', name: 'Defender', leader: 'TST_001', base: 'TST_002',
  cards: [{ id: 'TST_400', count: 1 }, { id: 'TST_300', count: 29 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
/** Play a unit if possible, else attack if possible, else the default do-nothing move (last). */
const aggressiveAi = (s: GameState): Action | null => {
  const moves = legalMoves(s)
  return moves.find(m => m.type === 'playUnit') ?? moves.find(m => m.type === 'attack') ?? moves[moves.length - 1] ?? null
}
const OPTS: UseGameOptions = { shuffle: identity, firstPlayer: 'player', ai: aggressiveAi }

describe('Clan Vizsla Soldier: the may-defeat-an-upgrade choice is reachably optional (#416)', () => {
  it('offers a Decline button, and declining leaves the upgrade in place', async () => {
    for (const c of CARDS) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })

    const user = userEvent.setup()
    render(<GameScreen deck={playerDeck} opponentDeck={opponentDeck} onExit={() => {}} onHelp={() => {}} gameOptions={OPTS} />)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())

    // Setup: keep hand, resource the two Fillers dealt after the three real cards.
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-3'))
    await user.click(screen.getByTestId('hand-card-3'))

    // Round 1: play Clan Vizsla Soldier (uses both starting resources); the opponent's aggressive
    // AI plays its Defender in reply. Then play the Upgrade Host and attach the Upgrade to IT, not
    // to Clan Vizsla Soldier: a unit's own upgrades leave play with it, so the candidate that
    // matters is on a unit that survives.
    await user.click(screen.getByTestId('hand-card-0')) // Clan Vizsla Soldier
    // No FrontArt on these synthetic cards, so each card face falls to its plain-text name.
    await waitFor(() => expect(within(screen.getByTestId('opponent-ground-units')).getByText('Defender')).toBeInTheDocument())
    await user.click(screen.getByTestId('hand-card-0')) // Upgrade Host (free)
    await user.click(screen.getByTestId('hand-card-0')) // Test Upgrade: click it, then its target
    const hostTile = within(screen.getByTestId('player-ground-units')).getByText('Upgrade Host').closest('[data-testid^="board-unit-"]')!
    await user.click(hostTile)
    await waitFor(() => expect(within(screen.getByTestId('player-ground-units')).getByTestId(/^board-unit-upgrades-u\d+$/)).toBeInTheDocument())

    // Pass through to round 2 so Clan Vizsla Soldier (played this round) is ready to attack.
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))

    // Attack the Defender: Clan Vizsla Soldier deals 2 (Defender survives at 20 HP), the Defender's
    // 5 power defeats Clan Vizsla Soldier, raising its "when defeated" choice.
    const cvsTile = within(screen.getByTestId('player-ground-units')).getByText('Clan Vizsla Soldier').closest('[data-testid^="board-unit-"]')!
    await user.click(cvsTile)
    const defenderTile = within(screen.getByTestId('opponent-ground-units')).getByText('Defender').closest('[data-testid^="board-unit-"]')!
    await user.click(defenderTile)

    // The fix: a Decline button is reachable at all (previously nothing dispatched the decline;
    // the two-step picker's own Cancel only stepped back to re-pick a host). Labelled "Cancel" by
    // the pre-existing generic label for this choice kind; what matters here is that it actually
    // dispatches the decline rather than just resetting local UI state.
    const decline = await screen.findByTestId('decline-choice-btn')
    await user.click(decline)

    // Declining leaves the upgrade in place and clears the choice.
    expect(within(screen.getByTestId('player-ground-units')).getByTestId(/^board-unit-upgrades-u\d+$/)).toBeInTheDocument()
    expect(screen.queryByTestId('decline-choice-btn')).not.toBeInTheDocument()
  })
})
