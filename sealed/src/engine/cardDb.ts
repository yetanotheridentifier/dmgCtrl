import type { SwuCard } from '../data/cards'
import { cardId } from '../data/cards'
import type { CardDb, CardType, EngineCard, Arena, KeywordInstance } from './types'
import { TOKEN_CARDS } from './tokenUpgrades'
import { TOKEN_UNIT_CARDS } from './tokenUnits'
import { PILOT_UPGRADE_STATS, UPGRADE_STAT_OVERRIDES } from './upgradeStatOverrides'
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

/** FrontText and BackText joined, the one place both are read from for a card's printed text. */
function cardText(card: SwuCard): string {
  return `${card.FrontText ?? ''}\n${card.BackText ?? ''}`
}

/**
 * SWUDB `Keywords[]` gives names only; numerals (Raid 2, Restore 1…) live in
 * the rules text in the standardised "Keyword N" form — extract them from there.
 */
/**
 * Whether a card's text prints `name` as a keyword of its own: at the start of a line or a sentence,
 * or inside a printed list ("AMBUSH, OVERWHELM"). A keyword the text only mentions ("this unit gains
 * Sentinel", "give a unit Sentinel", "a unit loses Sentinel") is not printed.
 */
function printsKeyword(text: string, name: string): boolean {
  return new RegExp(`(^|\\n|\\.\\s+)([A-Za-z]+( \\d+)?,\\s*)*${name}\\b`, 'i').test(text)
}

/**
 * The source lists, beside a unit's printed keywords, the ones it only gains on a condition and the
 * ones it only gives to other units. Copied as they stand, each made the unit hold the keyword all
 * game. So a unit or leader keeps only what its text prints, and a conditional keyword is granted by
 * the card's ability while its condition holds. Upgrades keep the source's list: an upgrade's keyword
 * is its attached unit's.
 */
function toKeywords(card: SwuCard): KeywordInstance[] {
  const text = cardText(card)
  const own = card.Type === 'Unit' || card.Type === 'Leader'
  return (card.Keywords ?? []).filter(raw => !own || printsKeyword(text, raw.trim())).map(raw => {
    // Trim: the source data ships some keywords with stray whitespace (e.g. two
    // "Shielded" variants), which would otherwise miss `hasKeyword` matches.
    const name = raw.trim()
    const match = text.match(new RegExp(`${name}\\s+(\\d+)`, 'i'))
    return match ? { name, value: parseInt(match[1], 10) } : { name }
  })
}

/**
 * Smuggle's own bracket does not fit the "Keyword N" shape `toKeywords` reads: it is a cost plus an
 * aspect list, either or both wrapped in the source's own icon-markup braces ("Smuggle [C=4
 * Cunning]", "Smuggle [{C=7} {Cunning} {Cunning}]"), and once (First Light) a trailing comma-led
 * additional cost this parser does not resolve, kept as `extra` so a reader can see the card was not
 * silently dropped rather than silently miss it. Piloting prints the same bracket ("Piloting [C=2
 * Vigilance]"), so it is read the same way.
 */
function parseBracket(card: SwuCard, keyword: 'Smuggle' | 'Piloting'): { cost: number; aspects: string[]; extra?: string } | undefined {
  const match = cardText(card).match(new RegExp(`${keyword}\\s*\\[\\{?C=(\\d+)\\}?\\s*((?:\\{?[A-Za-z]+\\}?\\s*)*)(?:,\\s*([^\\]]+))?\\]`))
  if (!match) return undefined
  const aspects = match[2].match(/[A-Za-z]+/g) ?? []
  return { cost: parseInt(match[1], 10), aspects, ...(match[3] !== undefined ? { extra: match[3].trim() } : {}) }
}

/**
 * The aspects of each other way a card can be played (Smuggle, Piloting), which can differ from the
 * printed ones: The Mandalorian (JTL) prints two Cunning and pilots for one.
 */
export function alternativeAspects(card: SwuCard): string[][] {
  return (['Smuggle', 'Piloting'] as const).flatMap(k => {
    const bracket = parseBracket(card, k)
    return bracket ? [bracket.aspects] : []
  })
}

/** Normalise a SWUDB card payload into engine static data. */
export function normaliseCard(card: SwuCard): EngineCard {
  const type = toType(card.Type)
  const id = cardId(card.Set, card.Number)
  // Several sets ship unit upgrades with no Power/HP in the source data, so fill
  // in the printed modifier from a lookup. Applied only when the source omits
  // both fields, so it auto-drops once the data is fixed.
  const override = card.Power === undefined && card.HP === undefined ? UPGRADE_STAT_OVERRIDES[id] : undefined
  const smuggle = parseBracket(card, 'Smuggle')
  const pilotBracket = parseBracket(card, 'Piloting')
  const piloting = pilotBracket && { cost: pilotBracket.cost, aspects: pilotBracket.aspects }
  const asUpgrade = PILOT_UPGRADE_STATS[id]
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
    // No rules meaning; read by the AI's card valuation (#393). The card cache stores the raw
    // SWUDB payload and normalises on read, so already-cached sets pick this up with no migration.
    ...(card.Rarity !== undefined && { rarity: card.Rarity }),
    ...(smuggle !== undefined && { smuggle }),
    ...(piloting !== undefined && { piloting }),
    ...(asUpgrade !== undefined && { upgradePower: asUpgrade.power, upgradeHp: asUpgrade.hp }),
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
