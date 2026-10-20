// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listPoints, factionName } from '../utils/xwingListInfo'

describe('listPoints', () => {
  it('sums the points of every pilot', () => {
    expect(listPoints([
      { name: 'a', ship: 's', points: 15 },
      { name: 'b', ship: 's', points: 18 },
      { name: 'c', ship: 's', points: 0 },
    ])).toBe(33)
  })

  it('returns 0 for no pilots', () => {
    expect(listPoints([])).toBe(0)
  })
})

describe('factionName', () => {
  it.each([
    ['rebelalliance', 'Rebel Alliance'],
    ['galacticempire', 'Galactic Empire'],
    ['scumandvillainy', 'Scum and Villainy'],
    ['resistance', 'Resistance'],
    ['firstorder', 'First Order'],
    ['galacticrepublic', 'Galactic Republic'],
    ['separatistalliance', 'Separatist Alliance'],
  ])('maps %s to %s', (xws, name) => {
    expect(factionName(xws)).toBe(name)
  })

  it('returns an unknown faction id unchanged', () => {
    expect(factionName('newfaction')).toBe('newfaction')
  })

  it('returns undefined when there is no faction', () => {
    expect(factionName(undefined)).toBeUndefined()
  })
})
