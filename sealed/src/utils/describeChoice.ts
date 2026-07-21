import type { GameState, PendingChoice, PlayerId } from '../engine/types'
import type { DescribePart } from './describeAction'

/**
 * Choice kinds resolved by clicking a highlighted card on the board rather than a menu button.
 * These are the ones that need a prompt: the highlight alone doesn't say what is being asked,
 * which is easy to misread when the choice was raised by the opponent's card (#370).
 *
 * Kept here rather than in the component so the prompt table and the board-highlight logic
 * can't drift apart.
 */
export const BOARD_TARGET_KINDS = [
  'mayDamage', 'mayAdvantageEach', 'mayDamageExhaust', 'mayLastingBuff', 'mayGiveAdvantage',
  'mayExhaustLeaderGiveAdvantage', 'mayExhaustLeaderExhaustUnit', 'mayExhaustUnit',
  'selectDamageTarget', 'selectHealTarget', 'selectUnitToExhaust', 'attachResourceUpgrade',
  'selectUnitToDefeat', 'selectUniqueUnitToDefeat', 'opponentGivesAdvantage', 'mayGiveTokens',
  'multiPick', 'distributeDamage', 'distributeTokens', 'variableStrike', 'healForAdvantage',
  'returnFriendlyUnit',
] as const

export type BoardTargetKind = (typeof BOARD_TARGET_KINDS)[number]

function cardRef(state: GameState, cardId: string | undefined, controller: PlayerId): DescribePart[] {
  const name = cardId ? state.cards[cardId]?.name : undefined
  return cardId && name ? [{ cardId, controller, text: name }] : []
}

/** The card that raised this choice, where the choice records one at all (see #374). */
function sourceRef(state: GameState, choice: PendingChoice): DescribePart[] {
  const controller = choice.controller
  if ('unitId' in choice && typeof choice.unitId === 'string') {
    for (const side of ['player', 'opponent'] as PlayerId[]) {
      const unit = state.players[side].units.find(u => u.instanceId === choice.unitId)
      if (unit) return cardRef(state, unit.cardId, side)
    }
  }
  if ('source' in choice && choice.source) return cardRef(state, choice.source.cardId, choice.source.controller)
  if ('cardId' in choice && typeof choice.cardId === 'string') return cardRef(state, choice.cardId, controller)
  return []
}

function tokenName(state: GameState, id: string): string {
  return state.cards[id]?.name ?? 'token'
}

/**
 * What this choice is asking the player to do, in describe-parts form so any card it names
 * renders as a hover-to-zoom reference.
 *
 * Where the choice records the card that raised it, the prompt leads with that card — the
 * "why am I being asked this?" case the ticket cares about most. Most kinds don't carry a
 * source yet (#374 adds one); those simply omit it rather than guessing.
 */
export function describeChoiceParts(state: GameState, choice: PendingChoice): DescribePart[] {
  const source = sourceRef(state, choice)
  const lead = source.length > 0 ? [...source, ': '] : []
  const body = choiceBody(state, choice)
  // Capitalise the instruction when it stands alone; after a card name it reads as a clause.
  if (lead.length === 0 && typeof body[0] === 'string') {
    return [body[0].charAt(0).toUpperCase() + body[0].slice(1), ...body.slice(1)]
  }
  return [...lead, ...body]
}

function choiceBody(state: GameState, choice: PendingChoice): DescribePart[] {
  switch (choice.kind) {
    case 'mayDamage':
      return [`choose a unit to deal ${choice.amount} damage to`]
    case 'selectDamageTarget': {
      const where = choice.baseTargets.length > 0 ? 'unit or base' : 'unit'
      return [`choose a ${where} to deal ${choice.amount} damage to`]
    }
    case 'selectHealTarget': {
      const where = choice.baseTargets.length > 0 ? 'unit or base' : 'unit'
      return [`choose a ${where} to heal ${choice.amount} damage from`]
    }
    case 'mayDamageExhaust':
      return [`choose a ${choice.arena} unit to deal 1 damage to and exhaust`]
    case 'mayAdvantageEach':
    case 'mayGiveAdvantage':
      return ['choose a unit to give Advantage to']
    case 'opponentGivesAdvantage':
      return [`choose a unit to give ${choice.count} Advantage to`]
    case 'mayExhaustLeaderGiveAdvantage':
      return ['choose a unit to give Advantage to, this exhausts your leader']
    case 'mayExhaustLeaderExhaustUnit':
      return ['choose an enemy unit to exhaust, this exhausts your leader']
    case 'mayExhaustUnit':
    case 'selectUnitToExhaust':
      return ['choose a unit to exhaust']
    case 'selectUnitToDefeat':
    case 'selectUniqueUnitToDefeat':
      return ['choose a unit to defeat']
    case 'mayLastingBuff': {
      const buff = [choice.power || choice.hp ? `+${choice.power ?? 0}/+${choice.hp ?? 0}` : '', ...(choice.keywords ?? []).map(k => k.name)].filter(Boolean).join(' & ')
      return [`choose a unit to give ${buff || 'a bonus'} this phase`]
    }
    case 'attachResourceUpgrade':
      return ['choose a unit to attach it to']
    case 'mayGiveTokens': {
      const name = tokenName(state, choice.token)
      return [`choose a unit to give ${choice.count > 1 ? `${choice.count} ${name} tokens` : `a ${name} token`} to`]
    }
    case 'distributeDamage':
      return [`deal damage across your targets: ${choice.total - choice.remaining} of ${choice.total} allocated`]
    case 'distributeTokens':
      return [`hand out ${tokenName(state, choice.token)} tokens: ${choice.total - choice.remaining} of ${choice.total} allocated`]
    case 'variableStrike':
      return [`choose a unit to damage: ${choice.damagedAmount} if it is already damaged, otherwise ${choice.undamagedAmount}`]
    case 'healForAdvantage':
      return [`choose a unit to heal up to ${choice.maxHeal} damage from`]
    case 'returnFriendlyUnit':
      return ['choose one of your units to return to your hand']
    case 'selectArenaToGrant':
      return ['choose an arena; every unit in it is dealt 2 damage when it attacks this phase']
    case 'chooseMode':
      return ['choose which effect to take']
    case 'mayPlayUnitFromDiscard':
      return ['choose a unit to play from your discard pile']
    case 'chooseNumber':
      return ['choose a number']
    case 'selectUnitToSteal':
      return ['choose an enemy unit to take control of']
    case 'multiPick': {
      // Optional chaining is deliberate: this is decoration over the board, and a malformed
      // choice must degrade to a vaguer prompt rather than throwing and blanking the screen.
      if (choice.spec?.mode === 'defeatForToken') return ['choose units to defeat']
      if (choice.spec?.mode === 'dealEach') return [`choose units to deal ${choice.spec.amount} damage to each`]
      return ['choose units to give Advantage to']
    }
    default:
      // Any kind without a written prompt still gets a usable instruction rather than a blank
      // panel or a leaked internal name.
      return ['choose a target on the board']
  }
}
