import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { sweepCardDb } from '../bench/sweep'
import { playGame } from '../bench/selfPlay'
import { randomAi } from '../ai/randomAi'
import { opponentAi } from '../config'
import { describeAction } from '../utils/describeAction'
import { describeChoiceParts } from '../utils/describeChoice'
import { partsText } from '../utils/describeAction'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * **Grand Admiral Thrawn (SOR_016), both sides: "When the action phase starts: Look at the top card of
 * each player's deck."**
 *
 * A triggered, one-shot look at a fixed moment. It is free and decides nothing: Thrawn's controller is
 * shown both top cards and acknowledges. What it shows is hidden information, the opponent's card
 * included, so the cards are named to nobody else: not in the log, not in the prompt text, and not in
 * the move that answers it (which is all a replay records).
 */

const THRAWN = 'SOR_016'
const SOR = poolFor(['SOR'])
const F: Record<string, EngineCard> = {
  ...CARDS,
  [THRAWN]: normaliseCard(SOR.find(c => c.Set === 'SOR' && String(c.Number) === '016')!),
  MINE_TOP: card({ id: 'MINE_TOP', name: 'My Secret', arena: 'ground', cost: 3 }),
  THEIR_TOP: card({ id: 'THEIR_TOP', name: 'Their Secret', arena: 'ground', cost: 4 }),
  MINE_NEXT: card({ id: 'MINE_NEXT', name: 'My Next Secret', arena: 'ground', cost: 3 }),
  THEIR_NEXT: card({ id: 'THEIR_NEXT', name: 'Their Next Secret', arena: 'ground', cost: 4 }),
  PLAIN: card({ id: 'PLAIN', arena: 'ground', cost: 2, power: 2, hp: 3 }),
}
const SECRET_NAMES = ['My Secret', 'Their Secret', 'My Next Secret', 'Their Next Secret']

type Side = Parameters<typeof player>[0]
type Look = Extract<PendingChoice, { kind: 'lookAtDeckTops' }>
const front = (exhausted = false) => ({ leader: { cardId: THRAWN, deployed: false, epicActionUsed: false, exhausted } })
const back = () => ({
  leader: { cardId: THRAWN, deployed: true, epicActionUsed: true, exhausted: false },
  units: [unit('thrawn', THRAWN, { isLeader: true, arena: 'ground' })],
})
/** The regroup phase draws two cards each, so the third card down is the top as the action phase starts. */
const MY_DECK = ['PLAIN', 'PLAIN', 'MINE_TOP', 'MINE_NEXT', 'PLAIN', 'PLAIN', 'PLAIN']
const THEIR_DECK = ['PLAIN', 'PLAIN', 'THEIR_TOP', 'THEIR_NEXT', 'PLAIN', 'PLAIN', 'PLAIN']
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}): GameState =>
  state({ cards: F, players: { player: player({ deck: MY_DECK, resources: ready(3), ...mine }), opponent: player({ deck: THEIR_DECK, resources: ready(3), ...theirs }) }, ...over })

/** Both players pass, then decline to resource: the board as the next action phase starts. */
function nextActionPhase(s: GameState): GameState {
  let next = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
  let guard = 0
  while (next.phase !== 'action' && guard++ < 12) {
    const moves = legalMoves(next)
    next = resolve(next, moves.find(m => m.type === 'skipResource') ?? moves[0])
  }
  expect(next.phase).toBe('action')
  expect(next.round).toBe(s.round + 1)
  return next
}
const looks = (s: GameState): Look[] => (s.pendingChoices ?? []).filter((c): c is Look => c.kind === 'lookAtDeckTops')
const theLook = (s: GameState): Look => {
  expect(looks(s), 'one look is waiting').toHaveLength(1)
  return looks(s)[0]
}
const shown = (look: Look): [PlayerId, string][] => look.tops.map(t => [t.deck, t.cardId])
const done = (s: GameState, look: Look = theLook(s)): GameState => resolve(s, { type: 'skipTrigger', choiceId: look.id })

