import type { SwuCard } from '../data/cards'
import { reprintCanonicalId } from '../data/reprints'

/**
 * Card-pool triage: classify a set by what the engine cannot yet express.
 *
 * A new set is roughly 260 cards. Reading them by hand to work out what is buildable is a day's
 * work and goes stale the moment a mechanic lands. This does it mechanically, in three passes:
 *
 *   1. **Buckets.** Vanilla, keyword-only on implemented keywords, held back purely by an
 *      unimplemented keyword, or carrying a real ability.
 *   2. **Blockers.** For each ability card, which things the engine cannot do. A card blocked by
 *      nothing is batchable now; a card blocked by exactly one thing is that mechanic's unlock
 *      count, which is what orders the work.
 *   3. **Fallout probes.** The blocker list catches new *nouns* (a token type, a zone, a card
 *      type). It cannot catch a card using familiar nouns in an unfamiliar *shape*. The probes flag
 *      those for reading rather than reclassifying them.
 *
 * **This is triage, not a specification.** It is reliable about clusters and relative sizes. Every
 * card still needs reading before it is built, and the probes exist because this tool knows it is
 * fallible.
 *
 * The lists below are the tool's model of the engine. **They shrink as mechanics land**: when
 * Experience tokens ship, delete that entry and every card it was blocking reclassifies itself.
 */

/** Same origin the app uses. Asserted equal to `SWU_DB_API` by test, imported by neither: pulling
 *  `data/cards` in for the constant would drag Dexie into a node process that has no IndexedDB. */
export const TRIAGE_API_BASE = 'https://worker.dmgctrl.app'

/** Keywords the engine dispatches today. */
export const IMPLEMENTED_KEYWORDS: ReadonlySet<string> = new Set([
  'Ambush', 'Grit', 'Overwhelm', 'Raid', 'Restore', 'Saboteur', 'Sentinel', 'Shielded', 'Hidden', 'Support',
])

/** Trigger points the ability framework dispatches today (see `docs/abilities.md`). */
const EXISTING_TRIGGERS: ReadonlySet<string> = new Set([
  'when played', 'on attack', 'on attack end', 'when attack ends', 'on defense', 'when defeated',
  'when readies', 'when regroup starts', 'when the regroup phase starts', 'when take initiative',
  'when play or create unit', 'when you play another unit', 'when upgrade attached',
  'when friendly upgrade defeated', 'when friendly unit defeated', 'when an enemy unit is defeated',
  'when enemy unit defeated', 'when friendly damaged survives', 'when enemy attacks base',
  'when own base damaged', 'when friendly attack ends', 'when this unit completes an attack',
  'action', 'epic action',
])

/**
 * Things the engine cannot express. Grounded in `engine/effects.ts`, the hook table in
 * `docs/abilities.md`, and the blocked-subsystem list in `data/implementedCards.ts`. Anything NOT
 * listed is treated as already expressible.
 */
