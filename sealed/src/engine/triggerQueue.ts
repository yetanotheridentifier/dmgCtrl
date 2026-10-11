import type { GameState, PendingTrigger, PlayerId } from './types'
import type { Action } from './actions'
import { pushChoice, hasPendingChoices } from './types'
import { collectAbilityUsed, runPendingTrigger, triggerAbility, usedAbilityOf } from './abilities'

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
  const from: GameState = { ...state, pendingTriggers: waiting, activePlayer: trigger.controller }
  const after = runPendingTrigger(from, trigger)
  // Announced as a nested batch like any other, which the queue holds back until the ability's own
  // choices are answered, so "use that ability again" follows the whole first use. A "Then, ..." the
  // ability owes after a choice is enqueued later, from the answer, so it nests deeper still and
  // resolves before the announcement too.
  const used = usedAbilityOf(trigger, after !== from)
  return used ? enqueueTriggers(after, collectAbilityUsed(after, used)) : after
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
  // **Probed with this trigger already off the queue, exactly as `runOne` resolves it.** Without that
  // the probe runs against a board that still owes the very ability being probed, so an effect which
  // fires a nested batch (attaching a token fires "when an upgrade attaches") reaches a drain that
  // finds the same trigger waiting and probes it again. That recursion is unbounded: it overflowed
  // the stack on a real board, and in the app, which has no error boundary, that is a lost game.
  //
  // The comparison is against the probed board rather than `state`, or dequeuing would itself read as
  // a change and every trigger would look actionable.
  const waiting = (state.pendingTriggers ?? []).filter(t => t.id !== trigger.id)
  const from: GameState = { ...state, pendingTriggers: waiting }
  return runPendingTrigger(from, trigger) === from
}

/** Two boards that differ in nothing. Shared structure is the common case, so identity is tried first. */
function sameBoard(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>]
  // The union of keys, so a field that is absent on one side and `undefined` on the other is the same.
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(k => sameBoard(left[k], right[k]))
}

/**
 * How the order probe answers a choice: the legal moves on a board, and the board a move leads to.
 * The resolver registers itself (`resolve.ts`), since importing it here is the cycle this module is
 * kept out of. Until it has, a choice raised during a probe simply counts as the order showing.
 */
export interface ProbeStepper {
  moves: (state: GameState) => Action[]
  step: (state: GameState, move: Action) => GameState
}
let stepper: ProbeStepper | undefined
export function setProbeStepper(registered: ProbeStepper): void {
  stepper = registered
}

/** Answers walked per pair before a probe gives up and lets the player decide. */
const PROBE_NODES = 48
/** Set while a probe runs, so an ability probed inside it is simply offered instead of probed again. */
let probing = false

/**
 * Whether two boards lead to the same place **whatever their controller answers**: both settled and
 * identical, or both asking `chooser` the same question with every answer leading to the same place
 * in turn. Anything else is a difference: a question to the other player (whose hand must not decide
 * what this player is asked), answers that differ, or more to walk than `budget` allows.
 */
function sameOutcome(a: GameState, b: GameState, chooser: PlayerId, budget: { nodes: number }): boolean {
  const open = (s: GameState): boolean => hasPendingChoices(s) || (s.pendingTriggers ?? []).length > 0
  if (a.winner !== null || b.winner !== null || (!open(a) && !open(b))) return sameBoard(a, b)
  if (!stepper || --budget.nodes < 0) return false
  if (a.activePlayer !== chooser || b.activePlayer !== chooser) return false
  const { moves, step } = stepper
  const answers = moves(a)
  if (answers.length === 0 || !sameBoard(answers, moves(b))) return false
  return answers.every(m => sameOutcome(step(a, m), step(b, m), chooser, budget))
}

/**
 * Whether `trigger`'s place in the order could be seen: asked of an ability that `yieldsOrder`
 * (Shielded), against each other ability it would be ordered with.
 *
 * Measured rather than declared, the same way `inertNow` is. Each pair is resolved both ways round on
 * a board that owes nothing else, and the order shows unless the two reach the same board. Where the
 * other ability asks its controller something, every answer is walked both ways round too: an Ambush
 * attack taken before the Shield arrives is damage on the unit and a Shield still on it, and taken
 * after is neither, which is exactly the difference this exists to keep. "You may give a Shield token
 * to another unit" comes out the same whichever way it is answered, and is not worth a question.
 *
 * Pairwise, from the board as it stands. That is exact for two abilities and an approximation for
 * three or more, where one could in principle change what a second makes of the Shield; it is
 * re-asked on every pass like everything else here. A probe that throws is a probe that could not
 * tell, so the player is asked.
 */
