import type { GameState, PendingTrigger, PlayerId } from './types'
import { pushChoice, hasPendingChoices } from './types'
import { runPendingTrigger } from './abilities'

/**
 * Ordering a batch of triggered abilities (CR 7.6.9 - 7.6.12).
 *
 * Triggers are collected as data (`collectUnitTriggers`) and drained here, rather than being run at
 * the point they fire. That split is the whole point: the rules let players order **abilities**, and
 * most abilities resolve without raising a choice, so an engine that runs them eagerly has destroyed
 * the ordering decision before it can be offered. A batch where one side draws a card and the other
 * looks at a deck top leaves a single entry in `pendingChoices`, which reads as "only one side has
 * anything owed" and asks nothing.
 *
 * Kept out of `resolve.ts` so `combat.ts` can enqueue without importing the resolver, which is the
 * import cycle `combat.ts` exists to break.
 */

/**
 * Append a freshly fired batch. Ids are made unique on collision because a defeat batch collects
 * once per defeated unit and each call numbers from zero, so two units of the same card id with the
 * same ability would otherwise collide and the second would be unaddressable.
 */
export function enqueueTriggers(state: GameState, triggers: PendingTrigger[], sameEvent = false): GameState {
  if (triggers.length === 0) return state
  const queue = state.pendingTriggers ?? []
  const taken = new Set(queue.map(t => t.id))

  /**
   * **A batch arriving while another is outstanding is nested** (CR 7.6.11), and that is enough to
   * detect it. The queue is only non-empty between firing and draining, so anything added during that
   * window was triggered by resolving one of the abilities already in it.
   *
   * Applied here rather than after the answering action completes, because a drain can happen in
   * between: damage dealt while answering a trigger's choice defeats a unit, and `applyUnitDamage`
   * drains before control ever returns to the resolver. A layer assigned later is assigned too late.
   *
   * `sameEvent` is the exception: a caller splitting one event across several calls (the combat damage
   * step damages each side separately) is still filling the same batch, not nesting under it.
   */
  const base = innermost(queue)
  const layer = queue.length > 0 && !sameEvent ? base + 1 : base
  const added = triggers.map(t => {
    let id = t.id
    for (let n = 1; taken.has(id); n++) id = `${t.id}#${n}`
    taken.add(id)
    return { ...t, id, layer }
  })
  // Nested batches lead, so the deepest layer is always at the front for a reader stepping the queue.
  return { ...state, pendingTriggers: layer > base ? [...added, ...queue] : [...queue, ...added] }
}

/**
 * Resolve one trigger. Anything it triggers in passing is layered by `enqueueTriggers`, which sees the
 * outstanding batch and nests underneath it, so nothing needs re-sorting here.
 */
function runOne(state: GameState, trigger: PendingTrigger): GameState {
  const waiting = (state.pendingTriggers ?? []).filter(t => t.id !== trigger.id)
  // `activePlayer` follows the ability, so a choice it raises is offered to the right side.
  return runPendingTrigger({ ...state, pendingTriggers: waiting, activePlayer: trigger.controller }, trigger)
}

/** The deepest layer still owed. Nested abilities resolve before the batch they interrupted. */
function innermost(queue: PendingTrigger[]): number {
  return queue.reduce((max, t) => Math.max(max, t.layer), 0)
}

/**
 * Whether ordering this batch is a real decision. The rules give the controller the order (CR 7.6.9),
 * but the same ability on the same card on the same unit, firing more than once for one event, has
 * only one answer: three upgrades leaving a unit at once is three Zeb Orrelios reactions that differ
 * in nothing. Asking would be a prompt whose options are indistinguishable to the player.
 *
 * The instance is part of the identity on purpose. Two copies of a card each hold their own ability,
 * and which resolves first is observable whenever one can change what the other sees.
 */
function distinguishable(triggers: PendingTrigger[]): boolean {
  const key = (t: PendingTrigger) => `${t.cardId}#${t.abilityIndex}#${t.sourceInstanceId ?? ''}`
  return new Set(triggers.map(key)).size > 1
}

/**
 * Whether this ability would change nothing if it resolved **right now**: a conditional trigger whose
 * condition is unmet, or one with no legal target.
 *
 * Asked by running it and looking at what comes back. Effects are pure, so the probed board is simply
 * discarded and only the answer kept, and a card states an unmet condition by returning the state it
 * was given (`s.initiative === ctx.owner ? … : s`), which is what makes the question answerable at all
 * without a per-card declaration that could drift from the effect it describes.
 *
 * "Right now" is the whole of it. The answer can change as the batch runs, so it is re-asked on every
 * pass rather than settled once when the batch was collected.
 */