const NEW_MECHANICS: readonly (readonly [string, RegExp])[] = [
  // Shield is implemented. Experience and Force are printed but never granted.
  ['experience-token', /\bExperience token/i],
  ['force-token', /\bthe Force\b|\bForce token/i],
  // `releaseCaptured` exists; capturing does not.
  ['capture', /\bcaptures?\b|\bcaptured\b/i],
  // A card that is both a unit and an upgrade.
  ['pilot', /\bPilot(ing)?\b|\bpilot\b/i],
  // An upgrade or aura handing a whole triggered-ability block to its host.
  ['granted-ability-block', /(?:Attached unit|Each other friendly [^.\n]{0,40}unit|While you control[^.\n]{0,40}) gains:/i],
  // Zone manipulation beyond resourceTopOfDeck / ready / exhaust, which do exist.
  ['resource-zone', /(?:return|take|move|defeat|discard)[^.\n]{0,40}\bresource\b|\bresource\b[^.\n]{0,30}\bto (?:your|their) hand|put[^.\n]{0,30}into (?:your|their) resource/i],
  ['play-from-discard', /play[^.\n]{0,50}from (?:your|their|the) discard/i],
  ['sideboard', /\bsideboard\b/i],
  // Keyword identity as a runtime value rather than a static property.
  ['dynamic-keywords', /\bthe chosen Keyword\b|\bthis unit's Keywords\b|different Keywords\b/i],
]

/**
 * Blockers that are one engine change wearing two hats. The Piloting keyword and the pilot text
 * always co-occur, as do the granted-ability-block shape and its "Attached unit gains:" head. Left
 * separate, every such card counts as multi-blocked and the mechanic's sole-unlock reads zero,
 * which orders the work wrongly.
 */
const CANONICAL_BLOCKERS: ReadonlyMap<string, string> = new Map([
  ['kw:Piloting', 'pilot'],
  ['trigger:When played as an upgrade', 'pilot'],
  ['trigger:When played as a unit', 'pilot'],
  ['trigger:Attached unit gains', 'granted-ability-block'],
  ['trigger:When a friendly Force unit attacks', 'force-token'],
  ['trigger:When played using Smuggle', 'kw:Smuggle'],
  ['trigger:Coordinate - When Played', 'kw:Coordinate'],
])

/**
 * Shapes that need engine work no blocker probe can see, because every noun in them is ordinary.
 * A hit does NOT reclassify a card: it flags it for reading. Several of these are already
 * supported (lasting effects, prohibitions, chained follow-ups) and are probed anyway, because the
 * point is to surface cards worth a second look, not to be precise about which.
 */
const SUSPECT_SHAPES: readonly (readonly [string, RegExp])[] = [
  ['alternate-win', /\b(?:you win the game|loses the game|wins the game)\b/i],
  ['play-restriction', /\bplay only (?:as|if|during)|can only be played|only as your first action/i],
  ['delayed-effect', /\bat the (?:start|end) of the\b/i],
  ['lasting-effect', /\bfor the rest of (?:the|this)\b|\bthis phase\b|\bthis round\b|\bnext round\b/i],
  ['replacement', /\binstead\b/i],
  ['prohibition', /\bcan'?t\b|\bcannot\b/i],
  ['symmetric', /\beach player\b|\bboth players\b/i],
  ['conditional-followup', /\bif you do\b|\bif you don'?t\b/i],
  ['modal', /\bchoose one\b|\bchoose two\b/i],
]

/** A trigger head appearing on fewer than this many cards is a one-off, not a mechanic. */
const ONE_OFF_THRESHOLD = 3

export type TriageBucket = 'vanilla' | 'existing-keyword' | 'new-keyword-only' | 'ability'

export interface TriagedCard {
  id: string
  set: string
  type: string
  name: string
  bucket: TriageBucket
  /** What the engine cannot do for this card. Empty means buildable today. */
  blockers: string[]
  /** Shapes worth a human reading. Never affects `blockers`. */
  suspects: string[]
  text: string
}

export interface BlockerCount {
  name: string
  /** Cards this blocker unlocks ON ITS OWN. The ordering signal. */
  sole: number
  /** Cards where this is one blocker among several. */
  touched: number
}

export interface TriageReport {
  sets: string[]
  /** Distinct non-token cards considered. */
  cards: number
  leaders: number
  buckets: Record<TriageBucket, number>
  blockers: BlockerCount[]
  /** Trigger-head distribution over the cards blocked by nothing: how to cut them into batches. */
  batches: { head: string; cards: number }[]
  fallout: { probe: string; cards: number }[]
  /** Cards blocked by nothing that nonetheless trip a probe. */
  suspectCards: number
  /**
   * Cards with ability text printed in more than one set. One registration covers every id, once
   * `data/reprints.ts` collapses them onto it; `registered` is false while that line is missing.
   */
  reprints: { name: string; type: string; ids: string[]; registered: boolean }[]
  /** Extra ids those reprints cover: the work saved, not the cards. */
  reprintSavings: number
  triaged: TriagedCard[]
}

/**
 * A card's identity across its printings: type, name, subtitle. Type is load-bearing because a
 * leader and a unit can share a name with no subtitle to separate them (ASH has 13 such collisions).
 *
 * This mirrors `printingKey` in `data/printings.ts`, which is asserted by test rather than imported:
 * that module pulls in Dexie, and the bench runs in node with no IndexedDB.
 */
export function identityKey(card: Pick<SwuCard, 'Type' | 'Name' | 'Subtitle'>): string {
  return [card.Type ?? '', card.Name ?? '', card.Subtitle ?? ''].join('|').toLowerCase()
}

/** Ability text left after removing keyword names and their parenthetical reminders. */
export function residualAbility(card: SwuCard): string {
  let t = (card.FrontText ?? '').trim().replace(/\([^)]*\)/g, '')
  for (const k of card.Keywords ?? []) t = t.replace(new RegExp(`\\b${k.trim()}\\b(\\s+\\d+)?`, 'gi'), '')
  return t.replace(/[\s.,]+/g, ' ').trim()
}

/**
 * Normal printings only, one row per real card. A set listing carries every variant, and some sets
 * reprint one card at several collector numbers (IBH's 104 slots are 51 cards), so implementing it
 * once covers every printing. Name plus subtitle identifies a card; the lowest number wins.
 *
 * **De-duplication is within a set, never across sets.** A card reprinted in a later set is a
 * separate card id, and the engine registers abilities per id, so collapsing the two would
 * undercount the work. The set code is therefore part of the key, and cross-set reprints are
 * reported separately by `triage` because one registration can cover several ids.
 */
export function normalPrintings(pool: SwuCard[]): SwuCard[] {
  const seen = new Map<string, SwuCard>()
  for (const c of pool) {
    if (c.VariantType != null && c.VariantType !== 'Normal') continue
    const key = `${c.Set}||${identityKey(c)}`
    const prev = seen.get(key)
    if (!prev || Number(c.Number) < Number(prev.Number)) seen.set(key, c)
  }
  return [...seen.values()]
}

/** Colon-led trigger heads, read from the card rather than from a guessed list. */
function triggerHeads(text: string): string[] {
  const heads: string[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z][^:\n]{0,48}):/.exec(line)
    if (m) heads.push(m[1].replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim())
  }
  return heads
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

export function triage(pool: SwuCard[]): TriageReport {
  const cards = normalPrintings(pool).filter(c => c.Type !== 'Token')
  const buckets: Record<TriageBucket, number> = { vanilla: 0, 'existing-keyword': 0, 'new-keyword-only': 0, ability: 0 }
  const triaged: TriagedCard[] = []
  const sets = new Set<string>()
  let leaders = 0

  for (const card of cards) {
    sets.add(card.Set)
    const text = (card.FrontText ?? '').trim()
    const keywords = (card.Keywords ?? []).map(k => k.trim()).filter(Boolean)
    const isLeader = card.Type === 'Leader'
    if (isLeader) leaders++

    // A leader is never vanilla: its deployed side always carries an ability, and reading only
    // FrontText would wrongly pass one whose front is blank (ASH's Grogu).
    const newKeywords = keywords.filter(k => !IMPLEMENTED_KEYWORDS.has(k) && !/^Keywords?$/i.test(k))
    let bucket: TriageBucket
    if (isLeader) bucket = 'ability'
    else if (!text) bucket = 'vanilla'
    else if (residualAbility(card) === '') bucket = newKeywords.length ? 'new-keyword-only' : 'existing-keyword'
    else bucket = 'ability'
    buckets[bucket]++

    if (bucket !== 'ability' && bucket !== 'new-keyword-only') continue

    const blockers = new Set<string>()
    for (const [name, re] of NEW_MECHANICS) if (re.test(text)) blockers.add(name)
    for (const k of newKeywords) blockers.add(`kw:${k}`)
    for (const h of triggerHeads(text)) {
      const norm = h.toLowerCase()
      if (norm.includes('/')) blockers.add('trigger:compound')
      else if (!EXISTING_TRIGGERS.has(norm)) blockers.add(`trigger:${h}`)
    }

    triaged.push({
      id: `${card.Set}_${card.Number}`,
      set: card.Set,
      type: card.Type,
      name: card.Name,
      bucket,
      blockers: [...blockers],
      suspects: SUSPECT_SHAPES.filter(([, re]) => re.test(text)).map(([n]) => n),
      text,
    })
  }

  // Fold rare trigger heads into one bucket: a head on one or two cards is a one-off, not a mechanic.
  const triggerFreq = new Map<string, number>()
  for (const c of triaged) for (const b of c.blockers) if (b.startsWith('trigger:')) bump(triggerFreq, b)
  for (const c of triaged) {
    c.blockers = [...new Set(c.blockers.map(b => {
      const canonical = CANONICAL_BLOCKERS.get(b) ?? b
      return canonical.startsWith('trigger:') && (triggerFreq.get(canonical) ?? triggerFreq.get(b) ?? 0) < ONE_OFF_THRESHOLD
        ? 'trigger:one-off'
        : canonical
    }))]
  }

  const sole = new Map<string, number>()
  const touched = new Map<string, number>()
  for (const c of triaged) {
    if (c.blockers.length === 1) bump(sole, c.blockers[0])
    for (const b of c.blockers) bump(touched, b)
  }

  const free = triaged.filter(c => c.blockers.length === 0)
  const batchHeads = new Map<string, number>()
  for (const c of free) {
    const heads = new Set(triggerHeads(c.text))
    if (heads.size === 0) bump(batchHeads, '(constant / no trigger head)')
    for (const h of heads) bump(batchHeads, h)
  }

  const fallout = new Map<string, number>()
  let suspectCards = 0
  for (const c of free) {
    if (c.suspects.length > 0) suspectCards++
    for (const s of c.suspects) bump(fallout, s)
  }

  /**
   * Cards with ability text printed in more than one set. Reprints exist mostly to balance sealed
   * pools and skew vanilla, so most never reach here, but the ones that do are free work: the
   * ability is registered once per id against the same behaviour. Rarity can differ between
   * printings without affecting that, since rarity is not something the engine reads.
   */
  const byIdentity = new Map<string, TriagedCard[]>()
  for (const c of triaged) {
    const source = cards.find(x => `${x.Set}_${x.Number}` === c.id)
    if (!source) continue
    const key = identityKey(source)
    const group = byIdentity.get(key)
    if (group) group.push(c)
    else byIdentity.set(key, [c])
  }
  const reprints = [...byIdentity.values()]
    .filter(group => new Set(group.map(c => c.set)).size > 1)
    .map(group => {
      const ids = group.map(c => c.id).sort()
      // Registered = every printing resolves to the same id, so one implementation serves them all.
      const registered = new Set(ids.map(id => reprintCanonicalId(id) ?? id)).size === 1
      return { name: group[0].name, type: group[0].type, ids, registered }
    })
    .sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name))
  const reprintSavings = reprints.reduce((n, r) => n + r.ids.length - 1, 0)

  const byCount = <T extends { cards: number }>(a: T, b: T): number => b.cards - a.cards
  return {
    reprints,
    reprintSavings,
    sets: [...sets].sort(),
    cards: cards.length,
    leaders,
    buckets,
    blockers: [...touched.entries()]
      .map(([name, n]) => ({ name, sole: sole.get(name) ?? 0, touched: n }))
      .sort((a, b) => b.sole - a.sole || b.touched - a.touched),
    batches: [...batchHeads.entries()].map(([head, cards]) => ({ head, cards })).sort(byCount),
    fallout: [...fallout.entries()].map(([probe, cards]) => ({ probe, cards })).sort(byCount),
    suspectCards,
    triaged,
  }
}

