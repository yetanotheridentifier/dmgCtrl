import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'
import { opponentOf, activeChoice, findChoice } from '../engine/types'
import { effectiveCost } from '../engine/legalMoves'

function unitName(state: GameState, owner: PlayerId, instanceId: string): string {
  const unit = state.players[owner].units.find(u => u.instanceId === instanceId)
  return unit ? state.cards[unit.cardId]?.name ?? unit.cardId : instanceId
}

/** Name a unit by instance id, whichever player controls it (upgrade targets). */
function anyUnitName(state: GameState, instanceId: string): string | undefined {
  for (const id of ['player', 'opponent'] as PlayerId[]) {
    const u = state.players[id].units.find(u => u.instanceId === instanceId)
    if (u) return state.cards[u.cardId]?.name ?? u.cardId
  }
  return undefined
}

export interface DescribeOptions {
  /**
   * Hide hidden information (CR 1.17): which card an opponent resources is
   * private, so log entries for the other player's resource picks are redacted.
   */
  redact?: boolean
}

/** Human-readable action label — used by the action menu and the game log. */
export function describeAction(state: GameState, by: PlayerId, action: Action, opts: DescribeOptions = {}): string {
  switch (action.type) {
    case 'playCard': {
      const cardId = state.players[by].hand[action.handIndex]
      const card = cardId ? state.cards[cardId] : undefined
      if (!card) return 'Play a card'
      return `Play ${card.name} (${effectiveCost(state, by, card)})`
    }
    case 'playUpgrade': {
      const cardId = state.players[by].hand[action.handIndex]
      const card = cardId ? state.cards[cardId] : undefined
      if (!card) return 'Play an upgrade'
      const targetUnit = [...state.players.player.units, ...state.players.opponent.units].find(u => u.instanceId === action.targetInstanceId)
      const target = anyUnitName(state, action.targetInstanceId)
      return `Play ${card.name} (${effectiveCost(state, by, card, targetUnit)})${target ? ` on ${target}` : ''}`
    }
    case 'attack': {
      const attacker = unitName(state, by, action.attackerId)
      if (action.target.kind === 'base') return `Attack base with ${attacker}`
      return `Attack ${unitName(state, opponentOf(by), action.target.instanceId)} with ${attacker}`
    }
    case 'deployLeader': {
      const name = state.cards[state.players[by].leader.cardId]?.name ?? 'leader'
      return `Deploy ${name}`
    }
    case 'useAbility':
      return `Use ${state.cards[action.cardId]?.name ?? 'ability'}`
    case 'useLeaderAbility': {
      const name = state.cards[state.players[by].leader.cardId]?.name ?? 'leader'
      const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
      return `${name} ability${target ? ` → ${target}` : ''}`
    }
    case 'takeInitiative':
      return 'Take the initiative'
    case 'pass':
      return 'Pass'
    case 'skipTrigger': {
      const choice = action.choiceId ? findChoice(state, action.choiceId) : activeChoice(state)
      if (!choice) return 'Skip'
      if (choice.kind === 'payOrExhaust') return "Don't pay (exhaust)"
      if (choice.kind === 'mayPlayTopFree') return "Don't play"
      if (choice.kind === 'mayDamageExhaust') return 'Decline'
      if (choice.kind === 'mayAttack') return "Don't attack"
      if (choice.kind === 'mayDamage' || choice.kind === 'mayAdvantageEach' || choice.kind === 'mayDefeatUpgradeForBase') return 'Decline'
      if (choice.kind === 'mayExhaustLeaderForAdvantage') return "Don't"
      return `Skip ${choice.kind}`
    }
    case 'acceptChoice': {
      const choice = findChoice(state, action.choiceId)
      if (!choice) return 'Accept'
      if (choice.kind === 'payOrExhaust') return `Pay ${choice.cost}`
      if (choice.kind === 'mayPlayTopFree') {
        const name = state.cards[choice.cardId]?.name ?? 'card'
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Play ${name} free${target ? ` on ${target}` : ''}`
      }
      if (choice.kind === 'mayDamageExhaust') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Deal 1 & exhaust${target ? ` ${target}` : ''}`
      }
      if (choice.kind === 'search' && action.deckIndex !== undefined) {
        const cardId = choice.revealed[action.deckIndex]
        return `Discard ${cardId ? state.cards[cardId]?.name ?? cardId : 'card'}`
      }
      if (choice.kind === 'mayDamage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Deal ${choice.amount}${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'mayAdvantageEach') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Advantage${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'mayDefeatUpgradeForBase') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Defeat ${target ? `${target}'s ` : ''}upgrade → 2 to base`
      }
      if (choice.kind === 'mayExhaustLeaderForAdvantage') return `Exhaust leader → Advantage to ${anyUnitName(state, choice.unitId) ?? 'unit'}`
      return 'Accept'
    }
    case 'resourceCard': {
      if (opts.redact) return 'Resource a card'
      const cardId = state.players[by].hand[action.handIndex]
      return `Resource ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
    }
    case 'skipResource':
      return 'Skip resourcing'
    case 'mulligan':
      return 'Mulligan'
    case 'keepHand':
      return 'Keep hand'
    case 'setupResource': {
      if (opts.redact) return 'Resource a card'
      const cardId = state.players[by].hand[action.handIndex]
      return `Resource ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
    }
  }
}
