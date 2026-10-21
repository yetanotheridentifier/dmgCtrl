// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listPoints, factionName, listMeta, pilotSummary } from '../utils/xwingListInfo'

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

describe('listMeta', () => {
  const pilots = [
    { name: 'a', ship: 's', points: 20 },
    { name: 'b', ship: 's', points: 29 },
  ]

  it('shows the points total and faction name', () => {
    expect(listMeta(pilots, 'rebelalliance')).toBe('49 pts · Rebel Alliance')
  })

  it('shows only the points total when there is no faction', () => {
    expect(listMeta(pilots, undefined)).toBe('49 pts')
  })
})

describe('pilotSummary', () => {
  const pilot = (name: string) => ({ name, ship: 's', points: 5 })

  it('names each pilot by its display name, in list order', () => {
    expect(pilotSummary([pilot('lukeskywalker'), pilot('bobafett-armedanddangerous')])).toBe('Luke Skywalker, Boba Fett')
  })

  it('groups repeated pilots as a count, where the first one appears', () => {
    expect(pilotSummary([
      pilot('academypilot'), pilot('howlrunner'), pilot('academypilot'), pilot('academypilot'),
    ])).toBe('3 × Academy Pilot, "Howlrunner"')
  })

  it('falls back to the slug for an unknown pilot', () => {
    expect(pilotSummary([pilot('notapilot')])).toBe('notapilot')
  })

  it('is empty for no pilots', () => {
    expect(pilotSummary([])).toBe('')
  })
})
