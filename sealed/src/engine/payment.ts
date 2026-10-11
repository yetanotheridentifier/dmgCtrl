import type { Action } from './actions'
import type { GameState, PendingChoice, PlayerId } from './types'
import { findChoice, opponentOf, removeChoice, updatePlayer } from './types'
import { payCost, readyResourceCount } from './resources'
import { abilityCardIds, getCardDefinition } from './abilities'
import { defeatCreditTokens, exhaustUnit, friendlyCreditTokens } from './effects'

/**
 * Paying a cost: the one door every payment goes through, and the paying step in front of it.
 *
 * **Three things pay.** Ready resources, which are exhausted. A Credit token ("While paying resources,
 * you may defeat this token. If you do, pay 1 less."). A unit that pays as a resource (`unitPaysCosts`,
 * Vuutun Palaa's Droids), exhausted to pay 1. Which of them pays is the player's to say every time a
 * cost is paid, whether or not ready resources would cover it: a token is sometimes worth more spent
 * than kept, and a ready unit is sometimes worth more than a ready resource.
 *
 * **The doors do not ask.** Each one (a card played out of any zone, an ability's cost, a choice that
 * carries a cost) computes what it owes, calls `pay`, and carries on in one synchronous function, and
 * several do more afterwards (a re-offer, an "if you do", a use marked, the turn handed over). None of
 * them can stop half way. So the question is asked before the action starts instead:
 *
 * 1. **Measure.** When the acting player holds anything besides resources to pay with, the dispatcher
 *    runs the action once with `paying.measure` set. `pay` records the first cost it is asked for and
 *    the result is thrown away.
 * 2. **Ask.** If a cost was asked for, a `payWith` choice is raised and nothing else happens: nothing
 *    is paid, marked used or handed over. The choice holds the action itself as `resume`, which is
 *    the whole continuation, as data.
 * 3. **Resume.** Done defeats the tokens picked, exhausts the units picked, and runs `resume` with
 *    that much `prepaid`. `pay` takes the prepaid amount off the first cost and exhausts resources
 *    for the rest.
 *
 * A player who holds no usable Credit token and controls no paying unit is never measured and never
 * asked: for them `pay` is `payCost` and `canPay` is `canAfford`.
 *
 * `GameState.paying` exists only inside one `resolve` call. No state that leaves the resolver has it.
 */
export interface Paying {
  /** A dry run: record the first cost asked for instead of acting on it. */
  measure?: true
  /** What the dry run was first asked to pay, and by whom. */
  asked?: { player: PlayerId; cost: number }
  /** What the paying step has already covered, taken off the next cost `player` pays. */
  prepaid?: { player: PlayerId; amount: number }
}

type PayWith = Extract<PendingChoice, { kind: 'payWith' }>

/**
 * How many of `playerId`'s Credit tokens can pay: all of them, or none while an enemy card says
 * "Enemy Credit tokens lose all abilities" (Conveyex Security Captain).
 */
export function usableCreditTokens(state: GameState, playerId: PlayerId): number {
  const held = friendlyCreditTokens(state, playerId)
  if (held === 0) return 0
  const enemy = opponentOf(playerId)
  const suppressed = state.players[enemy].units.some(u => abilityCardIds(state, u, enemy).some(id => getCardDefinition(id)?.suppressesEnemyCredits?.(state, u) ?? false))
  return suppressed ? 0 : held
}

/** `playerId`'s ready units that a friendly card lets them exhaust to pay costs (Vuutun Palaa's Droids). */
export function unitCostPayers(state: GameState, playerId: PlayerId): string[] {
  // Asked once per affordability question, many times per position, and a state never changes.
  const known = payersByState.get(state)?.[playerId]
  if (known) return known
  const units = state.players[playerId].units
  const tests = units.flatMap(u => abilityCardIds(state, u, playerId).flatMap(id => {
    const test = getCardDefinition(id)?.unitPaysCosts
    return test ? [test] : []
  }))
  const payers = tests.length === 0 ? [] : units.filter(u => !u.exhausted && tests.some(t => t(state, u))).map(u => u.instanceId)
  payersByState.set(state, { ...payersByState.get(state), [playerId]: payers })
  return payers
}
const payersByState = new WeakMap<GameState, Partial<Record<PlayerId, string[]>>>()

