import type { Action, AttackTarget } from './actions'
import type { GameState, PlayerId, UnitState } from './types'
import type { PendingChoice, UpgradeRef } from './types'
import { opponentOf, updatePlayer, activeChoice, popChoice, findChoice, removeChoice, hasPendingChoices, pushChoice } from './types'
import { addLastingEffect, clearLastingEffects, clearNextUnitGrants, resetPhaseEvents, recordUnitEntered, recordBaseAttacked, markAbilityUsed, nextUnitGrantMatches } from './types'
import { addResourceFromHand, payCost, readyAllResources } from './resources'
import { effectiveCost, enemyAttackTargets, affordableHandUnits, validUpgradeTargets } from './legalMoves'
import { runTrigger, runUnitTrigger, runLeaderTrigger, getCardDefinition, actionAbilityKey, leaderActions, type TriggerPoint, type EffectContext } from './abilities'
import { applyUnitDamage, dealDamageToUnit, defeatUnit } from './combat'
import { exhaustUnit, findUnit, giveToken, dealDamageToBase, defeatUpgradeAt, healUnit, healBase, resourceTopOfDeck, drawCards, discardFromHand, createTokenUnit, returnUpgradeFromDiscardToHand, returnUnitToHand, grantNextUnit } from './effects'
import { seededShuffle, nextSeed } from './rng'
import { effectivePower, effectiveHp } from './stats'
import { hasKeyword, unitHasKeyword, unitKeywordValue, unitNegatesOverwhelm } from './keywords'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, hasToken } from './tokenUpgrades'

/**
 * Action resolver (T2.5) — pure `(state, action) => state`.
 *
 * Legality lives in the legal-move generator; the resolver applies actions and
 * throws on engine-invariant violations (wrong phase, unknown ids, game over)
 * rather than re-validating game rules.
 */
