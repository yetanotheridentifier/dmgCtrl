import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from '../engine/resolve'
import { registerCard, unregisterAbility, collectUnitTriggers } from '../engine/abilities'
import { fireBatch, drawCards } from '../engine/effects'
import { pushChoice } from '../engine/types'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **An ability that will do nothing is not an ordering decision.**
 *
 * Play-testing #529: routing every event through the trigger queue put conditional abilities into the
 * ordering prompt even when their condition was unmet, so the player was asked to sequence something
 * that would visibly do nothing when they picked it.
 *
 * The pool states an unmet condition by returning the state it was given: `s.initiative === ctx.owner
 * ? … : s`, `targets.length ? … : s`, `if (!u || !isUpgraded(u)) return s`. That makes "would this do
 * anything right now" answerable without a per-card declaration that could drift from the effect, and
 * the effects are pure, so asking costs nothing but the call.
 *
 * Such an ability still resolves. It is resolved **first**, before the prompt, precisely because it
 * changes nothing: that keeps it a no-op rather than letting an earlier ability turn it into one.
 */
const LIVE = 'TEST_LIVE'
const DEAD = 'TEST_DEAD'
const ALSO_LIVE = 'TEST_ALSO_LIVE'
/** Meets DEAD's condition when it resolves, so the two together test the order they resolve in. */
const ENABLER = 'TEST_ENABLER'
const ALL = [LIVE, DEAD, ALSO_LIVE, ENABLER]

const cards = {
  ...CARDS,
  ...Object.fromEntries(ALL.map(id => [id, card({ id, type: 'unit', arena: 'ground', power: 2, hp: 4 })])),
}

// Registered per test, since `afterEach` unregisters and `registerCard` appends rather than replaces.
beforeEach(() => {
  /** Raises a choice, so it is plainly something to sequence. */
  registerCard(LIVE, {
    abilities: [{
      trigger: 'onAttackEnd',
      description: 'You may pay 0 to draw a card.',
      effect: (s, ctx) => pushChoice(s, { kind: 'mayPayToDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, draw: 1 }),
    }],
  })
  /** Draws, so it is meaningful but silent: it never raises a choice of its own. */
  registerCard(ALSO_LIVE, {
    abilities: [{ trigger: 'onAttackEnd', description: 'Draw a card.', effect: (s, ctx) => drawCards(s, ctx.owner, 1) }],
  })
  /** The conditional one. Its condition is unmet on these boards, so it returns the state untouched. */
  registerCard(DEAD, {
    abilities: [{
      trigger: 'onAttackEnd',
      description: 'If you control a unit in the space arena, draw a card.',
      effect: (s, ctx) => (s.players[ctx.owner].units.some(u => u.arena === 'space') ? drawCards(s, ctx.owner, 1) : s),
    }],
  })
  registerCard(ENABLER, {
    abilities: [{
      trigger: 'onAttackEnd',
      description: 'Create a space unit.',
      effect: (s, ctx) => ({
        ...s,
        players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], units: [...s.players[ctx.owner].units, unit('spawn', 'TST_U2', { arena: 'space' })] } },
      }),
    }],
  })
})

afterEach(() => ALL.forEach(unregisterAbility))

function board(cardIds: string[]): GameState {
  return state({
    cards,
    players: {
      player: player({ units: cardIds.map((c, i) => unit(`u${i}`, c, { arena: 'ground' })), deck: ['TST_U1', 'TST_U1', 'TST_U1'] }),
      opponent: player(),
    },
  })
}

/** Everything the batch owes, as one event. */
function fireAll(s: GameState): GameState {
  return fireBatch(s, s.players.player.units.flatMap(u => collectUnitTriggers(s, 'onAttackEnd', u, 'player')))
}

const ask = (s: GameState) => (s.pendingChoices ?? []).find(c => c.kind === 'chooseNextTrigger')

describe('an ability whose condition is unmet is not offered as an ordering decision', () => {
  it('asks nothing when only one of the two can do anything', () => {
    const fired = fireAll(board([LIVE, DEAD]))
    expect(ask(fired)).toBeUndefined()
    // The one that could act did, and its choice is what the player is left with.
    expect((fired.pendingChoices ?? []).map(c => c.kind)).toEqual(['mayPayToDraw'])
  })

  it('still resolves the unmet one rather than dropping it', () => {
    const fired = fireAll(board([LIVE, DEAD]))
    // The live one went first and stopped to ask, so the unmet one is still owed behind it
    // (CR 7.6.12: an ability resolves fully, choice and all, before the next begins).
    expect((fired.pendingTriggers ?? []).map(t => t.cardId)).toEqual([DEAD])
    const answered = resolve({ ...fired, activePlayer: 'player' }, { type: 'skipTrigger', choiceId: fired.pendingChoices![0].id })
    expect(answered.pendingTriggers ?? [], 'and it resolves once the queue reaches it').toEqual([])
  })

  it('does not silently skip a meaningful ability that raises no choice', () => {
    const before = board([ALSO_LIVE, DEAD])
    const fired = fireAll(before)
    expect(ask(fired)).toBeUndefined()
    expect(fired.players.player.hand).toHaveLength(before.players.player.hand.length + 1) // the draw happened
  })

  it('still asks when both can act', () => {
    const fired = fireAll(board([LIVE, ALSO_LIVE]))
    const question = ask(fired)
    expect(question, 'two live abilities is a real decision').toBeDefined()
    expect((question as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId).sort())
      .toEqual([ALSO_LIVE, LIVE].sort())
  })

  it('offers only the live ones when a third is unmet', () => {
    const fired = fireAll(board([LIVE, DEAD, ALSO_LIVE]))
    const question = ask(fired)
    expect(question).toBeDefined()
    expect((question as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).not.toContain(DEAD)
  })

  /**
   * **An unmet condition is not a permanent one.** The ability that can act resolves first and the
   * board is re-read afterwards, so one whose condition a batch-mate meets gets its chance rather than
   * being spent while it could still do nothing.
   */
  it('lets an ability its batch-mate enables resolve after it, not before', () => {
    const s = board([DEAD, ENABLER])
    const fired = fireAll(s)
    expect(ask(fired)).toBeUndefined() // only one could act, so there was nothing to order
    expect(fired.players.player.units.some(u => u.arena === 'space'), 'the enabler ran').toBe(true)
    expect(fired.players.player.hand, 'and the enabled one then drew').toHaveLength(s.players.player.hand.length + 1)
  })

  it('leaves it unmet when nothing in the batch meets it', () => {
    const s = board([DEAD, ALSO_LIVE])
    const fired = fireAll(s)
    // ALSO_LIVE draws; DEAD's condition is still unmet afterwards, so it does not.
    expect(fired.players.player.hand).toHaveLength(s.players.player.hand.length + 1)
  })
})