/**
 * The most the paying step could cover for `playerId`: usable Credit tokens plus paying units, less
 * `except`, a unit that cannot pay this cost (the one whose own action is being paid for).
 */
export function payingMeans(state: GameState, playerId: PlayerId, except?: string): number {
  return usableCreditTokens(state, playerId) + unitCostPayers(state, playerId).filter(id => id !== except).length
}

/**
 * What `playerId` could pay right now: ready resources, plus everything the paying step could cover.
 * While an action resumes after its step, the step's answer is final, so it is the ready resources
 * plus what was prepaid.
 */
export function payable(state: GameState, playerId: PlayerId, except?: string): number {
  const ready = readyResourceCount(state.players[playerId])
  const prepaid = state.paying?.prepaid
  if (prepaid) return ready + (prepaid.player === playerId ? prepaid.amount : 0)
  return ready + payingMeans(state, playerId, except)
}

/** Whether `playerId` can pay `cost`, with resources and whatever else they hold that pays. */
export function canPay(state: GameState, playerId: PlayerId, cost: number, except?: string): boolean {
  return cost <= 0 || cost <= payable(state, playerId, except)
}

/**
 * `playerId` pays `cost`. `prefer` names resources to exhaust first (a card leaving the zone by being
 * played out of it, CR 14.e); see `payCost`. Throws when the cost cannot be paid, which the moves on
 * offer never allow.
 */
export function pay(state: GameState, playerId: PlayerId, cost: number, prefer: number[] = []): GameState {
  if (cost <= 0) return state
  const paying = state.paying
  if (paying?.measure) {
    // A dry run: note the first cost, exhaust what resources there are, and let the action run on.
    const noted = paying.asked ? state : { ...state, paying: { ...paying, asked: { player: playerId, cost } } }
    const p = noted.players[playerId]
    return updatePlayer(noted, playerId, payCost(p, Math.min(cost, readyResourceCount(p)), prefer))
  }
  if (paying?.prepaid?.player !== playerId) return updatePlayer(state, playerId, payCost(state.players[playerId], cost, prefer))
  // The step answered for this one cost. Its answer is spent here, and `paying` stays (empty) so the
  // action is not measured again; a cost asked about later in the action is a new question.
  const next: GameState = { ...state, paying: {} }
  return updatePlayer(next, playerId, payCost(next.players[playerId], Math.max(0, cost - paying.prepaid.amount), prefer))
}

/**
 * Pay a cost whose own step has already asked what else pays for it (a card that raises the Credit
 * step itself to hear the answer, Jabba the Hutt): resources only, and never measured.
 */
export function payAsked(state: GameState, playerId: PlayerId, cost: number): GameState {
  return cost <= 0 ? state : updatePlayer(state, playerId, payCost(state.players[playerId], cost))
}

/** `state` with the transient payment record removed, as an absent field rather than an undefined one. */
export function withoutPaying(state: GameState): GameState {
  if (!('paying' in state)) return state
  const next = { ...state }
  delete next.paying
  return next
}

/** Actions that never pay a cost, so are never measured. */
const NEVER_PAYS: readonly Action['type'][] = ['pass', 'takeInitiative', 'concede', 'offerConcession', 'acceptConcession', 'declineConcession', 'resourceCard', 'skipResource', 'mulligan', 'keepHand', 'setupResource']

/** The unit that cannot pay for `action`: the one whose own action it is. */
const ownUnit = (action: Action): string | undefined => (action.type === 'useAbility' ? action.instanceId : undefined)

/**
 * The paying step `action` needs before it runs, or `undefined` when it needs none: nobody holds
 * anything but resources to pay with, the action pays nothing, or the player it asks to pay has
 * nothing else to pay with. `run` is the dispatcher, used here for the dry run only.
 */