/** Fetch whole sets from the card API. One request per set returns every card in it. */
export async function fetchSets(codes: string[]): Promise<SwuCard[]> {
  const out: SwuCard[] = []
  for (const code of codes) {
    const set = code.toUpperCase()
    const response = await fetch(`${TRIAGE_API_BASE}/cards/search?q=set:${set}`)
    if (!response.ok) throw new Error(`Set ${set} could not be fetched (${response.status})`)
    const payload = (await response.json()) as { data?: SwuCard[] }
    const data = payload.data ?? []
    if (data.length === 0) throw new Error(`Set ${set} returned no cards`)
    out.push(...data)
  }
  return out
}

export function formatTriage(r: TriageReport): string[] {
  const pad = (s: string | number, n: number): string => String(s).padEnd(n)
  const num = (s: string | number, n: number): string => String(s).padStart(n)
  const free = r.triaged.filter(c => c.blockers.length === 0).length
  const single = r.triaged.filter(c => c.blockers.length === 1).length
  const multi = r.triaged.filter(c => c.blockers.length > 1).length

  const lines = [
    `dmgCtrl card triage  (${r.sets.join(', ')})`,
    '',
    `  ${num(r.cards, 5)} distinct cards, of which ${r.leaders} leaders`,
    '',
    '  Buckets',
    `  ${num(r.buckets.vanilla, 5)}  vanilla (no ability text)`,
    `  ${num(r.buckets['existing-keyword'], 5)}  keyword-only, all keywords implemented`,
    `  ${num(r.buckets['new-keyword-only'], 5)}  otherwise vanilla, held back by a keyword`,
    `  ${num(r.buckets.ability, 5)}  real ability text`,
    '',
    '  Ability cards by how many new things block them',
    `  ${num(free, 5)}  blocked by nothing (buildable today)`,
    `  ${num(single, 5)}  blocked by exactly one`,
    `  ${num(multi, 5)}  blocked by two or more`,
    '',
    '  Blockers, by cards unlocked on their own',
    `  ${pad('blocker', 34)}${num('sole', 6)}${num('touched', 9)}`,
  ]
  for (const b of r.blockers) lines.push(`  ${pad(b.name, 34)}${num(b.sole, 6)}${num(b.touched, 9)}`)

  lines.push('', '  Batch sizing: trigger heads on the unblocked cards')
  for (const b of r.batches) if (b.cards >= ONE_OFF_THRESHOLD) lines.push(`  ${num(b.cards, 5)}  ${b.head}`)

  lines.push('', `  Fallout probes: ${r.suspectCards} of ${free} unblocked cards want a human reading`)
  for (const f of r.fallout) lines.push(`  ${num(f.cards, 5)}  ${f.probe}`)

  lines.push('', `  Cross-set reprints: ${r.reprints.length} ability cards printed in more than one set,`)
  lines.push(`  covering ${r.reprintSavings} extra card ids for no extra work.`)
  // Unregistered first: each is a line to add to data/reprints.ts, which is the actionable half.
  const missing = r.reprints.filter(rp => !rp.registered)
  lines.push(`  ${missing.length} not yet collapsed onto one implementation (add a line to data/reprints.ts).`)
  for (const rp of [...missing, ...r.reprints.filter(rp => rp.registered)].slice(0, 10)) {
    lines.push(`  ${pad(rp.name, 34)}${pad(rp.ids.join(', '), 32)}${rp.registered ? 'registered' : ''}`.trimEnd())
  }
  if (r.reprints.length > 10) lines.push(`  ... and ${r.reprints.length - 10} more`)

  lines.push('', '  Triage, not a specification. Every card still needs reading before it is built.')
  return lines
}
