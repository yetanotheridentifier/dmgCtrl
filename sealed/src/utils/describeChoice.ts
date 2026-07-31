import type { GameState, PendingChoice, PlayerId } from '../engine/types'
import { getCardDefinition } from '../engine/abilities'
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
  'returnFriendlyUnit', 'selectPair',
] as const

export type BoardTargetKind = (typeof BOARD_TARGET_KINDS)[number]

function cardRef(state: GameState, rawId: string | undefined, controller: PlayerId): DescribePart[] {
  // A `GRANT_*` ability carrier is not a real card and has no database entry, so name the card it
  // belongs to instead. That is the card the player actually played (#374).
  const cardId = rawId ? getCardDefinition(rawId)?.sourceCardId ?? rawId : undefined
  const name = cardId ? state.cards[cardId]?.name : undefined
  return cardId && name ? [{ cardId, controller, text: name }] : []
}

/**
 * The card that raised this choice. Every choice can name one now that the ability dispatcher
 * stamps `source` automatically (#374); the `unitId` branch is preferred where present because it
 * resolves to the live in-play card, which is more specific than the stamp.
 *
 * Exported so a test can assert the guarantee holds for every choice a real game raises.
 */
export function choiceSourceRef(state: GameState, choice: PendingChoice): DescribePart[] {
  return sourceRef(state, choice)
}

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

/** A card's printed name for use inside a prompt sentence, degrading to a neutral noun. */
function cardName(state: GameState, id: string): string {
  return state.cards[id]?.name ?? 'the card'
}

/**
 * What a damage or heal choice can actually be aimed at, following BOTH target lists.
 *
 * Reading only the base list says "unit or base" for a card that offers no units at all, which
 * invites a click that cannot be made: "deal 2 damage to a base" is a real and common wording.
 */