describe('SOR_016 Grand Admiral Thrawn: the registration', () => {
  it('declares the look on both sides, with the printed text', () => {
    const def = getCardDefinition(THRAWN)!
    const printed = "When the action phase starts: Look at the top card of each player's deck."
    expect(def.leaderAbilities?.abilities?.filter(a => a.trigger === 'whenActionPhaseStarts').map(a => a.description)).toEqual([printed])
    expect(def.abilities?.filter(a => a.trigger === 'whenActionPhaseStarts').map(a => a.description)).toEqual([printed])
  })

  it('keeps the second ability on both sides', () => {
    const def = getCardDefinition(THRAWN)!
    expect(def.leaderAbilities?.actions).toHaveLength(1)
    expect(def.abilities?.filter(a => a.trigger === 'onAttack')).toHaveLength(1)
  })
})

describe('the look, as an action phase starts', () => {
  it('shows the leader side’s controller the top card of both decks, their own first', () => {
    const s = nextActionPhase(board(front()))
    const look = theLook(s)
    expect(look.controller).toBe('player')
    expect(shown(look)).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
    expect(s.players.player.deck[0]).toBe('MINE_TOP')
    expect(s.players.opponent.deck[0]).toBe('THEIR_TOP')
  })

  it('names the card that raised it', () => {
    expect(theLook(nextActionPhase(board(front()))).source?.cardId).toBe(THRAWN)
  })

  it('is asked before either player acts, and of Thrawn’s controller whoever holds the initiative', () => {
    for (const initiative of ['player', 'opponent'] as const) {
      const s = nextActionPhase(board(front(), {}, { initiative, activePlayer: initiative }))
      expect(s.activePlayer, `initiative with ${initiative}`).toBe('player')
      expect(legalMoves(s)).toEqual([{ type: 'skipTrigger', choiceId: theLook(s).id }])
    }
  })

  it('has one answer, which costs nothing and changes nothing but who acts next', () => {
    const s = nextActionPhase(board(front(), {}, { initiative: 'opponent', activePlayer: 'opponent' }))
    const after = done(s)
    expect(after.pendingChoices ?? []).toEqual([])
    expect(after.activePlayer, 'play begins with the initiative holder').toBe('opponent')
    expect(after.players.player.deck).toEqual(s.players.player.deck)
    expect(after.players.opponent.deck).toEqual(s.players.opponent.deck)
    expect(after.players.player.hand).toEqual(s.players.player.hand)
    expect(after.players.player.resources).toEqual(s.players.player.resources)
    expect(after.players.player.leader, 'no exhaust').toEqual(s.players.player.leader)
  })

  it('still happens with the leader exhausted: it is not paid for with an exhaust', () => {
    // The regroup phase readies everything, so exhaust is checked on the first round, where nothing does.
    const s = board({ ...front(true), hand: ['PLAIN'], resources: ready(1), deck: ['MINE_TOP'] }, { resources: ready(2), deck: ['THEIR_TOP'] },
      { phase: 'setup', setupStage: 'resource', round: 1, activePlayer: 'player', initiative: 'opponent' })
    expect(shown(theLook(resolve(s, { type: 'setupResource', handIndex: 0 })))).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
  })

  it('happens on the first round, as setup ends', () => {
    const s = board({ ...front(), hand: ['PLAIN'], resources: ready(1), deck: ['MINE_TOP'] }, { resources: ready(2), deck: ['THEIR_TOP'] },
      { phase: 'setup', setupStage: 'resource', round: 1, activePlayer: 'player', initiative: 'opponent' })
    const started = resolve(s, { type: 'setupResource', handIndex: 0 })
    expect(started.phase).toBe('action')
    expect(started.round).toBe(1)
    expect(shown(theLook(started))).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
    expect(done(started).activePlayer).toBe('opponent')
  })

  it('happens every round, showing the cards on top by then', () => {
    const second = done(nextActionPhase(board(front())))
    // Nothing was drawn or moved, so the regroup phase draws the two cards that were shown.
    const third = nextActionPhase(second)
    expect(shown(theLook(third))).toEqual([['player', 'PLAIN'], ['opponent', 'PLAIN']])
    expect(third.players.player.hand).toEqual(expect.arrayContaining(['MINE_TOP', 'MINE_NEXT']))
  })

  it('is not available later in the round: once answered, nothing offers it again until the next action phase', () => {
    let s = done(nextActionPhase(board({ ...front(), hand: ['PLAIN'] })))
    expect(looks(s)).toEqual([])
    expect(legalMoves(s).filter(m => m.type === 'useLeaderAbility'), 'the leader offers only the reveal').toHaveLength(1)
    s = resolve(s, legalMoves(s).find(m => m.type === 'playUnit')!)
    expect(looks(s)).toEqual([])
    s = resolve(s, { type: 'pass' })
    expect(looks(s)).toEqual([])
  })
})

