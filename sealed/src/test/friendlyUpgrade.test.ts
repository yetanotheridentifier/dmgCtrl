import { describe, it, expect } from 'vitest'
import { replay, loadReport, REPORT_CARDS } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions'
import { state, player, card, CARDS, unit, ready } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState, PendingChoice } from '../engine/types'

/**
 * "Friendly upgrade" means one you OWN, not one that happens to sit on a unit you control (#378).
 * An opponent can attach an upgrade to your unit (Deadly Vulnerability); it stays theirs, and it
 * returns to their discard when defeated, which is why `UpgradeAttachment` carries `owner` at all.
 */
describe('friendly upgrades are the ones you own', () => {
  const upgradeChoice = (s: GameState) =>
    s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'selectUpgradeToDefeat' }> => c.kind === 'selectUpgradeToDefeat')

  /** The reported game, replayed: Vane's ability with an enemy-owned upgrade on a friendly unit. */
  it('Vane does not offer an enemy-owned upgrade attached to your unit', () => {
    const report = loadReport('vaneFriendlyUpgrade')
    const final = replay(report, REPORT_CARDS.vaneFriendlyUpgrade)

    const choice = upgradeChoice(final)
    expect(choice, 'the report ends on Vane’s upgrade choice').toBeTruthy()

    const owners = choice!.candidates.map(c => {
      const host = [...final.players.player.units, ...final.players.opponent.units].find(u => u.instanceId === c.unitId)!
      return host.upgrades[c.upgradeIndex].owner
    })
    expect(owners.every(o => o === 'player'), 'every candidate must be owned by the ability’s controller').toBe(true)

    // Concretely: Deadly Vulnerability, played by the opponent onto the player's Noti Nomad.
    const names = choice!.candidates.map(c => final.cards[c.cardId]?.name)
    expect(names).not.toContain('Deadly Vulnerability')
  })

  /** Tokens are stamped with the unit's controller, so your own must stay selectable. */
  it('still offers your own tokens and card upgrades', () => {
    const s = state({
      phase: 'action',
      activePlayer: 'player',
      cards: { ...CARDS, MINE: card({ id: 'MINE', name: 'Mine', type: 'unit', power: 2, hp: 3 }), UP: card({ id: 'UP', name: 'My Upgrade', type: 'upgrade' }) },
      players: {
        player: player({
          resources: ready(5),
          leader: { cardId: 'ASH_012', deployed: false, epicActionUsed: false, exhausted: false },
          units: [unit('u1', 'MINE', { upgrades: [
            { cardId: 'UP', owner: 'player' },
            { cardId: TOKEN_SHIELD, owner: 'player' },
            { cardId: TOKEN_ADVANTAGE, owner: 'player' },
            { cardId: 'UP', owner: 'opponent' }, // theirs, on your unit
          ] })],
        }),
        opponent: player(),
      },
    })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    const choice = upgradeChoice(used)!
    expect(choice.candidates).toHaveLength(3) // the three you own
    const owned = choice.candidates.map(c => used.players.player.units[0].upgrades[c.upgradeIndex].owner)
    expect(owned).toEqual(['player', 'player', 'player'])
  })
})

/**
 * The same #378 ruling, applied to every card whose text says "a friendly upgrade" (#401).
 * Pegasus Tri-Wing and Exploit Advantage both scanned their own units, which is the host
 * unit's controller, not the upgrade's owner. Reforge is the deliberate opposite: its text says
 * "an upgrade ON A FRIENDLY UNIT", so it really is keyed on the host, and must stay that way.
 */
describe('"a friendly upgrade" is owner-keyed; "on a friendly unit" is host-keyed', () => {
  const upgradeChoice = (s: GameState) =>
    s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'selectUpgradeToDefeat' }> => c.kind === 'selectUpgradeToDefeat')

  /** Mine-on-theirs and theirs-on-mine, so owner and host semantics give opposite answers. */
  const crossedBoard = (handCardId: string) => state({
    phase: 'action',
    activePlayer: 'player',
    cards: {
      ...CARDS,
      [handCardId]: card({ id: handCardId, name: handCardId, type: handCardId === 'ASH_171' ? 'unit' : 'event', arena: 'space', cost: 0, power: 1, hp: 1 }),
      BODY: card({ id: 'BODY', name: 'Body', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
      MINE_UP: card({ id: 'MINE_UP', name: 'My Upgrade', type: 'upgrade', cost: 1 }),
      THEIR_UP: card({ id: 'THEIR_UP', name: 'Their Upgrade', type: 'upgrade', cost: 1 }),
    },
    players: {
      player: player({
        hand: [handCardId],
        resources: ready(5),
        // An enemy-OWNED upgrade sitting on YOUR unit.
        units: [unit('mine', 'BODY', { arena: 'ground', upgrades: [{ cardId: 'THEIR_UP', owner: 'opponent' }] })],
      }),
      opponent: player({
        // A YOUR-OWNED upgrade sitting on THEIR unit.
        units: [unit('theirs', 'BODY', { arena: 'ground', upgrades: [{ cardId: 'MINE_UP', owner: 'player' }] })],
      }),
    },
  })

  it('Pegasus Tri-Wing offers the upgrade you own, on whichever unit it sits', () => {
    const played = resolve(crossedBoard('ASH_171'), { type: 'playUnit', handIndex: 0 })
    const choice = upgradeChoice(played)!
    expect(choice.candidates.map(c => c.cardId)).toEqual(['MINE_UP'])
    expect(choice.candidates[0].unitId).toBe('theirs') // on the ENEMY unit, but yours
  })

  it('Exploit Advantage does the same', () => {
    const played = resolve(crossedBoard('ASH_246'), { type: 'playEvent', handIndex: 0 })
    const choice = upgradeChoice(played)!
    expect(choice.candidates.map(c => c.cardId)).toEqual(['MINE_UP'])
  })

  it('Reforge stays host-keyed: "an upgrade on a friendly unit"', () => {
    const played = resolve(crossedBoard('ASH_090'), { type: 'playEvent', handIndex: 0 })
    const choice = upgradeChoice(played)!
    expect(choice.candidates.map(c => c.cardId)).toEqual(['THEIR_UP'])
    expect(choice.candidates[0].unitId).toBe('mine') // on YOUR unit, though they own it
  })
})
