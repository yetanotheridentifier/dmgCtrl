import type { Action, AttackTarget } from './actions'
import type { GameState, PlayerId, UnitState } from './types'
import type { PendingChoice, UpgradeRef } from './types'
import { opponentOf, updatePlayer, activeChoice, popChoice, findChoice, removeChoice, hasPendingChoices, pushChoice } from './types'
import { addLastingEffect, clearLastingEffects, clearNextUnitGrants, resetPhaseEvents, recordUnitEntered, recordBaseAttacked, recordCardPlayed, markAbilityUsed, nextUnitGrantMatches } from './types'
import { addResourceFromHand, payCost, readyAllResources } from './resources'
import { effectiveCost, enemyAttackTargets, affordableHandUnits, validUpgradeTargets } from './legalMoves'
import { runTrigger, runUnitTrigger, runLeaderTrigger, getCardDefinition, actionAbilityKey, leaderActions, type TriggerPoint, type EffectContext } from './abilities'
import { applyUnitDamage, dealDamageToUnit, defeatUnit, sweepStateBasedDefeats, preventionOffer } from './combat'
import { exhaustUnit, findUnit, giveToken, fireUpgradeAttached, dealDamageToBase, baseDamageAfterPrevention, defeatUpgradeAt, healUnit, healBase, resourceTopOfDeck, drawCards, discardFromHand, createTokenUnit, createTokenUnits, returnUpgradeFromDiscardToHand, returnUnitToHand, grantNextUnit, readyUnit, searchCount, bottomTopCards, returnUpgradeToHand } from './effects'
import { seededShuffle, nextSeed } from './rng'
import { effectivePower, effectiveHp, friendlyAdvantageInert } from './stats'
import { hasKeyword, unitHasKeyword, unitKeywordValue, unitNegatesOverwhelm, unitDealsDamageFirst, unitSpillsExcessToUnit, unitHasTrait } from './keywords'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, hasToken } from './tokenUpgrades'
import { TOKEN_MANDALORIAN } from './tokenUnits'

/**
 * Action resolver — pure `(state, action) => state`.
 *
 * Legality lives in the legal-move generator; the resolver applies actions and
 * throws on engine-invariant violations (wrong phase, unknown ids, game over)
 * rather than re-validating game rules.
 */
/**
 * Apply an action, then settle state-based defeats — an effect that LOWERS a unit's HP
 * (Morgan Elsbeth's −2/−2) defeats it without dealing damage, so every action ends with a sweep.
 */
export function resolve(state: GameState, action: Action): GameState {
  const next = resolveAction(state, action)
  // Advance the randomness stream once per action, whether or not this action consumed any.
  // Keeping the step here — rather than wherever a consumer happens to draw — is what makes a
  // move list replay to an identical state: the seed depends only on the sequence of actions.
  const stepped = { ...next, rngSeed: nextSeed(next.rngSeed) }
  return stepped.winner !== null ? stepped : checkWin(sweepStateBasedDefeats(stepped))
}

function resolveAction(state: GameState, action: Action): GameState {
  if (state.winner !== null) {
    throw new Error('Cannot resolve actions: the game is over')
  }

  switch (action.type) {
    case 'playUnit':
      return requirePhase(state, 'action', () => {
        const played = playUnit(state, action.handIndex)
        if (played.winner !== null) return played
        // An on-play trigger (Ambush) keeps the turn with the active player to
        // resolve it before passing. If the trigger raised an OPPONENT-controlled
        // choice (Ninth Sister: "an opponent discards…"), hand control to them first.
        if (activeChoice(played)) return resetPasses(handOffOpponentChoice(played, played.activePlayer))
        return advanceTurn(resetPasses(played))
      })
    case 'playEvent':
      return requirePhase(state, 'action', () => {
        const played = playEvent(state, action.handIndex)
        if (played.winner !== null) return played
        // Like a unit's on-play trigger: a raised choice keeps the turn, and an opponent-controlled
        // one hands over first.
        if (activeChoice(played)) return resetPasses(handOffOpponentChoice(played, played.activePlayer))
        return advanceTurn(resetPasses(played))
      })
    case 'playUpgrade':
      return requirePhase(state, 'action', () => {
        const played = playUpgrade(state, action.handIndex, action.targetInstanceId)
        // A raised choice (Camtono's look-at, the unique-rule defeat) keeps the turn.
        if (played.winner === null && activeChoice(played)) return resetPasses(played)
        return played.winner !== null ? played : advanceTurn(resetPasses(played))
      })
    case 'deployLeader':
      return requirePhase(state, 'action', () => {
        // Deploying a Support leader opens a support attack — hold the turn to resolve it.
        const deployed = deployLeader(state)
        return activeChoice(deployed) ? resetPasses(deployed) : advanceTurn(resetPasses(deployed))
      })
    case 'useAbility':
      return requirePhase(state, 'action', () => useAbility(state, action.instanceId, action.cardId, action.index))
    case 'useLeaderAbility':
      return requirePhase(state, 'action', () => useLeaderAbility(state, action.index, action.targetInstanceId))
    case 'attack':
      return requirePhase(state, 'action', () => {
        // An attack resolves a pending choice, if one is active. Both Support
        // ("gains this unit's other abilities") and Improvised Identity's mayAttack lend a source
        // card's full abilities (keywords + triggered) to the chosen attacker for this attack.
        const choice = activeChoice(state)
        const grantCardId = choice?.kind === 'support'
          ? state.players[state.activePlayer].units.find(u => u.instanceId === choice.unitId)?.cardId
          : choice?.kind === 'mayAttack' || choice?.kind === 'mayAttackAnyUnit' ? choice.grantCardId : undefined
        let before = grantCardId ? grantAbilityCard(state, action.attackerId, grantCardId) : state
        // Thrawn front: the chosen attacker gains Restore N for this attack.
        if (choice?.kind === 'mayAttackAnyUnit' && choice.restore > 0) {
          before = updatePlayer(before, before.activePlayer, {
            units: before.players[before.activePlayer].units.map(u =>
              u.instanceId === action.attackerId ? { ...u, grantedKeywords: [{ name: 'Restore', value: choice.restore }] } : u,
            ),
          })
        }
        // An Ambush attack is the one resolving the entering unit's ambush choice (Heroic Purrgil).
        const viaAmbush = choice?.kind === 'ambush' && choice.unitId === action.attackerId
        let attacked = attack(before, action.attackerId, action.target, viaAmbush)
        // Consume the ambush/support choice this attack resolved. Support-granted
        // keywords are cleared inside completeAttack (after they're used), so they
        // survive a mid-combat On Defense suspension.
        if (choice) attacked = popChoice(attacked)
        if (attacked.winner !== null) return attacked
        // A choice the attack raised keeps the turn to resolve it first. A defender's own trigger
        // (whenDefeated) is controlled by the defender, so hand control to them; remember the
        // attacker (`pendingResumeActive`) so the turn advances once every post-combat trigger drains.
        if (hasPendingChoices(attacked)) {
          const handed = handOffOpponentChoice(attacked, attacked.activePlayer)
          return handed.pendingResumeActive !== undefined ? handed : { ...handed, pendingResumeActive: attacked.activePlayer }
        }
        return advanceTurn(resetPasses(attacked))
      })
    case 'takeInitiative':
      return requirePhase(state, 'action', () => takeInitiative(state))
    case 'pass':
      return requirePhase(state, 'action', () => pass(state))
    // Choices are not action-phase-only: `whenReadies` raises them at round start and
    // `whenRegroupStarts` during regroup (Alphabet Squadron U-Wing). Gating them on the
    // action phase would deadlock those — there'd be no legal move.
    case 'skipTrigger':
      return resolveSkip(state, action.choiceId)
    case 'acceptChoice':
      return resolveAccept(state, action.choiceId, action.targetInstanceId, action.deckIndex, action.optionIndex, action.baseTarget, action.handIndex, action.cardName)
    case 'resourceCard':
      return requirePhase(state, 'regroup', () => regroupChoice(state, action.handIndex))
    case 'skipResource':
      return requirePhase(state, 'regroup', () => regroupChoice(state, null))
    case 'mulligan':
      return requirePhase(state, 'setup', () => setupDecision(state, true))
    case 'keepHand':
      return requirePhase(state, 'setup', () => setupDecision(state, false))
    case 'setupResource':
      return requirePhase(state, 'setup', () => setupResourceChoice(state, action.handIndex))
  }
}

function requirePhase(state: GameState, phase: GameState['phase'], fn: () => GameState): GameState {
  if (state.phase !== phase) {
    throw new Error(`Action requires the ${phase} phase (current: ${state.phase})`)
  }
  return fn()
}

// ---------------------------------------------------------------------------
// Shared state helpers
// ---------------------------------------------------------------------------

function resetPasses(state: GameState): GameState {
  return state.consecutivePasses === 0 ? state : { ...state, consecutivePasses: 0 }
}

/**
 * Hand the turn to the other player. If they hard-passed by taking the
 * initiative, their turn resolves as an automatic pass (CR 1.15.5b) and the
 * turn bounces back — possibly ending the phase when it completes the
 * consecutive-pass pair.
 */
function advanceTurn(state: GameState): GameState {
  const next = opponentOf(state.activePlayer)
  if (state.initiativeTakenBy === next) {
    const passes = state.consecutivePasses + 1
    if (passes >= 2) return enterRegroup(state)
    return { ...state, consecutivePasses: passes } // active player unchanged
  }
  return { ...state, activePlayer: next }
}

// ---------------------------------------------------------------------------
// Setup phase (CR 5.2.1e–f): mulligan decisions, initiative holder first,
// then both players take 2 starting resources and round 1 begins.
// ---------------------------------------------------------------------------


function setupDecision(state: GameState, takeMulligan: boolean): GameState {
  if (state.setupStage !== 'mulligan') {
    throw new Error('Mulligan decisions are only legal in the mulligan stage of setup')
  }
  const playerId = state.activePlayer
  let next = state

  if (takeMulligan) {
    // Shuffle the entire hand back into the deck and draw a new 6 (CR 5.2.1e).
    const p = state.players[playerId]
    const reshuffled = seededShuffle([...p.hand, ...p.deck], state.rngSeed)
    next = updatePlayer(state, playerId, {
      hand: reshuffled.slice(0, p.hand.length),
      deck: reshuffled.slice(p.hand.length),
    })
    next = { ...next, rngSeed: nextSeed(state.rngSeed) }
  }

  // Initiative holder decides first; after the other player's decision the
  // resource stage begins, back with the initiative holder (CR 5.2.1f).
  if (playerId === next.initiative) {
    return { ...next, activePlayer: opponentOf(playerId) }
  }
  return { ...next, setupStage: 'resource', activePlayer: next.initiative }
}

const SETUP_RESOURCES = 2

/**
 * Resource one chosen hand card, facedown and ready (CR 5.2.1f). Each player
 * picks one card at a time until they hold two starting resources; once both
 * players are done, round 1's action phase begins with the initiative holder.
 */
function setupResourceChoice(state: GameState, handIndex: number): GameState {
  if (state.setupStage !== 'resource') {
    throw new Error('setupResource is only legal in the resource stage of setup')
  }
  const playerId = state.activePlayer
  const p = state.players[playerId]
  if (handIndex < 0 || handIndex >= p.hand.length) {
    throw new Error(`setupResource: invalid hand index ${handIndex}`)
  }

  const next = updatePlayer(state, playerId, {
    hand: p.hand.filter((_, i) => i !== handIndex),
    resources: [...p.resources, { cardId: p.hand[handIndex], exhausted: false }],
  })

  const mine = next.players[playerId].resources.length
  if (mine < SETUP_RESOURCES) {
    return next // same player picks again
  }
  if (playerId === next.initiative) {
    return { ...next, activePlayer: opponentOf(playerId) }
  }
  return { ...next, phase: 'action', activePlayer: next.initiative }
}

// ---------------------------------------------------------------------------
// Action phase
// ---------------------------------------------------------------------------

/**
 * Bring a unit `cardId` into play under `owner`. Shared by playing a unit from
 * hand and free-play effects (e.g. Camtono). Handles Shielded/Hidden on entry, opens
 * the Ambush/Support pending choice, and fires "When Played". The caller is
 * responsible for spending cost / removing the card from its source zone, and for the
 * win check afterwards.
 */
