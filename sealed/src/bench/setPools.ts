import hmwSet from '../test/fixtures/hmwSet.json'
import ashSet from '../test/fixtures/ashSet.json'
import lawSet from '../test/fixtures/lawSet.json'
import secSet from '../test/fixtures/secSet.json'
import lofSet from '../test/fixtures/lofSet.json'
import jtlSet from '../test/fixtures/jtlSet.json'
import twiSet from '../test/fixtures/twiSet.json'
import shdSet from '../test/fixtures/shdSet.json'
import sorSet from '../test/fixtures/sorSet.json'
import ts26Set from '../test/fixtures/ts26Set.json'
import ibhSet from '../test/fixtures/ibhSet.json'
import { fromSearchRow, type SwuCard } from '../data/cards'
import { SET_PROGRESS } from '../data/implementedCards'
import { normalPrintings } from './triage'

/**
 * The card pools the bench can draw on: one bundled fixture per set, and the rules for naming a list
 * of them. Fixtures are written by `--fixture` from the live card API and committed, so a run never
 * depends on the network and is reproducible from its seed and set list alone.
 */

/** Every set, in the order the setup panel lists them. This order is canonical for a multi-set pool. */
export const SET_CODES: readonly string[] = SET_PROGRESS.map(s => s.code)

const FIXTURES: Record<string, SwuCard[]> = {
  HMW: hmwSet as unknown as SwuCard[],
  ASH: ashSet as unknown as SwuCard[],
  LAW: lawSet as unknown as SwuCard[],
  SEC: secSet as unknown as SwuCard[],
  LOF: lofSet as unknown as SwuCard[],
  JTL: jtlSet as unknown as SwuCard[],
  TWI: twiSet as unknown as SwuCard[],
  SHD: shdSet as unknown as SwuCard[],
  SOR: sorSet as unknown as SwuCard[],
  TS26: ts26Set as unknown as SwuCard[],
  IBH: ibhSet as unknown as SwuCard[],
}

/**
 * The fewest cards a set needs to be swept as sealed. A sealed deck is built from a pool opened from
 * one set, and a smaller product (TS26 at 84 cards, IBH at 51) is not designed for sealed play: the
 * generator cannot fill a 30-card deck from it, and IBH built one of 3 cards. A count rather than a
 * list, so a small product released later is left out without anyone adding it.
 */
export const SEALED_MIN_CARDS = 200

/** The sets a sealed sweep can draw on, in canonical order. */
export const SEALED_SET_CODES: readonly string[] = SET_CODES.filter(code => (FIXTURES[code]?.length ?? 0) >= SEALED_MIN_CARDS)

/** Where a set's fixture lives, relative to `sealed/`. */
export function fixtureFile(code: string): string {
  return `src/test/fixtures/${code.toLowerCase()}Set.json`
}

/**
 * Upper-case, expand `all`, drop repeats, and return the sets in canonical order. The order decides
 * which decks play first and so which games open on which seat, so a run should depend on which
 * sets were named rather than on how they were typed.
 */
export function resolveSetCodes(requested: readonly string[]): string[] {
  if (requested.length === 0) throw new Error('Name at least one set, e.g. LAW, LAW,SEC or all')
  const wanted = new Set<string>()
  for (const raw of requested) {
    const code = raw.trim().toUpperCase()
    if (code === 'ALL') {
      for (const c of SET_CODES) wanted.add(c)
    } else if (SET_CODES.includes(code)) {
      wanted.add(code)
    } else {
      throw new Error(`Unknown set: ${code} (known: ${SET_CODES.join(', ')}, or all)`)
    }
  }
  return SET_CODES.filter(c => wanted.has(c))
}

/**
 * `resolveSetCodes` for a sealed sweep: `all` means every sealed set, and a set too small for sealed is
 * refused when named rather than quietly dropped, since the caller asked for it.
 */
export function resolveSealedSets(requested: readonly string[]): string[] {
  const named = new Set(requested.map(r => r.trim().toUpperCase()))
  const codes = resolveSetCodes(requested)
  for (const code of codes) {
    if (named.has(code) && !SEALED_SET_CODES.includes(code)) {
      throw new Error(`${code} has ${FIXTURES[code]?.length ?? 0} cards, too few for sealed decks (needs ${SEALED_MIN_CARDS})`)
    }
  }
  return codes.filter(code => SEALED_SET_CODES.includes(code))
}

/** The named sets' cards, joined in canonical order. */
export function poolFor(codes: readonly string[]): SwuCard[] {
  return resolveSetCodes(codes).flatMap(code => {
    const cards = FIXTURES[code]
    if (!cards) throw new Error(`No fixture for ${code}: write one with --fixture ${code}`)
    return cards
  })
}

/** The fields a fixture keeps, in the order it keeps them. Everything else the API returns (art, prices, ids) is dropped. */
const FIXTURE_FIELDS = [
  'Set', 'Number', 'Name', 'Subtitle', 'Type', 'Cost', 'Power', 'HP', 'Arenas', 'Aspects', 'Traits',
  'Keywords', 'Unique', 'FrontText', 'BackText', 'Rarity',
] as const

/**
 * Turn a set listing from `cards/search?q=set:` into fixture rows: unwrapped (see `fromSearchRow`),
 * Normal printings only, one row per card within a set (see `normalPrintings`), no tokens, and only the
 * fixture fields, in fixture order. A field the row does not carry is left out rather than defaulted.
 */
export function toFixture(rows: readonly object[]): SwuCard[] {
  return normalPrintings(rows.map(fromSearchRow))
    .filter(card => card.Type !== 'Token')
    .map(card => {
      const source = card as unknown as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const field of FIXTURE_FIELDS) {
        if (source[field] !== undefined) out[field] = source[field]
      }
      return out as unknown as SwuCard
    })
}
