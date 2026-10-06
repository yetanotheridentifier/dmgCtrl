import { describe, it, expect } from 'vitest'
import { normaliseCard } from '../engine/cardDb'
import { CARD_DATA_CORRECTIONS } from '../engine/cardDataCorrections'
import { unitHasKeyword } from '../engine/keywords'
import { state, player, unit } from './helpers/engineFixtures'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import type { SwuCard } from '../data/cards'
import type { EngineCard } from '../engine/types'
import ashSet from './fixtures/ashSet.json'
import hmwSet from './fixtures/hmwSet.json'
import ibhSet from './fixtures/ibhSet.json'
import jtlSet from './fixtures/jtlSet.json'
import lawSet from './fixtures/lawSet.json'
import lofSet from './fixtures/lofSet.json'
import secSet from './fixtures/secSet.json'
import shdSet from './fixtures/shdSet.json'
import sorSet from './fixtures/sorSet.json'
import ts26Set from './fixtures/ts26Set.json'
import twiSet from './fixtures/twiSet.json'

/**
 * A unit or leader has the keywords its card **prints** (#767).
 *
 * The source lists, beside a card's printed keywords, the ones it only gains on a condition ("while
 * you control 6 or more resources, this unit gains Sentinel") and the ones it only gives to other units
 * ("give a unit Sentinel for this phase"). Copied as they stand, every such unit held the keyword all
 * game: Captain Typho was always a Sentinel, and SpecForce Soldier, whose ability removes Sentinel,
 * was one itself. A conditional keyword is granted by the card's own ability while its condition holds.
 *
 * Upgrades are left as the source has them: an upgrade's keyword is its attached unit's.
 */
const ALL = [ashSet, hmwSet, ibhSet, jtlSet, lawSet, lofSet, secSet, shdSet, sorSet, ts26Set, twiSet].flat() as unknown as SwuCard[]
const byId = new Map(ALL.map(c => [`${c.Set}_${c.Number}`, c]))
const keywordsOf = (id: string): string[] => normaliseCard(byId.get(id)!).keywords.map(k => k.name)
const card = (o: Partial<SwuCard>): SwuCard => ({ Set: 'TST', Number: '001', Name: 'Test', Type: 'Unit', Cost: '3', Power: '2', HP: '3', ...o })

describe('a unit keeps only the keywords its card prints', () => {
  it('drops a keyword the unit only gains on a condition', () => {
    expect(normaliseCard(card({ Keywords: ['Sentinel'], FrontText: 'While you control a Vehicle unit, this unit gains Sentinel.' })).keywords).toEqual([])
  })

  it('drops a keyword the unit only gives to others', () => {
    expect(normaliseCard(card({ Keywords: ['Raid'], FrontText: 'Each other friendly unit gains Raid 1.' })).keywords).toEqual([])
  })

  it('keeps a printed keyword, its numeral, and one in a printed list', () => {
    expect(normaliseCard(card({ Keywords: ['Sentinel'], FrontText: 'SENTINEL (Units in this arena can\'t attack your non-Sentinel units.)' })).keywords).toEqual([{ name: 'Sentinel' }])
    expect(normaliseCard(card({ Keywords: ['Raid'], FrontText: 'Raid 2 (This unit gets +2/+0 while attacking.)' })).keywords).toEqual([{ name: 'Raid', value: 2 }])
    expect(normaliseCard(card({ Keywords: ['Ambush', 'Overwhelm'], FrontText: 'AMBUSH, OVERWHELM\nOn Attack: Draw a card.' })).keywords.map(k => k.name)).toEqual(['Ambush', 'Overwhelm'])
  })

  it('keeps a keyword printed after another sentence on the same line', () => {
    expect(normaliseCard(card({ Keywords: ['Sentinel'], FrontText: 'This unit costs 1 less. Sentinel (Units in this arena can\'t attack your base.)' })).keywords).toEqual([{ name: 'Sentinel' }])
  })

  it('reads a leader\'s keywords off its back, where the leader unit\'s are printed', () => {
    const leader = (back: string) => normaliseCard(card({ Type: 'Leader', Keywords: ['Sentinel'], FrontText: 'Action [Exhaust]: Give a unit Sentinel for this phase.', BackText: back })).keywords
    expect(leader('Sentinel\nOn Attack: Draw a card.')).toEqual([{ name: 'Sentinel' }])
    expect(leader('On Attack: Draw a card.')).toEqual([])
  })

  it('leaves an upgrade\'s keywords alone: they are its attached unit\'s', () => {
    expect(normaliseCard(card({ Type: 'Upgrade', Keywords: ['Sentinel'], FrontText: 'Attached unit gains Sentinel.' })).keywords).toEqual([{ name: 'Sentinel' }])
  })
})