function enterUnit(state: GameState, owner: PlayerId, cardId: string, ready?: boolean): GameState {
  const card = state.cards[cardId]
  // Keywords the played unit gains on entry: its card's, plus any "next unit you play this phase"
  // grant (Sabine → Shielded) — so a granted Ambush/Shielded/Hidden fires just like a printed one.
  // "Your next unit …" grants matching this card — their keywords/enters-ready apply here
  // (the cost delta was already folded into `effectiveCost` at play time).
  const grants = (state.players[owner].nextUnitGrants ?? []).filter(g => nextUnitGrantMatches(card, g))
  const grantKeywords = grants.flatMap(g => g.keywords ?? [])
  // Every "enters play ready" source, in one place: a caller override (`ready`), a Neel-style grant,
  // or the card's own condition (Elzar Mann). Both the construction below AND the revert-to-
  // exhausted branch further down must honour all of them.
  const grantEntersReady = grants.some(g => g.entersReady) || (getCardDefinition(cardId)?.entersReady?.(state, owner) ?? false)
  const entersWith = (name: string): boolean => hasKeyword(state, cardId, name) || grantKeywords.some(k => k.name === name)
  // Ambush: the unit may immediately attack an enemy unit, so it enters ready.
  const ambush = entersWith('Ambush')
  const newUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId,
    arena: card?.arena ?? 'ground',
    damage: 0,
    // Units normally enter exhausted (CR 1.5.4b); Ambush — or an ability (Fennec / Neel) — enters ready.
    exhausted: ready === true || grantEntersReady ? false : !ambush,
    isLeader: false,
    // Shielded: the unit enters play with a shield token.
    upgrades: entersWith('Shielded') ? [{ cardId: TOKEN_SHIELD, owner }] : [],
    // Hidden: the unit enters play hidden — unattackable until the next phase.
    ...(entersWith('Hidden') ? { hidden: true } : {}),
  }

  let next = updatePlayer(state, owner, { units: [...state.players[owner].units, newUnit] })
  next = { ...next, instanceCounter: state.instanceCounter + 1 }
  next = recordUnitEntered(next, owner, newUnit.instanceId) // "entered play this phase"
  // Consume the matching grants: give the unit their keywords for this phase (a lasting effect, so an
  // ongoing keyword like Sentinel counts too), and drop the consumed grants — a non-matching unit
  // leaves them in place for a later matching unit.
  if (grants.length > 0) {
    if (grantKeywords.length > 0) next = addLastingEffect(next, { targetInstanceId: newUnit.instanceId, keywords: grantKeywords })
    const remaining = (next.players[owner].nextUnitGrants ?? []).filter(g => !nextUnitGrantMatches(card, g))
    next = updatePlayer(next, owner, { nextUnitGrants: remaining.length > 0 ? remaining : undefined })
  }

  // The unit is in play now, so read Ambush/Support from its LIVE keywords — an aura can strip them
  // (Domesticated Loth-Cat → "enemy units lose Ambush and Support"). Ambush: open the pending
  // attack only if there's an enemy to hit; otherwise the unit just enters exhausted, as normal.
  const inPlay = (): UnitState => next.players[owner].units.find(u => u.instanceId === newUnit.instanceId)!
  const exhaust = () => { next = updatePlayer(next, owner, { units: next.players[owner].units.map(u => (u.instanceId === newUnit.instanceId ? { ...u, exhausted: true } : u)) }) }
  if (unitHasKeyword(next, inPlay(), 'Ambush')) {
    if (enemyAttackTargets(next, inPlay()).targets.length > 0) {
      next = pushChoice(next, { kind: 'ambush', id: newUnit.instanceId, controller: owner, unitId: newUnit.instanceId })
    } else if (!inPlay().exhausted) {
      exhaust() // no target → settle into a normal exhausted entry
    }
  } else {
    // No (or aura-stripped) Ambush: it was constructed ready only if the card printed Ambush, so revert
    // to the normal exhausted entry — unless an ability entered it ready (Fennec `ready`, or a Neel-style
    // enters-ready grant).
    if (ready !== true && !grantEntersReady && !inPlay().exhausted) exhaust()
    if (unitHasKeyword(next, inPlay(), 'Support')) next = openSupportChoice(next, owner, newUnit.instanceId)
  }

  // A unit entering with upgrades (a Shielded token) reacts to them attaching (Sabine Wren).
  if (inPlay().upgrades.length > 0) next = fireUpgradeAttached(next, newUnit.instanceId)

  // "When Played" abilities fire after the card enters play (CR 6.2.0f).
  next = runTrigger(next, 'whenPlayed', { owner, cardId, sourceInstanceId: newUnit.instanceId })
  // "When you play or create a unit" reacts on the controller's other cards.
  next = fireEntersPlay(next, owner, newUnit.instanceId)
  return uniqueUnitCheck(next, owner) // two units with the same unique title → defeat one
}

/** Fire "When you play or create a unit" on the owner's undeployed leader and its
 *  other units, targeting the newly-entered unit. (Token *creation* firing is a follow-up.) */
function fireEntersPlay(state: GameState, owner: PlayerId, newUnitId: string): GameState {
  let next = runLeaderTrigger(state, 'whenPlayOrCreateUnit', owner, { targetInstanceId: newUnitId })
  for (const id of state.players[owner].units.map(u => u.instanceId)) {
    if (id === newUnitId) continue
    const reactor = next.players[owner].units.find(u => u.instanceId === id)
    if (reactor) next = runUnitTrigger(next, 'whenPlayOrCreateUnit', reactor, owner, { targetInstanceId: newUnitId })
  }
  return next
}

/** Enoch: grant "next unit costs 1 less per 2 damage dealt to your base". */
function grantEnochDiscount(state: GameState, controller: PlayerId, dealt: number): GameState {
  const delta = Math.floor(dealt / 2)
  return delta > 0 ? grantNextUnit(state, controller, { costDelta: -delta }) : state
}

/** Space units among `revealed` whose cost fits `budget` (Admiral Ackbar). */
function ackbarEligible(state: GameState, revealed: string[], budget: number): number[] {
  return revealed.flatMap((cardId, i) => {
    const c = state.cards[cardId]
    return c?.type === 'unit' && c.arena === 'space' && (c.cost ?? 0) <= budget ? [i] : []
  })
}

/**
 * Admiral Ackbar's search: reveal the top 10, and if any space unit fits the cost-5 budget,
 * hold those cards out of the deck in a `searchPlayFree` choice; otherwise put the searched cards on
 * the bottom (nothing to play). The printed "shuffle after search" is approximated by bottoming the
 * leftovers in the order revealed — deterministic, and the order is hidden information either way.
 */
function startAckbarSearch(state: GameState, owner: PlayerId, choiceId: string): GameState {
  const p = state.players[owner]
  const revealed = p.deck.slice(0, 10)
  const rest = p.deck.slice(10)
  const eligibleIndices = ackbarEligible(state, revealed, 5)
  if (eligibleIndices.length === 0) return updatePlayer(state, owner, { deck: [...rest, ...revealed] })
  // Pull the searched window out of the deck; leftover cards return to the bottom when the choice ends.
  const pulled = updatePlayer(state, owner, { deck: rest })
  return pushChoice(pulled, { kind: 'searchPlayFree', id: choiceId, controller: owner, revealed, eligibleIndices, budget: 5 })
}

function playUnit(state: GameState, handIndex: number): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'unit') {
    throw new Error(`playUnit: hand index ${handIndex} is not a playable unit`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  let next = updatePlayer(state, playerId, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
  next = recordCardPlayed(next, playerId, card.id) // after the cost, so "first X each phase" sees this one as the first
  // whenPlayed effects can defeat a base, so the win check runs afterwards.
  return checkWin(enterUnit(next, playerId, card.id))
}

/**
 * Play an event: pay its cost, put the card in the discard, then resolve its effect (registered as
 * the card's `whenPlayed`). The card reaches the discard BEFORE resolving, so an effect that reads
 * or replays from the discard sees it there rather than in limbo.
 *
 * An event never enters play, so there's no unit to hang its pending choices off. It gets a
 * synthetic `sourceInstanceId` instead — unique per resolution (via `instanceCounter`) so two
 * copies played in one turn can't collide, and deliberately matching no unit, so any effect that
 * looks up its source correctly finds nothing.
 */
function playEvent(state: GameState, handIndex: number): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'event') {
    throw new Error(`playEvent: hand index ${handIndex} is not a playable event`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  let next = updatePlayer(state, playerId, {
    ...paid,
    hand: paid.hand.filter((_, i) => i !== handIndex),
    discard: [...p.discard, card.id],
  })
  // After the cost, so Peli Motto's "first non-unit card each phase" counts this one as the first.
  next = recordCardPlayed(next, playerId, card.id)
  const sourceInstanceId = `ev${next.instanceCounter}`
  next = { ...next, instanceCounter: next.instanceCounter + 1 }
  next = runTrigger(next, 'whenPlayed', { owner: playerId, cardId: card.id, sourceInstanceId })
  return checkWin(next)
}

/**
 * Open the Support pending choice: another ready unit may attack, gaining the Support
 * source's abilities for that attack (see the `support` case in the attack dispatcher). No choice
 * if there's no other ready unit. Shared by playing a Support unit and deploying a Support leader.
 */
function openSupportChoice(state: GameState, owner: PlayerId, sourceInstanceId: string): GameState {
  const others = state.players[owner].units.filter(u => u.instanceId !== sourceInstanceId && !u.exhausted)
  return others.length > 0
    ? pushChoice(state, { kind: 'support', id: sourceInstanceId, controller: owner, unitId: sourceInstanceId })
    : state
}

/** Strip transient per-attack grants (Support keywords, and Improvised Identity's
 *  granted abilities) from every unit once the attack that used them is done. */
function clearGrantedKeywords(state: GameState): GameState {
  let next = state
  for (const id of ['player', 'opponent'] as PlayerId[]) {
    const units = next.players[id].units
    if (units.some(u => u.grantedKeywords || u.grantedAbilityCardIds)) {
      next = updatePlayer(next, id, {
        units: units.map(u => (u.grantedKeywords || u.grantedAbilityCardIds ? { ...u, grantedKeywords: undefined, grantedAbilityCardIds: undefined } : u)),
      })
    }
  }
  return next
}

/** Grant a unit the full abilities (keywords + triggered) of `cardId` for one attack
 *  (Improvised Identity). Cleared by `clearGrantedKeywords` after the attack. */
function grantAbilityCard(state: GameState, attackerId: string, cardId: string): GameState {
  const playerId = state.activePlayer
  return updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u => (u.instanceId === attackerId ? { ...u, grantedAbilityCardIds: [cardId] } : u)),
  })
}

/**
 * Resume once a choice resolves. While others remain, hand to the right
 * decider — the active player finishes their own simultaneous choices first (they
 * order them), then control passes to the other side. When the queue drains,
 * round-start `whenReadies` choices resume the action phase with the initiative
 * holder; mid-turn choices pass the turn as normal.
 */
function resumeAfterChoice(state: GameState, resolved: PendingChoice): GameState {
  if (hasPendingChoices(state)) {
    const activeHasMore = state.pendingChoices!.some(c => c.controller === state.activePlayer)
    return activeHasMore ? state : { ...state, activePlayer: opponentOf(state.activePlayer) }
  }
  // A combat suspended for an On Defense choice resumes once the queue drains.
  if (state.pendingAttack) return resumePendingAttack(state)
  // Regroup choices are resolved before anyone resources, and resourcing starts with the
  // initiative holder — `advanceTurn` below is action-phase logic and would hand the turn to the
  // wrong side here (or worse, re-enter regroup).
  if (state.phase === 'regroup') return { ...state, activePlayer: state.initiative }
  // A "when you take the initiative" choice: complete the deferred turn transition.
  if (state.pendingInitiativeEndsPhase !== undefined) {
    const cleared = { ...state, pendingInitiativeEndsPhase: undefined }
    return state.pendingInitiativeEndsPhase ? enterRegroup(cleared) : advanceTurn(resetPasses(cleared))
  }
  if (resolved.kind === 'payOrExhaust' && resolved.resumeAtInitiative) {
    return { ...state, activePlayer: state.initiative }
  }
  // An opponent-interjected choice (Sabine) drained: restore the original actor, then advance
  // the turn as their action normally would (so it becomes the opponent's turn).
  if (state.pendingResumeActive !== undefined) {
    return advanceTurn(resetPasses({ ...state, activePlayer: state.pendingResumeActive, pendingResumeActive: undefined }))
  }
  return advanceTurn(resetPasses(state))
}

/**
 * The "if you do …" tail of a `mayDamage`, run only when the damage actually landed.
 * Split out because a prevention offer defers the damage into its own choice, which runs this on
 * the declined branch — prevented damage was never dealt, so no tail fires.
 */
function mayDamageFollowUps(state: GameState, choice: PendingChoice & { kind: 'mayDamage' }, targetInstanceId: string): GameState {
  let next = state
  // "If it's defeated this way, …" — Imposing Scout Walker rewards its own unit.
  if (choice.rewardIfDefeated && !findUnit(next, targetInstanceId)) {
    const reward = choice.rewardIfDefeated
    if ('instanceId' in reward) {
      for (let i = 0; i < reward.count; i++) next = giveToken(next, reward.instanceId, TOKEN_ADVANTAGE)
    } else {
      // Justifier: give Advantage to a chosen unit.
      const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
      if (targets.length > 0) next = pushChoice(next, { kind: 'mayGiveTokens', id: choice.id, controller: choice.controller, token: TOKEN_ADVANTAGE, count: reward.chooseAdvantage, targets, optional: false })
    }
  }
  // 8D8: "if you do, search the top N of your deck for a unit, reveal it, and draw it."
  if (choice.thenSearchDraw) {
    const owner = choice.controller
    const source = findUnit(next, choice.unitId)
    const depth = source ? searchCount(next, source.unit, choice.thenSearchDraw) : choice.thenSearchDraw
    const revealed = next.players[owner].deck.slice(0, depth)
    const eligibleIndices = revealed.flatMap((cardId, i) => (next.cards[cardId]?.type === 'unit' ? [i] : []))
    next = eligibleIndices.length === 0
      ? bottomTopCards(next, owner, revealed.length) // no unit revealed → they all go to the bottom
      : pushChoice(next, { kind: 'searchDraw', id: `${choice.id}-search`, controller: owner, revealed, eligibleIndices })
  }
  return next
}

/** Resume a combat suspended by an On Attack / On Defense choice: restore the
 *  attacker as active, run the remaining stages from where it paused, then pass the turn
 *  (unless a later stage suspended again or won the game). */
function resumePendingAttack(state: GameState): GameState {
  const pa = state.pendingAttack!
  const next = runAttackStages(
    { ...state, pendingAttack: undefined, activePlayer: pa.activePlayer },
    pa.attackerId,
    pa.target,
    pa.stage,
    pa.viaAmbush,
    { preventAsked: pa.preventAsked, prevented: pa.prevented },
  )
  return next.winner !== null || hasPendingChoices(next) ? next : advanceTurn(resetPasses(next))
}

