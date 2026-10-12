import { describe, it, expect } from 'vitest'
import { boardChanges, logEntries } from '../utils/boardDiff'
import { describeAction, describeActionParts, partsText } from '../utils/describeAction'
import type { DescribePart } from '../utils/describeAction'
import { resolve } from '../engine/resolve'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { loadReport, replaySteps } from './helpers/replayReport'
import type { Action } from '../engine/actions'
import type { GameState, PendingChoice, PlayerId, PlayerState } from '../engine/types'

/**
 * The log's follow-up lines: what an action changed on the board, read off the state either side of
 * it. Every card below has a name of its own, so a line that names one can be told from one that
 * does not.
 */
const F = {
  ...CARDS,
  MINE: card({ id: 'MINE', name: 'My Trooper', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  THEIRS: card({ id: 'THEIRS', name: 'Their Trooper', type: 'unit', arena: 'ground', power: 3, hp: 5 }),
  EVENT: card({ id: 'EVENT', name: 'Some Event', type: 'event', cost: 1 }),
  UPG: card({ id: 'UPG', name: 'Some Upgrade', type: 'upgrade', cost: 1 }),
  ASH_258: card({ id: 'ASH_258', name: 'Grassroots Resistance', type: 'event', cost: 4 }),
  // Cards that only ever sit in a hidden zone in these tests.
  H_HAND: card({ id: 'H_HAND', name: 'Secret In Hand', type: 'unit', cost: 1 }),
  H_DECK: card({ id: 'H_DECK', name: 'Secret In Deck', type: 'unit', cost: 1 }),
  H_RES: card({ id: 'H_RES', name: 'Secret Resource', type: 'unit', cost: 1 }),
}
const SECRETS = ['H_HAND', 'H_DECK', 'H_RES']

type Sides = { player?: Partial<PlayerState>; opponent?: Partial<PlayerState> }
const board = (sides: Sides = {}, over: Partial<GameState> = {}): GameState =>
  state({ cards: F, players: { player: player(sides.player), opponent: player(sides.opponent) }, ...over })

const lines = (before: GameState, after: GameState, named: DescribePart[] = []) => boardChanges(before, after, named).map(partsText)
const refs = (parts: DescribePart[]) => parts.flatMap(p => (typeof p === 'string' ? [] : [p]))

describe('boardChanges: what the board diff reports', () => {
  it('says nothing when nothing on the board changed', () => {
    const s = board({ player: { units: [unit('u1', 'MINE')] } })
    expect(boardChanges(s, s)).toEqual([])
  })

  it('reports base damage and base healing, on either side', () => {
    const before = board({ player: { base: { cardId: 'TST_B', damage: 7 } }, opponent: { base: { cardId: 'TST_B', damage: 2 } } })
    const after = board({ player: { base: { cardId: 'TST_B', damage: 4 } }, opponent: { base: { cardId: 'TST_B', damage: 6 } } })
    expect(lines(before, after)).toEqual(['Your base heals 3', "Opponent's base takes 4 damage"])
    expect(lines(after, before)).toEqual(['Your base takes 3 damage', "Opponent's base heals 4"])
  })

  it('reports damage and healing on a unit, linked to the unit and coloured by its controller', () => {
    const before = board({ player: { units: [unit('u1', 'MINE', { damage: 3 })] }, opponent: { units: [unit('e1', 'THEIRS')] } })
    const after = board({ player: { units: [unit('u1', 'MINE', { damage: 1 })] }, opponent: { units: [unit('e1', 'THEIRS', { damage: 2 })] } })
    const changes = boardChanges(before, after)
    expect(changes.map(partsText)).toEqual(['My Trooper heals 2', 'Their Trooper takes 2 damage'])
    expect(changes.flatMap(refs)).toEqual([
      { cardId: 'MINE', controller: 'player', text: 'My Trooper' },
      { cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' },
    ])
  })

  it('reports a unit entering play', () => {
    const before = board()
    const after = board({ opponent: { units: [unit('e1', 'THEIRS')] } })
    expect(lines(before, after)).toEqual(['Their Trooper enters play'])
  })

  it('reports a unit whose card reached a discard pile as defeated, once, with no separate discard line', () => {
    const before = board({ opponent: { units: [unit('e1', 'THEIRS', { damage: 4 })] } })
    const after = board({ opponent: { discard: ['THEIRS'] } })
    expect(lines(before, after)).toEqual(['Their Trooper is defeated'])
  })

  it('reports a unit that left play some other way as leaving play', () => {
    const before = board({ opponent: { units: [unit('e1', 'THEIRS')] } })
    const after = board({ opponent: { hand: ['THEIRS'] } })
    expect(lines(before, after)).toEqual(['Their Trooper leaves play'])
  })

  it('reports a token unit that is gone as defeated: it has no discard pile to arrive in', () => {
    const before = board({ player: { units: [unit('t1', 'TOKEN_SPY')] } })
    expect(lines(before, board())).toEqual(['Spy is defeated'])
  })

  it('does not report damage on a unit that left play: the defeat is the line', () => {
    const before = board({ player: { units: [unit('u1', 'MINE', { damage: 1 })] } })
    const after = board({ player: { discard: ['MINE'] } })
    expect(lines(before, after)).toEqual(['My Trooper is defeated'])
  })

  it('reports a unit changing sides as taken, not as leaving and entering', () => {
    const before = board({ opponent: { units: [unit('e1', 'THEIRS')] } })
    const after = board({ player: { units: [unit('e1', 'THEIRS')] } })
    expect(lines(before, after)).toEqual(['You take control of Their Trooper'])
    expect(lines(after, before)).toEqual(['Opponent takes control of Their Trooper'])
  })

  it('reports an upgrade or token gained or lost by a unit that stays in play', () => {
    const bare = board({ player: { units: [unit('u1', 'MINE')] } })
    const shielded = board({ player: { units: [unit('u1', 'MINE', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] } })
    const changes = boardChanges(bare, shielded)
    expect(changes.map(partsText)).toEqual(['My Trooper gains Shield'])
    expect(changes.flatMap(refs).map(r => r.cardId)).toEqual(['MINE', TOKEN_SHIELD])
    expect(lines(shielded, bare)).toEqual(['My Trooper loses Shield'])
  })

  it('reports a card upgrade that fell off as lost, without a second line for its discard', () => {
    const before = board({ player: { units: [unit('u1', 'MINE', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] } })
    const after = board({ player: { units: [unit('u1', 'MINE')], discard: ['UPG'] } })
    expect(lines(before, after)).toEqual(['My Trooper loses Some Upgrade'])
  })

  it('stays silent about the upgrades of a unit that was defeated with them', () => {
    const before = board({ player: { units: [unit('u1', 'MINE', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] } })
    const after = board({ player: { discard: ['MINE', 'UPG'] } })
    expect(lines(before, after)).toEqual(['My Trooper is defeated'])
  })

  it('reports any other card that arrives in a discard pile, linked, and says whose pile', () => {
    const before = board({ player: { hand: ['EVENT'] }, opponent: { deck: ['THEIRS', 'TST_U1'] } })
    const after = board({ player: { discard: ['EVENT'] }, opponent: { deck: ['TST_U1'], discard: ['THEIRS'] } })
    const changes = boardChanges(before, after)
    expect(changes.map(partsText)).toEqual(['Some Event goes to your discard pile', "Their Trooper goes to opponent's discard pile"])
    expect(changes.flatMap(refs)).toEqual([
      { cardId: 'EVENT', controller: 'player', text: 'Some Event' },
      { cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' },
    ])
  })
})

/**
 * One rule for what the action's own line already said. Numbers are always stated, because the
 * action line says what was chosen and these lines say what happened (a Shield may have taken the
 * damage). A card the action line links is not reported again for arriving where the play puts it.
 */
describe('boardChanges: not repeating the action', () => {
  const named = (cardId: string, controller: PlayerId = 'player'): DescribePart[] => ['Play ', { cardId, controller, text: F[cardId as keyof typeof F].name }]

  it('does not report the played unit entering play', () => {
    const before = board({ player: { hand: ['MINE'] } })
    const after = board({ player: { units: [unit('u1', 'MINE')] } })
    expect(lines(before, after, named('MINE'))).toEqual([])
  })

  it('does not report the played event reaching the discard pile', () => {
    const before = board({ player: { hand: ['EVENT'] } })
    const after = board({ player: { discard: ['EVENT'] } })
    expect(lines(before, after, named('EVENT'))).toEqual([])
  })

  it('does not report the played upgrade being gained', () => {
    const before = board({ player: { hand: ['UPG'], units: [unit('u1', 'MINE')] } })
    const after = board({ player: { units: [unit('u1', 'MINE', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] } })
    expect(lines(before, after, ['Play ', { cardId: 'UPG', controller: 'player', text: 'Some Upgrade' }, ' on ', { cardId: 'MINE', controller: 'player', text: 'My Trooper' }])).toEqual([])
  })

  it('still reports a second copy arriving: one naming accounts for one card', () => {
    const before = board({ player: { hand: ['EVENT', 'EVENT'] } })
    const after = board({ player: { discard: ['EVENT', 'EVENT'] } })
    expect(lines(before, after, named('EVENT'))).toEqual(['Some Event goes to your discard pile'])
  })

  it('still reports what happened to a unit the action names: an attack line does not hide its outcome', () => {
    const before = board({ player: { units: [unit('u1', 'MINE')] }, opponent: { units: [unit('e1', 'THEIRS', { damage: 3 })] } })
    const after = board({ player: { units: [unit('u1', 'MINE', { damage: 3 })] }, opponent: { discard: ['THEIRS'] } })
    const attack: DescribePart[] = ['Attack ', { cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' }, ' with ', { cardId: 'MINE', controller: 'player', text: 'My Trooper' }]
    expect(lines(before, after, attack)).toEqual(['My Trooper takes 3 damage', 'Their Trooper is defeated'])
  })
})

describe('logEntries: the action, then what it changed', () => {
  /**
   * The case the ticket was filed from: Grassroots Resistance deals 3 and heals 3. The action line
   * says so, and the follow-ups state both outcomes anyway, which is the rule above.
   */
  it('Grassroots Resistance: the damage and the heal are both stated as outcomes', () => {
    const played = resolve(board({
      player: { resources: ready(10), hand: ['ASH_258'], base: { cardId: 'TST_B', damage: 7 } },
      opponent: { units: [unit('e', 'THEIRS')] },
    }), { type: 'playEvent', handIndex: 0 })
    const action: Action = { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'e' }
    const entries = logEntries(played, resolve(played, action), 'player', action)
    expect(entries.map(e => e.text)).toEqual([
      'Deal 3 to Their Trooper, heal 3 from your base',
      'Their Trooper takes 3 damage',
      'Your base heals 3',
    ])
    expect(entries.map(e => e.outcome ?? false)).toEqual([false, true, true])
    expect(entries.every(e => e.by === 'player')).toBe(true)
  })

  it('an attack says what it did to both units and to the base', () => {
    const s = board({ player: { units: [unit('u1', 'MINE')] }, opponent: { units: [unit('e1', 'THEIRS')] } })
    const onUnit: Action = { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } }
    expect(logEntries(s, resolve(s, onUnit), 'player', onUnit).map(e => e.text)).toEqual([
      'Attack Their Trooper with My Trooper',
      'My Trooper takes 3 damage',
      'Their Trooper takes 2 damage',
    ])
    const onBase: Action = { type: 'attack', attackerId: 'u1', target: { kind: 'base' } }
    expect(logEntries(s, resolve(s, onBase), 'player', onBase).map(e => e.text)).toEqual([
      'Attack base with My Trooper',
      "Opponent's base takes 2 damage",
    ])
  })

  it('a played unit is one line: the play, with nothing repeated under it', () => {
    const s = board({ player: { resources: ready(5), hand: ['MINE'] } })
    const action: Action = { type: 'playUnit', handIndex: 0 }
    expect(logEntries(s, resolve(s, action), 'player', action).map(e => e.text)).toEqual(['Play My Trooper (0)'])
  })

  it('keeps text and parts in step for every entry', () => {
    const s = board({ player: { units: [unit('u1', 'MINE')] }, opponent: { units: [unit('e1', 'THEIRS')] } })
    const action: Action = { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } }
    for (const e of logEntries(s, resolve(s, action), 'player', action)) expect(partsText(e.parts)).toBe(e.text)
  })
})

/**
 * Cards made public by the answer to a choice are linked in the action line itself, since the choice
 * carries which card it was: nothing in the state records a reveal.
 */
describe('reveals and discards the action itself names are links', () => {
  const asked = (by: PlayerId, choice: PendingChoice, sides: Sides) => board(sides, { activePlayer: by, pendingChoices: [choice] })

  it('links a unit revealed from hand, for the opponent too', () => {
    const s = asked('opponent', { kind: 'revealUnitFromHand', id: 'c', controller: 'opponent', handIndices: [0], amount: 3 }, { opponent: { hand: ['THEIRS'] } })
    const action: Action = { type: 'acceptChoice', choiceId: 'c', handIndex: 0 }
    const parts = describeActionParts(s, 'opponent', action, { redact: true })
    expect(partsText(parts)).toBe('Reveal Their Trooper')
    expect(refs(parts)).toEqual([{ cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' }])
  })

  it('links a card discarded from hand, and the discard is then not reported a second time', () => {
    const s = asked('opponent', { kind: 'selectDiscard', id: 'c', controller: 'opponent', count: 1 }, { opponent: { hand: ['H_HAND', 'THEIRS'] } })
    const action: Action = { type: 'acceptChoice', choiceId: 'c', handIndex: 1 }
    const parts = describeActionParts(s, 'opponent', action, { redact: true })
    expect(partsText(parts)).toBe('Discard Their Trooper')
    expect(refs(parts)).toEqual([{ cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' }])
    const after = board({ opponent: { hand: ['H_HAND'], discard: ['THEIRS'] } })
    expect(lines(s, after, parts)).toEqual([])
  })

  it('joins back to the plain description for every linked answer', () => {
    const s = asked('player', { kind: 'revealUnitFromHand', id: 'c', controller: 'player', handIndices: [0], amount: 3 }, { player: { hand: ['MINE'] } })
    const action: Action = { type: 'acceptChoice', choiceId: 'c', handIndex: 0 }
    expect(partsText(describeActionParts(s, 'player', action))).toBe(describeAction(s, 'player', action))
  })
})

/**
 * Hidden information. Nothing the player could not see at the table may reach the log: the
 * opponent's hand, either deck, a card put down as a resource, or a card moved between two of those.
 * Each test moves a card through hidden zones only and checks that no line names it, in text or as a
 * link (a link would show the card on hover even under a line that reads "a card").
 */
describe('hidden information never reaches the log', () => {
  const namesSecret = (e: { text: string; parts: DescribePart[] }) =>
    SECRETS.some(id => e.text.includes(F[id as keyof typeof F].name) || e.text.includes(id) || refs(e.parts).some(r => r.cardId === id))

  const hiddenMoves: [string, Sides, Sides][] = [
    ['the opponent draws', { opponent: { deck: ['H_DECK', 'TST_U1'] } }, { opponent: { deck: ['TST_U1'], hand: ['H_DECK'] } }],
    ['the player draws', { player: { deck: ['H_DECK', 'TST_U1'] } }, { player: { deck: ['TST_U1'], hand: ['H_DECK'] } }],
    ['the opponent resources a card from hand', { opponent: { hand: ['H_HAND'] } }, { opponent: { resources: [{ cardId: 'H_HAND', exhausted: false }] } }],
    ['the opponent resources the top of their deck', { opponent: { deck: ['H_DECK'] } }, { opponent: { deck: [], resources: [{ cardId: 'H_DECK', exhausted: false }] } }],
    ['the opponent puts a card from hand on their deck', { opponent: { hand: ['H_HAND'], deck: ['TST_U1'] } }, { opponent: { deck: ['H_HAND', 'TST_U1'] } }],
    ['the opponent takes a resource back into hand', { opponent: { resources: [{ cardId: 'H_RES', exhausted: false }] } }, { opponent: { hand: ['H_RES'] } }],
    ['a deck is reordered', { opponent: { deck: ['H_DECK', 'TST_U1', 'TST_U2'] } }, { opponent: { deck: ['TST_U2', 'TST_U1', 'H_DECK'] } }],
    ['a resource is exhausted', { opponent: { resources: [{ cardId: 'H_RES', exhausted: false }] } }, { opponent: { resources: [{ cardId: 'H_RES', exhausted: true }] } }],
  ]

  it.each(hiddenMoves)('the diff says nothing when %s', (_what, from, to) => {
    expect(boardChanges(board(from), board(to))).toEqual([])
  })

  /** The opponent's own action line, which `redact` governs, for each answer that moves a hidden card. */
  const opponentAnswers: [string, PendingChoice, Partial<PlayerState>, Action][] = [
    ['resources a card from hand', { kind: 'mayResourceFromHand', id: 'c', controller: 'opponent' }, { hand: ['H_HAND'] }, { type: 'acceptChoice', choiceId: 'c', handIndex: 0 }],
    ['picks a card from hand for an effect', { kind: 'selectHandCardThen', id: 'c', controller: 'opponent', handIndices: [0], text: 'put a card from your hand on top of your deck', then: { cardId: 'X', owner: 'opponent' } }, { hand: ['H_HAND'] }, { type: 'acceptChoice', choiceId: 'c', handIndex: 0 }],
    ['searches for a card and resources it', { kind: 'searchDraw', id: 'c', controller: 'opponent', revealed: ['H_DECK', 'TST_U1'], eligibleIndices: [0, 1], resourceIt: true }, { deck: ['H_DECK', 'TST_U1'] }, { type: 'acceptChoice', choiceId: 'c', deckIndex: 0 }],
    ['searches for any card and draws it', { kind: 'searchDraw', id: 'c', controller: 'opponent', revealed: ['H_DECK', 'TST_U1'], eligibleIndices: [0, 1] }, { deck: ['H_DECK', 'TST_U1'] }, { type: 'acceptChoice', choiceId: 'c', deckIndex: 0 }],
  ]

  it.each(opponentAnswers)("the opponent's line names no card when it %s", (_what, choice, side, action) => {
    const s = board({ opponent: side }, { activePlayer: 'opponent', pendingChoices: [choice] })
    const parts = describeActionParts(s, 'opponent', action, { redact: true })
    expect(namesSecret({ text: partsText(parts), parts })).toBe(false)
    expect(partsText(parts)).toBe(describeAction(s, 'opponent', action, { redact: true }))
  })

  /**
   * A search that only some of the looked-at cards could satisfy is a search for a kind of card,
   * which every printing reveals ("reveal it, and draw it"). That one is public and stays named.
   */
  it('still names the card a filtered search reveals', () => {
    const choice: PendingChoice = { kind: 'searchDraw', id: 'c', controller: 'opponent', revealed: ['THEIRS', 'EVENT'], eligibleIndices: [0] }
    const s = board({ opponent: { deck: ['THEIRS', 'EVENT'] } }, { activePlayer: 'opponent', pendingChoices: [choice] })
    const parts = describeActionParts(s, 'opponent', { type: 'acceptChoice', choiceId: 'c', deckIndex: 0 }, { redact: true })
    expect(partsText(parts)).toBe('Draw Their Trooper')
    expect(refs(parts)).toEqual([{ cardId: 'THEIRS', controller: 'opponent', text: 'Their Trooper' }])
  })

  it('the player still sees their own picks named: only the opponent is redacted', () => {
    const choice: PendingChoice = { kind: 'mayResourceFromHand', id: 'c', controller: 'player' }
    const s = board({ player: { hand: ['MINE'] } }, { pendingChoices: [choice] })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'c', handIndex: 0 })).toBe('Resource My Trooper')
  })

  /** Through the engine: the opponent's resource pick and regroup, start to finish. */
  it("resolving the opponent's resource pick logs that they resourced and nothing else", () => {
    const s = board({ opponent: { hand: ['H_HAND', 'THEIRS'] } }, { activePlayer: 'opponent', phase: 'regroup' })
    const action: Action = { type: 'resourceCard', handIndex: 0 }
    const entries = logEntries(s, resolve(s, action), 'opponent', action)
    expect(entries.map(e => e.text)).toEqual(['Resource a card'])
    expect(entries.some(namesSecret)).toBe(false)
  })

  /**
   * Every step of every filed report, which is real play against the real engine. A linked card must
   * be one the player could see: in play or in a discard pile either side of the action, or a card
   * the player themselves held. And no line by the opponent may name a card of theirs that was in a
   * hidden zone both before and after, unless it is public somewhere too.
   */
  describe('over the filed reports', () => {
    const inPlay = (p: PlayerState) => [
      p.leader.cardId, p.base.cardId,
      ...(p.base.upgrades ?? []).map(u => u.cardId),
      ...(p.base.captured ?? []).map(c => c.cardId),
      ...p.units.flatMap(u => [u.cardId, u.physicalCardId ?? u.cardId, ...u.upgrades.map(x => x.cardId), ...(u.captured ?? []).map(c => c.cardId)]),
    ]
    const publicIds = (s: GameState) => new Set((['player', 'opponent'] as PlayerId[]).flatMap(id => [...inPlay(s.players[id]), ...s.players[id].discard]))
    const hiddenIds = (p: PlayerState) => new Set([...p.hand, ...p.deck, ...p.resources.map(r => r.cardId)])

    const NAMES = ['grassrootsHeal', 'attackBuffPersists', 'baylanExhaust', 'debuffOnOwnUnit', 'exhaustedLeaderDraw', 'hondoTopCard', 'kimogilaArena', 'rampResourceReady', 'sloaneSelfSentinel']

    it.each(NAMES)('%s: no outcome line links a card the player could not see', name => {
      const report = loadReport(name)
      const steps = replaySteps(report)
      let outcomes = 0
      report.moves.forEach((move, i) => {
        const before = steps[i], after = steps[i + 1]
        const seen = new Set([...publicIds(before), ...publicIds(after)])
        for (const entry of logEntries(before, after, move.by, move.action).filter(e => e.outcome)) {
          outcomes++
          for (const ref of refs(entry.parts)) expect(seen.has(ref.cardId), `move ${i}: "${entry.text}" links ${ref.cardId}`).toBe(true)
        }
      })
      expect(outcomes, 'a real game changes the board: zero lines would mean the walk measured nothing').toBeGreaterThan(10)
    })

    it.each(NAMES)("%s: no line of the opponent's names a card that stayed hidden", name => {
      const report = loadReport(name)
      const steps = replaySteps(report)
      let checked = 0
      report.moves.forEach((move, i) => {
        if (move.by !== 'opponent') return
        const before = steps[i], after = steps[i + 1]
        const seen = new Set([...publicIds(before), ...publicIds(after)])
        const seenNames = new Set([...seen].map(id => before.cards[id]?.name))
        const stayedHidden = [...hiddenIds(before.players.opponent)].filter(id => hiddenIds(after.players.opponent).has(id) && !seen.has(id) && !seenNames.has(before.cards[id]?.name))
        for (const entry of logEntries(before, after, 'opponent', move.action)) {
          checked++
          for (const id of stayedHidden) {
            expect(refs(entry.parts).some(r => r.cardId === id), `move ${i}: "${entry.text}" links hidden ${id}`).toBe(false)
            expect(entry.text.includes(before.cards[id]?.name ?? id), `move ${i}: "${entry.text}" names hidden ${before.cards[id]?.name}`).toBe(false)
          }
        }
      })
      expect(checked).toBeGreaterThan(10)
    })
  })
})
