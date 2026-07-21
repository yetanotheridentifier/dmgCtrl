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

/**
 * A described action, in pieces: plain text, or a reference to a specific card. The log and the
 * action prompt render card references as hover-to-zoom, colour-coded by who controls the card
 * — which needs the card's identity, and that is exactly what a flat string throws away (card
 * names are not unique: 13 unit names collide with leader names).
 */
export type DescribePart = string | { cardId: string; controller: PlayerId; text: string }

/** The plain-text form of a described action — the join of its parts. */
export function partsText(parts: DescribePart[]): string {
  return parts.map(p => (typeof p === 'string' ? p : p.text)).join('')
}

function unitRef(state: GameState, instanceId: string): DescribePart | undefined {
  for (const controller of ['player', 'opponent'] as PlayerId[]) {
    const u = state.players[controller].units.find(u => u.instanceId === instanceId)
    if (u) return { cardId: u.cardId, controller, text: state.cards[u.cardId]?.name ?? u.cardId }
  }
  return undefined
}

/** A reference to a card in hand, for describing an action that is still being composed. */
export function handCardRef(state: GameState, owner: PlayerId, handIndex: number): DescribePart | undefined {
  const cardId = state.players[owner].hand[handIndex]
  if (!cardId) return undefined
  return { cardId, controller: owner, text: state.cards[cardId]?.name ?? cardId }
}

/**
 * The tokenised form of `describeAction`. Branches that carry a card identity emit a reference;
 * everything else falls back to the plain string, so an un-converted action renders as text
 * rather than breaking. `partsText(describeActionParts(…)) === describeAction(…)` always holds
 * (pinned by test), which is what makes that fallback safe.
 */
