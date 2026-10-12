import type { SwuCard } from './cards'

/**
 * Which row of a set listing a card is known by. The one statement of it: the bundled sets and the
 * bench fixtures are written with it, the triage counts with it, and the printing index
 * (`printings.ts`) resolves every other printing to it, so the id a card is registered under is the
 * id a deck's card arrives as.
 *
 * Nothing here touches the cache or the network, so the bench can use it in node.
 */

/**
 * A card's identity across its printings: type, name, subtitle. Type is load-bearing because a
 * leader and a unit can share a name with no subtitle to separate them (ASH has 13 such collisions).
 */
export function printingKey(card: Pick<SwuCard, 'Type' | 'Name' | 'Subtitle'>): string {
  return [card.Type ?? '', card.Name ?? '', card.Subtitle ?? ''].join('|').toLowerCase()
}

export const isNormal = (card: SwuCard): boolean => card.VariantType == null || card.VariantType === 'Normal'

/**
 * Normal printings only, one row per real card. A set listing carries every variant, and a set can
 * print one card at several Normal collector numbers (IBH's 104 slots are 51 cards, the copies
 * differing only in number, art and price), so implementing it once covers every printing.
 *
 * **The lowest number wins, read as a number**, wherever the row sits: listings and the cache both
 * hold rows in the order of their ids as text, where IBH 102 comes before IBH 74. A number that is
 * not one (a token's `T03`) never displaces the row already held.
 *
 * **De-duplication is within a set, never across sets.** A card reprinted in a later set is a
 * separate card id, and the engine registers abilities per id, so collapsing the two would
 * undercount the work. The set code is therefore part of the key; cross-set reprints are declared
 * in `reprints.ts`.
 */
export function normalPrintings(cards: readonly SwuCard[]): SwuCard[] {
  const seen = new Map<string, SwuCard>()
  for (const card of cards) {
    if (!isNormal(card)) continue
    const key = `${card.Set}||${printingKey(card)}`
    const held = seen.get(key)
    if (!held || Number(card.Number) < Number(held.Number)) seen.set(key, card)
  }
  return [...seen.values()]
}
