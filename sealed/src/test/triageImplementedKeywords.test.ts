import { describe, it, expect } from 'vitest'
import { normaliseCard } from '../engine/cardDb'
import { registeredCardIds } from '../engine/abilities'
import '../engine/cardDefinitions' // side effect: registers every implemented card
import { reprintCanonicalId } from '../data/reprints'
import { normalPrintings, triage } from '../bench/triage'
import { SET_CODES, poolFor } from '../bench/setPools'

/**
 * `IMPLEMENTED_KEYWORDS` (triage.ts) must never call a keyword unbuilt once cards carrying it are
 * actually registered. #713: Bounty shipped 24 registered cards (#467) while the constant still
 * omitted it, so every one of them kept reporting a `kw:Bounty` blocker forever, silently wrong in
 * every triage count that touched it.
 *
 * This pins the constant against the real card pool and `registeredCardIds()`, not against the
 * triage tool's own say-so, following the module/doc correspondence `docsBenchInventory.test.ts`
 * already uses for `src/bench`.
 */
describe('IMPLEMENTED_KEYWORDS against the real card pool', () => {
  const registered = new Set(registeredCardIds())
  const isRegistered = (id: string): boolean => registered.has(reprintCanonicalId(id) ?? id)

  const pool = poolFor(SET_CODES)
  const cards = normalPrintings(pool).filter(c => c.Type !== 'Token')
  const byId = new Map(cards.map(c => [`${c.Set}_${c.Number}`, c]))
  const report = triage(pool)

  it('flags no registered card with a `kw:` blocker for its own printed keyword', () => {
    // A registered card is built. A `kw:<Keyword>` blocker on one of its own printed keywords means
    // that keyword shipped without ever being added to IMPLEMENTED_KEYWORDS, so this catches the next
    // keyword to repeat #713's bug, whichever one it is.
    const offenders = report.triaged
      .filter(c => isRegistered(normaliseCard(byId.get(c.id)!).id))
      .flatMap(c => c.blockers.filter(b => b.startsWith('kw:')).map(b => `${c.id} ${b}`))
    expect(offenders).toEqual([])
  })
})
