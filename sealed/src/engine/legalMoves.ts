import type { Action } from './actions'
import type { EngineCard, GameState, HandCardRef, PlayerId, ResourceUpgradeRef, UnitState } from './types'
import { opponentOf, hasPendingChoices, nextUnitGrantMatches } from './types'
import { canAfford, readyResourceCount } from './resources'
import { unitHasKeyword, unitCannotAttackBases, unitCannotBeAttacked, unitAttacksEitherArena } from './keywords'
import { getCardDefinition, unitActionAbilities, actionAbilityKey, leaderActions } from './abilities'
import './cardDefinitions' // side effect: registers all real card behaviours

/**
 * The enemy units `attacker` (a unit controlled by the active player) may attack,
 * and whether Sentinel locks the attack onto them (so the base is off-limits).
 * Sentinel forces the attack; Hidden removes a unit as a target unless it also has
 * Sentinel; Saboteur ignores Sentinel.
 */
export function enemyAttackTargets(state: GameState, attacker: UnitState): { targets: UnitState[]; sentinelLocked: boolean } {
  const enemy = state.players[opponentOf(state.activePlayer)]
  // Normally same-arena only; Red Leader reaches either arena.
  const inRange = unitAttacksEitherArena(state, attacker) ? enemy.units : enemy.units.filter(e => e.arena === attacker.arena)
  // Hidden hides a unit (unless it has Sentinel); "can't be attacked" (Tatooine Repulsor Train)
  // removes it entirely — including as a forced Sentinel target.
  const attackable = inRange.filter(e => (!e.hidden || unitHasKeyword(state, e, 'Sentinel')) && !unitCannotBeAttacked(state, e))
  const sentinels = attackable.filter(e => unitHasKeyword(state, e, 'Sentinel'))
  const sentinelLocked = sentinels.length > 0 && !unitHasKeyword(state, attacker, 'Saboteur')
  return { targets: sentinelLocked ? sentinels : attackable, sentinelLocked }
}

/**
 * Effective cost of playing a card, including the aspect penalty (CR 8.1):
 * +2 resources per aspect icon on the card beyond those provided by the
 * player's leader and base. Icons match as a multiset — a doubled icon on a
 * card needs two provided copies to avoid the penalty.
 */
export function effectiveCost(state: GameState, playerId: PlayerId, card: EngineCard, target?: UnitState): number {
  const p = state.players[playerId]
  const provided: string[] = [
    ...(state.cards[p.leader.cardId]?.aspects ?? []),
    ...(state.cards[p.base.cardId]?.aspects ?? []),
  ]
  // A unit may provide its aspect icons while its controller pays costs — The Darksaber.
  for (const u of p.units) {
    for (const cardId of [u.cardId, ...u.upgrades.map(x => x.cardId)]) {
      provided.push(...(getCardDefinition(cardId)?.providesAspects?.(state, u) ?? []))
    }
  }
  let penalty = 0
  for (const icon of card.aspects) {
    const i = provided.indexOf(icon)
    if (i === -1) {
      penalty += 2
    } else {
      provided.splice(i, 1)
    }
  }
  // Card-specific cost modifiers (e.g. −1 on an Imperial/Mandalorian unit).
  const modifier = getCardDefinition(card.id)?.costModifier?.(state, playerId, target) ?? 0
  // Units in play that discount cards their controller plays, or waive the aspect penalty
  // (Pit Droid Team / Peli Motto). Distinct from `costModifier`, which lives on the played card.
  let discount = 0
  let waivePenalty = false
  const discountCtx = { owner: playerId, card, target }
  for (const u of p.units) {
    for (const cid of [u.cardId, ...u.upgrades.map(x => x.cardId)]) {
      const def = getCardDefinition(cid)
      discount += def?.costDiscount?.(state, u, discountCtx) ?? 0
      if (def?.waivesAspectPenalty?.(state, u, discountCtx)) waivePenalty = true
    }
  }
  if (waivePenalty) penalty = 0
  // "Your next unit …" cost grants that match this card — Mouse Droid's −1 to the next Imperial.
  const grantDelta = (p.nextUnitGrants ?? []).reduce((sum, g) => sum + (nextUnitGrantMatches(card, g) ? (g.costDelta ?? 0) : 0), 0)
  return Math.max(0, card.cost + penalty + modifier + grantDelta + discount)
}

