import { db } from './db'
import { cardId, SWU_DB_API } from './cards'
import type { SwuCard } from './cards'
import { logger } from './log'
import { bundledCanonicalId } from './bundledPrintings'

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
 * the map was last generated), the dynamic path below: cache first, then a network fetch of the
 * set's Normal-only listing, joined by `Type|Name|Subtitle` since the listing cannot be joined on
 * number. That join was verified unambiguous for ASH across its full 925-row printing list, not
 * just the 264 Normal rows (#389): every variant joins to exactly one Normal row.
 *
 * #389 was this dynamic path's failure mode: `indexFromCache` returns a `Map` as soon as ANY Normal
 * card for the set is cached, even if incomplete, so an incomplete cache silently prevented the
 * (correct, complete) network fetch from ever running. The bundled tier removes that race entirely
 * for anything it covers.
 */

/** Identity of a card across its printings. */
export function printingKey(card: Pick<SwuCard, 'Type' | 'Name' | 'Subtitle'>): string {
  return [card.Type ?? '', card.Name ?? '', card.Subtitle ?? ''].join('|').toLowerCase()
}

export type PrintingIndex = Map<string, string>

const isNormal = (card: SwuCard) => card.VariantType == null || card.VariantType === 'Normal'

/** Map every card's identity to its Normal printing's id. Non-Normal rows are ignored. */
export function buildPrintingIndex(cards: SwuCard[]): PrintingIndex {
  const index: PrintingIndex = new Map()
  for (const card of cards) {
    if (isNormal(card)) index.set(printingKey(card), cardId(card.Set, card.Number))
  }
  return index
}

/** Why a card could not be canonicalised; it will play vanilla either way. */
export type UnresolvedReason = 'no-index' | 'unknown-card'

export interface Unresolved {
  id: string
  name?: string
  reason: UnresolvedReason
}

async function indexFromCache(set: string): Promise<PrintingIndex | undefined> {
  const rows = await db.cards.where('id').startsWith(`${set}_`).toArray()
  const cards = rows.map(r => r.json as SwuCard).filter(isNormal)
  return cards.length > 0 ? buildPrintingIndex(cards) : undefined
}

async function indexFromNetwork(set: string): Promise<PrintingIndex | undefined> {
  try {
    const response = await fetch(`${SWU_DB_API}/cards/search?q=set:${set}`)
    if (!response.ok) {
      logger.warn('printing index fetch failed', { set, status: response.status })
      return undefined
    }
    const payload = (await response.json()) as { data?: SwuCard[] }
    const cards = payload.data ?? []
    return cards.length > 0 ? buildPrintingIndex(cards) : undefined
  } catch (err) {
    logger.warn('printing index fetch rejected', { set, error: String(err) })
    return undefined
  }
}

/** The set's index, cache first then network. One lookup per set, whatever the card count. */
async function printingIndex(set: string, cache: Map<string, PrintingIndex | undefined>): Promise<PrintingIndex | undefined> {
  if (!cache.has(set)) cache.set(set, (await indexFromCache(set)) ?? (await indexFromNetwork(set)))
  return cache.get(set)
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

    const bundled = bundledCanonicalId(id)
    if (bundled) {
      map.set(id, bundled)
      continue
    }

    const index = await printingIndex(card.Set, indexes)
    if (!index) {
      map.set(id, id)
      unresolved.push({ id, name: card.Name, reason: 'no-index' })
      continue
    }
    const canonical = index.get(printingKey(card))
    if (!canonical) {
      map.set(id, id)
      unresolved.push({ id, name: card.Name, reason: 'unknown-card' })
      continue
    }
    map.set(id, canonical)
  }

  if (unresolved.length > 0) {
    logger.warn('printings not canonicalised', { cards: unresolved.map(u => `${u.id}${u.name ? ` (${u.name})` : ''}`) })
  }
  return { map, unresolved }
}
