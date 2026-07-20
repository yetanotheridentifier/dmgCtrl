import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { UNIT_GROUPS } from '../data/implementedCards'
import { normaliseCard, buildCardDb } from '../engine/cardDb'
import { registeredCardIds } from '../engine/abilities'
import '../engine/cardDefinitions' // side effect: registers every implemented card
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'

/**
 * The ~39 vanilla + keyword-only units that need NO engine work. These tests
 * validate that claim against a snapshot of the real ASH card data (`fixtures/ashSet.json`):
 * every listed card is a unit whose only "ability" is already-implemented keywords, so it plays
 * correctly as printed. Keyword *behaviour* is covered by keywords/keywordCombat/keywordsMissing.
 */

const SET = ashSet as unknown as SwuCard[]
const UNITS = SET.filter(c => c.Type === 'Unit')
const byName = new Map(UNITS.map(c => [c.Name, c])) // unit names are unique within the set
const IMPLEMENTED_KEYWORDS = new Set(['Ambush', 'Grit', 'Overwhelm', 'Raid', 'Restore', 'Saboteur', 'Sentinel', 'Shielded', 'Hidden', 'Support'])
const keywordOnly = UNIT_GROUPS.find(g => g.id === 'keyword')!.units

/** Ability text left after removing keyword names and their (parenthetical) reminders — empty ⇒ keyword-only. */
function residualAbility(c: SwuCard): string {
  let t = (c.FrontText ?? '').trim().replace(/\([^)]*\)/g, '')
  for (const k of c.Keywords ?? []) t = t.replace(new RegExp(`\\b${k.trim()}\\b(\\s+\\d+)?`, 'gi'), '')
  return t.replace(/[\s.,]+/g, ' ').trim()
}

describe('Keyword-only units — no engine work needed', () => {
  it('each entry is a real ASH unit card', () => {
    for (const u of keywordOnly) expect(byName.get(u.name), u.name).toBeTruthy()
  })

  it('each is keyword-only — no ability text beyond keyword reminders', () => {
    for (const u of keywordOnly) {
      const c = byName.get(u.name)!
      expect(residualAbility(c), `${u.name}: "${(c.FrontText ?? '').replace(/\n/g, ' ')}"`).toBe('')
    }
  })

  it('each uses only keywords that are already implemented', () => {
    for (const u of keywordOnly) {
      for (const k of byName.get(u.name)!.Keywords ?? []) {
        expect(IMPLEMENTED_KEYWORDS.has(k.trim()), `${u.name}: ${k}`).toBe(true)
      }
    }
  })

  it('none of them needs a registered ability definition', () => {
    const registered = new Set(registeredCardIds())
    for (const u of keywordOnly) {
      // The group now carries card ids, so this checks the id we actually ship.
      expect(normaliseCard(byName.get(u.name)!).id, u.name).toBe(u.id)
      expect(registered.has(u.id), `${u.name} (${u.id}) should have no definition`).toBe(false)
    }
  })

  // Real-data smoke tests: build the card db from the fixture and confirm a couple of these
  // archetypes play through the engine, tying the actual card data to the keyword behaviour.
  it('a keyword-only Shielded unit (Noti Nomad) enters play with a Shield token', () => {
    const noti = byName.get('Noti Nomad')!
    const id = normaliseCard(noti).id
    const s = state({
      cards: { ...CARDS, ...buildCardDb([noti]) },
      players: { player: player({ hand: [id], resources: ready(15) }), opponent: player() },
    })
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(next.players.player.units[0].upgrades.some(u => u.cardId === TOKEN_SHIELD)).toBe(true)
  })

  it('a keyword-only Sentinel unit (Imperial Loyalist) forces enemy attacks onto it', () => {
    const sentinel = byName.get('Imperial Loyalist')!
    const id = normaliseCard(sentinel).id
    const s = state({
      cards: { ...CARDS, ...buildCardDb([sentinel]) },
      activePlayer: 'opponent',
      players: {
        player: player({ units: [unit('sent', id), unit('bystander', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }),
      },
    })
    // Enemy (opponent) may only attack the Sentinel — the bystander is protected.
    const targets = legalMoves(s).flatMap(a => (a.type === 'attack' && a.target.kind === 'unit' ? [a.target.instanceId] : []))
    expect(targets).toEqual(['sent'])
  })
})