export function describeActionParts(state: GameState, by: PlayerId, action: Action, opts: DescribeOptions = {}): DescribePart[] {
  const plain = () => [describeAction(state, by, action, opts)]

  switch (action.type) {
    case 'playUnit':
    case 'playEvent': {
      const ref = handCardRef(state, by, action.handIndex)
      const card = state.cards[state.players[by].hand[action.handIndex]]
      if (!ref || !card) return plain()
      return ['Play ', ref, ` (${effectiveCost(state, by, card)})`]
    }
    case 'playUpgrade': {
      const ref = handCardRef(state, by, action.handIndex)
      const card = state.cards[state.players[by].hand[action.handIndex]]
      if (!ref || !card) return plain()
      const targetUnit = [...state.players.player.units, ...state.players.opponent.units].find(u => u.instanceId === action.targetInstanceId)
      const target = unitRef(state, action.targetInstanceId)
      return ['Play ', ref, ` (${effectiveCost(state, by, card, targetUnit)})`, ...(target ? [' on ', target] : [])]
    }
    case 'attack': {
      const attacker = unitRef(state, action.attackerId)
      if (!attacker) return plain()
      if (action.target.kind === 'base') return ['Attack base with ', attacker]
      const defender = unitRef(state, action.target.instanceId)
      return defender ? ['Attack ', defender, ' with ', attacker] : plain()
    }
    case 'deployLeader': {
      const cardId = state.players[by].leader.cardId
      const name = state.cards[cardId]?.name
      return name ? ['Deploy ', { cardId, controller: by, text: name }] : plain()
    }
    case 'resourceCard':
    case 'setupResource': {
      // Redacted picks stay plain: a card token would leak the identity through the zoom.
      if (opts.redact) return plain()
      const ref = handCardRef(state, by, action.handIndex)
      return ref ? ['Resource ', ref] : plain()
    }
    default:
      return plain()
  }
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
    case 'playUnit':
    case 'playEvent': {
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
      if (choice.kind === 'distributeDamage' || choice.kind === 'distributeTokens' || choice.kind === 'lookAtHand' || choice.kind === 'searchPlayFree' || choice.kind === 'dealOwnBaseForDiscount') return 'Done'
      if (choice.kind === 'mayDoubleTokens') return "Don't"
      if (choice.kind === 'returnFriendlyUnit' || choice.kind === 'peekTopDiscard' || choice.kind === 'maySelfDamageHealBase' || choice.kind === 'mayExhaustLeaderBuffSelf') return "Don't"
      if (choice.kind === 'playUnitFromHand') return "Don't play"
      if (choice.kind === 'mayDefeatSelfSearch') return "Don't"
      if (choice.kind === 'mayDamage' || choice.kind === 'mayAdvantageEach' || choice.kind === 'selectUnitToDefeat' || choice.kind === 'selectDiscard') return 'Decline'
      if (choice.kind === 'selectUpgradeToDefeat' || choice.kind === 'selectResourceUpgrade' || choice.kind === 'selectFromDiscard') return 'Cancel'
      if (choice.kind === 'mayLastingBuff' || choice.kind === 'mayGiveAdvantage' || choice.kind === 'mayExhaustLeaderGiveAdvantage' || choice.kind === 'mayExhaustLeaderExhaustUnit' || choice.kind === 'mayExhaustUnit') return 'Decline'
      if (choice.kind === 'mayExhaustLeaderForAdvantage' || choice.kind === 'mayExhaustLeaderHealUnit' || choice.kind === 'mayPayToDraw' || choice.kind === 'mayDeployLeader') return "Don't"
      if (choice.kind === 'maySelfDamageShield' || choice.kind === 'mayCreateToken' || choice.kind === 'mayCapture') return "Don't"
      if (choice.kind === 'damageAnyBases') return 'Done'
      if (choice.kind === 'selectPair' || choice.kind === 'selectUpgradeToReturn' || choice.kind === 'mayPlayUpgradeFree') return 'Decline'
      if (choice.kind === 'mayPayExhaustArena' || choice.kind === 'revealUnitFromHand') return "Don't"
      if (choice.kind === 'mayPlayUnitFromDiscard') return "Don't play"
      // Named rather than left to the generic decline: a played unit can raise several choices at
      // once, and identical buttons make it unclear which one you are turning down.
      if (choice.kind === 'support') return 'Decline support'
      if (choice.kind === 'ambush') return "Don't ambush"
      // Never fall through to the kind's internal name: "Skip mayPlayUnitFromDiscard" reached
      // players (#379/#380). An unlabelled decline is still a decline.
      return 'Decline'
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
      if (choice.kind === 'mayDoubleTokens') return `Defeat ${anyUnitName(state, choice.unitId) ?? 'this unit'} \u2192 ${choice.count} more`
      if (choice.kind === 'dealOwnBaseForDiscount') return 'Deal 1 to your base'
      if (choice.kind === 'maySelfDamageHealBase') return `Deal ${choice.selfDamage} to self, heal ${choice.healBase}`
      if (choice.kind === 'mayExhaustLeaderBuffSelf') return `Exhaust leader → +${choice.power}/+${choice.hp}`
      if (choice.kind === 'returnFriendlyUnit') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Return ${target ?? 'unit'} to hand`
      }
      if (choice.kind === 'peekTopDiscard' && action.baseTarget) {
        const top = state.players[action.baseTarget].deck[0]
        const name = top ? state.cards[top]?.name ?? top : 'card'
        return `Discard ${name} (${action.baseTarget === by ? 'your' : "opponent's"} deck)`
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
      if (choice.kind === 'selectFromDiscard') {
        const cardId = choice.candidates[action.optionIndex ?? 0]
        return `Return ${cardId ? state.cards[cardId]?.name ?? cardId : 'card'}`
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
      if (choice.kind === 'distributeTokens') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        const tokenName = state.cards[choice.token]?.name ?? 'token'
        return `${tokenName}${target ? ` to ${target}` : ''}`
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
      if (choice.kind === 'maySelfDamageShield') {
        const self = anyUnitName(state, choice.selfId)
        const target = anyUnitName(state, choice.targetId)
        return `${choice.amount} damage to ${self ?? 'this unit'} → Shield to ${target ?? 'it'}`
      }
      if (choice.kind === 'damageAnyBases' && action.baseTarget) {
        return `Deal ${choice.amount} to ${action.baseTarget === by ? 'your base' : "opponent's base"}`
      }
      if (choice.kind === 'chooseDiscardFate') {
        const name = state.cards[choice.cardId]?.name ?? 'card'
        return (action.optionIndex ?? 0) === 0 ? `Bottom ${name}, heal ${choice.heal}` : `Return ${name} to hand`
      }
      if (choice.kind === 'selectPair') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return choice.chosenFriendly === undefined ? `Sacrifice ${target ?? 'unit'}` : `Defeat ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectUpgradeToReturn') {
        const pick = choice.candidates[action.optionIndex ?? 0]
        const name = pick ? state.cards[pick.cardId]?.name : undefined
        const host = pick ? anyUnitName(state, pick.unitId) : undefined
        return `Return ${name ?? 'upgrade'}${host ? ` from ${host}` : ''}`
      }
      if (choice.kind === 'mayPlayUpgradeFree') {
        const name = state.cards[choice.cardId]?.name ?? 'upgrade'
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Play ${name} free on ${target ?? 'unit'}`
      }
      if (choice.kind === 'mayPayExhaustArena') {
        return `Pay ${choice.cost}, exhaust ${(action.optionIndex ?? 0) === 0 ? 'ground' : 'space'}`
      }
      if (choice.kind === 'revealUnitFromHand' && action.handIndex !== undefined) {
        const cardId = state.players[by].hand[action.handIndex]
        return `Reveal ${state.cards[cardId]?.name ?? 'card'}`
      }
      if (choice.kind === 'mayCapture') return `Capture ${state.cards[choice.cardId]?.name ?? 'card'}`
      if (choice.kind === 'mayCreateToken') {
        const tokenName = state.cards[choice.token]?.name ?? 'token'
        return `Create ${choice.count > 1 ? `${choice.count} ${tokenName}s` : `a ${tokenName}`}`
      }
      if (choice.kind === 'selectUnitToDefeat') {
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
        if (choice.spec.mode === 'defeatForToken') return `Defeat ${target ?? 'unit'}`
        if (choice.spec.mode === 'dealEach') return `Deal ${choice.spec.amount} to ${target ?? 'unit'}`
        return `Advantage to ${target ?? 'unit'}`
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
      // Choose Your Path: name the mode, not "Accept". The modes are engine keys, so they are
      // spelled out here rather than shown raw.
      if (choice.kind === 'chooseMode') {
        const mode = choice.modes[action.optionIndex ?? 0]
        if (mode === 'healBase') return 'Heal 5 from your base'
        if (mode === 'mandoToken') return 'Create a Mandalorian token'
        return 'Choose'
      }
      // Treacherous Minefield: two arenas, two buttons. Unlabelled they were both "Accept", which
      // read as one button per unit (#379).
      if (choice.kind === 'selectArenaToGrant') {
        return `Mine the ${(action.optionIndex ?? 0) === 0 ? 'ground' : 'space'} arena`
      }
      if (choice.kind === 'mayPlayUnitFromDiscard') {
        const cardId = choice.candidates[action.optionIndex ?? 0]
        return `Play ${cardId ? state.cards[cardId]?.name ?? cardId : 'unit'}`
      }
      if (choice.kind === 'chooseNumber') return `Choose ${action.optionIndex ?? 0}`
      if (choice.kind === 'selectUnitToSteal') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Take control of ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectUnitToReady') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Ready ${target ?? 'unit'}`
      }
      if (choice.kind === 'selectUnitToReturn') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Return ${target ?? 'unit'} to hand`
      }
      if (choice.kind === 'selectDistributeSource') {
        const target = action.targetInstanceId ? anyUnitName(state, action.targetInstanceId) : undefined
        return `Take from ${target ?? 'unit'}`
      }
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