function inertNow(state: GameState, trigger: PendingTrigger): boolean {
  return runPendingTrigger(state, trigger) === state
}

/**
 * Nothing owed: drop both fields rather than leaving empty ones behind, so states stay comparable, and
 * hand `activePlayer` back to whoever held it on entry.
 *
 * The restore matters. `runOne` moves `activePlayer` to each ability's controller so a choice it raises
 * is offered to the right side, and a batch that resolves silently would otherwise leave it parked on
 * the last ability's owner. That is invisible until a caller reads it back: the attack path restored
 * "the attacker" from the post-attack state, got the defender's side because their When Defeated had
 * run last, and `advanceTurn` then flipped the turn to the wrong player for the rest of the game.
 *
 * Only on a full drain. Stopping to ask a question deliberately leaves `activePlayer` on the chooser.
 */
function settled(state: GameState, enteredAs: PlayerId): GameState {
  if (state.pendingTriggers === undefined && state.triggerTurn === undefined && state.activePlayer === enteredAs) {
    return state
  }
  return { ...state, pendingTriggers: undefined, triggerTurn: undefined, activePlayer: enteredAs }
}

/**
 * Run the owed batch as far as it can go, stopping wherever a player has something to decide.
 *
 * Re-entrant: `resumeAfterChoice` calls back here once a trigger's own choice is answered, and the
 * loop picks up where it left off. The bound is a guard against a pathological chain of triggers
 * spawning triggers, matching `sweepStateBasedDefeats`.
 */
export function drainTriggers(state: GameState): GameState {
  const enteredAs = state.activePlayer
  let next = state
  for (let guard = 0; guard < 64; guard++) {
    const queue = next.pendingTriggers ?? []
    if (queue.length === 0) return settled(next, enteredAs)
    // An ability that raised its own choice resolves fully before the next begins (CR 7.6.12).
    if (hasPendingChoices(next)) return next

    // Only the innermost layer is in play, so every question below is asked among abilities that
    // genuinely triggered at the same time (CR 7.6.11).
    const layer = innermost(queue)
    const live = queue.filter(t => t.layer === layer)

    let turn = next.triggerTurn
    // Stale once that side has finished, or once a nested batch has opened underneath: either way the
    // question is re-decided, which is how the second player picks up without being asked something
    // that has only one answer.
    if (turn === undefined || turn.layer !== layer || !live.some(t => t.controller === turn!.side)) {
      const sides = new Set(live.map(t => t.controller))
      if (sides.size > 1) {
        // CR 7.6.10, and it is the ACTIVE player's call, not the initiative holder's.
        const asker = next.activePlayer
        return pushChoice(next, { kind: 'chooseTriggerOrder', id: `order-${queue.length}`, controller: asker })
      }
      turn = { side: live[0].controller, layer }
      next = { ...next, triggerTurn: turn }
    }

    const mine = live.filter(t => t.controller === turn.side)
    let toRun = mine[0]
    // Only worth probing where there is something to order: one ability resolves either way.
    if (mine.length > 1 && !mine[0].picked) {
      const actionable = mine.filter(t => !inertNow(next, t))
      if (actionable.length > 1 && distinguishable(actionable)) {
        // CR 7.6.9: their own order, over the abilities that would actually do something. `cardId`
        // rides along so the prompt can name each waiting ability's source, which is the only thing
        // distinguishing a unit's own ability from its upgrade's.
        return pushChoice({ ...next, activePlayer: turn.side }, {
          kind: 'chooseNextTrigger',
          id: `next-${queue.length}`,
          controller: turn.side,
          candidates: actionable.map(t => ({ triggerId: t.id, cardId: t.cardId, ...(t.sourceInstanceId ? { sourceInstanceId: t.sourceInstanceId } : {}) })),
        })
      }
      // Something that can act goes first, and the board is re-read on the next pass. An unmet
      // condition is not a permanent one: Grogu deploying meets Luke Skywalker's "at least 4 units",
      // and spending Luke while he could still do nothing would decide that for the player.
      // With nothing actionable, order cannot matter: none of them can change what the others see.
      if (actionable.length > 0) toRun = actionable[0]
    }
    next = runOne(next, toRun)
  }
  return next
}

/** Move the chosen trigger to the front and flag it, so the next drain resolves it (CR 7.6.9). */
export function pickNextTrigger(state: GameState, triggerId: string): GameState {
  const queue = state.pendingTriggers ?? []
  const picked = queue.find(t => t.id === triggerId)
  if (!picked) return state
  return { ...state, pendingTriggers: [{ ...picked, picked: true }, ...queue.filter(t => t.id !== triggerId)] }
}