/** Decline a pending choice. Ambush and pay-or-exhaust leave the unit
 *  exhausted; Support and may-play do nothing. `choiceId` picks one of several. */
function resolveSkip(state: GameState, choiceId?: string): GameState {
  const choice = choiceId ? findChoice(state, choiceId) : activeChoice(state)
  if (!choice) throw new Error('skipTrigger: no pending choice')
  let next = removeChoice(state, choice.id)
  if (choice.kind === 'ambush' || choice.kind === 'payOrExhaust') {
    next = updatePlayer(next, choice.controller, {
      units: next.players[choice.controller].units.map(u => (u.instanceId === choice.unitId ? { ...u, exhausted: true } : u)),
    })
  }
  // Admiral Ackbar: stopping the search returns the still-held revealed cards to the deck bottom.
  if (choice.kind === 'searchPlayFree') {
    next = updatePlayer(next, choice.controller, { deck: [...next.players[choice.controller].deck, ...choice.revealed] })
  }
  // Enoch: stopping grants the discount for the damage dealt to your base so far.
  if (choice.kind === 'dealOwnBaseForDiscount') {
    next = grantEnochDiscount(next, choice.controller, choice.dealt)
  }
  // Elzar Mann: stopping early still triggers the follow-up, sized to what was distributed.
  if (choice.kind === 'distributeTokens') {
    next = finishDistribution(next, choice, choice.total - choice.remaining)
  }
  // The Mandalorian: declining to prevent lets the damage through. Combat damage is applied
  // by the resumed attack; ability damage was deferred into this choice, so it lands here — along
  // with the "if you do …" tail of whatever was dealing it.
  if (choice.kind === 'mayPreventDamage' && !choice.combat) {
    const found = findUnit(next, choice.targetId)
    if (found) {
      next = applyUnitDamage(next, found.owner, new Map([[choice.targetId, choice.amount]]), false, {}, choice.source)
      next = checkWin(next)
      if (next.winner !== null) return next
      if (choice.followUp?.kind === 'mayDamage') next = mayDamageFollowUps(next, choice.followUp, choice.targetId)
    }
  }
  return resumeAfterChoice(next, choice)
}

