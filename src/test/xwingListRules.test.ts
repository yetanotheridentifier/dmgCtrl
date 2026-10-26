import { describe, it, expect } from 'vitest'
import {
  addBlock,
  atCurrentCost,
  defaultListName,
  factionShips,
  listProblems,
  pilotProblems,
  saveStatus,
} from '../utils/xwingListRules'
import type { XwingPilot } from '../utils/parseXwsText'
import { xwaPilots } from '../data/xwaCards'

// Real pilots from the XWA table, at their table points.
const p = (id: string): XwingPilot => ({ name: id, ship: xwaPilots[id].ship, points: xwaPilots[id].points })

describe('xwingListRules', () => {

  // --- What can be added ---

  it('a unique pilot already in the list cannot be added again', () => {
    expect(addBlock([p('howlrunner')], 'howlrunner')).toBe('unique')
  })

  it('a unique character blocks another card of the same name (a scenario variant)', () => {
    expect(addBlock([p('hansolo-modifiedyt1300lightfreighter')], 'hansolo-battleofyavin')).toBe('unique')
  })

  it('a generic pilot without a limit can be added any number of times', () => {
    const list = [p('academypilot'), p('academypilot'), p('academypilot'), p('academypilot')]
    expect(addBlock(list, 'academypilot')).toBeNull()
  })

  it('a generic pilot at its per-squad limit cannot be added again', () => {
    expect(addBlock([p('isbjingoist')], 'isbjingoist')).toBeNull()
    expect(addBlock([p('isbjingoist'), p('isbjingoist')], 'isbjingoist')).toBe('limit')
  })

  it('nothing can be added to a list of 8 ships', () => {
    const eight = Array.from({ length: 8 }, () => p('academypilot'))
    expect(addBlock(eight, 'blacksquadronace')).toBe('ships')
  })

  // --- Problems with a list ---

  it('a list of legal pilots has no pilot problems', () => {
    expect(pilotProblems([p('howlrunner'), p('isbjingoist'), p('isbjingoist'), p('academypilot')])).toEqual([])
  })

  it('names a unique pilot that appears twice', () => {
    expect(pilotProblems([p('howlrunner'), p('howlrunner'), p('academypilot')])).toEqual([
      '"Howlrunner" is unique: only one per list.',
    ])
  })

  it('names a generic pilot over its limit', () => {
    expect(pilotProblems([p('isbjingoist'), p('isbjingoist'), p('isbjingoist')])).toEqual([
      'ISB Jingoist: limit 2 per list, this list has 3.',
    ])
  })

  it('ignores pilots missing from the table', () => {
    const unknown = { name: 'notapilot', ship: 'tielnfighter', points: 5 }
    expect(pilotProblems([unknown, unknown])).toEqual([])
  })

  it('a list of 3 to 8 ships at 46 to 50 points with legal pilots has no problems', () => {
    const list = [p('soontirfel'), p('howlrunner'), p('maulermithel'), p('isbjingoist'), p('academypilot'), p('academypilot')]
    expect(list.reduce((s, x) => s + x.points, 0)).toBe(47)
    expect(listProblems(list)).toEqual([])
  })

  it('names the ship count and points when they are out of range', () => {
    expect(listProblems([p('soontirfel'), p('howlrunner')])).toEqual([
      '3 to 8 ships: this list has 2.',
      '21 pts: lists are 46–50.',
    ])
  })

  // --- The builder's status line ---

  it('asks for more points under 46', () => {
    expect(saveStatus([p('soontirfel'), p('howlrunner'), p('maulermithel'), p('academypilot'), p('academypilot'), p('academypilot')]))
      .toEqual({ ready: false, message: '2 more points to save (46–50)' })
  })

  it('says how far over 50 a list is', () => {
    // 13 + 8 + 8 + 6 + 8 + 8 + 5 = 56
    const list = [p('soontirfel'), p('howlrunner'), p('maulermithel'), p('wampa'), p('isbjingoist'), p('isbjingoist'), p('academypilot')]
    expect(saveStatus(list).message).toBe('6 points over (46–50)')
  })

  it('asks for more ships under 3, before points', () => {
    expect(saveStatus([p('soontirfel')])).toEqual({ ready: false, message: 'Add at least 3 ships' })
  })

  it('a pilot problem blocks saving and is the message', () => {
    const list = [p('soontirfel'), p('soontirfel'), p('howlrunner'), p('maulermithel'), p('isbjingoist')]
    expect(saveStatus(list)).toEqual({ ready: false, message: 'Soontir Fel is unique: only one per list.' })
  })

  it('a legal list is ready to save', () => {
    const list = [p('soontirfel'), p('howlrunner'), p('maulermithel'), p('isbjingoist'), p('academypilot'), p('academypilot')]
    expect(saveStatus(list)).toEqual({ ready: true, message: 'Ready to save' })
  })

  // --- Pilots to choose from ---

  it("groups a faction's pilots by ship, cheapest first", () => {
    const ships = factionShips('galacticempire')
    expect(ships).toHaveLength(18)
    const tie = ships.find(s => s.ship === 'tielnfighter')!
    expect(tie.name).toBe('TIE/ln Fighter')
    const points = tie.pilots.map(id => xwaPilots[id].points)
    expect(points).toEqual([...points].sort((a, b) => a - b))
    expect(tie.pilots).toContain('howlrunner')
    expect(tie.pilots.every(id => xwaPilots[id].faction === 'galacticempire')).toBe(true)
  })

  it('re-prices known pilots at today\'s cost and leaves unknown ones as saved', () => {
    const stale = { name: 'howlrunner', ship: 'tielnfighter', points: 99 }
    const unknown = { name: 'notapilot', ship: 'tielnfighter', points: 7 }
    expect(atCurrentCost([stale, unknown])).toEqual([p('howlrunner'), unknown])
  })

  // --- Default name ---

  it('names a new list after its faction with the lowest unused number', () => {
    expect(defaultListName('galacticempire', [])).toBe('Galactic Empire list 1')
    expect(defaultListName('galacticempire', ['Galactic Empire list 1', 'Galactic Empire list 3', 'Other'])).toBe('Galactic Empire list 2')
  })
})
