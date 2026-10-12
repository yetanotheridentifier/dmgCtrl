import type { SwuCard } from './cards'
import { logger } from './log'

/**
 * The set snapshots the app ships, so a set's cards are on the device without the card API.
 *
 * They are the bench's fixture files, read where they are: one copy, written by
 * `npm run bench -- --fixture` (`bench/setPools.ts`), so the game plays the card data the bench and
 * the tests are run against. A snapshot holds Normal printings only, one row per card, no tokens,
 * and none of the art fields.
 *
 * Each is loaded with `import()`, which makes it a file of its own in the build, fetched the first
 * time its set is asked for. A static import here would put every set in the script the page needs
 * before it can draw anything.
 */
const SNAPSHOTS: Record<string, () => Promise<{ default: unknown }>> = {
  HMW: () => import('../test/fixtures/hmwSet.json'),
  ASH: () => import('../test/fixtures/ashSet.json'),
  LAW: () => import('../test/fixtures/lawSet.json'),
  SEC: () => import('../test/fixtures/secSet.json'),
  LOF: () => import('../test/fixtures/lofSet.json'),
  JTL: () => import('../test/fixtures/jtlSet.json'),
  TWI: () => import('../test/fixtures/twiSet.json'),
  SHD: () => import('../test/fixtures/shdSet.json'),
  SOR: () => import('../test/fixtures/sorSet.json'),
  TS26: () => import('../test/fixtures/ts26Set.json'),
  IBH: () => import('../test/fixtures/ibhSet.json'),
}

/** Every set with a snapshot. */
export const BUNDLED_SET_CODES: readonly string[] = Object.keys(SNAPSHOTS)

/**
 * A collector number without its leading zeros. Deck lists pad every number, most sets are filed
 * padded and a few are not (IBH and TS26), so two spellings of a number name the same card.
 */
export function unpadded(number: string): string {
  return number.replace(/^0+(?=.)/, '')
}

const ART = 'https://cdn.swu-db.com/images/cards'

/**
 * A snapshot row with its art named. The card API files every card's art under its set and number,
 * and a leader's back under the same with `-b`, so the fields a snapshot leaves out are a rule
 * rather than data, and the art itself still streams from the proxy. `--fixture` checks the rule
 * against the listing each time a snapshot is written (`artOffRule` in `bench/setPools.ts`).
 */
export function withArt(card: SwuCard): SwuCard {
  const front = `${ART}/${card.Set}/${card.Number}`
  return { ...card, FrontArt: `${front}.png`, ...(card.Type === 'Leader' && { BackArt: `${front}-b.png` }) }
}

const loaded = new Map<string, Promise<SwuCard[]>>()

/**
 * Every card of a bundled set, or none for a set with no snapshot. A snapshot that fails to load (the
 * site itself out of reach) reads as none too, and is asked for again next time, so the callers fall
 * through to the network exactly as they do for a set that was never bundled.
 */
export function bundledSetCards(setCode: string): Promise<SwuCard[]> {
  const set = setCode.toUpperCase()
  const snapshot = SNAPSHOTS[set]
  if (!snapshot) return Promise.resolve([])
  let cards = loaded.get(set)
  if (!cards) {
    cards = snapshot()
      .then(module => (module.default as SwuCard[]).map(withArt))
      .catch((err: unknown) => {
        logger.warn('bundled set failed to load', { set, error: String(err) })
        loaded.delete(set)
        return []
      })
    loaded.set(set, cards)
  }
  return cards
}

/** One card of a bundled set, under the number its set uses, whichever spelling it was asked by. */
export async function bundledCard(setCode: string, number: string): Promise<SwuCard | undefined> {
  const wanted = unpadded(number)
  return (await bundledSetCards(setCode)).find(card => unpadded(card.Number) === wanted)
}
