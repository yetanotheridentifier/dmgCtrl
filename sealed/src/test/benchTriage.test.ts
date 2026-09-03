import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { SWU_DB_API } from '../data/cards'
import { printingKey } from '../data/printings'
import {
  IMPLEMENTED_KEYWORDS,
  TRIAGE_API_BASE,
  identityKey,
  normalPrintings,
  residualAbility,
  triage,
} from '../bench/triage'

/**
 * Card-pool triage: classify a set by what the engine cannot yet express, so a newly released set
 * can be sized without reading 260 cards by hand.
 *
 * The load-bearing test is the ASH anchor: the tool's "plays as printed" count must agree with the
 * figure `data/implementedCards.ts` already records by hand. Two independent derivations agreeing is
 * what makes the tool's numbers for the OTHER sets trustworthy.
 */

const ASH = ashSet as unknown as SwuCard[]

const card = (over: Partial<SwuCard>): SwuCard => ({
  Set: 'TST', Number: '1', Name: 'Test', Type: 'Unit', ...over,
})

describe('residualAbility', () => {
  it('is empty for a card whose only text is its keywords and their reminders', () => {
    expect(residualAbility(card({
      Keywords: ['Sentinel', 'Raid'],
      FrontText: 'Sentinel (Enemy units must attack this unit if able.)\nRaid 2',
    }))).toBe('')
  })

  it('keeps text that is a real ability', () => {
    expect(residualAbility(card({
      Keywords: ['Sentinel'],
      FrontText: 'Sentinel\nWhen Played: Draw a card.',
    }))).not.toBe('')
  })

  it('is empty for a card with no text at all', () => {
    expect(residualAbility(card({}))).toBe('')
  })
})

