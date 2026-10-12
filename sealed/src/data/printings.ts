import { db } from './db'
import { cardId, fromSearchRow, SWU_DB_API } from './cards'
import type { SwuCard } from './cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { logger } from './log'
import { bundledCanonicalId } from './bundledPrintings'
import { bundledSetCards } from './bundledSets'
import { normalPrintings, printingKey } from './normalPrintings'
import { reprintCanonicalId } from './reprints'

/**
 * Printings, and why card identity has to be canonical.
 *
 * A card is printed several ways (Normal, Hyperspace, foil, prestige tiers, showcase…), each with
 * its own collector number, and ProtectThePod faithfully exports the printing you own. Everything
 * the engine keys by card id — the ability registry, `cardDataCorrections`, `upgradeStatOverrides`,
 * the unique rule — is written against the Normal number, so a non-Normal printing was
 * unregistered and played as a vanilla card (#382-#385).
 *
 * The fix is to canonicalise the id during hydration, so the engine only ever sees one id per
 * card. The printing's own art is kept, so you still see the card you own.
 *
 * Two tiers. First, a bundled static map (`bundledPrintings.ts`, `scripts/generatePrintingMap.mjs`)
 * generated from a set's FULL printing listing, resolved synchronously with no IndexedDB or
 * network dependency. Second, for anything not bundled (another set, or a printing released since
 * the map was last generated), the dynamic path below: the cached rows of the set and the bundled
 * set (`bundledSets.ts`, which is a Normal-only listing) read together, and only if the device holds
 * neither, a network fetch of the set's Normal-only listing. The join is by `Type|Name|Subtitle`
 * since the listing cannot be joined on number. That join was verified unambiguous for ASH across
 * its full 925-row printing list, not just the 264 Normal rows (#389): every variant joins to
 * exactly one Normal row.
 *
 * A set can print one card at several Normal numbers (IBH does, for 38 of its 51 cards). The card is
 * known by the lowest of them (`normalPrintings.ts`), which is the row the bundled set keeps and the
 * id the engine registers, so its other numbers resolve to that one like any other printing.
 *
 * The dynamic path's failure mode, for a set that is not bundled: the index is built as soon as ANY
 * Normal card of the set is cached, even if incomplete, so an incomplete cache silently prevents the
 * (correct, complete) network fetch from ever running (#389). The bundled map and the bundled sets
 * remove that race for anything they cover.
 *
 * Both tiers work within one set, and a cross-set reprint is a Normal printing of its own, so
 * neither can bridge the two (#551). The declared table in `reprints.ts` does, and is applied last:
 * whatever id a card's own set resolves to, a reprint of an implemented card ends on that card.
 */

/**
 * The deck as the engine should see it: every id replaced by its canonical id, where it has one. The
 * saved deck keeps the printings you actually own, so the deck list still shows your cards; only the
 * game works in canonical ids. Two printings of one card collapse to a single id, which is correct for
 * play (they are the same card) and merely means one of the two arts is shown.
 *
 * The app and the bench's coverage sweep both play decks through this, resolving ids their own way.
 */
export function canonicalDeck<T extends ParsedDeck>(deck: T, canonicalId: (id: string) => string | undefined): T {
  const id = (raw: string) => canonicalId(raw) ?? raw
  return {
    ...deck,
    leader: id(deck.leader),
    base: id(deck.base),
    cards: deck.cards.map(c => ({ ...c, id: id(c.id) })),
  }
}

/** A card's data filed under another id: the printing as the engine sees it once canonicalised. */
export function asCardId(card: SwuCard, id: string): SwuCard {
  const [set, number] = id.split('_')
  return { ...card, Set: set, Number: number }
}

export type PrintingIndex = Map<string, string>

/**
 * Map every card's identity to its Normal printing's id, for the rows of one set. Non-Normal rows are
 * ignored, and a card with several Normal rows is known by the lowest number (`normalPrintings`).
 */
export function buildPrintingIndex(cards: SwuCard[]): PrintingIndex {
  return new Map(normalPrintings(cards).map(card => [printingKey(card), cardId(card.Set, card.Number)]))
}