export function payingStepFor(state: GameState, action: Action, run: (s: GameState, a: Action) => GameState): PayWith | undefined {
  if (state.paying || NEVER_PAYS.includes(action.type)) return undefined
  const except = ownUnit(action)
  if (payingMeans(state, 'player', except) === 0 && payingMeans(state, 'opponent', except) === 0) return undefined
  let asked: Paying['asked']
  try {
    asked = run({ ...state, paying: { measure: true } }, action).paying?.asked
  } catch {
    // An action that cannot be taken throws the same way when it is run for real, which is where it is reported.
    return undefined
  }
  if (!asked) return undefined
  const credits = Math.min(asked.cost, usableCreditTokens(state, asked.player))
  const units = unitCostPayers(state, asked.player).filter(id => id !== except)
  if (credits === 0 && units.length === 0) return undefined
  const parent = 'choiceId' in action && action.choiceId ? findChoice(state, action.choiceId) : undefined
  // A card played from hand keeps the id its paying step has always had, so a game recorded with
  // that step in it (a filed report, a bench record) still replays move for move.
  const fromHand = action.type === 'playUnit' || action.type === 'playEvent' || action.type === 'playUpgrade' || action.type === 'playBaseUpgrade'
    ? state.players[asked.player].hand[action.handIndex]
    : undefined
  return {
    kind: 'payWith', id: fromHand !== undefined ? `exploit-${fromHand}` : 'payWith', controller: asked.player, cost: asked.cost, credits: 0, units: [], resume: action,
    ...(except !== undefined ? { except } : {}),
    ...(parent?.source ? { source: parent.source } : {}),
  }
}

/** The units a `payWith` step could still exhaust. */
export function payWithUnits(state: GameState, choice: PayWith): string[] {
  return unitCostPayers(state, choice.controller).filter(id => id !== choice.except && !choice.units.includes(id))
}

/** How much of its cost a `payWith` step has covered so far. */
export const payWithPicked = (choice: PayWith): number => choice.credits + choice.units.length

/** Whether a `payWith` step may take another Credit token: one is left, and the cost is not yet covered. */
export function payWithCredit(state: GameState, choice: PayWith): boolean {
  return payWithPicked(choice) < choice.cost && choice.credits < usableCreditTokens(state, choice.controller)
}

/** Whether a `payWith` step could finish now: ready resources cover what its picks leave. */
export function payWithAffordable(state: GameState, choice: PayWith): boolean {
  return choice.cost - payWithPicked(choice) <= readyResourceCount(state.players[choice.controller])
}

/**
 * One more pick for a `payWith` step: a Credit token, or the unit named. The step finishes by itself
 * once the cost is covered or nothing is left to pick, and is offered again otherwise.
 */
export function pickPayWith(state: GameState, choice: PayWith, unitId: string | undefined, run: (s: GameState, a: Action) => GameState): GameState {
  const next: PayWith = unitId === undefined
    ? (payWithCredit(state, choice) ? { ...choice, credits: choice.credits + 1 } : choice)
    : (payWithPicked(choice) < choice.cost && payWithUnits(state, choice).includes(unitId) ? { ...choice, units: choice.units.concat(unitId) } : choice)
  const covered = payWithPicked(next) >= next.cost
  const exhausted = !payWithCredit(state, next) && payWithUnits(state, next).length === 0
  if (next !== choice && (covered || exhausted) && payWithAffordable(state, next)) return finishPayWith(state, next, run)
  return { ...state, pendingChoices: (state.pendingChoices ?? []).map(c => (c.id === choice.id ? next : c)) }
}

/**
 * Finish a `payWith` step: defeat the tokens picked, exhaust the units picked, and run the action it
 * stood in front of with that much prepaid. The tokens and units go now and not as they are picked,
 * so the step can be backed out of with nothing spent.
 */
export function finishPayWith(state: GameState, choice: PayWith, run: (s: GameState, a: Action) => GameState): GameState {
  if (!payWithAffordable(state, choice)) return state
  let next = removeChoice(state, choice.id)
  next = defeatCreditTokens(next, choice.controller, choice.credits)
  for (const id of choice.units) next = exhaustUnit(next, id)
  return run({ ...next, paying: { prepaid: { player: choice.controller, amount: payWithPicked(choice) } } }, choice.resume)
}