describe('normalPrintings', () => {
  it('drops non-Normal variants', () => {
    const pool = [
      card({ Number: '1', VariantType: 'Normal' }),
      card({ Number: '2', Name: 'Hyper', VariantType: 'Hyperspace' }),
    ]
    expect(normalPrintings(pool).map(c => c.Number)).toEqual(['1'])
  })

  it('de-duplicates a card reprinted at several collector numbers, keeping the lowest', () => {
    // IBH reprints the same card at up to three numbers; 104 printed slots are 51 real cards.
    const pool = [
      card({ Number: '103', Name: 'Blizzard Force AT-ST' }),
      card({ Number: '70', Name: 'Blizzard Force AT-ST' }),
      card({ Number: '89', Name: 'Blizzard Force AT-ST' }),
    ]
    const out = normalPrintings(pool)
    expect(out).toHaveLength(1)
    expect(out[0].Number).toBe('70')
  })

  it('keeps a card reprinted in a later set as a separate card', () => {
    // Different set means a different card id, and abilities register per id. Collapsing these
    // would undercount the work.
    const pool = [
      card({ Set: 'SOR', Number: '10', Name: 'Vanguard Infantry' }),
      card({ Set: 'LAW', Number: '55', Name: 'Vanguard Infantry' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })

  it('keeps two cards that share a name but differ by subtitle', () => {
    const pool = [
      card({ Number: '1', Name: 'Grogu', Subtitle: 'Found' }),
      card({ Number: '2', Name: 'Grogu', Subtitle: 'Irresistible' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })
})

describe('triage buckets', () => {
  const report = triage([
    card({ Number: '1', Name: 'Plain' }),
    card({ Number: '2', Name: 'Keyworded', Keywords: ['Sentinel'], FrontText: 'Sentinel' }),
    card({ Number: '3', Name: 'Plotter', Keywords: ['Plot'], FrontText: 'Plot' }),
    card({ Number: '4', Name: 'Abilitied', FrontText: 'When Played: Draw a card.' }),
    card({ Number: '5', Name: 'Chief', Type: 'Leader', FrontText: 'Action: Draw a card.' }),
    card({ Number: '6', Name: 'Shield', Type: 'Token' }),
  ])

  it('sorts each card into exactly one bucket', () => {
    expect(report.buckets.vanilla).toBe(1)
    expect(report.buckets['existing-keyword']).toBe(1)
    expect(report.buckets['new-keyword-only']).toBe(1)
    expect(report.buckets.ability).toBe(2) // the ability card plus the leader
  })

  it('excludes tokens entirely and counts leaders separately', () => {
    expect(report.cards).toBe(5)
    expect(report.leaders).toBe(1)
  })

  it('treats a leader as never vanilla, since its deployed side always carries an ability', () => {
    const leaderOnly = triage([card({ Type: 'Leader', Name: 'Blankfront' })])
    expect(leaderOnly.buckets.vanilla).toBe(0)
    expect(leaderOnly.buckets.ability).toBe(1)
  })
})

describe('triage blockers', () => {
  it('reports a card blocked by nothing as having no blockers', () => {
    const r = triage([card({ FrontText: 'When Played: Draw a card.' })])
    expect(r.triaged[0].blockers).toEqual([])
  })

  it('counts a sole blocker as unlocking its card on its own', () => {
    const r = triage([card({ FrontText: 'When Played: Give an Experience token to a friendly unit.' })])
    const xp = r.blockers.find(b => b.name === 'experience-token')
    expect(xp).toBeDefined()
    expect(xp!.sole).toBe(1)
    expect(xp!.touched).toBe(1)
  })

  it('credits neither blocker with a sole unlock when a card needs two', () => {
    // Bounty is gated behind capture: "when this unit is defeated OR CAPTURED".
    const r = triage([card({
      Keywords: ['Bounty'],
      FrontText: 'Bounty - Draw a card. (When this unit is defeated or captured, your opponent collects its bounty.)',
    })])
    const bounty = r.blockers.find(b => b.name === 'kw:Bounty')!
    const capture = r.blockers.find(b => b.name === 'capture')!
    expect(bounty.touched).toBe(1)
    expect(bounty.sole).toBe(0)
    expect(capture.touched).toBe(1)
    expect(capture.sole).toBe(0)
  })

  it('does not treat an implemented keyword as a blocker', () => {
    const r = triage([card({ Keywords: ['Sentinel'], FrontText: 'Sentinel\nWhen Played: Draw a card.' })])
    expect(r.triaged[0].blockers).toEqual([])
    expect(IMPLEMENTED_KEYWORDS.has('Sentinel')).toBe(true)
  })
})

describe('triage fallout probes', () => {
  // The probes exist because the blocker list catches new NOUNS but not familiar nouns in an
  // unfamiliar SHAPE. This card is the real SEC_145, which reads as ordinary text and is not.
  const confidenceInVictory = card({
    Set: 'SEC', Number: '145', Type: 'Event', Name: 'Confidence in Victory',
    FrontText: 'Play only as your first action in the action phase.\nChoose an arena. At the start of the regroup phase, if you are the only player who controls units in that arena, you win the game.',
  })

  it('flags a card that needs engine work no blocker probe can see', () => {
    const r = triage([confidenceInVictory])
    expect(r.triaged[0].blockers).toEqual([]) // classified free ...
    expect(r.triaged[0].suspects).toEqual(   // ... but flagged for reading
      expect.arrayContaining(['alternate-win', 'play-restriction', 'delayed-effect']),
    )
    expect(r.suspectCards).toBe(1)
  })

  it('does not flag an ordinary card', () => {
    const r = triage([card({ FrontText: 'When Played: Draw a card.' })])
    expect(r.triaged[0].suspects).toEqual([])
    expect(r.suspectCards).toBe(0)
  })
})

describe('the ASH anchor', () => {
  const report = triage(ASH)

  it('agrees with the hand-recorded "plays as printed" count for ASH', () => {
    // data/implementedCards.ts records ASH as { bases: 8, units: 39 } playable with no engine work.
    // Derived independently here, the two must match, or one of them is wrong.
    expect(report.buckets.vanilla + report.buckets['existing-keyword']).toBe(47)
  })

  it('finds every ASH leader', () => {
    expect(report.leaders).toBe(18)
  })

  it('finds no unimplemented keyword in ASH', () => {
    // ASH uses none of Bounty, Coordinate, Exploit, Piloting, Plot or Smuggle.
    expect(report.buckets['new-keyword-only']).toBe(0)
    expect(report.blockers.filter(b => b.name.startsWith('kw:'))).toEqual([])
  })

  it('finds no card granting an Experience token, which is why ASH reads 3 of 4 tokens', () => {
    // The token is printed in the set; no ASH card grants one, so nothing is blocked on it.
    expect(report.blockers.some(b => b.name === 'experience-token')).toBe(false)
  })
})

describe('card identity', () => {
  it('matches the printing key the app canonicalises with, so the two cannot drift', () => {
    const c = card({ Type: 'Unit', Name: 'Grogu', Subtitle: 'Irresistible' })
    expect(identityKey(c)).toBe(printingKey(c))
  })

  it('separates a leader from a unit that shares its name with no subtitle', () => {
    // ASH has 13 unit names that collide with leader names. Without Type in the key one is lost.
    const pool = [
      card({ Set: 'ASH', Number: '18', Type: 'Leader', Name: 'Grogu' }),
      card({ Set: 'ASH', Number: '155', Type: 'Unit', Name: 'Grogu' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })
})

describe('cross-set reprints', () => {
  const reprinted = {
    Type: 'Unit', Name: 'Vanguard Infantry',
    FrontText: 'When Played: Draw a card.',
  }

  it('reports a card printed in two sets, and the ids one registration covers', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.reprints).toHaveLength(1)
    expect(r.reprints[0].ids).toEqual(['LAW_55', 'SOR_10'])
    // Two ids, one behaviour: the saving is the extra id, not the card.
    expect(r.reprintSavings).toBe(1)
  })

  it('counts both printings as work, since abilities register per card id', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.cards).toBe(2)
    expect(r.buckets.ability).toBe(2)
  })

  it('ignores a card printed once', () => {
    expect(triage([card({ ...reprinted, Set: 'SOR', Number: '10' })]).reprints).toEqual([])
  })

  /**
   * The reprint table (`data/reprints.ts`) is declared by hand, so triage is where a new set's
   * reprints get noticed: a pair it does not collapse onto one id is a line still to add (#551).
   */
  it('marks a pair the reprint table already collapses onto one implementation', () => {
    const r = triage([
      card({ ...reprinted, Set: 'ASH', Number: '258' }),
      card({ ...reprinted, Set: 'SEC', Number: '258' }),
    ])
    expect(r.reprints[0].registered).toBe(true)
  })

  it('marks a pair the table does not cover, which is the work it is reporting', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.reprints[0].registered).toBe(false)
  })

  it('does not treat a same-set reprint at another collector number as cross-set', () => {
    // IBH prints one card at up to three numbers. That collapses in normalPrintings instead.
    const r = triage([
      card({ ...reprinted, Set: 'IBH', Number: '70' }),
      card({ ...reprinted, Set: 'IBH', Number: '89' }),
    ])
    expect(r.cards).toBe(1)
    expect(r.reprints).toEqual([])
  })
})

describe('the fetch endpoint', () => {
  it('uses the same origin as the app, so the two cannot drift', () => {
    expect(TRIAGE_API_BASE).toBe(SWU_DB_API)
  })
})
