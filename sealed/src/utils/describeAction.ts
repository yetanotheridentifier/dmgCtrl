import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectiveCost } from '../engine/legalMoves'

function unitName(state: GameState, owner: PlayerId, instanceId: string): string {
  const unit = state.players[owner].units.find(u => u.instanceId === instanceId)
  return unit ? state.cards[unit.cardId]?.name ?? unit.cardId : instanceId
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
    case 'attack': {
      const attacker = unitName(state, by, action.attackerId)
      if (action.target.kind === 'base') return `Attack base with ${attacker}`
      return `Attack ${unitName(state, opponentOf(by), action.target.instanceId)} with ${attacker}`
    }
    case 'deployLeader': {
      const name = state.cards[state.players[by].leader.cardId]?.name ?? 'leader'
      return `Deploy ${name}`
    }
    case 'takeInitiative':
      return 'Take the initiative'
    case 'pass':
      return 'Pass'
    case 'resourceCard': {
      if (opts.redact) return 'Resource a card (facedown)'
      const cardId = state.players[by].hand[action.handIndex]
      return `Resource ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
    }
    case 'skipResource':
      return 'Skip resourcing'
    case 'mulligan':
      return 'Mulligan (redraw 6)'
    case 'keepHand':
      return 'Keep hand'
    case 'setupResource': {
      if (opts.redact) return 'Resource a card (facedown)'
      const cardId = state.players[by].hand[action.handIndex]
      return `Resource ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
    }
  }
}