/** Accept a pending "may…" choice — pay the cost / play the card / search. */
function resolveAccept(state: GameState, choiceId: string, targetInstanceId?: string, deckIndex?: number, optionIndex?: number, baseTarget?: PlayerId, handIndex?: number, cardName?: string): GameState {
  const choice = findChoice(state, choiceId)
  if (!choice) throw new Error(`acceptChoice: no choice ${choiceId}`)
  let next = removeChoice(state, choice.id)
  switch (choice.kind) {
    case 'payOrExhaust':
      // Pay the cost; the unit simply stays ready (no exhaust).
      next = updatePlayer(next, choice.controller, payCost(next.players[choice.controller], choice.cost))
      break
    case 'mayPlayTopFree': {
      next = playTopCardFree(next, choice.controller, choice.cardId, targetInstanceId)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'mayDamageExhaust':
      // DDC Defender: deal 1 to a chosen unit in the arena and exhaust it.
      if (targetInstanceId) {
        next = dealDamageToUnit(next, targetInstanceId, 1)
        next = exhaustUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    case 'mayDamage':
      // Optional targeted damage, e.g. Cad Bane's On Attack.
      if (targetInstanceId) {
        const pending = next.pendingChoices?.length ?? 0
        next = dealDamageToUnit(next, targetInstanceId, choice.amount, choice.source, choice)
        // A prevention offer means the damage hasn't been dealt yet — it lands only if the
        // offer is declined, and the "if you do …" tail runs there, not here.
        if ((next.pendingChoices?.length ?? 0) > pending) break
        next = checkWin(next)
        if (next.winner !== null) return next
        next = mayDamageFollowUps(next, choice, targetInstanceId)
      }
      break
    case 'chooseDiscardFate': {
      // Trask Walker: 0 = bottom the card and heal; 1 = return it to hand.
      const owner = choice.controller
      const p = next.players[owner]
      const idx = p.discard.indexOf(choice.cardId)
      if (idx === -1) break
      const discard = p.discard.filter((_, i) => i !== idx)
      if ((optionIndex ?? 0) === 0) {
        next = updatePlayer(next, owner, { discard, deck: [...p.deck, choice.cardId] })
        next = healBase(next, owner, choice.heal)
      } else {
        next = updatePlayer(next, owner, { discard, hand: [...p.hand, choice.cardId] })
      }
      break
    }
    case 'selectPair': {
      // First accept records the friendly pick; the second applies `mode` to both.
      if (!targetInstanceId) break
      if (choice.chosenFriendly === undefined) {
        next = pushChoice(next, { ...choice, chosenFriendly: targetInstanceId })
        break
      }
      const pair = [choice.chosenFriendly, targetInstanceId]
      if (choice.mode === 'exhaust') {
        for (const id of pair) next = exhaustUnit(next, id)
      } else {
        for (const id of pair) next = defeatUnit(next, id)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      // Diplomatic Pageantry: "if you do, give 2 Advantage tokens to a friendly unit".
      if (choice.thenAdvantage) {
        const targets = next.players[choice.controller].units.map(u => u.instanceId)
        if (targets.length > 0) {
          next = pushChoice(next, { kind: 'mayGiveTokens', id: `${choice.id}-adv`, controller: choice.controller, token: TOKEN_ADVANTAGE, count: choice.thenAdvantage, targets, optional: false })
        }
      }
      break
    }
    case 'selectUpgradeToReturn': {
      // Jabba the Hutt: the upgrade goes to ITS OWNER's hand — only your own comes back to you,
      // and only then may you replay it for free.
      const pick = choice.candidates[optionIndex ?? 0]
      if (!pick) break
      const upgradeOwner = findUnit(next, pick.unitId)?.unit.upgrades[pick.upgradeIndex]?.owner
      next = returnUpgradeToHand(next, pick.unitId, pick.upgradeIndex)
      if (choice.thenShield) {
        // Full of Surprises: "Give a Shield token to a unit" — a separate effect, any unit.
        const targets = inPlayUnits(next).map(u => u.instanceId)
        if (targets.length > 0) {
          next = pushChoice(next, { kind: 'mayGiveTokens', id: `${choice.id}-shield`, controller: choice.controller, token: TOKEN_SHIELD, count: 1, targets, optional: false })
        }
        break
      }
      if (upgradeOwner === choice.controller) {
        const targets = inPlayUnits(next).map(u => u.instanceId)
        if (targets.length > 0) {
          next = pushChoice(next, { kind: 'mayPlayUpgradeFree', id: `${choice.id}-free`, controller: choice.controller, cardId: pick.cardId, targets })
        }
      }
      break
    }
    case 'mayPlayUpgradeFree': {
      // Jabba the Hutt: attach the just-returned upgrade to a chosen unit, paying nothing.
      if (!targetInstanceId) break
      const owner = choice.controller
      const p = next.players[owner]
      const handIdx = p.hand.indexOf(choice.cardId)
      if (handIdx === -1) break
      next = updatePlayer(next, owner, { hand: p.hand.filter((_, i) => i !== handIdx) })
      const host = findUnit(next, targetInstanceId)
      if (!host) break
      next = updatePlayer(next, host.owner, {
        units: next.players[host.owner].units.map(u =>
          u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId: choice.cardId, owner }] } : u,
        ),
      })
      next = fireUpgradeAttached(next, targetInstanceId, true) // playing it free still counts as playing it
      break
    }
    case 'mayPayExhaustArena': {
      // Jod Na Nawood: pay the cost, then exhaust every unit in the chosen arena, both sides.
      const arena = (optionIndex ?? 0) === 0 ? 'ground' : 'space'
      next = updatePlayer(next, choice.controller, payCost(next.players[choice.controller], choice.cost))
      for (const u of inPlayUnits(next)) {
        if (u.arena === arena) next = exhaustUnit(next, u.instanceId)
      }
      break
    }
    case 'revealUnitFromHand': {
      // Queen Soruna: the revealed card's cost selects the units that can be damaged.
      // Revealing is public information only — the card stays in hand.
      if (handIndex === undefined) break
      const revealed = next.players[choice.controller].hand[handIndex]
      const cost = next.cards[revealed]?.cost
      if (cost === undefined) break
      const unitTargets = inPlayUnits(next).filter(u => next.cards[u.cardId]?.cost === cost).map(u => u.instanceId)
      if (unitTargets.length > 0) {
        next = pushChoice(next, { kind: 'selectDamageTarget', id: `${choice.id}-dmg`, controller: choice.controller, amount: choice.amount, unitTargets, baseTargets: [] })
      }
      break
    }
    case 'damageAnyBases': {
      // Rancor Keeper: 1 damage to a chosen base, then re-offer the bases not yet hit.
      if (baseTarget) {
        next = dealDamageToBase(next, baseTarget, choice.amount, choice.source)
        next = checkWin(next)
        if (next.winner !== null) return next
        const remaining = choice.remaining.filter(b => b !== baseTarget)
        if (remaining.length > 0) next = pushChoice(next, { ...choice, remaining })
      }
      break
    }
    case 'mayPreventDamage': {
      // The Mandalorian: pay the preventer's own cost (defeat a Shield), then cancel the damage.
      const preventer = findUnit(next, choice.preventerId)
      if (preventer) {
        for (const cardId of [preventer.unit.cardId, ...preventer.unit.upgrades.map(u => u.cardId)]) {
          const pay = getCardDefinition(cardId)?.payPreventionCost
          if (pay) { next = pay(next, preventer.unit); break }
        }
      }
      // Combat damage is applied later, by the resumed attack — record the cancellation for it.
      // Ability damage was deferred into this choice, so cancelling means simply never applying it.
      if (choice.combat && next.pendingAttack) {
        next = { ...next, pendingAttack: { ...next.pendingAttack, prevented: [...(next.pendingAttack.prevented ?? []), choice.targetId] } }
      }
      break
    }
    case 'mayCapture': {
      // Bothan-5: move the card out of the discard and under the capturing unit.
      const owner = choice.controller
      const p = next.players[owner]
      const idx = p.discard.indexOf(choice.cardId)
      if (idx === -1) break
      next = updatePlayer(next, owner, {
        discard: p.discard.filter((_, i) => i !== idx),
        units: p.units.map(u => (u.instanceId === choice.unitId ? { ...u, captured: [...(u.captured ?? []), choice.cardId] } : u)),
      })
      if (choice.markUsed) next = markAbilityUsed(next, owner, choice.markUsed.instanceId, choice.markUsed.key)
      break
    }
    case 'maySelfDamageShield': {
      // Cobb Vanth: pay 2 damage to himself to shield the unit that just entered play.
      next = dealDamageToUnit(next, choice.selfId, choice.amount)
      next = giveToken(next, choice.targetId, TOKEN_SHIELD)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'mayCreateToken': {
      // Gar Saxon: create the token unit(s) and record the once-each-round use.
      next = createTokenUnits(next, choice.controller, choice.token, choice.count)
      if (choice.markUsed) {
        const { instanceId, key } = choice.markUsed
        next = updatePlayer(next, choice.controller, {
          units: next.players[choice.controller].units.map(u =>
            u.instanceId === instanceId ? { ...u, usedAbilities: [...(u.usedAbilities ?? []), key] } : u,
          ),
        })
      }
      break
    }
    case 'mayAdvantageEach':
      // Emperor Palpatine: give the chosen unit an Advantage token per other friendly unit.
      if (targetInstanceId) {
        const others = next.players[choice.controller].units.filter(u => u.instanceId !== targetInstanceId).length
        for (let i = 0; i < others; i++) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    case 'mayExhaustLeaderForAdvantage': {
      // Greef Karga front: exhaust the leader to give the just-played unit an Advantage token.
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = giveToken(next, choice.unitId, TOKEN_ADVANTAGE)
      }
      break
    }
    case 'mayLastingBuff':
      // Optional "this phase" buff, e.g. Baylan's On Attack: grant the chosen unit the buff.
      if (targetInstanceId) {
        // The Student Guides the Master: +1 per friendly unit with strictly less power than the pick.
        let power = choice.power
        if (choice.powerPerWeakerFriendly) {
          const picked = findUnit(next, targetInstanceId)
          const mine = picked ? effectivePower(next, picked.unit) : 0
          power = next.players[choice.controller].units.filter(u => u.instanceId !== targetInstanceId && effectivePower(next, u) < mine).length
        }
        next = addLastingEffect(next, { targetInstanceId, power, hp: choice.hp, keywords: choice.keywords })
        // T-6 Shuttle: "you may attack with that unit" — only meaningful for a ready unit
        // we control (the buff itself may target any unit).
        const buffed = findUnit(next, targetInstanceId)
        if (choice.thenMayAttack && buffed && buffed.owner === choice.controller && !buffed.unit.exhausted) {
          next = pushChoice(next, { kind: 'mayAttack', id: `${choice.id}-attack`, controller: choice.controller, unitId: targetInstanceId })
        }
      }
      break
    case 'mayGiveAdvantage':
      // Ezra deployed: give the chosen unit an Advantage token, no cost.
      if (targetInstanceId) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      break
    case 'mayGiveTokens':
      // Give `count` of a token to the chosen unit — Attendant Navigator, Anakin, Trexler.
      if (targetInstanceId) for (let i = 0; i < choice.count; i++) next = giveToken(next, targetInstanceId, choice.token)
      break
    case 'mayExhaustLeaderGiveAdvantage': {
      // Ezra front: exhaust the (undeployed) leader to give the chosen unit an Advantage token.
      const p = next.players[choice.controller]
      if (targetInstanceId && !p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    }
    case 'mayExhaustLeaderExhaustUnit': {
      // Shin Hati front: exhaust the (undeployed) leader to exhaust the chosen unit.
      const p = next.players[choice.controller]
      if (targetInstanceId && !p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = exhaustUnit(next, targetInstanceId)
      }
      break
    }
    case 'mayExhaustUnit':
      // Shin Hati deployed: exhaust the chosen unit (no leader cost); mark the once-per-round use.
      if (targetInstanceId) {
        next = exhaustUnit(next, targetInstanceId)
        if (choice.markUsed) next = markAbilityUsed(next, choice.controller, choice.markUsed.instanceId, choice.markUsed.key)
      }
      break
    case 'chooseOne': {
      // Choose-one/modal: apply the picked option's effect (Sloane's arena buff).
      const opt = choice.options[optionIndex ?? 0]
      if (opt?.kind === 'arenaLastingBuff') {
        for (const owner of ['player', 'opponent'] as PlayerId[]) {
          for (const u of next.players[owner].units) {
            if (u.arena === opt.arena) next = addLastingEffect(next, { targetInstanceId: u.instanceId, power: opt.power, hp: opt.hp, keywords: opt.keywords })
          }
        }
      }
      break
    }
    case 'selectUpgradeToDefeat': {
      // Vane: defeat the chosen upgrade (card or token). Vane then chooses where 2 damage
      // lands (`then`); Clan Vizsla Soldier just defeats it, with no follow-up.
      const pick = choice.candidates[optionIndex ?? 0]
      if (pick) {
        next = defeatUpgradeAt(next, pick.unitId, pick.upgradeIndex)
        // Pegasus Tri-Wing: "if you do, ready this unit".
        if (choice.thenReadyUnit) next = readyUnit(next, choice.thenReadyUnit)
        // Exploit Advantage: "if you do, draw 2 cards".
        if (choice.thenDraw) next = drawCards(next, choice.controller, choice.thenDraw)
        // Reforge: dig for a replacement upgrade that can attach to the same unit.
        const search = choice.thenSearchUpgrade
        const host = search ? findUnit(next, pick.unitId) : undefined
        if (search && host) {
          const owner = choice.controller
          const revealed = next.players[owner].deck.slice(0, search.depth)
          const eligibleIndices = revealed.flatMap((cardId, i) => {
            const c = next.cards[cardId]
            if (c?.type !== 'upgrade') return []
            const restriction = getCardDefinition(cardId)?.attachRestriction
            return !restriction || restriction(next, host.unit) ? [i] : []
          })
          next = eligibleIndices.length === 0
            ? bottomTopCards(next, owner, revealed.length)
            : updatePlayer(
                pushChoice(next, { kind: 'searchPlayUpgrade', id: `${choice.id}-reforge`, controller: owner, unitId: pick.unitId, revealed, eligibleIndices, discount: search.discount }),
                owner,
                { deck: next.players[owner].deck.slice(revealed.length) }, // held out until the choice resolves
              )
        }
        const spec = choice.then
        if (spec) {
          const inPlay = new Set([...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId))
          next = pushChoice(next, {
            kind: 'selectDamageTarget',
            id: `${choice.id}-dmg`,
            controller: choice.controller,
            amount: spec.amount,
            unitTargets: spec.unitTargets.filter(id => inPlay.has(id)), // a target may have left play
            baseTargets: spec.baseTargets,
          })
        }
      }
      break
    }
    case 'selectDamageTarget': {
      // Deal the chosen amount to the picked base or unit.
      if (baseTarget) next = dealDamageToBase(next, baseTarget, choice.amount, choice.source)
      else if (targetInstanceId) next = dealDamageToUnit(next, targetInstanceId, choice.amount, choice.source)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'mayExhaustLeaderHealUnit': {
      // Luke front: exhaust the (undeployed) leader to heal the attacker.
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = healUnit(next, choice.unitId, choice.amount)
      }
      break
    }
    case 'selectHealTarget':
      // Luke deployed: heal the chosen unit or your base.
      if (baseTarget) next = healBase(next, baseTarget, choice.amount)
      else if (targetInstanceId) {
        next = healUnit(next, targetInstanceId, choice.amount)
        // "…and give a Shield token to it" (Perserverance) — the same unit, one effect.
        if (choice.thenShield) next = giveToken(next, targetInstanceId, TOKEN_SHIELD)
      }
      break
    case 'selectUnitToExhaust':
      // Fennec's additional cost: exhaust the chosen unit, then the play-from-hand step.
      if (targetInstanceId) {
        next = exhaustUnit(next, targetInstanceId)
        const candidates = affordableHandUnits(next, choice.controller, 0, choice.then.costDelta)
        if (candidates.length > 0) {
          next = pushChoice(next, { kind: 'playUnitFromHand', id: `${choice.id}-play`, controller: choice.controller, candidates, costDelta: choice.then.costDelta, entersReady: choice.then.entersReady })
        }
      }
      break
    case 'mayPayToDraw': {
      // Mandalorian: optionally pay the cost, then draw. `cost` 0 = a free "may draw".
      next = updatePlayer(next, choice.controller, payCost(next.players[choice.controller], choice.cost))
      const handBefore = next.players[choice.controller].hand.length
      next = drawCards(next, choice.controller, choice.draw)
      // Mos Espa Watermonger: "if you do, discard a card" — only when a card was actually drawn.
      const drew = next.players[choice.controller].hand.length - handBefore
      if (choice.thenDiscard && drew > 0) {
        next = pushChoice(next, { kind: 'selectDiscard', id: choice.id, controller: choice.controller, count: Math.min(choice.thenDiscard, next.players[choice.controller].hand.length) })
      }
      break
    }
    case 'selectDiscard': {
      // Discard the chosen hand card, then re-offer until `count` are discarded.
      if (handIndex !== undefined) {
        const discardedId = next.players[choice.controller].hand[handIndex]
        next = discardFromHand(next, choice.controller, handIndex)
        const remaining = choice.count - 1
        if (remaining > 0 && next.players[choice.controller].hand.length > 0) {
          next = pushChoice(next, { kind: 'selectDiscard', id: choice.id, controller: choice.controller, count: remaining, optional: choice.optional, then: choice.then })
        } else if (choice.then && discardedId !== undefined) {
          if ('distributeDamageTo' in choice.then) {
            // Ninth Sister: "deal damage equal to its cost divided among any units".
            const amount = next.cards[discardedId]?.cost ?? 0
            const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
            if (amount > 0 && targets.length > 0) {
              next = pushChoice(next, { kind: 'distributeDamage', id: choice.id, controller: choice.then.distributeDamageTo, remaining: amount, total: amount, targets })
            }
          } else if ('buffUnit' in choice.then) {
            // Razor Crest: "if you do, this unit gets +power/+hp for this attack".
            next = addLastingEffect(next, { targetInstanceId: choice.then.buffUnit, power: choice.then.power, hp: choice.then.hp })
          } else if ('exhaustUnit' in choice.then) {
            // Mayor's Majordomo: the discard was a COST — now exhaust a unit.
            const targets = inPlayUnits(next).map(u => u.instanceId)
            if (targets.length > 0) next = pushChoice(next, { kind: 'mayExhaustUnit', id: `${choice.id}-exh`, controller: choice.controller, targets })
          } else {
            // Qi'ra: "if you do, deal N damage to a unit". Reckless Sacrifice narrows the targets to
            // units costing more than the card just discarded.
            const floor = choice.then.costlierThanDiscard ? next.cards[discardedId]?.cost ?? 0 : undefined
            const targets = inPlayUnits(next)
              .filter(u => floor === undefined || (next.cards[u.cardId]?.cost ?? 0) > floor)
              .map(u => u.instanceId)
            if (targets.length > 0) next = pushChoice(next, { kind: 'mayDamage', id: choice.id, controller: choice.controller, unitId: choice.id, targets, amount: choice.then.dealDamage, optional: false })
          }
        }
      }
      break
    }
    case 'maySelfDamageHealBase': {
      // Leia Organa: deal `selfDamage` to this unit, then heal `healBase` from your base.
      next = dealDamageToUnit(next, choice.unitId, choice.selfDamage)
      next = checkWin(next)
      if (next.winner !== null) return next
      next = healBase(next, choice.controller, choice.healBase)
      break
    }
    case 'mayExhaustLeaderBuffSelf': {
      // Mando's N-1: exhaust your leader, then give this unit a "this phase" buff.
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = addLastingEffect(next, { targetInstanceId: choice.unitId, power: choice.power, hp: choice.hp })
      }
      break
    }
    case 'distributeDamage': {
      // Ninth Sister: spend one point of the pool onto the chosen unit, then re-offer the
      // rest against the still-living units. skipTrigger (Done) ends it early — the whole thing is optional.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        next = dealDamageToUnit(next, targetInstanceId, 1)
        next = checkWin(next)
        if (next.winner !== null) return next
        const remaining = choice.remaining - 1
        const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
        if (remaining > 0 && targets.length > 0) {
          next = pushChoice(next, { kind: 'distributeDamage', id: choice.id, controller: choice.controller, remaining, total: choice.total, targets })
        }
      }
      break
    }
    case 'distributeTokens': {
      // Helgait: give one token to the chosen friendly unit, then re-offer the rest.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        next = giveToken(next, targetInstanceId, choice.token)
        const remaining = choice.remaining - 1
        const targets = next.players[choice.controller].units.map(u => u.instanceId).filter(id => id !== choice.exclude)
        if (remaining > 0 && targets.length > 0) {
          next = pushChoice(next, { ...choice, remaining, targets })
        } else {
          next = finishDistribution(next, choice, choice.total - remaining)
        }
      }
      break
    }
    case 'dealOwnBaseForDiscount': {
      // Enoch: deal 1 to your own base; at `max` (or on Done, see resolveSkip) grant the discount.
      next = dealDamageToBase(next, choice.controller, 1)
      next = checkWin(next)
      if (next.winner !== null) return next
      const dealt = choice.dealt + 1
      if (dealt < choice.max) next = pushChoice(next, { kind: 'dealOwnBaseForDiscount', id: choice.id, controller: choice.controller, dealt, max: choice.max })
      else next = grantEnochDiscount(next, choice.controller, dealt)
      break
    }
    case 'selectUnitToReady':
      // Galvanized Leap: ready the chosen unit.
      if (targetInstanceId) next = readyUnit(next, targetInstanceId)
      break
    case 'selectUnitToSteal': {
      // Rehabilitation: debuff the unit for the phase, then move it across exactly as it stands —
      // same damage, upgrades and ready state — recording who still owns the card.
      const found = targetInstanceId ? findUnit(next, targetInstanceId) : undefined
      if (!found || found.owner === choice.controller) break
      if (choice.power !== undefined || choice.hp !== undefined) {
        next = addLastingEffect(next, { targetInstanceId: found.unit.instanceId, power: choice.power, hp: choice.hp })
      }
      next = takeControlOfUnit(next, found.owner, choice.controller, found.unit.instanceId)
      break
    }
    case 'mayPlayUnitFromDiscard': {
      // Bring the chosen unit out of the discard and into play, paying nothing. It enters as a
      // normal play would, so its own When Played fires.
      const owner = choice.controller
      const cardId = choice.candidates[optionIndex ?? 0]
      const idx = cardId === undefined ? -1 : next.players[owner].discard.indexOf(cardId)
      if (idx === -1) break
      next = updatePlayer(next, owner, { discard: next.players[owner].discard.filter((_, i) => i !== idx) })
      next = enterUnit(next, owner, cardId)
      next = checkWin(next)
      if (next.winner !== null) return next
      // Re-offer while the pool allows it — Dathomiri Magicks plays up to three.
      const remaining = choice.remaining - 1
      if (remaining > 0) {
        const candidates = discardUnitsMatching(next, owner, choice.maxCost, choice.excludeTrait)
        if (candidates.length > 0) {
          next = pushChoice(next, { ...choice, candidates, remaining })
        }
      }
      break
    }
    case 'chooseMode': {
      // "Choose one:" — the card decided which modes were available; run the one picked.
      next = applyChosenMode(next, choice.controller, choice.modes[optionIndex ?? 0])
      break
    }
    case 'searchPlayUpgrade': {
      // Reforge: attach the chosen revealed upgrade, paying its cost less the discount; whatever
      // wasn't taken goes to the bottom of the deck.
      const owner = choice.controller
      const idx = deckIndex
      const cardId = idx !== undefined ? choice.revealed[idx] : undefined
      const card = cardId ? next.cards[cardId] : undefined
      const host = findUnit(next, choice.unitId)
      if (card && cardId && host && idx !== undefined && choice.eligibleIndices.includes(idx)) {
        const cost = Math.max(0, effectiveCost(next, owner, card, host.unit) - choice.discount)
        next = updatePlayer(next, owner, payCost(next.players[owner], cost))
        next = updatePlayer(next, host.owner, {
          units: next.players[host.owner].units.map(u =>
            u.instanceId === choice.unitId ? { ...u, upgrades: [...u.upgrades, { cardId, owner }] } : u,
          ),
        })
        next = fireUpgradeAttached(next, choice.unitId, true)
        next = updatePlayer(next, owner, { deck: [...next.players[owner].deck, ...choice.revealed.filter((_, i) => i !== idx)] })
      } else {
        next = updatePlayer(next, owner, { deck: [...next.players[owner].deck, ...choice.revealed] })
      }
      break
    }
    case 'selectArenaToGrant': {
      // Treacherous Minefield: hand the carrier card's abilities to every unit in the chosen arena
      // for the phase. Applied to the units there NOW — one arriving later doesn't pick it up.
      const arena = (optionIndex ?? 0) === 0 ? 'ground' : 'space'
      for (const u of inPlayUnits(next).filter(x => x.arena === arena)) {
        next = addLastingEffect(next, { targetInstanceId: u.instanceId, abilityCardIds: [choice.grantCardId] })
      }
      break
    }
    case 'chooseNumber': {
      // Sense Through the Force: the named number rides along on the search that follows.
      const owner = choice.controller
      const guessedCost = optionIndex ?? 0
      const revealed = next.players[owner].deck.slice(0, 5)
      const eligibleIndices = revealed.map((_, i) => i) // "search for a card" — any card qualifies
      next = eligibleIndices.length === 0
        ? bottomTopCards(next, owner, revealed.length)
        : pushChoice(next, { kind: 'searchDraw', id: `${choice.id}-search`, controller: owner, revealed, eligibleIndices, guessedCost })
      break
    }
    case 'selectDistributeSource': {
      // Hold Them Off: the chosen unit's power becomes a pool spread among units in its own arena.
      const src = targetInstanceId ? findUnit(next, targetInstanceId) : undefined
      if (!src) break
      const total = effectivePower(next, src.unit)
      const targets = inPlayUnits(next).filter(u => u.arena === src.unit.arena).map(u => u.instanceId)
      if (total > 0 && targets.length > 0) {
        next = pushChoice(next, { kind: 'distributeDamage', id: `${choice.id}-dist`, controller: choice.controller, remaining: total, total, targets })
      }
      break
    }
    case 'selectUnitToReturn':
      // Far Far Away's second half: return the chosen unit to its owner's hand.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) next = returnUnitToHand(next, targetInstanceId)
      break
    case 'returnFriendlyUnit': {
      // Return the chosen unit to hand, then the card's follow-up: Purrgil Ultra deals its cost as
      // damage; Far Far Away bounces an enemy non-leader in turn.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        const found = findUnit(next, targetInstanceId)
        const cost = found ? next.cards[found.unit.cardId]?.cost ?? 0 : 0
        next = returnUnitToHand(next, targetInstanceId)
        if (choice.then === 'returnEnemyUnit') {
          const enemy = opponentOf(choice.controller)
          const targets = next.players[enemy].units.filter(u => !u.isLeader).map(u => u.instanceId)
          if (targets.length > 0) next = pushChoice(next, { kind: 'selectUnitToReturn', id: `${choice.id}-enemy`, controller: choice.controller, targets })
          break
        }
        const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
        if (cost > 0 && targets.length > 0) {
          next = pushChoice(next, { kind: 'mayDamage', id: choice.id, controller: choice.controller, unitId: choice.id, targets, amount: cost, optional: false })
        }
      }
      break
    }
    case 'peekTopDiscard': {
      // Reanimated Night Trooper: discard the top card of the chosen deck.
      if (baseTarget) {
        const p = next.players[baseTarget]
        if (p.deck.length > 0) next = updatePlayer(next, baseTarget, { deck: p.deck.slice(1), discard: [...p.discard, p.deck[0]] })
      }
      break
    }
    case 'lookAtHand': {
      // Remnant Lookouts: discard the chosen card from the target's hand; if `thenDraw`, they draw.
      if (choice.mayDiscard && handIndex !== undefined) {
        next = discardFromHand(next, choice.target, handIndex)
        if (choice.thenDraw) next = drawCards(next, choice.target, 1)
      }
      break
    }
    case 'selectFromDiscard': {
      // Moff Gideon: return the chosen discard-pile card to hand.
      const cardId = choice.candidates[optionIndex ?? 0]
      if (cardId === undefined) break
      // Trask Walker instead picks a fate for the card.
      if (choice.then === 'discardFate') {
        next = pushChoice(next, { kind: 'chooseDiscardFate', id: `${choice.id}-fate`, controller: choice.controller, cardId, heal: 3 })
        break
      }
      next = returnUpgradeFromDiscardToHand(next, choice.controller, cardId)
      break
    }
    case 'searchDraw': {
      // Clan Wren Loyalist: draw the chosen revealed card; put the other revealed cards on
      // the bottom of the deck (revealed order — the "random order" is immaterial hidden info here).
      if (deckIndex !== undefined && deckIndex < choice.revealed.length) {
        const owner = choice.controller
        const p = next.players[owner]
        const drawn = choice.revealed[deckIndex]
        const rest = p.deck.slice(choice.revealed.length)
        const others = choice.revealed.filter((_, i) => i !== deckIndex)
        next = updatePlayer(next, owner, { hand: [...p.hand, drawn], deck: [...rest, ...others] })
        // Sense Through the Force: a correct guess at the drawn card's cost pays out.
        if (choice.guessedCost !== undefined && next.cards[drawn]?.cost === choice.guessedCost) {
          const targets = next.players[owner].units.filter(u => unitHasTrait(next, u, 'Force')).map(u => u.instanceId)
          if (targets.length > 0) {
            next = pushChoice(next, { kind: 'mayGiveTokens', id: `${choice.id}-sense`, controller: owner, token: TOKEN_ADVANTAGE, count: 3, targets })
          }
        }
      }
      break
    }
    case 'variableStrike': {
      // The Cyborg Mech: deal 5 to a damaged target, else 2 to an undamaged one.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        const found = findUnit(next, targetInstanceId)
        const amount = found && found.unit.damage > 0 ? choice.damagedAmount : choice.undamagedAmount
        next = dealDamageToUnit(next, targetInstanceId, amount)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    }
    case 'healForAdvantage': {
      // Barriss Offee: heal min(maxHeal, damage) from the unit and give it that many Advantage tokens.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        const found = findUnit(next, targetInstanceId)
        const healed = found ? Math.min(choice.maxHeal, found.unit.damage) : 0
        if (healed > 0) {
          next = healUnit(next, targetInstanceId, healed)
          for (let i = 0; i < healed; i++) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
        }
      }
      break
    }
    case 'mayDoubleTokens': {
      // Moff Jerjerrod: defeat him, then top the batch up by the same number again.
      next = defeatUnit(next, choice.unitId)
      for (let i = 0; i < choice.count; i++) next = createTokenUnit(next, choice.controller, choice.token)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'nameCard': {
      // Ryder Azadi: record the named card on this unit — the opponent can't play cards with
      // that name while it's in play (enforced in legalMoves). Naming is mandatory.
      if (cardName) {
        next = updatePlayer(next, choice.controller, {
          units: next.players[choice.controller].units.map(u => (u.instanceId === choice.unitId ? { ...u, namedCard: cardName } : u)),
        })
      }
      break
    }
    case 'mayDefeatSelfSearch': {
      // Admiral Ackbar: defeat this unit, then search the top 10 for space units to play free.
      next = defeatUnit(next, choice.unitId)
      next = checkWin(next)
      if (next.winner !== null) return next
      next = startAckbarSearch(next, choice.controller, choice.id)
      break
    }
    case 'searchPlayFree': {
      // Admiral Ackbar: play the chosen revealed space unit for free (it may trigger its own
      // When Played — that sub-choice resolves first, then we re-offer the rest of the budget).
      if (deckIndex !== undefined && choice.eligibleIndices.includes(deckIndex)) {
        const owner = choice.controller
        const cardId = choice.revealed[deckIndex]
        const cost = next.cards[cardId]?.cost ?? 0
        next = enterUnit(next, owner, cardId, choice.entersReady === true)
        next = checkWin(next)
        if (next.winner !== null) return next
        const revealed = choice.revealed.filter((_, i) => i !== deckIndex)
        const budget = choice.budget - cost
        const eligibleIndices = ackbarEligible(next, revealed, budget)
        // Eye of Sion plays exactly one; Ackbar keeps offering until the budget runs out.
        if (!choice.playOne && budget > 0 && eligibleIndices.length > 0) {
          next = pushChoice(next, { kind: 'searchPlayFree', id: choice.id, controller: owner, revealed, eligibleIndices, budget })
        } else {
          next = updatePlayer(next, owner, { deck: [...next.players[owner].deck, ...revealed] }) // bottom the leftovers
        }
      }
      break
    }
    case 'selectUniqueToDefeat': {
      // Unique rule: defeat the chosen duplicate upgrade, then re-check (3+ copies → repeat).
      const pick = choice.candidates[optionIndex ?? 0]
      if (pick) {
        next = defeatUpgradeAt(next, pick.unitId, pick.upgradeIndex)
        next = uniqueUpgradeCheck(next, choice.controller)
      }
      break
    }
    case 'opponentGivesAdvantage':
      // Sabine front: the opponent gives `count` Advantage tokens to their chosen unit.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        for (let i = 0; i < choice.count; i++) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    case 'multiPick':
      // Repeatable board-target pick: apply the per-pick effect, then re-offer the remaining
      // eligible targets — Inspiring Veteran (up to N Advantage), Pre Vizsla (defeat within an HP budget).
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        if (choice.spec.mode === 'giveAdvantage' || choice.spec.mode === 'dealEach') {
          const targets = choice.targets.filter(id => id !== targetInstanceId)
          const remaining = choice.spec.remaining - 1
          if (choice.spec.mode === 'giveAdvantage') {
            next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
            if (remaining > 0 && targets.length > 0) next = pushChoice(next, { kind: 'multiPick', id: choice.id, controller: choice.controller, targets, spec: { mode: 'giveAdvantage', remaining } })
          } else {
            const amount = choice.spec.amount
            next = dealDamageToUnit(next, targetInstanceId, amount)
            next = checkWin(next)
            if (next.winner !== null) return next
            if (remaining > 0 && targets.length > 0) next = pushChoice(next, { kind: 'multiPick', id: choice.id, controller: choice.controller, targets, spec: { mode: 'dealEach', amount, remaining } })
          }
        } else if (choice.spec.mode === 'exhaust') {
          // Keep Them Talking: exhaust up to N of the eligible units.
          next = exhaustUnit(next, targetInstanceId)
          const targets = choice.targets.filter(id => id !== targetInstanceId)
          const remaining = choice.spec.remaining - 1
          if (remaining > 0 && targets.length > 0) next = pushChoice(next, { kind: 'multiPick', id: choice.id, controller: choice.controller, targets, spec: { mode: 'exhaust', remaining } })
        } else {
          const found = findUnit(next, targetInstanceId)
          const remHp = found ? Math.max(0, effectiveHp(next, found.unit) - found.unit.damage) : 0
          next = createTokenUnit(defeatUnit(next, targetInstanceId), choice.controller, choice.spec.token)
          next = checkWin(next)
          if (next.winner !== null) return next
          const budget = choice.spec.budget - remHp
          // Re-offer from the ORIGINAL candidate set (minus the one just defeated), filtered by the
          // remaining budget — so the tokens created this way don't become targets themselves.
          const targets = choice.targets.filter(id => {
            if (id === targetInstanceId) return false
            const u = findUnit(next, id)?.unit
            return u !== undefined && effectiveHp(next, u) - u.damage <= budget
          })
          if (budget > 0 && targets.length > 0) next = pushChoice(next, { kind: 'multiPick', id: choice.id, controller: choice.controller, targets, spec: { mode: 'defeatForToken', budget, token: choice.spec.token } })
        }
      }
      break
    case 'selectUniqueUnitToDefeat': {
      // Unique rule for units: defeat the chosen duplicate unit, then re-check (3+ → repeat).
      if (targetInstanceId && choice.candidates.includes(targetInstanceId)) {
        next = defeatUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
        next = uniqueUnitCheck(next, choice.controller)
      }
      break
    }
    case 'selectUnitToDefeat':
      // Defeat the chosen unit; the card decided which ones were eligible.
      if (targetInstanceId) {
        const defeatedCardId = findUnit(next, targetInstanceId)?.unit.cardId
        next = defeatUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
        // "If you do, resource the top card of your deck" (Long Live the Empire).
        if (choice.thenResource) next = resourceTopOfDeck(next, choice.controller)
        // "Then, you may play that unit from your discard pile for free" (One Must Destroy to Create).
        if (choice.thenReplayFromDiscard && defeatedCardId !== undefined && next.players[choice.controller].discard.includes(defeatedCardId)) {
          next = pushChoice(next, { kind: 'mayPlayUnitFromDiscard', id: `${choice.id}-replay`, controller: choice.controller, candidates: [defeatedCardId], remaining: 1 })
        }
      }
      break
    case 'mayDeployLeader':
      // Grogu: deploy via the triggered epic action — not once-per-game, so it doesn't burn
      // the epic action (`epicUsed: false`), letting Grogu redeploy after being defeated + readying.
      next = deployLeader(next, false)
      break
    case 'selectResourceUpgrade': {
      // The Armorer: the chosen resource upgrade → pick where to attach it.
      const pick = choice.candidates[optionIndex ?? 0]
      if (pick) {
        const targets = validUpgradeTargets(next, choice.controller, pick.resourceIndex, pick.cardId, choice.then.payCost, choice.then.targetUnits)
        if (targets.length > 0) {
          next = pushChoice(next, { kind: 'attachResourceUpgrade', id: `${choice.id}-attach`, controller: choice.controller, resourceIndex: pick.resourceIndex, cardId: pick.cardId, targets, payCost: choice.then.payCost })
        }
      }
      break
    }
    case 'attachResourceUpgrade': {
      // Play the upgrade from resources onto the chosen unit, then resource the top of the deck.
      const owner = choice.controller
      const p = next.players[owner]
      const resource = p.resources[choice.resourceIndex]
      const card = next.cards[choice.cardId]
      const targetUnit = targetInstanceId ? [...next.players.player.units, ...next.players.opponent.units].find(u => u.instanceId === targetInstanceId) : undefined
      if (resource?.cardId === choice.cardId && card?.type === 'upgrade' && targetUnit) {
        let pl = { ...p, resources: p.resources.filter((_, i) => i !== choice.resourceIndex) }
        if (choice.payCost) pl = payCost(pl, effectiveCost(next, owner, card, targetUnit)) // front pays; back is free
        pl = { ...pl, units: pl.units.map(u => (u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId: choice.cardId, owner }] } : u)) }
        next = updatePlayer(next, owner, pl)
        next = resourceTopOfDeck(next, owner) // "If you do, resource the top card of your deck."
        next = runTrigger(next, 'whenPlayed', { owner, cardId: choice.cardId, sourceInstanceId: targetInstanceId })
        next = uniqueUpgradeCheck(next, owner) // unique rule
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    }
    case 'playUnitFromHand': {
      // Play the chosen hand unit, paying its cost + costDelta, entering ready if the ability says so.
      const p = next.players[choice.controller]
      const cardId = handIndex !== undefined ? p.hand[handIndex] : undefined
      const card = cardId ? next.cards[cardId] : undefined
      if (handIndex !== undefined && card?.type === 'unit') {
        const cost = Math.max(0, effectiveCost(next, choice.controller, card) + choice.costDelta)
        const paid = payCost(p, cost)
        next = updatePlayer(next, choice.controller, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
        next = enterUnit(next, choice.controller, cardId!, choice.entersReady)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    }
    case 'search':
      // Improvised Identity: discard the chosen revealed ground unit, then offer the
      // follow-up attack that grants its abilities.
      if (deckIndex !== undefined) {
        const owner = choice.controller
        const discarded = next.players[owner].deck[deckIndex]
        if (discarded !== undefined) {
          next = updatePlayer(next, owner, {
            deck: next.players[owner].deck.filter((_, i) => i !== deckIndex),
            discard: [...next.players[owner].discard, discarded],
          })
          next = pushChoice(next, { kind: 'mayAttack', id: choice.unitId, controller: owner, unitId: choice.unitId, grantCardId: discarded })
        }
      }
      break
    default:
      throw new Error(`acceptChoice: ${choice.kind} is not acceptable`)
  }
  return resumeAfterChoice(next, choice)
}