/** Why a card could not be canonicalised; it will play vanilla either way. */
export type UnresolvedReason = 'no-index' | 'unknown-card'

export interface Unresolved {
  id: string
  name?: string
  reason: UnresolvedReason
}

/**
 * The index of what the device holds of a set: the cached rows and the bundled set, read together.
 * The cache is whatever was fetched one card at a time, so on its own it is rarely the whole set and
 * can hold a card's second number without its first; the bundled set is a complete Normal listing,
 * which is what the network would be asked for.
 */
async function indexFromDevice(set: string): Promise<PrintingIndex | undefined> {
  const rows = await db.cards.where('id').startsWith(`${set}_`).toArray()
  const index = buildPrintingIndex([...rows.map(r => r.json as SwuCard), ...(await bundledSetCards(set))])
  return index.size > 0 ? index : undefined
}

async function indexFromNetwork(set: string): Promise<PrintingIndex | undefined> {
  try {
    const response = await fetch(`${SWU_DB_API}/cards/search?q=set:${set}`)
    if (!response.ok) {
      logger.warn('printing index fetch failed', { set, status: response.status })
      return undefined
    }
    const payload = (await response.json()) as { data?: SwuCard[] }
    const cards = (payload.data ?? []).map(fromSearchRow)
    return cards.length > 0 ? buildPrintingIndex(cards) : undefined
  } catch (err) {
    logger.warn('printing index fetch rejected', { set, error: String(err) })
    return undefined
  }
}

/** The set's index: the cache and the bundled set, then the network. One lookup per set, whatever the card count. */
async function printingIndex(set: string, cache: Map<string, PrintingIndex | undefined>): Promise<PrintingIndex | undefined> {
  if (!cache.has(set)) cache.set(set, (await indexFromDevice(set)) ?? (await indexFromNetwork(set)))
  return cache.get(set)
}

/**
 * The card's Normal id within its own set: bundled map first, then the cache/network index. An id
 * that cannot be resolved stays as it is and says why, so the game plays on with a vanilla card
 * rather than failing to start.
 */
async function withinSet(
  card: SwuCard,
  id: string,
  indexes: Map<string, PrintingIndex | undefined>,
): Promise<{ canonical: string; reason?: UnresolvedReason }> {
  const bundled = bundledCanonicalId(id)
  if (bundled) return { canonical: bundled }

  const index = await printingIndex(card.Set, indexes)
  if (!index) return { canonical: id, reason: 'no-index' }

  const canonical = index.get(printingKey(card))
  return canonical ? { canonical } : { canonical: id, reason: 'unknown-card' }
}

/**
 * Canonical id for each hydrated card, keyed by the id it was fetched under.
 *
 * Takes the cards rather than bare ids because the join is by name: a variant's identity is only
 * knowable from its own data. Unresolvable cards map to themselves, so being offline degrades to
 * the previous behaviour (the card plays vanilla) rather than breaking the game, and every such
 * card is reported so it can be surfaced instead of failing silently.
 */
export async function canonicaliseCards(cards: SwuCard[]): Promise<{ map: Map<string, string>; unresolved: Unresolved[] }> {
  const map = new Map<string, string>()
  const unresolved: Unresolved[] = []
  const indexes = new Map<string, PrintingIndex | undefined>()

  for (const card of cards) {
    const id = cardId(card.Set, card.Number)
    if (map.has(id)) continue

    // A declared reprint names its canonical id outright, so it needs no index of its own set.
    const declared = reprintCanonicalId(id)
    if (declared) {
      map.set(id, declared)
      continue
    }

    const { canonical, reason } = await withinSet(card, id, indexes)
    if (reason) unresolved.push({ id, name: card.Name, reason })
    map.set(id, reprintCanonicalId(canonical) ?? canonical)
  }

  if (unresolved.length > 0) {
    logger.warn('printings not canonicalised', { cards: unresolved.map(u => `${u.id}${u.name ? ` (${u.name})` : ''}`) })
  }
  return { map, unresolved }
}