/**
 * Hand units `owner` can afford to play via an ability: each unit card whose effective cost
 * (plus `costDelta`, floored at 0) fits the ready resources left after `extraResourceCost` (the
 * ability's own C=… cost). Used both to gate the ability (`usable`) and to build the play choice.
 */
/** Distinct names of playable cards in the game (either deck) — the nameable set for Ryder Azadi. */
export function nameableCardNames(state: GameState): string[] {
  const names = new Set<string>()
  for (const card of Object.values(state.cards)) {
    if (card && (card.type === 'unit' || card.type === 'event' || card.type === 'upgrade')) names.add(card.name)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Card names the opponent has forbidden us from playing via a Ryder Azadi they control. */
export function namedByOpponent(state: GameState, playerId: PlayerId): Set<string> {
  return new Set(state.players[opponentOf(playerId)].units.flatMap(u => (u.namedCard ? [u.namedCard] : [])))
}

export function affordableHandUnits(state: GameState, owner: PlayerId, extraResourceCost: number, costDelta: number): HandCardRef[] {
  const p = state.players[owner]
  const budget = readyResourceCount(p) - extraResourceCost
  const out: HandCardRef[] = []
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (card?.type !== 'unit') return
    if (Math.max(0, effectiveCost(state, owner, card) + costDelta) <= budget) out.push({ handIndex, cardId })
  })
  return out
}

/**
 * Valid targets for playing the resource upgrade at `resourceIndex`: units from `targetUnits`
 * that pass the upgrade's attach restriction and — when `payCost` — are affordable from the ready
 * resources left after the upgrade itself leaves the resource pool.
 */
export function validUpgradeTargets(state: GameState, owner: PlayerId, resourceIndex: number, cardId: string, payCost: boolean, targetUnits: string[]): string[] {
  const p = state.players[owner]
  const resource = p.resources[resourceIndex]
  const card = state.cards[cardId]
  if (!resource || resource.cardId !== cardId || card?.type !== 'upgrade') return []
  const available = readyResourceCount(p) - (resource.exhausted ? 0 : 1)
  const restriction = getCardDefinition(cardId)?.attachRestriction
  const inPlay = [...state.players.player.units, ...state.players.opponent.units]
  return targetUnits.filter(id => {
    const tu = inPlay.find(u => u.instanceId === id)
    if (!tu || (restriction && !restriction(state, tu))) return false
    return !payCost || effectiveCost(state, owner, card, tu) <= available
  })
}

/** Upgrades in `owner`'s resource zone that can be played on at least one of `targetUnits`. */
export function resourceUpgradeCandidates(state: GameState, owner: PlayerId, payCost: boolean, targetUnits: string[]): ResourceUpgradeRef[] {
  const out: ResourceUpgradeRef[] = []
  state.players[owner].resources.forEach((r, resourceIndex) => {
    if (state.cards[r.cardId]?.type !== 'upgrade') return
    if (validUpgradeTargets(state, owner, resourceIndex, r.cardId, payCost, targetUnits).length > 0) out.push({ resourceIndex, cardId: r.cardId })
  })
  return out
}

/**
 * Legal move generator — every action the active player may take.
 * The single source of truth for legality: the resolver applies actions
 * produced here without re-validating game rules.
 */
export function legalMoves(state: GameState): Action[] {
  if (state.winner !== null) return []

  switch (state.phase) {
    case 'setup':
      return setupMoves(state)
    case 'action':
      return actionPhaseMoves(state)
    case 'regroup':
      return regroupPhaseMoves(state)
  }
}

function setupMoves(state: GameState): Action[] {
  // CR 5.2.1e: first, each player decides whether to take their one mulligan.
  if (state.setupStage === 'mulligan') {
    return [{ type: 'mulligan' }, { type: 'keepHand' }]
  }
  // CR 5.2.1f: then each player resources two cards, one pick at a time.
  return state.players[state.activePlayer].hand.map(
    (_, handIndex): Action => ({ type: 'setupResource', handIndex }),
  )
}