/**
 * Play the revealed top-of-deck card for free (Camtono). Unit → enters play;
 * upgrade → attaches to `targetInstanceId`; event → a temporary rule discards it with
 * no effect (until events are built). A no-op if the top card moved.
 */
function playTopCardFree(state: GameState, owner: PlayerId, cardId: string, targetInstanceId?: string): GameState {
  if (state.players[owner].deck[0] !== cardId) return state // top card changed; abort safely
  const type = state.cards[cardId]?.type
  let next = updatePlayer(state, owner, { deck: state.players[owner].deck.slice(1) }) // remove from deck

  if (type === 'unit') {
    return enterUnit(next, owner, cardId)
  }
  if (type === 'upgrade' && targetInstanceId) {
    const targetOwner = (['player', 'opponent'] as PlayerId[]).find(id =>
      next.players[id].units.some(u => u.instanceId === targetInstanceId),
    )
    if (!targetOwner) return next // target gone
    next = updatePlayer(next, targetOwner, {
      units: next.players[targetOwner].units.map(u =>
        u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId, owner }] } : u,
      ),
    })
    next = runTrigger(next, 'whenPlayed', { owner, cardId, sourceInstanceId: targetInstanceId })
    return uniqueUpgradeCheck(next, owner) // unique rule
  }
  // Event (or an upgrade with no target): temporary stub — discard with no effect.
  return updatePlayer(next, owner, { discard: [...next.players[owner].discard, cardId] })
}