describe('the look, from the leader unit', () => {
  it('is raised once for a deployed Thrawn, not once per side of the card', () => {
    const s = nextActionPhase(board(back()))
    expect(shown(theLook(s))).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
    expect(theLook(s).source?.cardId).toBe(THRAWN)
  })

  it('goes with him when he is defeated: the leader side looks again next round', () => {
    const fallen = board({ leader: { cardId: THRAWN, deployed: false, epicActionUsed: true, exhausted: true } })
    expect(shown(theLook(nextActionPhase(fallen)))).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
  })
})

describe('the look, with a deck that has run out', () => {
  it('shows only the opponent’s top card when Thrawn’s own deck is empty', () => {
    const s = nextActionPhase(board({ ...front(), deck: [] }))
    expect(shown(theLook(s))).toEqual([['opponent', 'THEIR_TOP']])
  })

  it('shows only his own when the opponent’s deck is empty', () => {
    const s = nextActionPhase(board(front(), { deck: [] }))
    expect(shown(theLook(s))).toEqual([['player', 'MINE_TOP']])
  })

  it('asks nothing when both decks are empty: there is nothing to look at', () => {
    const s = nextActionPhase(board({ ...front(), deck: [] }, { deck: [] }))
    expect(s.pendingChoices ?? []).toEqual([])
    expect(s.activePlayer).toBe(s.initiative)
  })
})

describe('the look, when both players lead with Thrawn', () => {
  /**
   * Two abilities of different players triggering together are ordered first (CR 7.6.10), so the board
   * is driven with each choice's first answer, collecting every look on the way and who answered it.
   */
  const both = () => {
    let s = nextActionPhase(board(front(), front()))
    const seen: { look: Look; answeredBy: PlayerId }[] = []
    let guard = 0
    while ((s.pendingChoices ?? []).length > 0 && guard++ < 8) {
      const move = legalMoves(s)[0]
      const look = looks(s).find(c => move.type === 'skipTrigger' && c.id === move.choiceId)
      if (look) seen.push({ look, answeredBy: s.activePlayer })
      s = resolve(s, move)
    }
    return { seen, after: s }
  }

  it('gives each player their own look at the same two cards, their own deck first', () => {
    const { seen } = both()
    expect(seen).toHaveLength(2)
    const mine = seen.find(x => x.look.controller === 'player')!.look
    const theirs = seen.find(x => x.look.controller === 'opponent')!.look
    expect(shown(mine)).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
    expect(shown(theirs)).toEqual([['opponent', 'THEIR_TOP'], ['player', 'MINE_TOP']])
  })

  it('has each answered by its own controller, then starts play with the initiative holder', () => {
    const { seen, after } = both()
    for (const { look, answeredBy } of seen) expect(answeredBy).toBe(look.controller)
    expect(after.pendingChoices ?? []).toEqual([])
    expect(after.activePlayer).toBe(after.initiative)
  })
})

