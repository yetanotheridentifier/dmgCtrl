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
      if (choice.kind === 'distributeDamage' || choice.kind === 'lookAtHand' || choice.kind === 'searchPlayFree') return 'Done'
      if (choice.kind === 'playUnitFromHand') return "Don't play"
      if (choice.kind === 'mayDefeatSelfSearch') return "Don't"
      if (choice.kind === 'mayDamage' || choice.kind === 'mayAdvantageEach' || choice.kind === 'mayDefeatEnemyUnit' || choice.kind === 'selectDiscard') return 'Decline'
      if (choice.kind === 'selectUpgradeToDefeat' || choice.kind === 'selectResourceUpgrade') return 'Cancel'
      if (choice.kind === 'mayLastingBuff' || choice.kind === 'mayGiveAdvantage' || choice.kind === 'mayExhaustLeaderGiveAdvantage' || choice.kind === 'mayExhaustLeaderExhaustUnit' || choice.kind === 'mayExhaustUnit') return 'Decline'
      if (choice.kind === 'mayExhaustLeaderForAdvantage' || choice.kind === 'mayExhaustLeaderHealUnit' || choice.kind === 'mayPayToDraw' || choice.kind === 'mayDeployLeader') return "Don't"
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
      if (choice.kind === 'searchDraw' && action.deckIndex !== undefined) {
        const cardId = choice.revealed[action.deckIndex]
        return `Draw ${cardId ? state.cards[cardId]?.name ?? cardId : 'card'}`
      }
      if (choice.kind === 'variableStrike') {
        const found = action.targetInstanceId ? [...state.players.player.units, ...state.players.opponent.units].find(u => u.instanceId === action.targetInstanceId) : undefined
        const amount = found && found.damage > 0 ? choice.damagedAmount : choice.undamagedAmount
        return `Deal ${amount}${found ? ` to ${anyUnitName(state, found.instanceId)}` : ''}`
      }
      if (choice.kind === 'healForAdvantage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Heal${target ? ` ${target}` : ''}`
      }
      if (choice.kind === 'nameCard') return `Name ${action.cardName ?? 'a card'}`
      if (choice.kind === 'mayDefeatSelfSearch') return `Defeat ${anyUnitName(state, choice.unitId) ?? 'this unit'} & search`
      if (choice.kind === 'searchPlayFree' && action.deckIndex !== undefined) {
        const cardId = choice.revealed[action.deckIndex]
        return `Play ${cardId ? state.cards[cardId]?.name ?? cardId : 'card'} free`
      }
      if (choice.kind === 'mayDamage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Deal ${choice.amount}${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'mayAdvantageEach') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Advantage${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'selectUpgradeToDefeat') {
        const pick = choice.candidates[action.optionIndex ?? 0]
        const name = pick ? state.cards[pick.cardId]?.name ?? pick.cardId : 'upgrade'
        return `Defeat ${name}`
      }
      if (choice.kind === 'selectDamageTarget') {
        if (action.baseTarget) return `Deal ${choice.amount} to ${action.baseTarget === by ? 'your base' : "opponent's base"}`
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Deal ${choice.amount} to ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectHealTarget') {
        if (action.baseTarget) return `Heal ${choice.amount} from ${action.baseTarget === by ? 'your base' : "opponent's base"}`
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Heal ${choice.amount} from ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayExhaustLeaderHealUnit') return `Exhaust leader → heal ${choice.amount} from ${anyUnitName(state, choice.unitId) ?? 'unit'}`
      if (choice.kind === 'playUnitFromHand') {
        const cardId = action.handIndex !== undefined ? state.players[by].hand[action.handIndex] : undefined
        return `Play ${cardId ? state.cards[cardId]?.name ?? cardId : 'unit'}`
      }
      if (choice.kind === 'selectUnitToExhaust') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Exhaust ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectResourceUpgrade') {
        const pick = choice.candidates[action.optionIndex ?? 0]
        return `Play ${pick ? state.cards[pick.cardId]?.name ?? pick.cardId : 'upgrade'}`
      }
      if (choice.kind === 'attachResourceUpgrade') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Attach ${state.cards[choice.cardId]?.name ?? choice.cardId} to ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectDiscard') {
        const cardId = action.handIndex !== undefined ? state.players[by].hand[action.handIndex] : undefined
        return `Discard ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
      }
      if (choice.kind === 'distributeDamage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Deal 1${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'lookAtHand') {
        const cardId = action.handIndex !== undefined ? state.players[choice.target].hand[action.handIndex] : undefined
        return `Discard ${cardId ? state.cards[cardId]?.name ?? cardId : 'a card'}`
      }
      if (choice.kind === 'mayExhaustLeaderForAdvantage') return `Exhaust leader → Advantage to ${anyUnitName(state, choice.unitId) ?? 'unit'}`
      if (choice.kind === 'mayPayToDraw') {
        const cards = choice.draw === 1 ? 'a card' : `${choice.draw} cards`
        return choice.cost > 0 ? `Pay ${choice.cost}, draw ${cards}` : `Draw ${cards}`
      }
      if (choice.kind === 'mayDeployLeader') return `Deploy ${state.cards[state.players[by].leader.cardId]?.name ?? 'leader'}`
      if (choice.kind === 'mayDefeatEnemyUnit') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Defeat ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectUniqueToDefeat') {
        const pick = choice.candidates[action.optionIndex ?? 0]
        const host = pick ? anyUnitName(state, pick.unitId) : undefined
        return `Defeat the copy${host ? ` on ${host}` : ''}`
      }
      if (choice.kind === 'selectUniqueUnitToDefeat') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Defeat ${target ?? 'the duplicate'}`
      }
      if (choice.kind === 'opponentGivesAdvantage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `${choice.count} Advantage to ${target ?? 'unit'}`
      }
      if (choice.kind === 'multiPick') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return choice.spec.mode === 'defeatForToken' ? `Defeat ${target ?? 'unit'}` : `Advantage to ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayGiveTokens') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        const tokenName = state.cards[choice.token]?.name ?? 'token'
        return `${choice.count > 1 ? `${choice.count} ` : ''}${tokenName}${choice.count > 1 ? 's' : ''} to ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayLastingBuff') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        const buff = [choice.power || choice.hp ? `+${choice.power ?? 0}/+${choice.hp ?? 0}` : '', ...(choice.keywords ?? []).map(k => k.name)].filter(Boolean).join(' & ')
        return `Give ${target ?? 'unit'} ${buff} this phase`
      }
      if (choice.kind === 'mayGiveAdvantage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Advantage${target ? ` to ${target}` : ''}`
      }
      if (choice.kind === 'mayExhaustLeaderGiveAdvantage') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Exhaust leader → Advantage to ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayExhaustLeaderExhaustUnit') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Exhaust leader → exhaust ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayExhaustUnit') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Exhaust ${target ?? 'unit'}`
      }
      if (choice.kind === 'chooseOne') return choice.options[action.optionIndex ?? 0]?.label ?? 'Choose'
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