/**
 * Unique rule (CR): a player can't control two upgrades with the same title. After an upgrade
 * attaches, if `owner` now controls ≥2 unique upgrades of one card id, raise a choice to defeat one
 * (their pick). Re-run after each defeat so 3+ copies resolve down to one. Titles are keyed by card
 * id (a deck's duplicates share it). (The unit-side unique rule is a follow-up.)
 */
function uniqueUpgradeCheck(state: GameState, owner: PlayerId): GameState {
  const instances: UpgradeRef[] = []
  for (const pid of ['player', 'opponent'] as PlayerId[]) {
    for (const u of state.players[pid].units) {
      u.upgrades.forEach((up, i) => {
        if (up.owner === owner && state.cards[up.cardId]?.unique) instances.push({ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId })
      })
    }
  }
  const dupCardId = instances.map(r => r.cardId).find((id, i, arr) => arr.indexOf(id) !== i)
  if (!dupCardId) return state
  const candidates = instances.filter(r => r.cardId === dupCardId)
  return pushChoice(state, { kind: 'selectUniqueToDefeat', id: `unique-${dupCardId}`, controller: owner, cardId: dupCardId, candidates })
}

/**
 * Unique rule for units (CR): a player can't control two units that share a unique title. After a
 * unit enters play, if `owner` now controls ≥2 units of one card id, raise a choice to defeat one
 * (their pick, off the board). Re-run after each defeat so 3+ copies resolve down to one. Keyed by
 * card id (a deck's duplicates share it), mirroring the upgrade rule.
 */
function uniqueUnitCheck(state: GameState, owner: PlayerId): GameState {
  const uniqueIds = state.players[owner].units.filter(u => state.cards[u.cardId]?.unique).map(u => u.cardId)
  const dupCardId = uniqueIds.find((id, i, arr) => arr.indexOf(id) !== i)
  if (!dupCardId) return state
  const candidates = state.players[owner].units.filter(u => u.cardId === dupCardId).map(u => u.instanceId)
  return pushChoice(state, { kind: 'selectUniqueUnitToDefeat', id: `unique-unit-${dupCardId}`, controller: owner, cardId: dupCardId, candidates })
}

/**
 * Play an upgrade from hand and attach it to a unit. Any unit in play is a
 * valid target by default; a card narrows that with its `attachRestriction`. Cost + aspect penalty
 * apply as for units; the upgrade's power/HP and keywords then modify the unit
 * (via the stats/keyword helpers).
 */
function playUpgrade(state: GameState, handIndex: number, targetInstanceId: string): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'upgrade') {
    throw new Error(`playUpgrade: hand index ${handIndex} is not a playable upgrade`)
  }

  const targetOwner = (['player', 'opponent'] as PlayerId[]).find(id =>
    state.players[id].units.some(u => u.instanceId === targetInstanceId),
  )
  if (!targetOwner) {
    throw new Error(`playUpgrade: no unit ${targetInstanceId} to attach to`)
  }
  const targetUnit = state.players[targetOwner].units.find(u => u.instanceId === targetInstanceId)

  const paid = payCost(p, effectiveCost(state, playerId, card, targetUnit))
  let next = updatePlayer(state, playerId, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
  next = updatePlayer(next, targetOwner, {
    units: next.players[targetOwner].units.map(u =>
      u.instanceId === targetInstanceId ? { ...u, upgrades: [...u.upgrades, { cardId: card.id, owner: playerId }] } : u,
    ),
  })

  next = recordCardPlayed(next, playerId, card.id) // after the cost ("the first upgrade you play each phase")

  // "When 1 or more upgrades attach to this unit" (Sabine Wren) — the host reacts. This is the
  // played-from-hand path, so it also satisfies "when you PLAY an upgrade on this unit" (Gar Saxon).
  next = fireUpgradeAttached(next, targetInstanceId, true)

  // "When Played" abilities fire after the upgrade attaches (CR 6.2.0f).
  next = runTrigger(next, 'whenPlayed', {
    owner: playerId,
    cardId: card.id,
    sourceInstanceId: targetInstanceId,
  })
  next = uniqueUpgradeCheck(next, playerId) // two upgrades with the same title → defeat one
  return checkWin(next)
}

/**
 * Use a unit's activated "Action:" ability. A once-per-round ability is marked
 * spent before its effect runs (so effects that raise a choice carry the mark), its
 * `cost` (C=N) is paid, then the turn passes — unless the ability raised a pending choice
 * (e.g. a search), which keeps the turn with the active player to resolve it.
 */
function useAbility(state: GameState, instanceId: string, cardId: string, index: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found) throw new Error(`useAbility: no unit ${instanceId}`)
  const ability = getCardDefinition(cardId)?.actionAbilities?.[index]
  if (!ability) throw new Error(`useAbility: no ability ${cardId}#${index}`)
  const owner = found.owner

  let next = state
  if (ability.cost) next = updatePlayer(next, owner, payCost(next.players[owner], ability.cost))
  if (ability.exhaustCost) next = exhaustUnit(next, instanceId) // pay the "[Exhaust]" cost
  if (ability.oncePerRound) {
    const key = actionAbilityKey(cardId, index)
    next = updatePlayer(next, owner, {
      units: next.players[owner].units.map(u =>
        u.instanceId === instanceId ? { ...u, usedAbilities: [...(u.usedAbilities ?? []), key] } : u,
      ),
    })
  }
  next = ability.effect(next, { owner, cardId, sourceInstanceId: instanceId })
  next = checkWin(next)
  if (next.winner !== null) return next
  return hasPendingChoices(next) ? next : advanceTurn(resetPasses(next))
}

/**
 * Use an undeployed leader's activated "Action:" ability: pay its cost, exhaust
 * the leader (so it's once per round until it readies at regroup), run the effect with
 * the chosen target, then pass the turn — unless the effect raised a pending choice.
 */
function useLeaderAbility(state: GameState, index: number, targetInstanceId?: string): GameState {
  const owner = state.activePlayer
  const p = state.players[owner]
  if (p.leader.deployed || p.leader.exhausted) throw new Error('useLeaderAbility: leader unavailable')
  const ability = leaderActions(p.leader.cardId)[index]
  if (!ability) throw new Error(`useLeaderAbility: no leader action ${index}`)

  const paid = ability.cost ? payCost(p, ability.cost) : p
  let next = updatePlayer(state, owner, { ...paid, leader: { ...p.leader, exhausted: true } })
  next = ability.effect(next, { owner, cardId: p.leader.cardId, targetInstanceId })
  next = checkWin(next)
  if (next.winner !== null) return next
  next = handOffOpponentChoice(next, owner)
  return hasPendingChoices(next) ? next : advanceTurn(resetPasses(next))
}

/**
 * If an ability raised a choice controlled by the OTHER player (Sabine → "an opponent gives …")
 * and the actor has none of their own left to resolve, hand control to that opponent and
 * remember the actor so `resumeAfterChoice` restores them and advances the turn once it drains.
 * Generic; a no-op when the actor has their own choice to resolve first, or none was raised.
 */
/**
 * Follow-up once a `distributeTokens` pool is spent or stopped (Elzar Mann): the opponent
 * searches twice the number distributed for an event and draws it. Nothing distributed → no search.
 * The opponent makes the choice, so control hands over and returns via `pendingResumeActive`.
 */
function finishDistribution(state: GameState, choice: PendingChoice & { kind: 'distributeTokens' }, distributed: number): GameState {
  if (choice.then !== 'opponentSearchEvent' || distributed <= 0) return state
  const opponent = opponentOf(choice.controller)
  const revealed = state.players[opponent].deck.slice(0, distributed * 2)
  const eligibleIndices = revealed.flatMap((cardId, i) => (state.cards[cardId]?.type === 'event' ? [i] : []))
  // No event among them → they all go to the bottom and nothing is drawn.
  if (eligibleIndices.length === 0) return bottomTopCards(state, opponent, revealed.length)
  const pushed = pushChoice(state, { kind: 'searchDraw', id: `${choice.id}-oppsearch`, controller: opponent, revealed, eligibleIndices })
  return handOffOpponentChoice(pushed, choice.controller)
}

function handOffOpponentChoice(state: GameState, actor: PlayerId): GameState {
  if (!hasPendingChoices(state) || state.pendingChoices!.some(c => c.controller === actor)) return state
  const other = state.pendingChoices![0].controller
  return other === actor ? state : { ...state, activePlayer: other, pendingResumeActive: actor }
}

/**
 * Deploy the active player's leader. The normal epic action sets `epicActionUsed` so it can't be
 * used again (and a defeated leader can't redeploy, CR 3.4.5). Grogu's *triggered* deploy
 * passes `epicUsed: false` — it's gated on "if this leader is ready", not once-per-game, so he can
 * redeploy after being defeated once he readies at regroup.
 */
function deployLeader(state: GameState, epicUsed = true): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  if (p.leader.deployed || (epicUsed && p.leader.epicActionUsed)) {
    throw new Error('deployLeader: leader cannot deploy')
  }

  // Deploying is an epic action: no resources are spent (CR 2.6.1); the leader
  // arrives in the ground arena, ready (CR 3.4.4).
  const leaderUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId: p.leader.cardId,
    arena: 'ground',
    damage: 0,
    exhausted: false,
    isLeader: true,
    upgrades: [],
  }

  let next = updatePlayer(state, playerId, {
    leader: { ...p.leader, deployed: true, epicActionUsed: epicUsed ? true : p.leader.epicActionUsed },
    units: [...p.units, leaderUnit],
  })
  next = { ...next, instanceCounter: state.instanceCounter + 1 }
  // A deployed leader enters ready (CR 3.4.4) and runs its on-enter keywords — including any GRANTED
  // at deploy (Moff Gideon gains keywords from an Imperial in your discard): a Shield token,
  // Hidden, and an Ambush or Support attack.
  return applyDeployKeywords(next, playerId, leaderUnit.instanceId)
}

