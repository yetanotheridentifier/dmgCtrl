/**
 * ProtectThePod deck import.
 *
 * ASSUMED SHAPE — no real PTP export sample was available when this was written.
 * PTP advertises SWUDB-compatible JSON, so this targets the de-facto SWUDB deck
 * format: { metadata?: { name }, leader: { id }|string, base: { id }|string,
 * deck: [{ id: "SET_NNN", count }] }. If a real export differs, this module is
 * the only place that needs to change.
 */

export interface DeckCardEntry {
  id: string
  count: number
}

export interface ParsedDeck {
  name: string
  leader: string
  base: string
  cards: DeckCardEntry[]
}

export type ParseDeckError =
  | 'invalid-json'
  | 'invalid-format'
  | 'missing-leader'
  | 'missing-base'
  | 'too-few-cards'

export type ParseDeckResult =
  | { ok: true; deck: ParsedDeck }
  | { ok: false; error: ParseDeckError }

const MIN_DECK_CARDS = 30

const CARD_ID_PATTERN = /^([A-Za-z0-9]+)_([A-Za-z0-9]+)$/

export function cardRefFromId(id: string): { set: string; number: string } | null {
  const match = CARD_ID_PATTERN.exec(id)
  if (!match) return null
  return { set: match[1], number: match[2] }
}

/** Accepts `{ id: "SOR_010", ... }` or a bare `"SOR_010"`; null when neither. */
function extractCardId(value: unknown): string | null {
  if (typeof value === 'string' && cardRefFromId(value)) return value
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && cardRefFromId(id)) return id
  }
  return null
}

export function parseProtectThePod(text: string): ParseDeckResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'invalid-format' }
  }
  const obj = raw as Record<string, unknown>

  if (!Array.isArray(obj.deck)) {
    return { ok: false, error: 'invalid-format' }
  }

  const leader = extractCardId(obj.leader)
  if (!leader) return { ok: false, error: 'missing-leader' }

  const base = extractCardId(obj.base)
  if (!base) return { ok: false, error: 'missing-base' }

  const cards: DeckCardEntry[] = []
  for (const entry of obj.deck) {
    const id = extractCardId(entry)
    if (!id) return { ok: false, error: 'invalid-format' }
    const count = typeof (entry as { count?: unknown }).count === 'number'
      ? (entry as { count: number }).count
      : 1
    if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'invalid-format' }
    cards.push({ id, count })
  }

  const totalCards = cards.reduce((n, c) => n + c.count, 0)
  if (totalCards < MIN_DECK_CARDS) {
    return { ok: false, error: 'too-few-cards' }
  }

  const metadata = obj.metadata as { name?: unknown } | undefined
  const name = typeof metadata?.name === 'string' && metadata.name.trim() !== ''
    ? metadata.name
    : 'Imported deck'

  return { ok: true, deck: { name, leader, base, cards } }
}