describe('the cards #767 reported', () => {
  it.each([
    ['TWI_046', 'Sentinel'], // Captain Typho: gives a unit Sentinel
    ['SOR_140', 'Sentinel'], // SpecForce Soldier: makes a unit LOSE Sentinel
    ['SHD_037', 'Sentinel'], // Supreme Leader Snoke: Sentinel nowhere on the card
    ['SEC_031', 'Sentinel'], // Nute Gunray: gives another Official unit Sentinel
    ['JTL_134', 'Raid'], // General Hux: gives other First Order units Raid 1
    ['LOF_209', 'Hidden'], // Tusken Tracker: makes enemy units LOSE Hidden
  ])('%s no longer has %s on its own', (id, keyword) => {
    expect(keywordsOf(id)).not.toContain(keyword)
  })

  /** Sugi's conditional Sentinel was built, and also always on: now only the condition gives it. */
  it('gives Sugi Sentinel only while an enemy unit is upgraded', () => {
    const cards: Record<string, EngineCard> = { SHD_052: normaliseCard(byId.get('SHD_052')!), UP: normaliseCard(byId.get('SOR_057')!) }
    const quiet = state({ cards, players: { player: player({ units: [unit('s', 'SHD_052')] }), opponent: player({ units: [unit('e', 'SHD_052')] }) } })
    expect(unitHasKeyword(quiet, quiet.players.player.units[0], 'Sentinel')).toBe(false)
    const upgraded = state({ cards, players: { player: player({ units: [unit('s', 'SHD_052')] }), opponent: player({ units: [unit('e', 'SHD_052', { upgrades: [{ cardId: 'UP', owner: 'opponent' }] })] }) } })
    expect(unitHasKeyword(upgraded, upgraded.players.player.units[0], 'Sentinel')).toBe(true)
  })

  /** "While this unit is exhausted, she gains Bounty": other cards read "a unit with a Bounty". */
  it.each(['SHD_033', 'SHD_165'])('%s has a Bounty only while exhausted', id => {
    const cards: Record<string, EngineCard> = { [id]: normaliseCard(byId.get(id)!) }
    const at = (exhausted: boolean) => {
      const s = state({ cards, players: { player: player({ units: [unit('b', id, { exhausted })] }), opponent: player() } })
      return unitHasKeyword(s, s.players.player.units[0], 'Bounty')
    }
    expect(at(false)).toBe(false)
    expect(at(true)).toBe(true)
  })

  /**
   * Millennium Falcon gains Ambush "if you play this unit from your hand": a keyword it gains for that
   * play (`fromHandKeywords`, see smuggle2.test.ts), so not one it prints.
   */
  it('drops the Millennium Falcon\'s Ambush, which it only gains when played from hand', () => {
    expect(keywordsOf('SHD_204')).not.toContain('Ambush')
  })
})

describe('across every set', () => {
  /** Every keyword the rule drops, so a new set's surprises arrive as a diff to review. */
  it('drops exactly these keywords from units and leaders', () => {
    const dropped: string[] = []
    for (const c of ALL) {
      if (c.Type !== 'Unit' && c.Type !== 'Leader') continue
      const kept = new Set(normaliseCard({ ...c, Set: 'RAW' }).keywords.map(k => k.name))
      for (const k of (c.Keywords ?? []).map(k => k.trim())) if (!kept.has(k)) dropped.push(`${c.Set}_${c.Number} ${k}`)
    }
    expect(dropped.sort()).toEqual(DROPPED)
  })

  /** A correction that restates the rule is noise, and the next reader has to check it agrees. */
  it('keeps no keyword correction that only restates what the rule does', () => {
    const restating = Object.entries(CARD_DATA_CORRECTIONS).filter(([id, fix]) => {
      const c = byId.get(id)
      if (!fix.keywords || !c || (c.Type !== 'Unit' && c.Type !== 'Leader')) return false
      const ruled = normaliseCard({ ...c, Set: 'RAW' }).keywords.map(k => `${k.name}${k.value ?? ''}`).sort().join(',')
      return ruled === fix.keywords.map(k => `${k.name}${k.value ?? ''}`).sort().join(',')
    }).map(([id]) => id)
    expect(restating).toEqual([])
  })
})