/**
 * On-enter keyword effects for a just-DEPLOYED leader unit: Shielded → a Shield token,
 * Hidden → unattackable until the next phase, then Ambush (this unit may attack now) or Support
 * (another ready unit may attack). Reads the unit's LIVE keywords, so keywords granted at deploy
 * count (Moff Gideon from a discard Imperial). A leader always enters ready, so an Ambush with no
 * target simply stays ready. (Units played from hand run the equivalent inline in `enterUnit`.)
 */
function applyDeployKeywords(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const unitNow = (s: GameState) => s.players[owner].units.find(u => u.instanceId === instanceId)!
  let next = state
  if (unitHasKeyword(next, unitNow(next), 'Shielded') && !hasToken(unitNow(next).upgrades, TOKEN_SHIELD)) {
    next = updatePlayer(next, owner, {
      units: next.players[owner].units.map(u => (u.instanceId === instanceId ? { ...u, upgrades: [...u.upgrades, { cardId: TOKEN_SHIELD, owner }] } : u)),
    })
  }
  if (unitHasKeyword(next, unitNow(next), 'Hidden') && !unitNow(next).hidden) {
    next = updatePlayer(next, owner, {
      units: next.players[owner].units.map(u => (u.instanceId === instanceId ? { ...u, hidden: true } : u)),
    })
  }
  if (unitHasKeyword(next, unitNow(next), 'Ambush')) {
    if (enemyAttackTargets(next, unitNow(next)).targets.length > 0) {
      next = pushChoice(next, { kind: 'ambush', id: instanceId, controller: owner, unitId: instanceId })
    }
  } else if (unitHasKeyword(next, unitNow(next), 'Support')) {
    next = openSupportChoice(next, owner, instanceId)
  }
  return next
}

function takeInitiative(state: GameState): GameState {
  const playerId = state.activePlayer
  // Taking the initiative immediately after an opponent's pass ends the action phase (CR 1.15.5c).
  const endsPhase = state.consecutivePasses >= 1
  let taken: GameState = { ...state, initiative: playerId, initiativeTakenBy: playerId }
  // "When you take the initiative" (Mandalorian): fire before the turn transition. If it raises
  // a choice, hold with the taker and finish the transition once the choice drains (resumeAfterChoice).
  const before = taken.pendingChoices?.length ?? 0
  taken = runLeaderTrigger(taken, 'whenTakeInitiative', playerId)
  // The taker's units carry the trigger too (Grogu the unit).
  for (const u of taken.players[playerId].units) {
    const still = taken.players[playerId].units.find(x => x.instanceId === u.instanceId)
    if (still) taken = runUnitTrigger(taken, 'whenTakeInitiative', still, playerId)
  }
  if ((taken.pendingChoices?.length ?? 0) > before) {
    return { ...taken, pendingInitiativeEndsPhase: endsPhase }
  }
  return endsPhase ? enterRegroup(taken) : { ...taken, activePlayer: opponentOf(playerId) }
}

function pass(state: GameState): GameState {
  const passes = state.consecutivePasses + 1
  if (passes >= 2) return enterRegroup(state)
  return advanceTurn({ ...state, consecutivePasses: passes })
}

// ---------------------------------------------------------------------------
// Combat resolution
// ---------------------------------------------------------------------------

/**
 * Advantage gives +1/0 until the unit next completes an attack or defence, then
 * the token is removed. Called for the attacker and defender after
 * combat; a no-op if the unit has no Advantage token (or was defeated).
 */
function consumeAdvantage(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const p = state.players[owner]
  const unit = p.units.find(u => u.instanceId === instanceId)
  if (!unit || !hasToken(unit.upgrades, TOKEN_ADVANTAGE)) return state
  // "They aren't defeated after combat" (Eviscerator) — inert tokens stay put.
  if (friendlyAdvantageInert(state, owner)) return state
  // A unit's next attack/defence removes ALL its Advantage tokens (each gave +1/0), unless
  // another ability says otherwise.
  return updatePlayer(state, owner, {
    units: p.units.map(u =>
      u.instanceId === instanceId ? { ...u, upgrades: u.upgrades.filter(a => a.cardId !== TOKEN_ADVANTAGE) } : u,
    ),
  })
}

/** Fire "When Attack Ends" abilities on the attacker (card + upgrades), if it
 *  survived the combat. `ctx` carries what the attack did (target, whether
 *  it damaged the base) for abilities like Whistling Birds. */
function fireAttackEnd(state: GameState, owner: PlayerId, attackerId: string, ctx: Partial<EffectContext>, captured?: UnitState): GameState {
  const fullCtx = { ...ctx, attackerInstanceId: attackerId }
  // "When THIS unit's attack ends" — the attacker only (Camtono, Whistling Birds). Still
  // triggers if the attacker was defeated by combat damage (CR 7.6 / 1258) — fall back to
  // its last-known state (with its upgrades).
  const attacker = state.players[owner].units.find(u => u.instanceId === attackerId) ?? captured
  let next = attacker ? runUnitTrigger(state, 'onAttackEnd', attacker, owner, fullCtx) : state
  // "When a friendly unit's attack ends" — every unit the attacker's controller has (re-found
  // in case an earlier reactor changed the board), plus their undeployed leader.
  for (const id of next.players[owner].units.map(u => u.instanceId)) {
    const reactor = next.players[owner].units.find(u => u.instanceId === id)
    if (reactor) next = runUnitTrigger(next, 'whenFriendlyAttackEnds', reactor, owner, fullCtx)
  }
  next = runLeaderTrigger(next, 'whenFriendlyAttackEnds', owner, fullCtx)
  return next
}

/** Fire a trigger for every unit in play (both sides), re-finding each in case an
 *  earlier ability changed it. Used for board-wide events like regroup start. */
function fireForAllUnits(state: GameState, point: TriggerPoint): GameState {
  let next = state
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    for (const id of next.players[owner].units.map(u => u.instanceId)) {
      const unit = next.players[owner].units.find(u => u.instanceId === id)
      if (unit) next = runUnitTrigger(next, point, unit, owner)
    }
  }
  return next
}

/**
 * Begin an attack: exhaust the attacker and apply Restore, then either finish
 * inline or — if the defender has an "On Defense" ability that raises a choice —
 * suspend the combat before damage and hand control to the defender. Combat damage
 * itself is dealt by `completeAttack` (immediately, or on resume after the choice).
 */
function attack(state: GameState, attackerId: string, target: AttackTarget, viaAmbush = false): GameState {
  const playerId = state.activePlayer
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  if (!attacker) throw new Error(`attack: no friendly unit ${attackerId}`)
  if (attacker.exhausted) throw new Error(`attack: unit ${attackerId} is exhausted`)

  // Attacking exhausts the attacker (CR 1.5.4d).
  let next = updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u =>
      u.instanceId === attackerId ? { ...u, exhausted: true } : u,
    ),
  })

  // Restore N: heals the attacking player's base when the unit attacks (CR 7.5).
  const restore = unitKeywordValue(next, attacker, 'Restore')
  if (restore > 0) {
    const own = next.players[playerId]
    next = updatePlayer(next, playerId, {
      base: { ...own.base, damage: Math.max(0, own.base.damage - restore) },
    })
  }

  // "On Attack" abilities fire before combat damage; a raised choice suspends
  // the attack with the attacker keeping control, resuming at the On Defense stage.
  const before = next.pendingChoices?.length ?? 0
  const attackerNow = next.players[playerId].units.find(u => u.instanceId === attackerId)!
  next = runUnitTrigger(next, 'onAttack', attackerNow, playerId, { attackTarget: target })
  if ((next.pendingChoices?.length ?? 0) > before) {
    return { ...next, pendingAttack: { attackerId, target, activePlayer: playerId, stage: 'onDefense', viaAmbush } }
  }
  return runAttackStages(next, attackerId, target, 'onDefense', viaAmbush)
}

/**
 * Run the pre-combat stages from `stage` onward and then deal the damage.
 * The On Defense stage may suspend (handing control to the defender); resumption picks
 * up from the stored stage. `state.activePlayer` is the attacker's controller here.
 */
function runAttackStages(state: GameState, attackerId: string, target: AttackTarget, stage: 'onDefense' | 'damage', viaAmbush = false, prevent: PreventionProgress = {}): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)

  if (stage === 'onDefense' && target.kind === 'unit') {
    const defender = state.players[enemyId].units.find(u => u.instanceId === target.instanceId)
    if (defender) {
      const before = state.pendingChoices?.length ?? 0
      const afterDefense = runUnitTrigger(state, 'onDefense', defender, enemyId)
      if ((afterDefense.pendingChoices?.length ?? 0) > before) {
        // Hand control to the defender; resume at the damage stage.
        return { ...afterDefense, pendingAttack: { attackerId, target, activePlayer: playerId, stage: 'damage', viaAmbush, ...prevent }, activePlayer: enemyId }
      }
      return completeAttack(afterDefense, attackerId, target, viaAmbush, prevent)
    }
  }
  return completeAttack(state, attackerId, target, viaAmbush, prevent)
}

/**
 * How far the damage-prevention offers for one combat have got (The Mandalorian).
 * `preventAsked` are the units already offered a prevention this combat (so a declined offer isn't
 * re-raised on resume); `prevented` are those whose damage was actually cancelled.
 */
interface PreventionProgress {
  preventAsked?: string[]
  prevented?: string[]
}

/**
 * Deal the combat damage — calculated from the *current* (post-"On Defense")
 * state, per CR 6.3.4. The attacker or defender may have been defeated by an On
 * Defense ability, in which case the attack fizzles. Clears any transient
 * Support-granted keywords once the calculation that used them is done.
 */
function completeAttack(state: GameState, attackerId: string, target: AttackTarget, viaAmbush = false, prevent: PreventionProgress = {}): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  // The attacker may have been defeated before damage (e.g. an On Defense ping).
  if (!attacker) return clearGrantedKeywords(checkWin(state))

  // "While attacking a damaged unit …" (Marrok's Fiend Fighter) reads the defender's pre-combat damage.
  const targetUnit = target.kind === 'unit' ? state.players[enemyId].units.find(u => u.instanceId === target.instanceId) : undefined
  const attackerPower = effectivePower(state, attacker, { attacking: true, attackingBase: target.kind === 'base', defenderDamaged: (targetUnit?.damage ?? 0) > 0, viaAmbush })

  if (target.kind === 'base') {
    // Through `dealDamageToBase` so base-damage prevention applies (At Attin Safety Droid);
    // the attack-end ctx reports what actually landed, not the raw power.
    const baseSource = { cardId: attacker.cardId, controller: playerId }
    const dealtToBase = baseDamageAfterPrevention(state, enemyId, attackerPower, baseSource)
    let next = dealDamageToBase(state, enemyId, attackerPower, baseSource)
    next = recordBaseAttacked(next, enemyId) // "your base was attacked this phase" (Greef Karga)
    // "When an enemy unit attacks your base" (Kachirho Militia) — the attacked player's units react.
    for (const id of next.players[enemyId].units.map(u => u.instanceId)) {
      const reactor = next.players[enemyId].units.find(u => u.instanceId === id)
      if (reactor) next = runUnitTrigger(next, 'whenEnemyAttacksBase', reactor, enemyId, { attackerInstanceId: attackerId })
    }
    next = consumeAdvantage(next, playerId, attackerId) // the attack completed
    next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, combatDamageToBase: dealtToBase })
    return clearGrantedKeywords(checkWin(next))
  }

  const defenderBefore = state.players[enemyId].units.find(u => u.instanceId === target.instanceId)
  // The defender may have been defeated before damage → the attack fizzles.
  if (!defenderBefore) {
    let next = consumeAdvantage(state, playerId, attackerId)
    next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, combatDamageToBase: 0, defenderDefeated: true, combatDamageToDefender: 0 })
    return clearGrantedKeywords(checkWin(next))
  }

  // Saboteur: when this unit attacks, defeat the defending unit's Shields before combat damage
  // (CR 6.3.2b) — not optional, so a shield can't soak the hit. (Sentinel-ignoring is in legalMoves.)
  const preCombat = unitHasKeyword(state, attacker, 'Saboteur') && hasToken(defenderBefore.upgrades, TOKEN_SHIELD)
    ? updatePlayer(state, enemyId, {
        units: state.players[enemyId].units.map(u =>
          u.instanceId === defenderBefore.instanceId ? { ...u, upgrades: u.upgrades.filter(a => a.cardId !== TOKEN_SHIELD) } : u,
        ),
      })
    : state
  const defender = preCombat.players[enemyId].units.find(u => u.instanceId === target.instanceId)!

  // Combat-conditional auras (Grogu) apply to the defender during damage resolution.
  const combat = { attackerInstanceId: attackerId, defenderInstanceId: defender.instanceId }
  const defenderCtx = { combat, defending: true } // Palace Chef Droid: "+X while defending"
  const counterPower = effectivePower(preCombat, defender, defenderCtx)

  // Overwhelm: excess combat damage beyond the defender's remaining HP hits the
  // defending player's base (CR 1.9.11). A shielded defender takes no damage, so
  // there is no excess to trample.
  const remainingHp = effectiveHp(preCombat, defender, defenderCtx) - defender.damage
  const overwhelmExcess = unitHasKeyword(preCombat, attacker, 'Overwhelm')
    && !hasToken(defender.upgrades, TOKEN_SHIELD)
    && !unitNegatesOverwhelm(preCombat, defender)
    ? Math.max(0, attackerPower - remainingHp)
    : 0

  // Simultaneous combat damage (CR 1.9.10) — flagged as combat damage for whenDefeated. The
  // stat context goes through so combat-only debuffs count in the defeat check (Scion Shuttle).
  // Combat damage is attributed to the unit dealing it, so "damage dealt by friendly Underworld
  // cards is unpreventable" can see where it came from (Gorian Shard's Corsair).
  const attackerSource = { cardId: attacker.cardId, controller: playerId }
  const counterSource = { cardId: defender.cardId, controller: enemyId }

  // Damage prevention (The Mandalorian) is settled HERE — after the powers are known but
  // before anything is committed — so the logic below (first strike, Overwhelm, attack-end) still
  // sees correct values. Nothing has been written to `next` yet, so suspending and re-running this
  // whole function on resume is safe. Each side is asked at most once per combat (`preventAsked`).
  const asked = prevent.preventAsked ?? []
  const prevented = prevent.prevented ?? []
  for (const [targetId, amount, dmgSource] of [
    [defender.instanceId, attackerPower, attackerSource],
    [attacker.instanceId, counterPower, counterSource],
  ] as const) {
    if (amount <= 0 || asked.includes(targetId)) continue
    const offer = preventionOffer(preCombat, targetId, dmgSource)
    if (!offer) continue
    const withChoice = pushChoice(preCombat, {
      kind: 'mayPreventDamage',
      id: `prevent-${targetId}-${preCombat.instanceCounter}`,
      controller: offer.controller,
      preventerId: offer.preventerId,
      targetId,
      amount,
      source: dmgSource,
      combat: true,
    })
    return {
      ...withChoice,
      pendingAttack: { attackerId, target, activePlayer: playerId, stage: 'damage', viaAmbush, preventAsked: [...asked, targetId], prevented },
      // The unit's own controller decides; hand them control and come back to the attacker after.
      ...(offer.controller === playerId ? {} : { activePlayer: offer.controller, pendingResumeActive: playerId }),
    }
  }
  const damageTo = (id: string, amount: number) => (prevented.includes(id) ? 0 : amount)

  let next = applyUnitDamage(preCombat, enemyId, new Map([[defender.instanceId, damageTo(defender.instanceId, attackerPower)]]), true, defenderCtx, attackerSource)
  // "Deals combat damage before the defender" (Carson Teva): a defender defeated by that
  // damage never strikes back. Without it, damage is simultaneous (CR 1.9.10) and both still land.
  const defenderSurvived = next.players[enemyId].units.some(u => u.instanceId === defender.instanceId)
  if (defenderSurvived || !unitDealsDamageFirst(preCombat, attacker)) {
    next = applyUnitDamage(next, playerId, new Map([[attacker.instanceId, damageTo(attacker.instanceId, counterPower)]]), true, { combat, attacking: true, viaAmbush }, counterSource)
  }

  // Overwhelm excess also goes through base-damage prevention.
  const overwhelmDealt = overwhelmExcess > 0 ? baseDamageAfterPrevention(next, enemyId, overwhelmExcess, attackerSource) : 0
  if (overwhelmExcess > 0) next = dealDamageToBase(next, enemyId, overwhelmExcess, attackerSource)

  // Wipe Them Out: the same excess may be aimed at another unit in the arena instead of the base.
  const spillExcess = Math.max(0, damageTo(defender.instanceId, attackerPower) - remainingHp)
  if (spillExcess > 0 && unitSpillsExcessToUnit(preCombat, attacker)) {
    const targets = inPlayUnits(next)
      .filter(u => u.arena === attacker.arena && u.instanceId !== defender.instanceId)
      .map(u => u.instanceId)
    if (targets.length > 0) {
      next = pushChoice(next, { kind: 'selectDamageTarget', id: `${attackerId}-spill`, controller: playerId, amount: spillExcess, unitTargets: targets, baseTargets: [], optional: true, source: attackerSource })
    }
  }

  // Both units completed a combat — spend any Advantage on the survivors.
  next = consumeAdvantage(next, playerId, attackerId)
  next = consumeAdvantage(next, enemyId, defender.instanceId)
  // Pass the pre-combat attacker so its "When Attack Ends" fires even if it was defeated.
  const defenderDefeated = !next.players[enemyId].units.some(u => u.instanceId === defender.instanceId)
  next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, combatDamageToBase: overwhelmDealt, defenderDefeated, combatDamageToDefender: attackerPower }, attacker)
  return clearGrantedKeywords(checkWin(next))
}