function actionPhaseMoves(state: GameState): Action[] {
  // A pending choice (Ambush/Support/pay-or-exhaust …) overrides the normal moves.
  if (hasPendingChoices(state)) return choiceMoves(state)

  const moves: Action[] = []
  const playerId = state.activePlayer
  const p = state.players[playerId]
  const enemy = state.players[opponentOf(playerId)]

  // A Ryder Azadi the opponent controls forbids us from playing cards with the named names.
  const forbiddenNames = namedByOpponent(state, playerId)

  // Play a card from hand — units only; upgrades have their own action, events aren't modelled
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (!card || card.type !== 'unit') return
    if (forbiddenNames.has(card.name)) return
    if (canAfford(p, effectiveCost(state, playerId, card))) {
      moves.push({ type: 'playCard', handIndex })
    }
  })

  // Play an Upgrade — attach to any unit in play (either player's) by default; a
  // card's attachRestriction narrows that, and its cost may depend on the target
  //.
  const allUnits = [...p.units, ...enemy.units]
  p.hand.forEach((cardId, handIndex) => {
    const card = state.cards[cardId]
    if (!card || card.type !== 'upgrade') return
    if (forbiddenNames.has(card.name)) return
    const restriction = getCardDefinition(card.id)?.attachRestriction
    for (const target of allUnits) {
      if (restriction && !restriction(state, target)) continue
      if (!canAfford(p, effectiveCost(state, playerId, card, target))) continue
      moves.push({ type: 'playUpgrade', handIndex, targetInstanceId: target.instanceId })
    }
  })

  // Attack With a Unit — ready units; targets are enemy units in the same
  // arena, or the enemy base (CR 1.15.3, 3.2.3). Sentinel forces the attack
  // onto a Sentinel unit in that arena — even the base is off-limits — unless
  // the attacker has Saboteur (CR 6.3.2b).
  for (const unit of p.units) {
    if (unit.exhausted) continue

    const { targets, sentinelLocked } = enemyAttackTargets(state, unit)
    for (const enemyUnit of targets) {
      moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'unit', instanceId: enemyUnit.instanceId } })
    }
    if (!sentinelLocked && !unitCannotAttackBases(state, unit)) {
      moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'base' } })
    }
  }

  // Deploy Leader — epic action; requires CONTROLLING resources equal to the leader's
  // cost (CR 2.6.1 — controlled, not spent; exhausted ones count), unless the leader
  // supplies a custom deploy condition (e.g. Bo-Katan).
  const leaderCard = state.cards[p.leader.cardId]
  if (leaderCard && !p.leader.deployed && !p.leader.epicActionUsed) {
    const condition = getCardDefinition(p.leader.cardId)?.deployCondition
    const canDeploy = condition ? condition(state, playerId) : p.resources.length >= leaderCard.cost
    if (canDeploy) moves.push({ type: 'deployLeader' })
  }

  // Use a unit's activated "Action:" ability — e.g. Improvised Identity. Each
  // is addressed by its source card + index; once-per-round ones drop once used.
  for (const u of p.units) {
    for (const { cardId, index, ability } of unitActionAbilities(u)) {
      if (ability.oncePerRound && u.usedAbilities?.includes(actionAbilityKey(cardId, index))) continue
      if (ability.exhaustCost && u.exhausted) continue // "[Exhaust]" — the unit must be ready to pay it
      if (!canAfford(p, ability.cost ?? 0)) continue
      if (ability.usable && !ability.usable(state, u)) continue
      moves.push({ type: 'useAbility', instanceId: u.instanceId, cardId, index })
    }
  }

  // Use an undeployed leader's activated "Action:" ability. A targeted ability
  // yields one move per valid target (none = not usable); a target-less one is gated by
  // `usable` and affordability.
  if (!p.leader.deployed && !p.leader.exhausted) {
    leaderActions(p.leader.cardId).forEach((ability, index) => {
      if (!canAfford(p, ability.cost ?? 0)) return
      if (ability.targets) {
        for (const targetInstanceId of ability.targets(state, playerId)) {
          moves.push({ type: 'useLeaderAbility', index, targetInstanceId })
        }
      } else if (!ability.usable || ability.usable(state, playerId)) {
        moves.push({ type: 'useLeaderAbility', index })
      }
    })
  }

  // Take the Initiative — once per round across both players (CR 1.15.5a).
  if (state.initiativeTakenBy === null) {
    moves.push({ type: 'takeInitiative' })
  }

  moves.push({ type: 'pass' })
  return moves
}