const DROPPED = [
  'ASH_007 Sentinel', 'ASH_030 Saboteur', 'ASH_049 Sentinel', 'ASH_057 Restore', 'ASH_078 Sentinel', 'ASH_079 Sentinel',
  'ASH_093 Raid', 'ASH_098 Ambush', 'ASH_099 Sentinel', 'ASH_105 Raid', 'ASH_113 Ambush', 'ASH_120 Sentinel',
  'ASH_122 Restore', 'ASH_127 Sentinel', 'ASH_243 Sentinel', 'HMW_001 Raid', 'HMW_006 Grit', 'HMW_039 Restore',
  'HMW_041 Overwhelm', 'HMW_053 Ambush', 'HMW_066 Restore', 'HMW_074 Sentinel', 'HMW_084 Shielded', 'HMW_090 Grit',
  'HMW_117 Overwhelm', 'HMW_117 Raid', 'HMW_118 Ambush', 'HMW_118 Overwhelm', 'HMW_131 Ambush', 'HMW_137 Sentinel',
  'HMW_138 Raid', 'HMW_142 Sentinel', 'HMW_176 Hidden', 'HMW_176 Saboteur', 'HMW_210 Sentinel', 'HMW_212 Raid',
  'HMW_221 Sentinel', 'HMW_243 Grit', 'HMW_246 Sentinel', 'HMW_257 Ambush', 'HMW_259 Sentinel', 'JTL_008 Piloting',
  'JTL_047 Grit', 'JTL_047 Keyword', 'JTL_047 Restore', 'JTL_047 Sentinel', 'JTL_047 Shielded', 'JTL_053 Keywords',
  'JTL_053 Sentinel', 'JTL_081 Raid', 'JTL_104 Sentinel', 'JTL_107 Sentinel', 'JTL_109 Sentinel', 'JTL_113 Sentinel',
  'JTL_134 Raid', 'JTL_137 Overwhelm', 'JTL_137 Raid', 'JTL_150 Grit', 'JTL_150 Overwhelm', 'JTL_161 Overwhelm',
  'JTL_257 Raid', 'LAW_001 Overwhelm', 'LAW_081 Shielded', 'LAW_093 Shielded', 'LAW_104 Sentinel', 'LAW_105 Sentinel',
  'LOF_003 Sentinel', 'LOF_007 Overwhelm', 'LOF_050 Grit', 'LOF_085 Sentinel', 'LOF_096 Sentinel', 'LOF_105 Ambush',
  'LOF_105 Grit', 'LOF_105 Hidden', 'LOF_105 Overwhelm', 'LOF_105 Raid', 'LOF_105 Restore', 'LOF_105 Saboteur',
  'LOF_105 Sentinel', 'LOF_105 Shielded', 'LOF_114 Overwhelm', 'LOF_118 Ambush', 'LOF_162 Raid', 'LOF_169 Raid',
  'LOF_180 Ambush', 'LOF_186 Raid', 'LOF_191 Saboteur', 'LOF_196 Sentinel', 'LOF_209 Hidden', 'LOF_212 Raid',
  'LOF_231 Ambush', 'LOF_242 Sentinel', 'SEC_007 Ambush', 'SEC_010 Raid', 'SEC_029 Grit', 'SEC_031 Sentinel',
  'SEC_032 Sentinel', 'SEC_041 Sentinel', 'SEC_048 Sentinel', 'SEC_063 Sentinel', 'SEC_079 Sentinel', 'SEC_082 Sentinel',
  'SEC_099 Overwhelm', 'SEC_099 Raid', 'SEC_109 Ambush', 'SEC_116 Restore', 'SEC_120 Sentinel', 'SEC_134 Raid',
  'SEC_139 Overwhelm', 'SEC_140 Raid', 'SEC_155 Raid', 'SEC_171 Raid', 'SEC_201 Raid', 'SEC_202 Saboteur',
  'SEC_203 Hidden', 'SEC_248 Sentinel', 'SEC_249 Raid', 'SEC_255 Sentinel', 'SHD_031 Bounty', 'SHD_033 Bounty',
  'SHD_034 Sentinel', 'SHD_037 Sentinel', 'SHD_052 Sentinel', 'SHD_112 Sentinel', 'SHD_138 Overwhelm', 'SHD_165 Bounty',
  'SHD_168 Raid', 'SHD_169 Overwhelm', 'SHD_186 Shielded', 'SHD_204 Ambush', 'SHD_212 Shielded', 'SHD_247 Sentinel',
  'SOR_012 Raid', 'SOR_048 Sentinel', 'SOR_065 Sentinel', 'SOR_079 Ambush', 'SOR_082 Sentinel', 'SOR_086 Sentinel',
  'SOR_100 Ambush', 'SOR_112 Restore', 'SOR_113 Sentinel', 'SOR_114 Ambush', 'SOR_130 Overwhelm', 'SOR_131 Raid',
  'SOR_140 Sentinel', 'SOR_156 Raid', 'SOR_159 Raid', 'SOR_188 Raid', 'SOR_211 Sentinel', 'SOR_249 Ambush',
  'TS26_14 Sentinel', 'TS26_16 Restore', 'TS26_20 Sentinel', 'TS26_3 Keywords', 'TS26_40 Restore', 'TS26_50 Sentinel',
  'TS26_75 Ambush', 'TWI_005 Exploit', 'TWI_010 Saboteur', 'TWI_015 Sentinel', 'TWI_033 Sentinel', 'TWI_043 Sentinel',
  'TWI_046 Sentinel', 'TWI_050 Grit', 'TWI_061 Sentinel', 'TWI_062 Restore', 'TWI_081 Ambush', 'TWI_106 Ambush',
  'TWI_130 Overwhelm', 'TWI_130 Saboteur', 'TWI_143 Saboteur', 'TWI_164 Raid', 'TWI_180 Raid', 'TWI_194 Ambush',
  'TWI_196 Raid', 'TWI_243 Saboteur',
]