function targetNoun(choice: { unitTargets: string[]; baseTargets: PlayerId[] }): string {
  const units = choice.unitTargets.length > 0
  const bases = choice.baseTargets.length > 0
  if (units && bases) return 'unit or base'
  return bases ? 'base' : 'unit'
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
    case 'selectDamageTarget':
      return [`choose a ${targetNoun(choice)} to deal ${choice.amount} damage to`]
    case 'selectHealTarget':
      return [`choose a ${targetNoun(choice)} to heal ${choice.amount} damage from`]
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
    case 'peekTopDiscard':
      return ['choose a deck to look at the top card of']
    case 'selectPair': {
      // Two picks in sequence, so the prompt has to say WHICH one is being asked for now (#387).
      const verb = choice.mode === 'exhaust' ? 'exhaust' : 'defeat'
      return choice.chosenFriendly === undefined
        ? [`choose one of your units to ${verb}`]
        : [`choose an enemy unit to ${verb}`]
    }
    case 'multiPick': {
      // Optional chaining is deliberate: this is decoration over the board, and a malformed
      // choice must degrade to a vaguer prompt rather than throwing and blanking the screen.
      if (choice.spec?.mode === 'defeatForToken') return ['choose units to defeat']
      if (choice.spec?.mode === 'dealEach') return [`choose units to deal ${choice.spec.amount} damage to each`]
      if (choice.spec?.mode === 'exhaust') return ['choose units to exhaust']
      return ['choose units to give Advantage to']
    }

    // ── Attacks granted by a keyword or an ability ────────────────────────────────────────────
    case 'ambush':
      return ['this unit may attack an enemy unit right now']
    case 'support':
      return ['choose another ready unit to attack with']
    case 'mayAttack':
      return ['you may attack with this unit']
    case 'mayAttackAnyUnit':
      return [`choose a ready unit to attack with${choice.restore > 0 ? `, it gains Restore ${choice.restore}` : ''}`]

    // ── Costs and yes/no offers ───────────────────────────────────────────────────────────────
    case 'payOrExhaust':
      return [`pay ${choice.cost} to keep this unit ready, or let it exhaust`]
    case 'mayPayExhaustArena':
      return [`pay ${choice.cost} to exhaust every unit in an arena`]
    case 'mayPayToDraw':
      return [choice.cost > 0
        ? `pay ${choice.cost} to draw ${choice.draw === 1 ? 'a card' : `${choice.draw} cards`}`
        : `you may draw ${choice.draw === 1 ? 'a card' : `${choice.draw} cards`}`]
    case 'mayDeployLeader':
      return ['you may deploy your leader']
    case 'mayExhaustLeaderForAdvantage':
      return ['give the played unit an Advantage token, this exhausts your leader']
    case 'mayExhaustLeaderHealUnit':
      return [`heal ${choice.amount} damage from the unit, this exhausts your leader`]
    case 'mayExhaustLeaderBuffSelf':
      return [`give this unit +${choice.power}/+${choice.hp} this phase, this exhausts your leader`]
    case 'maySelfDamageHealBase':
      return [`deal ${choice.selfDamage} damage to this unit to heal ${choice.healBase} from your base`]
    case 'maySelfDamageShield':
      return [`deal ${choice.amount} damage to this unit to give a Shield token`]
    case 'mayCreateToken':
      return [`create ${choice.count > 1 ? `${choice.count} ${tokenName(state, choice.token)} tokens` : `a ${tokenName(state, choice.token)} token`}`]
    case 'mayDoubleTokens':
      return [`defeat this unit to create ${choice.count} more ${tokenName(state, choice.token)} tokens`]
    case 'mayCapture':
      return [`capture ${cardName(state, choice.cardId)} from your discard pile`]
    case 'mayDefeatSelfSearch':
      return ['defeat this unit to search your deck']
    case 'dealOwnBaseForDiscount':
      return [`deal another damage to your own base for a bigger discount (${choice.dealt} of ${choice.max} so far), or stop`]
    /** The #422 prompt: the generic fallback read as "pick something to hit", the opposite of this. */
    case 'mayPreventDamage':
      return [`defeat a Shield to prevent ${choice.amount} damage to this unit`]

    // ── Picking a card, rather than a target on the board ─────────────────────────────────────
    case 'mayPlayTopFree':
      return [`play ${cardName(state, choice.cardId)} for free, or leave it`]
    case 'mayPlayUpgradeFree':
      return [`choose a unit to attach ${cardName(state, choice.cardId)} to for free`]
    case 'playUnitFromHand':
      return ['choose a unit to play from your hand']
    case 'selectFromDiscard':
      return ['choose a card to take from your discard pile']
    case 'chooseDiscardFate':
      return [`bottom ${cardName(state, choice.cardId)} and heal ${choice.heal}, or return it to your hand`]
    case 'selectDiscard':
      return [`choose ${choice.count === 1 ? 'a card' : `${choice.count} cards`} to discard from your hand`]
    case 'revealUnitFromHand':
      return ['reveal a unit from your hand; its cost sets the damage']
    case 'nameCard':
      return ['name a card the opponent may not play while this unit is out']
    case 'selectResourceUpgrade':
      return ['choose an upgrade to play from your resources']
    case 'chooseOne':
      return ['choose one effect']

    // ── Searching the deck ────────────────────────────────────────────────────────────────────
    case 'search':
      return ['choose a ground unit to discard from the revealed cards']
    case 'searchDraw':
      return [choice.eligibleIndices.length > 0
        ? 'choose a card to draw; the rest go to the bottom of your deck'
        : 'nothing matched; these go to the bottom of your deck']
    case 'searchPlayFree':
      return [choice.eligibleIndices.length > 0
        ? 'choose a card to play for free; the rest go to the bottom of your deck'
        : 'nothing playable; these go to the bottom of your deck']
    case 'searchPlayUpgrade':
      return [choice.eligibleIndices.length > 0
        ? `choose an upgrade to play on the unit, ${choice.discount} less to play`
        : 'nothing attaches; these go to the bottom of your deck']

    // ── Looking at cards ──────────────────────────────────────────────────────────────────────
    case 'lookAtHand':
      return [choice.mayDiscard ? 'choose a card to discard from their hand' : 'look at their hand']
    case 'mayDiscardTop':
      return [`discard ${cardName(state, choice.cardId)} from the top, or leave it there`]

    // ── Board targets not already covered above ───────────────────────────────────────────────
    case 'selectUpgradeToDefeat':
      return ['choose an upgrade to defeat']
    case 'selectUpgradeToReturn':
      return ["choose an upgrade to return to its owner's hand"]
    case 'selectUniqueToDefeat':
      return [`you control two copies of ${cardName(state, choice.cardId)}: choose one to defeat`]
    case 'selectUnitToReturn':
      return ["choose a unit to return to its owner's hand"]
    case 'selectUnitToReady':
      return ['choose a unit to ready']
    case 'selectDistributeSource':
      return ['choose the unit whose power is spread as damage']
    case 'damageAnyBases':
      return [`deal ${choice.amount} damage to a base, or stop`]

    default: {
      // EXHAUSTIVE. Every choice kind above names what it is asking, so this is unreachable and TS
      // proves it: a new kind added to `PendingChoice` without a prompt fails to compile here rather
      // than silently shipping "choose a target on the board".
      //
      // That fallback is what #422 was. A damage-PREVENTION offer rendered as "choose a target on
      // the board", which reads as "pick something to hit", and the reporter reasonably concluded
      // the wrong player was being asked. 46 of the 71 kinds were in that state.
      const unhandled: never = choice
      void unhandled
      return ['choose a target on the board']
    }
  }
}
