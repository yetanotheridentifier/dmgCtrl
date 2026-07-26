import type { EngineCard, GameState, PlayerId } from '../engine/types'
import { effectiveCost } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'

/**
 * How good a card is IF you get to cast it (#393).
 *
 * The board evaluation reads only `hand.length`, so it cannot prefer one card in hand over another:
 * all 1417 regroup resource picks in a 132-game sweep were decided by a coin flip. This is the
 * quality scale that gives it an opinion, and it is deliberately standalone so #396's optional-
 * ability scoring and #398's held-removal value can reuse it rather than growing their own.
 *
 * Every input contributes positively, so the function is monotone: mis-tuning can make it a worse
 * ranking, but never an inverted one.
 */

export interface CardValueWeights {
  /** Effective cost: the game's own designed statement of how strong a card is. */
  cost: number
  /** Per point of printed power + HP. */
  stats: number
  /** Per keyword. */
  keyword: number
  /** Per registered ability or hook (see `abilityRichness`). */
  ability: number
  /** Per rarity step, Common through Legendary. */
  rarity: number
  /** Per aspect icon: more icons buys more card for the cost. */
  aspect: number
  /** Flat, for a unique card. One-of in Sealed, so it cannot be replaced. */
  unique: number
  /**
   * Stat-equivalent per point of cost for a card with no printed power/HP.
   *
   * PLACEHOLDER. Events earn their value from effect magnitude (pumps, debuffs, bounce, defeat),
   * which is not visible here, and valuing them off `power + hp` would rank every event below every
   * unit. Set so a statless card matches a unit of the same cost with average stats. Replace with
   * real effect scoring when the event-valuation ticket lands; it needs the same machinery as #396.
   */
  statlessPerCost: number
}

export const DEFAULT_CARD_VALUE: CardValueWeights = {
  cost: 1,
  stats: 0.5,
  keyword: 1,
  ability: 1,
  rarity: 2,
  aspect: 1,
  unique: 2,
  statlessPerCost: 2,
}

const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
  // "Special" is the showcase/promo tier, printed across the rarity range; treat it as Rare rather
  // than assuming it is the top.
  special: 2,
}

/** Rarity as a number, floor 0. Unknown or missing rarity is never NaN: token cards have none. */
export function rarityRank(rarity: string | undefined): number {
  return RARITY_ORDER[rarity?.toLowerCase() ?? ''] ?? 0
}

/**
 * How much registered behaviour a card has: its triggered abilities plus each hook it defines
 * (auras, stat modifiers, cost discounts and the rest).
 *
 * Counting the IMPLEMENTATION rather than parsing the printed text is deliberate and more accurate:
 * a card whose ability is not built genuinely does nothing in this engine, so the AI should value it
 * lower. The numbers self-correct as the remaining cards land.
 */
function abilityRichness(cardId: string): number {
  const def = getCardDefinition(cardId)
  if (!def) return 0
  let count = def.abilities?.length ?? 0
  for (const [key, value] of Object.entries(def)) {
    // `sourceCardId` is bookkeeping for the GRANT_* pseudo cards, not behaviour.
    if (key === 'abilities' || key === 'sourceCardId') continue
    if (value !== undefined) count++
  }
  return count
}

/** Build a card valuation for a given set of weights. */
export function makeCardValue(w: CardValueWeights): (state: GameState, owner: PlayerId, card: EngineCard) => number {
  return (state, owner, card) => {
    // Effective, not printed: an off-aspect card really is the more expensive card, and the pool
    // has to reach that number before it can be cast.
    const cost = effectiveCost(state, owner, card)
    const statTotal = (card.power ?? 0) + (card.hp ?? 0)
    const stats = statTotal > 0 ? statTotal : w.statlessPerCost * cost

    return w.cost * cost
      + w.stats * stats
      + w.keyword * card.keywords.length
      + w.ability * abilityRichness(card.id)
      + w.rarity * rarityRank(card.rarity)
      + w.aspect * card.aspects.length
      + w.unique * (card.unique ? 1 : 0)
  }
}

/** How good `card` is for `owner` to cast, under the default weights. */
export const cardValue = makeCardValue(DEFAULT_CARD_VALUE)
