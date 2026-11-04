import { useEffect, useState } from 'react'
import { getCard } from '../data/cards'
import type { SwuCard } from '../data/cards'
import { normaliseCard } from '../engine/cardDb'
import type { EngineCard } from '../engine/types'
import { cardRefFromId } from '../utils/parseProtectThePod'

/**
 * Cards looked up for the setup screen, kept for the session: a deck's leader, base and list are read
 * many times (the deck card, the sheet, the view) and each card is fetched once. A pool a generator has
 * loaded is added whole, so a generated deck needs no lookups at all.
 */
const known = new Map<string, EngineCard>()
const pending = new Map<string, Promise<void>>()

/** Add cards already in hand, such as a generator's pool. */
export function primeCards(cards: SwuCard[]): void {
  for (const card of cards) {
    const engine = normaliseCard(card)
    if (!known.has(engine.id)) known.set(engine.id, engine)
  }
}

function lookUp(id: string): Promise<void> {
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const ref = cardRefFromId(id)
  const lookup = (ref ? getCard(ref.set, ref.number) : Promise.reject(new Error(`not a card id: ${id}`)))
    .then(card => { known.set(id, { ...normaliseCard(card), id }) })
    // A card that cannot be found stays unknown and the screen shows its id: one missing card does not
    // stop the rest of the deck from showing. It is asked for again on the next screen that names it.
    .catch(() => {})
    .finally(() => pending.delete(id))
  pending.set(id, lookup)
  return lookup
}

/**
 * The cards named by `ids`, as far as they are found: local first (the cache, then the bundled sets),
 * then the network, as a game loads them. Re-renders as each batch lands.
 */
export function useCardLookup(ids: string[]): Record<string, EngineCard | undefined> {
  const key = [...new Set(ids)].sort().join(',')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const missing = key ? key.split(',').filter(id => !known.has(id)) : []
    if (missing.length === 0) return
    let live = true
    void Promise.all(missing.map(lookUp)).then(() => { if (live) setVersion(v => v + 1) })
    return () => { live = false }
  }, [key])

  // Read on every render rather than memoised: a pool primed by another component is a card found
  // without this hook's own lookup finishing. `version` re-renders for the ones it did find.
  void version
  const out: Record<string, EngineCard | undefined> = {}
  for (const id of key ? key.split(',') : []) out[id] = known.get(id)
  return out
}
