import type { SwuCard } from '../data/cards'
import { cardId } from '../data/cards'
import type { CardDb, CardType, EngineCard, Arena, KeywordInstance } from './types'
import { TOKEN_CARDS } from './tokenUpgrades'
import { TOKEN_UNIT_CARDS } from './tokenUnits'
import { UPGRADE_STAT_OVERRIDES } from './upgradeStatOverrides'
import { CARD_DATA_CORRECTIONS } from './cardDataCorrections'

function toInt(value: string | undefined): number {
  const n = parseInt(value ?? '', 10)
  return Number.isNaN(n) ? 0 : n
}

function toType(value: string): CardType {
  const t = value.toLowerCase()
  if (t === 'unit' || t === 'event' || t === 'upgrade' || t === 'leader' || t === 'base' || t === 'token') {
    return t
  }
  // Leader Unit / Token Unit etc. — first word wins for compound types.
  if (t.startsWith('leader')) return 'leader'
  if (t.startsWith('token')) return 'token'
  return 'unit'
}

function toArena(arenas: string[] | undefined): Arena | undefined {
  const first = arenas?.[0]?.toLowerCase()
  return first === 'ground' || first === 'space' ? first : undefined
}

/**
 * SWUDB `Keywords[]` gives names only; numerals (Raid 2, Restore 1…) live in
 * the rules text in the standardised "Keyword N" form — extract them from there.
 */
function toKeywords(card: SwuCard): KeywordInstance[] {
  const text = `${card.FrontText ?? ''}\n${card.BackText ?? ''}`
  return (card.Keywords ?? []).map(raw => {
    // Trim: the source data ships some keywords with stray whitespace (e.g. two
    // "Shielded" variants), which would otherwise miss `hasKeyword` matches.
    const name = raw.trim()
    const match = text.match(new RegExp(`${name}\\s+(\\d+)`, 'i'))
    return match ? { name, value: parseInt(match[1], 10) } : { name }
  })
}

/** Normalise a SWUDB card payload into engine static data. */
export function normaliseCard(card: SwuCard): EngineCard {
  const type = toType(card.Type)
  const id = cardId(card.Set, card.Number)
  // Temporary: some sets (currently ASH) ship upgrade cards with no Power/HP in
  // the source data, so fill in the printed modifier from a lookup. Applied only
  // when the source omits both fields, so it auto-drops once the data is fixed.
  const override = card.Power === undefined && card.HP === undefined ? UPGRADE_STAT_OVERRIDES[id] : undefined
  const normalised: EngineCard = {
    id,
    name: card.Name,
    ...(card.Subtitle !== undefined && { subtitle: card.Subtitle }),
    type,
    ...(type === 'unit' && toArena(card.Arenas) !== undefined && { arena: toArena(card.Arenas) }),
    cost: toInt(card.Cost),
    power: override ? override.power : toInt(card.Power),
    hp: override ? override.hp : toInt(card.HP),
    aspects: card.Aspects ?? [],
    traits: card.Traits ?? [],
    keywords: toKeywords(card),
    unique: card.Unique ?? false,
    ...(card.FrontArt !== undefined && { frontArt: card.FrontArt }),
    ...(card.BackArt !== undefined && { backArt: card.BackArt }),
    ...(card.FrontText !== undefined && { text: card.FrontText }),
  }
  // Last: override any values the source data gets wrong (read off the printed card).
  return { ...normalised, ...CARD_DATA_CORRECTIONS[id] }
}

export function buildCardDb(cards: SwuCard[]): CardDb {
  // Built-in token upgrades and token units are always present so tokens resolve.
  const db: Record<string, EngineCard> = { ...TOKEN_CARDS, ...TOKEN_UNIT_CARDS }
  for (const card of cards) {
    const normalised = normaliseCard(card)
    db[normalised.id] = normalised
  }
  return db
}