function orderShows(state: GameState, trigger: PendingTrigger, others: PendingTrigger[]): boolean {
  if (probing) return true
  const bare: GameState = { ...state, pendingTriggers: undefined, triggerTurn: undefined }
  // Both owed and `first` already named as the next to resolve, as answering the question leaves it.
  const ordered = (first: PendingTrigger, second: PendingTrigger): GameState =>
    drainTriggers({ ...bare, pendingTriggers: [{ ...first, layer: 0, picked: true }, { ...second, layer: 0, picked: false }] })
  probing = true
  try {
    return others.some(other =>
      !sameOutcome(ordered(trigger, other), ordered(other, trigger), trigger.controller, { nodes: PROBE_NODES }))
  } catch {
    return true
  } finally {
    probing = false
  }
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
      // An ability that steps aside resolves now, unasked, where its place in the order cannot be
      // seen; the rest are then ordered among themselves on the next pass.
      const aside = actionable.length > 1
        ? actionable.find(t => triggerAbility(t)?.yieldsOrder && !orderShows(next, t, actionable.filter(o => o !== t)))
        : undefined
      if (aside) {
        next = runOne(next, aside)
        continue
      }
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

/**
 * Set the owed batch aside for an attack made while resolving one of its abilities.
 *
 * An Ambush attack is part of resolving Ambush, so whatever triggered alongside it "is not resolved
 * until after the attack resulting from Ambush and any abilities triggered during the attack are
 * resolved" (CR 7.5.5f; Support reads the same, and CR 7.6.12 says it of every ability). Left on the
 * queue, the batch is resolved by the first drain the attack makes: a Shield that was to arrive after
 * the attack arrives in the middle of it, in time to soak the hit.
 *
 * Taken off the queue rather than fenced within it, so that everything asking "is this event's batch
 * still going" during the attack sees the attack's own abilities and nothing else.
 */
export function holdTriggers(state: GameState, attackerId: string): GameState {
  const triggers = state.pendingTriggers ?? []
  if (triggers.length === 0) return state
  const held = { attackerId, triggers, ...(state.triggerTurn ? { turn: state.triggerTurn } : {}) }
  return { ...state, pendingTriggers: undefined, triggerTurn: undefined, heldTriggers: [...(state.heldTriggers ?? []), held] }
}

/**
 * Put back the batch `attackerId`'s attack set aside, now that the attack is over. Anything the
 * attack triggered that is still owed (it stopped to ask something) is nested above the returning
 * batch, so it still resolves first (CR 7.6.11). The caller drains.
 */
export function releaseTriggers(state: GameState, attackerId: string): GameState {
  const stack = state.heldTriggers ?? []
  const held = stack[stack.length - 1]
  if (!held || held.attackerId !== attackerId) return state
  const above = innermost(held.triggers) + 1
  const owed = (state.pendingTriggers ?? []).map(t => ({ ...t, layer: t.layer + above }))
  const turn = owed.length > 0
    ? (state.triggerTurn ? { ...state.triggerTurn, layer: state.triggerTurn.layer + above } : undefined)
    : held.turn
  return {
    ...state,
    pendingTriggers: [...owed, ...held.triggers],
    triggerTurn: turn,
    heldTriggers: stack.length > 1 ? stack.slice(0, -1) : undefined,
  }
}

/** Move the chosen trigger to the front and flag it, so the next drain resolves it (CR 7.6.9). */
export function pickNextTrigger(state: GameState, triggerId: string): GameState {
  const queue = state.pendingTriggers ?? []
  const picked = queue.find(t => t.id === triggerId)
  if (!picked) return state
  return { ...state, pendingTriggers: [{ ...picked, picked: true }, ...queue.filter(t => t.id !== triggerId)] }
}
