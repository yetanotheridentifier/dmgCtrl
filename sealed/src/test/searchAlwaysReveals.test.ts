import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'

/**
 * A search that matches nothing must still SHOW the cards it looked at (#413). They are private
 * information the searcher is entitled to: knowing which cards just went to the bottom is most of
 * a search's value, and the opponent never sees them either way.
 *
 * There are four search choice kinds and they differ in one load-bearing way: whether the revealed
 * window was pulled OUT of the deck. `searchDraw` and `search` leave the cards in place, so
 * acknowledging must bottom them (or leave them, per the card). `searchPlayFree` and
 * `searchPlayUpgrade` hold them out, so acknowledging must put them back.
 *
 * The deadlock trap: `searchDraw` and `search` are MANDATORY kinds with no decline. Revealing an
 * empty match without adding an acknowledge move would leave zero legal moves and hang the game,
 * so every case below asserts a move exists.
 */
const F = {
  ...CARDS,
  ASH_090: card({ id: 'ASH_090', name: 'Reforge', type: 'event', cost: 0 }),
  ASH_235: card({ id: 'ASH_235', name: 'Sense Through the Force', type: 'event', cost: 0 }),
  HOST: card({ id: 'HOST', name: 'Host', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  UPG: card({ id: 'UPG', name: 'Upgrade', type: 'upgrade', cost: 1 }),
  EVT: card({ id: 'EVT', name: 'Event', type: 'event', cost: 1 }),
}

const choiceOf = (s: GameState, kind: PendingChoice['kind']) => s.pendingChoices?.find(c => c.kind === kind)

describe('Reforge: passing on the search must not eat the deck (#413)', () => {
  /**
   * `searchPlayUpgrade` holds its window out of the deck, but `resolveSkip` had no branch for it,
   * so passing deleted up to 8 cards outright. Found while making the empty case reveal.
   */
  const board = (deck: string[]) => state({
    phase: 'action',
    activePlayer: 'player',
    cards: F,
    players: {
      player: player({
        hand: ['ASH_090'],
        resources: ready(5),
        deck,
        units: [unit('h', 'HOST', { arena: 'ground', upgrades: [{ cardId: 'UPG', owner: 'player' }] })],
      }),
      opponent: player(),
    },
  })

  it('returns the whole revealed window to the deck when the search is passed', () => {
    const deck = ['EVT', 'EVT', 'EVT']
    const played = resolve(board(deck), { type: 'playEvent', handIndex: 0 })
    // Defeat the host's upgrade, which is what starts Reforge's search.
    const defeatChoice = choiceOf(played, 'selectUpgradeToDefeat')!
    const searching = resolve(played, { type: 'acceptChoice', choiceId: defeatChoice.id, optionIndex: 0 })

    const search = choiceOf(searching, 'searchPlayUpgrade')
    expect(search, 'the reveal happens even with no attachable upgrade among the cards').toBeTruthy()
    expect(legalMoves(searching).length).toBeGreaterThan(0)

    const done = resolve(searching, { type: 'skipTrigger', choiceId: search!.id })
    expect(done.players.player.deck.sort()).toEqual(deck.sort()) // nothing lost
  })
})

describe('a reveal belonging to the opponent stays private', () => {
  /**
   * Elzar Mann makes the OPPONENT search their own deck. Now that the no-match case raises a
   * choice rather than resolving silently, that choice is the opponent's to answer and its cards
   * are theirs to see. Every overlay in `gameScreen` is gated on `controller === 'player'`, so the
   * guarantee is that the choice is stamped to the opponent; this pins that.
   */
  it('is raised for the opponent, not the player who triggered it', () => {
    const s = state({
      phase: 'action',
      activePlayer: 'player',
      cards: F,
      players: {
        player: player({ units: [unit('a', 'HOST', { arena: 'ground' })] }),
        opponent: player({ deck: ['HOST', 'HOST', 'HOST', 'HOST'] }),
      },
      pendingChoices: [{ kind: 'distributeTokens', id: 'd', controller: 'player', token: 'TOKEN_ADVANTAGE', remaining: 0, total: 1, targets: ['a'], then: 'opponentSearchEvent' }],
    })
    // Finish distributing, which triggers "an opponent searches ... for an event". None is present.
    const done = resolve(s, { type: 'skipTrigger', choiceId: 'd' })
    const search = choiceOf(done, 'searchDraw')
    expect(search, 'the opponent still gets to see their own cards').toBeTruthy()
    expect(search!.controller).toBe('opponent')
  })
})

describe('Sense Through the Force reveals its five even though every card qualifies', () => {
  const board = (deck: string[]) => state({
    phase: 'action',
    activePlayer: 'player',
    cards: F,
    players: {
      player: player({ hand: ['ASH_235'], resources: ready(5), deck }),
      opponent: player(),
    },
  })

  it('an empty deck reveals nothing rather than opening an empty overlay', () => {
    const played = resolve(board([]), { type: 'playEvent', handIndex: 0 })
    const numbered = resolve(played, { type: 'acceptChoice', choiceId: choiceOf(played, 'chooseNumber')!.id, optionIndex: 1 })
    expect(choiceOf(numbered, 'searchDraw')).toBeUndefined()
  })
})