export function resolve(state: GameState, action: Action): GameState {
  if (state.winner !== null) {
    throw new Error('Cannot resolve actions: the game is over')
  }

  switch (action.type) {
    case 'playCard':
      return requirePhase(state, 'action', () => {
        const played = playCard(state, action.handIndex)
        if (played.winner !== null) return played
        // An on-play trigger (Ambush) keeps the turn with the active player to
        // resolve it before passing (#334). If the trigger raised an OPPONENT-controlled
        // choice (Ninth Sister: "an opponent discards…", #355), hand control to them first.
        if (activeChoice(played)) return resetPasses(handOffOpponentChoice(played, played.activePlayer))
        return advanceTurn(resetPasses(played))
      })
    case 'playUpgrade':
      return requirePhase(state, 'action', () => {
        const played = playUpgrade(state, action.handIndex, action.targetInstanceId)
        // A raised choice (Camtono's look-at, the unique-rule defeat) keeps the turn (#342/#348).
        if (played.winner === null && activeChoice(played)) return resetPasses(played)
        return played.winner !== null ? played : advanceTurn(resetPasses(played))
      })
    case 'deployLeader':
      return requirePhase(state, 'action', () => {
        // Deploying a Support leader opens a support attack — hold the turn to resolve it (#348).
        const deployed = deployLeader(state)
        return activeChoice(deployed) ? resetPasses(deployed) : advanceTurn(resetPasses(deployed))
      })
    case 'useAbility':
      return requirePhase(state, 'action', () => useAbility(state, action.instanceId, action.cardId, action.index))
    case 'useLeaderAbility':
      return requirePhase(state, 'action', () => useLeaderAbility(state, action.index, action.targetInstanceId))
    case 'attack':
      return requirePhase(state, 'action', () => {
        // An attack resolves a pending choice, if one is active (#334/#343/#348). Both Support
        // ("gains this unit's other abilities") and Improvised Identity's mayAttack lend a source
        // card's full abilities (keywords + triggered) to the chosen attacker for this attack.
        const choice = activeChoice(state)
        const grantCardId = choice?.kind === 'support'
          ? state.players[state.activePlayer].units.find(u => u.instanceId === choice.unitId)?.cardId
          : choice?.kind === 'mayAttack' ? choice.grantCardId : undefined
        let before = grantCardId ? grantAbilityCard(state, action.attackerId, grantCardId) : state
        // Thrawn front (#348): the chosen attacker gains Restore N for this attack.
        if (choice?.kind === 'attackWithRestore' && choice.restore > 0) {
          before = updatePlayer(before, before.activePlayer, {
            units: before.players[before.activePlayer].units.map(u =>
              u.instanceId === action.attackerId ? { ...u, grantedKeywords: [{ name: 'Restore', value: choice.restore }] } : u,
            ),
          })
        }
        let attacked = attack(before, action.attackerId, action.target)
        // Consume the ambush/support choice this attack resolved. Support-granted
        // keywords are cleared inside completeAttack (after they're used), so they
        // survive a mid-combat On Defense suspension.
        if (choice) attacked = popChoice(attacked)
        if (attacked.winner !== null) return attacked
        // A choice the attack raised keeps the turn to resolve it first. A defender's own trigger
        // (whenDefeated, #356) is controlled by the defender, so hand control to them; remember the
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
    case 'skipTrigger':
      return requirePhase(state, 'action', () => resolveSkip(state, action.choiceId))
    case 'acceptChoice':
      return requirePhase(state, 'action', () => resolveAccept(state, action.choiceId, action.targetInstanceId, action.deckIndex, action.optionIndex, action.baseTarget, action.handIndex, action.cardName))
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
 * Bring a unit `cardId` into play under `owner` (#342). Shared by playing a unit from
 * hand and free-play effects (e.g. Camtono). Handles Shielded/Hidden on entry, opens
 * the Ambush/Support pending choice, and fires "When Played". The caller is
 * responsible for spending cost / removing the card from its source zone, and for the
 * win check afterwards.
 */
function enterUnit(state: GameState, owner: PlayerId, cardId: string, ready?: boolean): GameState {
  const card = state.cards[cardId]
  // Keywords the played unit gains on entry: its card's, plus any "next unit you play this phase"
  // grant (Sabine → Shielded, #348) — so a granted Ambush/Shielded/Hidden fires just like a printed one.
  // "Your next unit …" grants matching this card (#348/#355) — their keywords/enters-ready apply here
  // (the cost delta was already folded into `effectiveCost` at play time).
  const grants = (state.players[owner].nextUnitGrants ?? []).filter(g => nextUnitGrantMatches(card, g))
  const grantKeywords = grants.flatMap(g => g.keywords ?? [])
  const grantEntersReady = grants.some(g => g.entersReady)
  const entersWith = (name: string): boolean => hasKeyword(state, cardId, name) || grantKeywords.some(k => k.name === name)
  // Ambush: the unit may immediately attack an enemy unit, so it enters ready (#334).
  const ambush = entersWith('Ambush')
  const newUnit: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId,
    arena: card?.arena ?? 'ground',
    damage: 0,
    // Units normally enter exhausted (CR 1.5.4b); Ambush — or an ability (Fennec #348 / Neel #355) — enters ready.
    exhausted: ready === true || grantEntersReady ? false : !ambush,
    isLeader: false,
    // Shielded: the unit enters play with a shield token (#334).
    upgrades: entersWith('Shielded') ? [{ cardId: TOKEN_SHIELD, owner }] : [],
    // Hidden: the unit enters play hidden — unattackable until the next phase (#334).
    ...(entersWith('Hidden') ? { hidden: true } : {}),
  }

  let next = updatePlayer(state, owner, { units: [...state.players[owner].units, newUnit] })
  next = { ...next, instanceCounter: state.instanceCounter + 1 }
  next = recordUnitEntered(next, owner, newUnit.instanceId) // "entered play this phase" (#347)
  // Consume the matching grants: give the unit their keywords for this phase (a lasting effect, so an
  // ongoing keyword like Sentinel counts too), and drop the consumed grants — a non-matching unit
  // leaves them in place for a later matching unit (#348/#355).
  if (grants.length > 0) {
    if (grantKeywords.length > 0) next = addLastingEffect(next, { targetInstanceId: newUnit.instanceId, keywords: grantKeywords })
    const remaining = (next.players[owner].nextUnitGrants ?? []).filter(g => !nextUnitGrantMatches(card, g))
    next = updatePlayer(next, owner, { nextUnitGrants: remaining.length > 0 ? remaining : undefined })
  }

  // The unit is in play now, so read Ambush/Support from its LIVE keywords — an aura can strip them
  // (Domesticated Loth-Cat → "enemy units lose Ambush and Support", #354). Ambush: open the pending
  // attack only if there's an enemy to hit; otherwise the unit just enters exhausted, as normal (#334).
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
    // enters-ready grant, #355).
    if (ready !== true && !grantEntersReady && !inPlay().exhausted) exhaust()
    if (unitHasKeyword(next, inPlay(), 'Support')) next = openSupportChoice(next, owner, newUnit.instanceId)
  }

  // "When Played" abilities fire after the card enters play (CR 6.2.0f).
  next = runTrigger(next, 'whenPlayed', { owner, cardId, sourceInstanceId: newUnit.instanceId })
  // "When you play or create a unit" reacts on the controller's other cards (#309).
  next = fireEntersPlay(next, owner, newUnit.instanceId)
  return uniqueUnitCheck(next, owner) // two units with the same unique title → defeat one
}

/** Fire "When you play or create a unit" (#309) on the owner's undeployed leader and its
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

/** Enoch (#356): grant "next unit costs 1 less per 2 damage dealt to your base". */
function grantEnochDiscount(state: GameState, controller: PlayerId, dealt: number): GameState {
  const delta = Math.floor(dealt / 2)
  return delta > 0 ? grantNextUnit(state, controller, { costDelta: -delta }) : state
}

/** Space units among `revealed` whose cost fits `budget` (#355, Admiral Ackbar). */
function ackbarEligible(state: GameState, revealed: string[], budget: number): number[] {
  return revealed.flatMap((cardId, i) => {
    const c = state.cards[cardId]
    return c?.type === 'unit' && c.arena === 'space' && (c.cost ?? 0) <= budget ? [i] : []
  })
}

/**
 * Admiral Ackbar's search (#355): reveal the top 10, and if any space unit fits the cost-5 budget,
 * hold those cards out of the deck in a `searchPlayFree` choice; otherwise put the searched cards on
 * the bottom (nothing to play). The `#348`-style "shuffle after search" is approximated by bottoming.
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

function playCard(state: GameState, handIndex: number): GameState {
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const cardId = p.hand[handIndex]
  const card = cardId ? state.cards[cardId] : undefined
  if (!card || card.type !== 'unit') {
    throw new Error(`playCard: hand index ${handIndex} is not a playable unit`)
  }

  const paid = payCost(p, effectiveCost(state, playerId, card))
  const next = updatePlayer(state, playerId, { ...paid, hand: paid.hand.filter((_, i) => i !== handIndex) })
  // whenPlayed effects can defeat a base, so the win check runs afterwards.
  return checkWin(enterUnit(next, playerId, card.id))
}

/**
 * Open the Support pending choice (#334/#348): another ready unit may attack, gaining the Support
 * source's abilities for that attack (see the `support` case in the attack dispatcher). No choice
 * if there's no other ready unit. Shared by playing a Support unit and deploying a Support leader.
 */
function openSupportChoice(state: GameState, owner: PlayerId, sourceInstanceId: string): GameState {
  const others = state.players[owner].units.filter(u => u.instanceId !== sourceInstanceId && !u.exhausted)
  return others.length > 0
    ? pushChoice(state, { kind: 'support', id: sourceInstanceId, controller: owner, unitId: sourceInstanceId })
    : state
}

/** Strip transient per-attack grants (Support keywords #334, Improvised Identity
 *  granted abilities #343) from every unit once the attack that used them is done. */
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
 *  (Improvised Identity, #343). Cleared by `clearGrantedKeywords` after the attack. */
function grantAbilityCard(state: GameState, attackerId: string, cardId: string): GameState {
  const playerId = state.activePlayer
  return updatePlayer(state, playerId, {
    units: state.players[playerId].units.map(u => (u.instanceId === attackerId ? { ...u, grantedAbilityCardIds: [cardId] } : u)),
  })
}

/**
 * Resume once a choice resolves (#342). While others remain, hand to the right
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
  // A combat suspended for an On Defense choice resumes once the queue drains (#342).
  if (state.pendingAttack) return resumePendingAttack(state)
  // A "when you take the initiative" choice (#348): complete the deferred turn transition.
  if (state.pendingInitiativeEndsPhase !== undefined) {
    const cleared = { ...state, pendingInitiativeEndsPhase: undefined }
    return state.pendingInitiativeEndsPhase ? enterRegroup(cleared) : advanceTurn(resetPasses(cleared))
  }
  if (resolved.kind === 'payOrExhaust' && resolved.resumeAtInitiative) {
    return { ...state, activePlayer: state.initiative }
  }
  // An opponent-interjected choice (Sabine, #348) drained: restore the original actor, then advance
  // the turn as their action normally would (so it becomes the opponent's turn).
  if (state.pendingResumeActive !== undefined) {
    return advanceTurn(resetPasses({ ...state, activePlayer: state.pendingResumeActive, pendingResumeActive: undefined }))
  }
  return advanceTurn(resetPasses(state))
}

/** Resume a combat suspended by an On Attack / On Defense choice (#342/#309): restore the
 *  attacker as active, run the remaining stages from where it paused, then pass the turn
 *  (unless a later stage suspended again or won the game). */
function resumePendingAttack(state: GameState): GameState {
  const pa = state.pendingAttack!
  const next = runAttackStages({ ...state, pendingAttack: undefined, activePlayer: pa.activePlayer }, pa.attackerId, pa.target, pa.stage)
  return next.winner !== null || hasPendingChoices(next) ? next : advanceTurn(resetPasses(next))
}

/** Decline a pending choice (#334/#342). Ambush and pay-or-exhaust leave the unit
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
  // Admiral Ackbar (#355): stopping the search returns the still-held revealed cards to the deck bottom.
  if (choice.kind === 'searchPlayFree') {
    next = updatePlayer(next, choice.controller, { deck: [...next.players[choice.controller].deck, ...choice.revealed] })
  }
  // Enoch (#356): stopping grants the discount for the damage dealt to your base so far.
  if (choice.kind === 'dealOwnBaseForDiscount') {
    next = grantEnochDiscount(next, choice.controller, choice.dealt)
  }
  return resumeAfterChoice(next, choice)
}

/** Accept a pending "may…" choice — pay the cost / play the card / search (#342/#343). */
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
      // Optional targeted damage, e.g. Cad Bane's On Attack (#309).
      if (targetInstanceId) {
        next = dealDamageToUnit(next, targetInstanceId, choice.amount)
        next = checkWin(next)
        if (next.winner !== null) return next
        // "If it's defeated this way, …" — Imposing Scout Walker rewards its own unit (#355).
        if (choice.rewardIfDefeated && !findUnit(next, targetInstanceId)) {
          const reward = choice.rewardIfDefeated
          if ('instanceId' in reward) {
            for (let i = 0; i < reward.count; i++) next = giveToken(next, reward.instanceId, TOKEN_ADVANTAGE)
          } else {
            // Justifier (#356): give Advantage to a chosen unit.
            const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
            if (targets.length > 0) next = pushChoice(next, { kind: 'mayGiveTokens', id: choice.id, controller: choice.controller, token: TOKEN_ADVANTAGE, count: reward.chooseAdvantage, targets, optional: false })
          }
        }
      }
      break
    case 'mayAdvantageEach':
      // Emperor Palpatine: give the chosen unit an Advantage token per other friendly unit (#309).
      if (targetInstanceId) {
        const others = next.players[choice.controller].units.filter(u => u.instanceId !== targetInstanceId).length
        for (let i = 0; i < others; i++) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    case 'mayExhaustLeaderForAdvantage': {
      // Greef Karga front: exhaust the leader to give the just-played unit an Advantage token (#309).
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = giveToken(next, choice.unitId, TOKEN_ADVANTAGE)
      }
      break
    }
    case 'mayLastingBuff':
      // Optional "this phase" buff, e.g. Baylan's On Attack: grant the chosen unit the buff (#347).
      if (targetInstanceId) {
        next = addLastingEffect(next, { targetInstanceId, power: choice.power, hp: choice.hp, keywords: choice.keywords })
      }
      break
    case 'mayGiveAdvantage':
      // Ezra deployed: give the chosen unit an Advantage token, no cost (#347).
      if (targetInstanceId) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      break
    case 'mayGiveTokens':
      // Give `count` of a token to the chosen unit (#355) — Attendant Navigator, Anakin, Trexler.
      if (targetInstanceId) for (let i = 0; i < choice.count; i++) next = giveToken(next, targetInstanceId, choice.token)
      break
    case 'mayExhaustLeaderGiveAdvantage': {
      // Ezra front: exhaust the (undeployed) leader to give the chosen unit an Advantage token (#347).
      const p = next.players[choice.controller]
      if (targetInstanceId && !p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    }
    case 'mayExhaustLeaderExhaustUnit': {
      // Shin Hati front: exhaust the (undeployed) leader to exhaust the chosen unit (#347).
      const p = next.players[choice.controller]
      if (targetInstanceId && !p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = exhaustUnit(next, targetInstanceId)
      }
      break
    }
    case 'mayExhaustUnit':
      // Shin Hati deployed: exhaust the chosen unit (no leader cost); mark the once-per-round use (#347).
      if (targetInstanceId) {
        next = exhaustUnit(next, targetInstanceId)
        if (choice.markUsed) next = markAbilityUsed(next, choice.controller, choice.markUsed.instanceId, choice.markUsed.key)
      }
      break
    case 'chooseOne': {
      // Choose-one/modal (#348): apply the picked option's effect (Sloane's arena buff).
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
      // Vane (#309/#348): defeat the chosen upgrade (card or token). Vane then chooses where 2 damage
      // lands (`then`); Clan Vizsla Soldier (#356) just defeats it, with no follow-up.
      const pick = choice.candidates[optionIndex ?? 0]
      if (pick) {
        next = defeatUpgradeAt(next, pick.unitId, pick.upgradeIndex)
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
      // Deal the chosen amount to the picked base or unit (#348).
      if (baseTarget) next = dealDamageToBase(next, baseTarget, choice.amount)
      else if (targetInstanceId) next = dealDamageToUnit(next, targetInstanceId, choice.amount)
      next = checkWin(next)
      if (next.winner !== null) return next
      break
    }
    case 'mayExhaustLeaderHealUnit': {
      // Luke front: exhaust the (undeployed) leader to heal the attacker (#348).
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = healUnit(next, choice.unitId, choice.amount)
      }
      break
    }
    case 'selectHealTarget':
      // Luke deployed: heal the chosen unit or your base (#348).
      if (baseTarget) next = healBase(next, baseTarget, choice.amount)
      else if (targetInstanceId) next = healUnit(next, targetInstanceId, choice.amount)
      break
    case 'selectUnitToExhaust':
      // Fennec's additional cost (#348): exhaust the chosen unit, then the play-from-hand step.
      if (targetInstanceId) {
        next = exhaustUnit(next, targetInstanceId)
        const candidates = affordableHandUnits(next, choice.controller, 0, choice.then.costDelta)
        if (candidates.length > 0) {
          next = pushChoice(next, { kind: 'playUnitFromHand', id: `${choice.id}-play`, controller: choice.controller, candidates, costDelta: choice.then.costDelta, entersReady: choice.then.entersReady })
        }
      }
      break
    case 'mayPayToDraw': {
      // Mandalorian (#348): optionally pay the cost, then draw. `cost` 0 = a free "may draw".
      next = updatePlayer(next, choice.controller, payCost(next.players[choice.controller], choice.cost))
      const handBefore = next.players[choice.controller].hand.length
      next = drawCards(next, choice.controller, choice.draw)
      // Mos Espa Watermonger (#355): "if you do, discard a card" — only when a card was actually drawn.
      const drew = next.players[choice.controller].hand.length - handBefore
      if (choice.thenDiscard && drew > 0) {
        next = pushChoice(next, { kind: 'selectDiscard', id: choice.id, controller: choice.controller, count: Math.min(choice.thenDiscard, next.players[choice.controller].hand.length) })
      }
      break
    }
    case 'selectDiscard': {
      // Discard the chosen hand card (#355), then re-offer until `count` are discarded.
      if (handIndex !== undefined) {
        const discardedId = next.players[choice.controller].hand[handIndex]
        next = discardFromHand(next, choice.controller, handIndex)
        const remaining = choice.count - 1
        if (remaining > 0 && next.players[choice.controller].hand.length > 0) {
          next = pushChoice(next, { kind: 'selectDiscard', id: choice.id, controller: choice.controller, count: remaining, optional: choice.optional, then: choice.then })
        } else if (choice.then && discardedId !== undefined) {
          if ('distributeDamageTo' in choice.then) {
            // Ninth Sister (#355): "deal damage equal to its cost divided among any units".
            const amount = next.cards[discardedId]?.cost ?? 0
            const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
            if (amount > 0 && targets.length > 0) {
              next = pushChoice(next, { kind: 'distributeDamage', id: choice.id, controller: choice.then.distributeDamageTo, remaining: amount, total: amount, targets })
            }
          } else {
            // Razor Crest (#356): "if you do, this unit gets +power/+hp for this attack".
            next = addLastingEffect(next, { targetInstanceId: choice.then.buffUnit, power: choice.then.power, hp: choice.then.hp })
          }
        }
      }
      break
    }
    case 'maySelfDamageHealBase': {
      // Leia Organa (#356): deal `selfDamage` to this unit, then heal `healBase` from your base.
      next = dealDamageToUnit(next, choice.unitId, choice.selfDamage)
      next = checkWin(next)
      if (next.winner !== null) return next
      next = healBase(next, choice.controller, choice.healBase)
      break
    }
    case 'mayExhaustLeaderBuffSelf': {
      // Mando's N-1 (#356): exhaust your leader, then give this unit a "this phase" buff.
      const p = next.players[choice.controller]
      if (!p.leader.exhausted) {
        next = updatePlayer(next, choice.controller, { leader: { ...p.leader, exhausted: true } })
        next = addLastingEffect(next, { targetInstanceId: choice.unitId, power: choice.power, hp: choice.hp })
      }
      break
    }
    case 'distributeDamage': {
      // Ninth Sister (#355): spend one point of the pool onto the chosen unit, then re-offer the
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
      // Helgait (#356): give one token to the chosen friendly unit, then re-offer the rest.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        next = giveToken(next, targetInstanceId, choice.token)
        const remaining = choice.remaining - 1
        const targets = next.players[choice.controller].units.map(u => u.instanceId)
        if (remaining > 0 && targets.length > 0) {
          next = pushChoice(next, { kind: 'distributeTokens', id: choice.id, controller: choice.controller, token: choice.token, remaining, total: choice.total, targets })
        }
      }
      break
    }
    case 'dealOwnBaseForDiscount': {
      // Enoch (#356): deal 1 to your own base; at `max` (or on Done, see resolveSkip) grant the discount.
      next = dealDamageToBase(next, choice.controller, 1)
      next = checkWin(next)
      if (next.winner !== null) return next
      const dealt = choice.dealt + 1
      if (dealt < choice.max) next = pushChoice(next, { kind: 'dealOwnBaseForDiscount', id: choice.id, controller: choice.controller, dealt, max: choice.max })
      else next = grantEnochDiscount(next, choice.controller, dealt)
      break
    }
    case 'returnFriendlyUnit': {
      // Purrgil Ultra (#356): return the chosen unit to hand, then deal its cost as damage to any unit.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        const found = findUnit(next, targetInstanceId)
        const cost = found ? next.cards[found.unit.cardId]?.cost ?? 0 : 0
        next = returnUnitToHand(next, targetInstanceId)
        const targets = [...next.players.player.units, ...next.players.opponent.units].map(u => u.instanceId)
        if (cost > 0 && targets.length > 0) {
          next = pushChoice(next, { kind: 'mayDamage', id: choice.id, controller: choice.controller, unitId: choice.id, targets, amount: cost, optional: false })
        }
      }
      break
    }
    case 'peekTopDiscard': {
      // Reanimated Night Trooper (#356): discard the top card of the chosen deck.
      if (baseTarget) {
        const p = next.players[baseTarget]
        if (p.deck.length > 0) next = updatePlayer(next, baseTarget, { deck: p.deck.slice(1), discard: [...p.discard, p.deck[0]] })
      }
      break
    }
    case 'lookAtHand': {
      // Remnant Lookouts (#355): discard the chosen card from the target's hand; if `thenDraw`, they draw.
      if (choice.mayDiscard && handIndex !== undefined) {
        next = discardFromHand(next, choice.target, handIndex)
        if (choice.thenDraw) next = drawCards(next, choice.target, 1)
      }
      break
    }
    case 'selectFromDiscard': {
      // Moff Gideon (#356): return the chosen discard-pile card to hand.
      const cardId = choice.candidates[optionIndex ?? 0]
      if (cardId !== undefined) next = returnUpgradeFromDiscardToHand(next, choice.controller, cardId)
      break
    }
    case 'searchDraw': {
      // Clan Wren Loyalist (#355): draw the chosen revealed card; put the other revealed cards on
      // the bottom of the deck (revealed order — the "random order" is immaterial hidden info here).
      if (deckIndex !== undefined && deckIndex < choice.revealed.length) {
        const owner = choice.controller
        const p = next.players[owner]
        const drawn = choice.revealed[deckIndex]
        const rest = p.deck.slice(choice.revealed.length)
        const others = choice.revealed.filter((_, i) => i !== deckIndex)
        next = updatePlayer(next, owner, { hand: [...p.hand, drawn], deck: [...rest, ...others] })
      }
      break
    }
    case 'variableStrike': {
      // The Cyborg Mech (#355): deal 5 to a damaged target, else 2 to an undamaged one.
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
      // Barriss Offee (#355): heal min(maxHeal, damage) from the unit and give it that many Advantage tokens.
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
    case 'nameCard': {
      // Ryder Azadi (#355): record the named card on this unit — the opponent can't play cards with
      // that name while it's in play (enforced in legalMoves). Naming is mandatory.
      if (cardName) {
        next = updatePlayer(next, choice.controller, {
          units: next.players[choice.controller].units.map(u => (u.instanceId === choice.unitId ? { ...u, namedCard: cardName } : u)),
        })
      }
      break
    }
    case 'mayDefeatSelfSearch': {
      // Admiral Ackbar (#355): defeat this unit, then search the top 10 for space units to play free.
      next = defeatUnit(next, choice.unitId)
      next = checkWin(next)
      if (next.winner !== null) return next
      next = startAckbarSearch(next, choice.controller, choice.id)
      break
    }
    case 'searchPlayFree': {
      // Admiral Ackbar (#355): play the chosen revealed space unit for free (it may trigger its own
      // When Played — that sub-choice resolves first, then we re-offer the rest of the budget).
      if (deckIndex !== undefined && choice.eligibleIndices.includes(deckIndex)) {
        const owner = choice.controller
        const cardId = choice.revealed[deckIndex]
        const cost = next.cards[cardId]?.cost ?? 0
        next = enterUnit(next, owner, cardId, false)
        next = checkWin(next)
        if (next.winner !== null) return next
        const revealed = choice.revealed.filter((_, i) => i !== deckIndex)
        const budget = choice.budget - cost
        const eligibleIndices = ackbarEligible(next, revealed, budget)
        if (budget > 0 && eligibleIndices.length > 0) {
          next = pushChoice(next, { kind: 'searchPlayFree', id: choice.id, controller: owner, revealed, eligibleIndices, budget })
        } else {
          next = updatePlayer(next, owner, { deck: [...next.players[owner].deck, ...revealed] }) // bottom the leftovers
        }
      }
      break
    }
    case 'selectUniqueToDefeat': {
      // Unique rule (#348): defeat the chosen duplicate upgrade, then re-check (3+ copies → repeat).
      const pick = choice.candidates[optionIndex ?? 0]
      if (pick) {
        next = defeatUpgradeAt(next, pick.unitId, pick.upgradeIndex)
        next = uniqueUpgradeCheck(next, choice.controller)
      }
      break
    }
    case 'opponentGivesAdvantage':
      // Sabine front (#348): the opponent gives `count` Advantage tokens to their chosen unit.
      if (targetInstanceId && choice.targets.includes(targetInstanceId)) {
        for (let i = 0; i < choice.count; i++) next = giveToken(next, targetInstanceId, TOKEN_ADVANTAGE)
      }
      break
    case 'multiPick':
      // Repeatable board-target pick (#355): apply the per-pick effect, then re-offer the remaining
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
      // Unique rule for units (#348): defeat the chosen duplicate unit, then re-check (3+ → repeat).
      if (targetInstanceId && choice.candidates.includes(targetInstanceId)) {
        next = defeatUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
        next = uniqueUnitCheck(next, choice.controller)
      }
      break
    }
    case 'mayDefeatEnemyUnit':
      // Thrawn deployed (#348): defeat the chosen non-leader enemy unit.
      if (targetInstanceId) {
        next = defeatUnit(next, targetInstanceId)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    case 'mayDeployLeader':
      // Grogu (#348): deploy via the triggered epic action — not once-per-game, so it doesn't burn
      // the epic action (`epicUsed: false`), letting Grogu redeploy after being defeated + readying.
      next = deployLeader(next, false)
      break
    case 'selectResourceUpgrade': {
      // The Armorer (#348): the chosen resource upgrade → pick where to attach it.
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
      // Play the upgrade from resources onto the chosen unit, then resource the top of the deck (#348).
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
        next = uniqueUpgradeCheck(next, owner) // unique rule (#348)
        next = checkWin(next)
        if (next.winner !== null) return next
      }
      break
    }
    case 'playUnitFromHand': {
      // Play the chosen hand unit, paying its cost + costDelta, entering ready if the ability says so (#348).
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
 * Play the revealed top-of-deck card for free (Camtono, #342). Unit → enters play;
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
    return uniqueUpgradeCheck(next, owner) // unique rule (#348)
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
 * Play an upgrade from hand and attach it to a unit (#308). Any unit in play is a
 * valid target by default; per-card restrictions are #337. Cost + aspect penalty
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
 * Use a unit's activated "Action:" ability (#343). A once-per-round ability is marked
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
 * Use an undeployed leader's activated "Action:" ability (#309): pay its cost, exhaust
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
 * If an ability raised a choice controlled by the OTHER player (Sabine → "an opponent gives …",
 * #348) and the actor has none of their own left to resolve, hand control to that opponent and
 * remember the actor so `resumeAfterChoice` restores them and advances the turn once it drains.
 * Generic; a no-op when the actor has their own choice to resolve first, or none was raised.
 */
function handOffOpponentChoice(state: GameState, actor: PlayerId): GameState {
  if (!hasPendingChoices(state) || state.pendingChoices!.some(c => c.controller === actor)) return state
  const other = state.pendingChoices![0].controller
  return other === actor ? state : { ...state, activePlayer: other, pendingResumeActive: actor }
}

/**
 * Deploy the active player's leader. The normal epic action sets `epicActionUsed` so it can't be
 * used again (and a defeated leader can't redeploy, CR 3.4.5). Grogu's *triggered* deploy (#348)
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
  // at deploy (Moff Gideon gains keywords from an Imperial in your discard, #348): a Shield token,
  // Hidden, and an Ambush or Support attack.
  return applyDeployKeywords(next, playerId, leaderUnit.instanceId)
}

/**
 * On-enter keyword effects for a just-DEPLOYED leader unit (#334/#348): Shielded → a Shield token,
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
  // "When you take the initiative" (#348, Mandalorian): fire before the turn transition. If it raises
  // a choice, hold with the taker and finish the transition once the choice drains (resumeAfterChoice).
  const before = taken.pendingChoices?.length ?? 0
  taken = runLeaderTrigger(taken, 'whenTakeInitiative', playerId)
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
// Combat (basic resolution — T2.5/T3.2/T3.3)
// ---------------------------------------------------------------------------

/**
 * Advantage gives +1/0 until the unit next completes an attack or defence, then
 * the token is removed (#308/#334). Called for the attacker and defender after
 * combat; a no-op if the unit has no Advantage token (or was defeated).
 */
function consumeAdvantage(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const p = state.players[owner]
  const unit = p.units.find(u => u.instanceId === instanceId)
  if (!unit || !hasToken(unit.upgrades, TOKEN_ADVANTAGE)) return state
  // A unit's next attack/defence removes ALL its Advantage tokens (each gave +1/0), unless
  // another ability says otherwise.
  return updatePlayer(state, owner, {
    units: p.units.map(u =>
      u.instanceId === instanceId ? { ...u, upgrades: u.upgrades.filter(a => a.cardId !== TOKEN_ADVANTAGE) } : u,
    ),
  })
}

/** Fire "When Attack Ends" abilities on the attacker (card + upgrades), if it
 *  survived the combat (#340). `ctx` carries what the attack did (target, whether
 *  it damaged the base) for abilities like Whistling Birds (#342). */
function fireAttackEnd(state: GameState, owner: PlayerId, attackerId: string, ctx: Partial<EffectContext>, captured?: UnitState): GameState {
  const fullCtx = { ...ctx, attackerInstanceId: attackerId }
  // "When THIS unit's attack ends" — the attacker only (Camtono, Whistling Birds). Still
  // triggers if the attacker was defeated by combat damage (CR 7.6 / 1258) — fall back to
  // its last-known state (with its upgrades).
  const attacker = state.players[owner].units.find(u => u.instanceId === attackerId) ?? captured
  let next = attacker ? runUnitTrigger(state, 'onAttackEnd', attacker, owner, fullCtx) : state
  // "When a friendly unit's attack ends" — every unit the attacker's controller has (re-found
  // in case an earlier reactor changed the board), plus their undeployed leader (#347).
  for (const id of next.players[owner].units.map(u => u.instanceId)) {
    const reactor = next.players[owner].units.find(u => u.instanceId === id)
    if (reactor) next = runUnitTrigger(next, 'whenFriendlyAttackEnds', reactor, owner, fullCtx)
  }
  next = runLeaderTrigger(next, 'whenFriendlyAttackEnds', owner, fullCtx)
  return next
}

/** Fire a trigger for every unit in play (both sides), re-finding each in case an
 *  earlier ability changed it. Used for board-wide events like regroup start (#340). */
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
 * Begin an attack (#342): exhaust the attacker and apply Restore, then either finish
 * inline or — if the defender has an "On Defense" ability that raises a choice —
 * suspend the combat before damage and hand control to the defender. Combat damage
 * itself is dealt by `completeAttack` (immediately, or on resume after the choice).
 */
function attack(state: GameState, attackerId: string, target: AttackTarget): GameState {
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

  // "On Attack" abilities fire before combat damage (#309); a raised choice suspends
  // the attack with the attacker keeping control, resuming at the On Defense stage.
  const before = next.pendingChoices?.length ?? 0
  const attackerNow = next.players[playerId].units.find(u => u.instanceId === attackerId)!
  next = runUnitTrigger(next, 'onAttack', attackerNow, playerId, { attackTarget: target })
  if ((next.pendingChoices?.length ?? 0) > before) {
    return { ...next, pendingAttack: { attackerId, target, activePlayer: playerId, stage: 'onDefense' } }
  }
  return runAttackStages(next, attackerId, target, 'onDefense')
}

/**
 * Run the pre-combat stages from `stage` onward and then deal the damage (#342/#309).
 * The On Defense stage may suspend (handing control to the defender); resumption picks
 * up from the stored stage. `state.activePlayer` is the attacker's controller here.
 */
function runAttackStages(state: GameState, attackerId: string, target: AttackTarget, stage: 'onDefense' | 'damage'): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)

  if (stage === 'onDefense' && target.kind === 'unit') {
    const defender = state.players[enemyId].units.find(u => u.instanceId === target.instanceId)
    if (defender) {
      const before = state.pendingChoices?.length ?? 0
      const afterDefense = runUnitTrigger(state, 'onDefense', defender, enemyId)
      if ((afterDefense.pendingChoices?.length ?? 0) > before) {
        // Hand control to the defender; resume at the damage stage.
        return { ...afterDefense, pendingAttack: { attackerId, target, activePlayer: playerId, stage: 'damage' }, activePlayer: enemyId }
      }
      return completeAttack(afterDefense, attackerId, target)
    }
  }
  return completeAttack(state, attackerId, target)
}

/**
 * Deal the combat damage (#342) — calculated from the *current* (post-"On Defense")
 * state, per CR 6.3.4. The attacker or defender may have been defeated by an On
 * Defense ability, in which case the attack fizzles. Clears any transient
 * Support-granted keywords once the calculation that used them is done.
 */
function completeAttack(state: GameState, attackerId: string, target: AttackTarget): GameState {
  const playerId = state.activePlayer
  const enemyId = opponentOf(playerId)
  const attacker = state.players[playerId].units.find(u => u.instanceId === attackerId)
  // The attacker may have been defeated before damage (e.g. an On Defense ping).
  if (!attacker) return clearGrantedKeywords(checkWin(state))

  const attackerPower = effectivePower(state, attacker, { attacking: true, attackingBase: target.kind === 'base' })

  if (target.kind === 'base') {
    const enemy = state.players[enemyId]
    let next = updatePlayer(state, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + attackerPower } })
    next = recordBaseAttacked(next, enemyId) // "your base was attacked this phase" (#356, Greef Karga)
    next = consumeAdvantage(next, playerId, attackerId) // the attack completed
    next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, combatDamageToBase: attackerPower })
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

  // Combat-conditional auras (Grogu, #348) apply to the defender during damage resolution.
  const combat = { attackerInstanceId: attackerId, defenderInstanceId: defender.instanceId }
  const counterPower = effectivePower(preCombat, defender, { combat })

  // Overwhelm: excess combat damage beyond the defender's remaining HP hits the
  // defending player's base (CR 1.9.11). A shielded defender takes no damage, so
  // there is no excess to trample (#308).
  const remainingHp = effectiveHp(preCombat, defender, { combat }) - defender.damage
  const overwhelmExcess = unitHasKeyword(preCombat, attacker, 'Overwhelm')
    && !hasToken(defender.upgrades, TOKEN_SHIELD)
    && !unitNegatesOverwhelm(preCombat, defender)
    ? Math.max(0, attackerPower - remainingHp)
    : 0

  // Simultaneous combat damage (CR 1.9.10) — flagged as combat damage for whenDefeated (#356).
  let next = applyUnitDamage(preCombat, enemyId, new Map([[defender.instanceId, attackerPower]]), true)
  next = applyUnitDamage(next, playerId, new Map([[attacker.instanceId, counterPower]]), true)

  if (overwhelmExcess > 0) {
    const enemy = next.players[enemyId]
    next = updatePlayer(next, enemyId, { base: { ...enemy.base, damage: enemy.base.damage + overwhelmExcess } })
  }

  // Both units completed a combat — spend any Advantage on the survivors (#308).
  next = consumeAdvantage(next, playerId, attackerId)
  next = consumeAdvantage(next, enemyId, defender.instanceId)
  // Pass the pre-combat attacker so its "When Attack Ends" fires even if it was defeated.
  const defenderDefeated = !next.players[enemyId].units.some(u => u.instanceId === defender.instanceId)
  next = fireAttackEnd(next, playerId, attackerId, { attackTarget: target, combatDamageToBase: overwhelmExcess, defenderDefeated, combatDamageToDefender: attackerPower }, attacker)
  return clearGrantedKeywords(checkWin(next))
}

/**
 * A base with damage ≥ HP defeats its owner (CR 1.9.7, 3.2.5). Both bases are
 * evaluated so that if a single action defeats both at once the game is a draw
 * rather than awarding the win to whichever was checked first (#323).
 */
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

/** Clear every unit's Hidden state — it lasts only until the next phase (#334). */
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
 * State-based unit defeats (#347): defeat any unit whose damage now meets its HP — e.g. after a
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
  // "This phase" buffs expire and per-phase tracking resets as the phase changes (#347); a unit
  // that the expired buff was keeping alive is then defeated as a state-based check. Unused
  // "next unit you play this phase" grants (Sabine, #348) also lapse at the phase boundary.
  let next: GameState = clearNextUnitGrants(resetPhaseEvents(clearLastingEffects(clearHidden({ ...state, phase: 'regroup', consecutivePasses: 0 }))))
  next = sweepUnitDefeats(next)
  next = drawForRegroup(next, 'player')
  next = drawForRegroup(next, 'opponent')
  next = checkWin(next)
  if (next.winner !== null) return next
  // "When the regroup phase starts" abilities (e.g. Heightened Awareness) (#340).
  next = checkWin(fireForAllUnits(next, 'whenRegroupStarts'))
  if (next.winner !== null) return next
  return {
    ...next,
    activePlayer: next.initiative,
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
    // Ready units and clear their once-per-round action-ability usage (#343).
    units: p.units.map(u => (u.exhausted || u.usedAbilities ? { ...u, exhausted: false, usedAbilities: undefined } : u)),
    leader: p.leader.exhausted ? { ...p.leader, exhausted: false } : p.leader,
  })
  // "When this unit readies" abilities fire for each unit that just readied (#342).
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
  next = resetPhaseEvents(next) // a fresh action phase begins (#347)
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