/**
 * A base with damage ≥ HP defeats its owner (CR 1.9.7, 3.2.5). Both bases are
 * evaluated so that if a single action defeats both at once the game is a draw
 * rather than awarding the win to whichever was checked first.
 */
/** Every unit in play, both sides. */
function inPlayUnits(state: GameState): UnitState[] {
  return [...state.players.player.units, ...state.players.opponent.units]
}

/**
 * Move a unit from `from` to `to`, unchanged in every other respect. `owner` records where the card
 * came from so it can go home — to that player's discard if it's defeated, or back under their
 * control at regroup. Moving a unit that was already stolen keeps the ORIGINAL owner, and a unit
 * returning to its owner drops the field entirely.
 */
function takeControlOfUnit(state: GameState, from: PlayerId, to: PlayerId, instanceId: string): GameState {
  const unit = state.players[from].units.find(u => u.instanceId === instanceId)
  if (!unit || from === to) return state
  const cardOwner = unit.owner ?? from
  const moved: UnitState = cardOwner === to ? { ...unit, owner: undefined } : { ...unit, owner: cardOwner }
  const without = updatePlayer(state, from, { units: state.players[from].units.filter(u => u.instanceId !== instanceId) })
  return updatePlayer(without, to, { units: [...without.players[to].units, moved] })
}

/**
 * Hand every unit back to its owner. Runs at the START of the regroup phase, before units ready, so
 * the owner gets it back in time to ready it and use it in the next action phase.
 */
function returnStolenUnits(state: GameState): GameState {
  let next = state
  for (const controller of ['player', 'opponent'] as PlayerId[]) {
    for (const u of next.players[controller].units.filter(x => x.owner !== undefined && x.owner !== controller)) {
      next = takeControlOfUnit(next, controller, u.owner!, u.instanceId)
    }
  }
  return next
}

/** Unit cards in `owner`'s discard matching an optional cost cap and excluded trait. */
export function discardUnitsMatching(state: GameState, owner: PlayerId, maxCost?: number, excludeTrait?: string): string[] {
  return state.players[owner].discard.filter(id => {
    const c = state.cards[id]
    if (c?.type !== 'unit') return false
    if (maxCost !== undefined && c.cost > maxCost) return false
    if (excludeTrait && c.traits.some(t => t.toLowerCase() === excludeTrait.toLowerCase())) return false
    return true
  })
}

/**
 * Run one branch of a "Choose one:" event. Modes are named rather than carrying their own effect,
 * because a pending choice is plain JSON and can't hold a function.
 */
function applyChosenMode(state: GameState, owner: PlayerId, mode: string | undefined): GameState {
  switch (mode) {
    case 'healBase': // Choose Your Path — with a Force unit
      return healBase(state, owner, 5)
    case 'mandoToken': { // Choose Your Path — with a Mandalorian unit
      const tokenId = `u${state.instanceCounter}`
      return giveToken(createTokenUnit(state, owner, TOKEN_MANDALORIAN), tokenId, TOKEN_ADVANTAGE)
    }
    default:
      return state
  }
}

function checkWin(state: GameState): GameState {
  const defeated = (id: PlayerId): boolean => {
    const base = state.players[id].base
    return base.damage >= (state.cards[base.cardId]?.hp ?? 0)
  }
  const playerLost = defeated('player')
  const opponentLost = defeated('opponent')
  if (playerLost && opponentLost) return { ...state, winner: 'draw' }
  if (playerLost) return { ...state, winner: 'opponent' }
  if (opponentLost) return { ...state, winner: 'player' }
  return state
}

// ---------------------------------------------------------------------------
// Regroup phase (CR 5.5): draw 2 → each player may resource 1 → ready all
// ---------------------------------------------------------------------------

const REGROUP_DRAW = 2
/**
 * Drawing from an empty deck deals 3 damage to the drawing player's base per
 * missed card. (CR 8.6 Empty Deck — section absent from the docs PDF; this is
 * the standard rule. Flagged for verification against the full CR.)
 */
const EMPTY_DECK_DAMAGE = 3

function drawForRegroup(state: GameState, id: PlayerId): GameState {
  const p = state.players[id]
  const drawn = p.deck.slice(0, REGROUP_DRAW)
  const missed = REGROUP_DRAW - drawn.length
  return updatePlayer(state, id, {
    hand: [...p.hand, ...drawn],
    deck: p.deck.slice(REGROUP_DRAW),
    base: missed > 0 ? { ...p.base, damage: p.base.damage + missed * EMPTY_DECK_DAMAGE } : p.base,
  })
}

/** Clear every unit's Hidden state — it lasts only until the next phase. */
function clearHidden(state: GameState): GameState {
  let next = state
  for (const id of ['player', 'opponent'] as PlayerId[]) {
    const units = next.players[id].units
    if (units.some(u => u.hidden)) {
      next = updatePlayer(next, id, { units: units.map(u => (u.hidden ? { ...u, hidden: false } : u)) })
    }
  }
  return next
}

/**
 * State-based unit defeats: defeat any unit whose damage now meets its HP — e.g. after a
 * "this phase" HP buff expires at regroup, a unit only that buff kept alive dies. Runs each side
 * through the normal defeat path (`applyUnitDamage` with no new damage), so discards, leader
 * return and `whenDefeated` all fire.
 */
function sweepUnitDefeats(state: GameState): GameState {
  let next = applyUnitDamage(state, 'player', new Map())
  next = applyUnitDamage(next, 'opponent', new Map())
  return next
}

function enterRegroup(state: GameState): GameState {
  // "This phase" buffs expire and per-phase tracking resets as the phase changes; a unit
  // that the expired buff was keeping alive is then defeated as a state-based check. Unused
  // "next unit you play this phase" grants (Sabine) also lapse at the phase boundary.
  let next: GameState = clearNextUnitGrants(resetPhaseEvents(clearLastingEffects(clearHidden({ ...state, phase: 'regroup', consecutivePasses: 0 }))))
  // "At the start of the regroup phase, its owner takes control of it" (Rehabilitation) — before
  // anything readies, so the owner has it available for the next action phase.
  next = returnStolenUnits(next)
  next = sweepUnitDefeats(next)
  next = drawForRegroup(next, 'player')
  next = drawForRegroup(next, 'opponent')
  next = checkWin(next)
  if (next.winner !== null) return next
  // "When the regroup phase starts" abilities (e.g. Alphabet Squadron U-Wing).
  next = checkWin(fireForAllUnits(next, 'whenRegroupStarts'))
  if (next.winner !== null) return next
  // These fire for BOTH players' units, and a choice belongs to the card's controller whichever
  // side that is. Resourcing starts with the initiative holder, but if the only pending choice is
  // the other player's, handing them the turn is the only way it can be answered: `choiceMoves`
  // offers the active player's choices alone, so otherwise the regroup phase has no legal move at
  // all and the game hangs (#365). `resumeAfterChoice` hands back once the queue drains.
  const pending = next.pendingChoices ?? []
  const answerable = pending.some(c => c.controller === next.initiative) || pending.length === 0
  return {
    ...next,
    activePlayer: answerable ? next.initiative : pending[0].controller,
    regroupResourced: { player: false, opponent: false },
  }
}

function regroupChoice(state: GameState, handIndex: number | null): GameState {
  const playerId = state.activePlayer
  if (state.regroupResourced[playerId]) {
    throw new Error(`regroup: ${playerId} has already chosen`)
  }

  let next = state
  if (handIndex !== null) {
    next = updatePlayer(state, playerId, addResourceFromHand(state.players[playerId], handIndex))
  }
  next = { ...next, regroupResourced: { ...next.regroupResourced, [playerId]: true } }

  const other = opponentOf(playerId)
  if (!next.regroupResourced[other]) {
    return { ...next, activePlayer: other }
  }
  return startNextRound(next)
}

function readyEverything(state: GameState, id: PlayerId): GameState {
  const p = state.players[id]
  const readied = readyAllResources(p)
  const justReadied = p.units.filter(u => u.exhausted).map(u => u.instanceId)
  let next = updatePlayer(state, id, {
    resources: readied.resources,
    // Ready units and clear their once-per-round action-ability usage.
    units: p.units.map(u => (u.exhausted || u.usedAbilities ? { ...u, exhausted: false, usedAbilities: undefined } : u)),
    leader: p.leader.exhausted ? { ...p.leader, exhausted: false } : p.leader,
  })
  // "When this unit readies" abilities fire for each unit that just readied.
  for (const instanceId of justReadied) {
    const unit = next.players[id].units.find(u => u.instanceId === instanceId)
    if (unit) next = runUnitTrigger(next, 'whenReadies', unit, id)
  }
  return next
}

/** Whoever decides the first pending choice — the initiative holder if they have one
 *  (they resolve first), else the other player; the initiative holder otherwise. */
function firstDecider(state: GameState, initiative: PlayerId): PlayerId {
  const choices = state.pendingChoices ?? []
  if (choices.length === 0) return initiative
  return choices.some(c => c.controller === initiative) ? initiative : opponentOf(initiative)
}

function startNextRound(state: GameState): GameState {
  let next = readyEverything(readyEverything(state, 'player'), 'opponent')
  next = resetPhaseEvents(next) // a fresh action phase begins
  next = {
    ...next,
    phase: 'action',
    round: state.round + 1,
    consecutivePasses: 0,
    initiativeTakenBy: null, // counter flips back to available (CR 1.12.2b)
    regroupResourced: { player: false, opponent: false },
    // A whenReadies choice (e.g. The Conflict Within) is resolved before play begins.
    activePlayer: firstDecider(next, next.initiative),
  }
  return next
}