/**
 * Moves while choices are pending. The active player resolves their own
 * simultaneous choices in any order (each is addressable by id, honouring active-player
 * trigger ordering). Ambush: the played unit may attack an enemy unit (never the base).
 * Support: any OTHER ready unit may attack (unit or base), gaining the support unit's
 * keywords. Pay-or-exhaust (The Conflict Within): pay if affordable, or decline. Any
 * choice can be skipped.
 */
function choiceMoves(state: GameState): Action[] {
  const p = state.players[state.activePlayer]
  const moves: Action[] = []

  for (const choice of state.pendingChoices ?? []) {
    if (choice.controller !== state.activePlayer) continue
    switch (choice.kind) {
      case 'ambush': {
        const unit = p.units.find(u => u.instanceId === choice.unitId)
        if (unit) {
          for (const e of enemyAttackTargets(state, unit).targets) {
            moves.push({ type: 'attack', attackerId: unit.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          }
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'support': {
        // The chosen attacker gains the Support source's full abilities for the attack, so
        // its granted keywords (Saboteur, Sentinel-ignoring…) shape the legal targets here too.
        const sourceCardId = p.units.find(u => u.instanceId === choice.unitId)?.cardId
        for (const candidate of p.units) {
          if (candidate.exhausted || candidate.instanceId === choice.unitId) continue
          const attacker = sourceCardId ? { ...candidate, grantedAbilityCardIds: [sourceCardId] } : candidate
          const { targets, sentinelLocked } = enemyAttackTargets(state, attacker)
          for (const e of targets) {
            moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          }
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: candidate.instanceId, target: { kind: 'base' } })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'payOrExhaust': {
        if (readyResourceCount(p) >= choice.cost) moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPlayTopFree': {
        // The card is always revealed (a "look at"); it can only be PLAYED free if it costs
        // ≤ 2. A unit/event needs no target; an upgrade offers one accept per valid attach
        // target (like playUpgrade).
        const top = state.cards[choice.cardId]
        if (top && top.cost <= 2) {
          if (top.type === 'upgrade') {
            const restriction = getCardDefinition(top.id)?.attachRestriction
            for (const t of [...state.players.player.units, ...state.players.opponent.units]) {
              if (restriction && !restriction(state, t)) continue
              moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: t.instanceId })
            }
          } else {
            moves.push({ type: 'acceptChoice', choiceId: choice.id })
          }
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDamageExhaust': {
        // DDC Defender: pick any unit in this unit's arena to deal 1 + exhaust, or decline.
        for (const t of [...state.players.player.units, ...state.players.opponent.units]) {
          if (t.arena === choice.arena) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: t.instanceId })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'search': {
        // Improvised Identity: pick which revealed ground unit to discard (mandatory —
        // the choice is only raised when at least one is present).
        choice.revealed.forEach((cid, i) => {
          const c = state.cards[cid]
          if (c?.type === 'unit' && c.arena === 'ground') moves.push({ type: 'acceptChoice', choiceId: choice.id, deckIndex: i })
        })
        break
      }
      case 'mayAdvantageEach':
      case 'mayLastingBuff':
      case 'mayGiveAdvantage':
      case 'mayExhaustLeaderGiveAdvantage':
      case 'mayExhaustLeaderExhaustUnit':
      case 'mayExhaustUnit':
      case 'multiPick': {
        // Optional targeted effects: pick an eligible target, or decline / finish.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDamage':
      case 'mayGiveTokens': {
        // Targeted damage / token grant: a decline is offered unless the effect is
        // mandatory (`optional: false`, e.g. Snub Fighter Squadron's "Deal 1 to a space unit").
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        if (choice.optional !== false) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'chooseOne': {
        // Choose-one/modal: one move per option, no decline (mandatory).
        choice.options.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        break
      }
      case 'selectUpgradeToDefeat': {
        // Vane: pick a candidate upgrade to defeat; Cancel only on the optional (deployed) form.
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectFromDiscard': {
        // Moff Gideon: pick a candidate discard card to return, or decline (optional).
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectDamageTarget':
      case 'selectHealTarget': {
        // Deal/heal N to a chosen unit or base — mandatory unless `optional` (Nebulon-C's "may heal").
        for (const id of choice.unitTargets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        for (const bp of choice.baseTargets) moves.push({ type: 'acceptChoice', choiceId: choice.id, baseTarget: bp })
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayExhaustLeaderHealUnit': {
        // Luke front: a yes/no — the healed unit is fixed (the attacker).
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'playUnitFromHand': {
        // Play a chosen hand unit — one move per affordable candidate. Optional for a "may" (Crix Madine).
        for (const { handIndex } of choice.candidates) moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex })
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectUnitToExhaust': {
        // Fennec's "exhaust a friendly unit" additional cost — pick one. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'selectResourceUpgrade': {
        // The Armorer: pick a resource upgrade to play; Cancel only on the optional (deployed) form.
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'attachResourceUpgrade': {
        // Attach the chosen resource upgrade to a valid unit. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'mayExhaustLeaderForAdvantage': {
        // Greef Karga front: a yes/no — the target unit is fixed.
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPayToDraw': {
        // Mandalorian: a yes/no — accept only if the cost is affordable.
        if (readyResourceCount(p) >= choice.cost) moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectDiscard': {
        // Mos Espa Watermonger: discard a card from hand — any hand card is eligible.
        p.hand.forEach((_, handIndex) => moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex }))
        if (choice.optional) moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'distributeDamage': {
        // Ninth Sister: allocate a point to any eligible unit, or stop (Done) — always optional.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'distributeTokens': {
        // Helgait: allocate a token to any friendly unit, or stop (Done) — always optional.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'dealOwnBaseForDiscount': {
        // Enoch: deal one more to your base (up to `max`), or stop (Done).
        if (choice.dealt < choice.max) moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDoubleTokens':
      case 'maySelfDamageHealBase':
      case 'mayExhaustLeaderBuffSelf': {
        // Leia / Mando's N-1: a yes/no.
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'returnFriendlyUnit': {
        // Purrgil Ultra: return a chosen friendly unit, or decline (optional).
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'peekTopDiscard': {
        // Reanimated Night Trooper: discard the top of a chosen deck (with cards), or decline.
        for (const deck of choice.decks) if (state.players[deck].deck.length > 0) moves.push({ type: 'acceptChoice', choiceId: choice.id, baseTarget: deck })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'lookAtHand': {
        // Imperial Defector / Remnant Lookouts: view the target's hand. With `mayDiscard`,
        // one accept per card in it; always a Done to dismiss.
        if (choice.mayDiscard) state.players[choice.target].hand.forEach((_, handIndex) => moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex }))
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'searchDraw': {
        // Clan Wren Loyalist: draw one of the trait-matching revealed cards. Mandatory (a match exists).
        for (const deckIndex of choice.eligibleIndices) moves.push({ type: 'acceptChoice', choiceId: choice.id, deckIndex })
        break
      }
      case 'mayDefeatSelfSearch': {
        // Admiral Ackbar: a yes/no — defeat this unit to search, or decline.
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'variableStrike': {
        // The Cyborg Mech: pick a ground unit to strike. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'healForAdvantage': {
        // Barriss Offee: pick a damaged unit to heal, or decline (optional).
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'nameCard': {
        // Ryder Azadi: name any card. The nameable set is the cards in play (both decks) — the
        // UI filters it by typing; the AI just picks one. Mandatory.
        for (const name of nameableCardNames(state)) moves.push({ type: 'acceptChoice', choiceId: choice.id, cardName: name })
        break
      }
      case 'searchPlayFree': {
        // Admiral Ackbar: play one eligible revealed space unit, or stop (Done).
        for (const deckIndex of choice.eligibleIndices) moves.push({ type: 'acceptChoice', choiceId: choice.id, deckIndex })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      // A yes/no with no target to pick: Grogu's triggered deploy, and Cobb Vanth /
      // Gar Saxon.
      case 'chooseDiscardFate': {
        // Trask Walker: bottom-and-heal, or take it to hand. Mandatory.
        moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: 0 })
        moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: 1 })
        break
      }
      case 'selectPairToDefeat': {
        // Chimaera: friendly first, then the enemy half.
        const stage = choice.chosenFriendly === undefined ? choice.friendlyTargets : choice.enemyTargets
        for (const id of stage) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectUpgradeToReturn': {
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPlayUpgradeFree': {
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayPayExhaustArena': {
        // Jod Na Nawood: ground or space, or decline. Only if the cost is affordable.
        if (canAfford(p, choice.cost)) {
          moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: 0 })
          moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: 1 })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'revealUnitFromHand': {
        for (const handIndex of choice.handIndices) moves.push({ type: 'acceptChoice', choiceId: choice.id, handIndex })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'damageAnyBases': {
        // Rancor Keeper: pick a base still to be hit, or stop.
        for (const b of choice.remaining) moves.push({ type: 'acceptChoice', choiceId: choice.id, baseTarget: b })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'mayDeployLeader':
      case 'maySelfDamageShield':
      case 'mayCapture':
      case 'mayPreventDamage':
      case 'mayCreateToken': {
        // Grogu: a yes/no to deploy via the triggered epic action.
        moves.push({ type: 'acceptChoice', choiceId: choice.id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'selectUniqueToDefeat': {
        // Unique rule: pick which duplicate to defeat. Mandatory (must reduce to one).
        choice.candidates.forEach((_, i) => moves.push({ type: 'acceptChoice', choiceId: choice.id, optionIndex: i }))
        break
      }
      case 'selectUniqueUnitToDefeat': {
        // Unique unit rule: pick which duplicate unit to defeat (board target). Mandatory.
        for (const id of choice.candidates) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'mayAttackAnyUnit': {
        // Thrawn front: attack with any ready unit (the Restore grant is applied on resolve).
        for (const u of p.units) {
          if (u.exhausted) continue
          const { targets, sentinelLocked } = enemyAttackTargets(state, u)
          for (const e of targets) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'base' } })
        }
        break
      }
      case 'mayDefeatEnemyUnit': {
        // Thrawn deployed: pick a non-leader enemy unit to defeat, or decline.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
      case 'opponentGivesAdvantage': {
        // Sabine front: the opponent picks which of their units gets the Advantage tokens. Mandatory.
        for (const id of choice.targets) moves.push({ type: 'acceptChoice', choiceId: choice.id, targetInstanceId: id })
        break
      }
      case 'mayAttack': {
        // Improvised Identity's optional follow-up attack, with the discarded unit's
        // abilities granted (so granted Saboteur etc. shape the legal targets).
        const u = p.units.find(x => x.instanceId === choice.unitId)
        if (u && !u.exhausted) {
          const attacker = choice.grantCardId ? { ...u, grantedAbilityCardIds: [choice.grantCardId] } : u
          const { targets, sentinelLocked } = enemyAttackTargets(state, attacker)
          for (const e of targets) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'unit', instanceId: e.instanceId } })
          if (!sentinelLocked) moves.push({ type: 'attack', attackerId: u.instanceId, target: { kind: 'base' } })
        }
        moves.push({ type: 'skipTrigger', choiceId: choice.id })
        break
      }
    }
  }
  return moves
}

function regroupPhaseMoves(state: GameState): Action[] {
  // A "when the regroup phase starts" ability may raise a choice (Alphabet Squadron U-Wing);
  // it must be answerable here, or the phase deadlocks with no legal move.
  if (hasPendingChoices(state)) return choiceMoves(state)
  if (state.regroupResourced[state.activePlayer]) return []

  const moves: Action[] = state.players[state.activePlayer].hand.map(
    (_, handIndex): Action => ({ type: 'resourceCard', handIndex }),
  )
  moves.push({ type: 'skipResource' })
  return moves
}

// Re-exported for callers that only need affordability checks.
export { readyResourceCount }