describe('the look is what the card showed when it resolved', () => {
  it('names the cards that were on top then, in the choice itself', () => {
    const s = nextActionPhase(board(front()))
    const moved: GameState = { ...s, players: { ...s.players, opponent: { ...s.players.opponent, deck: s.players.opponent.deck.slice(1) } } }
    expect(shown(theLook(moved))).toEqual([['player', 'MINE_TOP'], ['opponent', 'THEIR_TOP']])
  })
})

describe('hidden information: the cards are named to nobody but the player looking', () => {
  const containsSecret = (text: string) => SECRET_NAMES.some(n => text.includes(n)) || /MINE_|THEIR_/.test(text)

  it('the move that answers it carries no card: a replay records only the choice id', () => {
    const s = nextActionPhase(board(front()))
    const answer = legalMoves(s)[0]
    expect(Object.keys(answer).sort()).toEqual(['choiceId', 'type'])
    expect(containsSecret(JSON.stringify(answer))).toBe(false)
  })

  it('the log line for answering it names neither card, for the player or for the opponent', () => {
    const mine = nextActionPhase(board(front()))
    const myAnswer: Action = { type: 'skipTrigger', choiceId: theLook(mine).id }
    expect(describeAction(mine, 'player', myAnswer)).toBe('Done')

    const theirs = nextActionPhase(board({}, front()))
    expect(theLook(theirs).controller).toBe('opponent')
    const theirAnswer: Action = { type: 'skipTrigger', choiceId: theLook(theirs).id }
    for (const redact of [true, false]) expect(containsSecret(describeAction(theirs, 'opponent', theirAnswer, { redact }))).toBe(false)
  })

  it('the prompt says what is being asked without naming a card', () => {
    const s = nextActionPhase(board(front()))
    const prompt = partsText(describeChoiceParts(s, theLook(s)))
    expect(prompt).toContain('Grand Admiral Thrawn')
    expect(prompt).toMatch(/top card of each deck/i)
    expect(containsSecret(prompt)).toBe(false)
  })
})

describe('the bot', () => {
  it('answers the look with the one legal move, so the engine never waits on it', () => {
    const s = nextActionPhase(board({}, front()))
    expect(s.activePlayer).toBe('opponent')
    const answer = opponentAi(s)
    expect(answer).toEqual({ type: 'skipTrigger', choiceId: theLook(s).id })
    expect(resolve(s, answer!).pendingChoices ?? []).toEqual([])
  })

  it('still finds a move when its lookahead reaches the next action phase, whichever seat will look', () => {
    // The player has passed, so the bot's own pass ends the round and the look is raised inside its search.
    const seats: [Side, Side][] = [[front(), {}], [{}, front()], [front(), front()]]
    for (const [mine, theirs] of seats) {
      const s = board({ ...mine, hand: ['PLAIN'] }, { ...theirs, hand: ['PLAIN'] }, { activePlayer: 'opponent', consecutivePasses: 1 })
      expect(legalMoves(s)).toContainEqual(opponentAi(s))
    }
  })

  it('plays whole games leading with Thrawn to the end, looking every round', () => {
    const cardDb = sweepCardDb(SOR)
    const decks = buildCoverageDecks(SOR, 42).decks
    let lookedAt = 0
    for (let i = 0; i < 40; i++) {
      const mine = { ...decks[i % decks.length], leader: THRAWN }
      const theirs = i % 4 === 0 ? { ...decks[(i + 1) % decks.length], leader: THRAWN } : decks[(i + 1) % decks.length]
      const game = playGame({ deckPlayer: mine, deckOpponent: theirs, cardDb, aiPlayer: randomAi, aiOpponent: randomAi, seed: 800 + i, firstPlayer: i % 2 === 0 ? 'player' : 'opponent' })
      expect(game.status, `game ${i}: ${game.dropReason}`).toBe('completed')
      // Replay it to count the looks: one per Thrawn per action phase.
      let s = game.initialState!
      for (const { action } of game.moves) {
        if (action.type === 'skipTrigger' && looks(s).some(c => c.id === action.choiceId)) lookedAt++
        s = resolve(s, action)
      }
    }
    expect(lookedAt).toBeGreaterThan(40)
  }, 120_000)
})
