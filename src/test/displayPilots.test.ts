import { describe, it, expect } from 'vitest'
import { displayPilots } from '../utils/displayPilots'

const pilot = (name: string, points = 10) => ({ name, ship: 'ship', points })

describe('displayPilots', () => {
  it('resolves pilot name using base slug (before first hyphen) as lookup key', () => {
    expect(displayPilots([pilot('bobafett-armedanddangerous', 18)])[0].displayName).toBe('Boba Fett')
  })

  it('resolves pilot name for unhyphenated slug', () => {
    expect(displayPilots([pilot('asajjventress', 15)])[0].displayName).toBe('Asajj Ventress')
  })

  it('preserves points', () => {
    expect(displayPilots([pilot('bossk', 17)])[0].points).toBe(17)
  })

  it('resolves ship slug to display name', () => {
    const result = displayPilots([{ name: 'bossk', ship: 'yv666lightfreighter', points: 17 }])
    expect(result[0].ship).toBe('YV-666 Light Freighter')
  })

  it('returns empty array for empty input', () => {
    expect(displayPilots([])).toEqual([])
  })

  it('does not number unique pilots', () => {
    const result = displayPilots([pilot('asajjventress'), pilot('bossk')])
    expect(result[0].displayName).toBe('Asajj Ventress')
    expect(result[1].displayName).toBe('Bossk')
  })

  it('numbers all instances when duplicates exist', () => {
    const result = displayPilots([pilot('academypilot'), pilot('academypilot'), pilot('academypilot')])
    expect(result[0].displayName).toBe('Academy Pilot 1')
    expect(result[1].displayName).toBe('Academy Pilot 2')
    expect(result[2].displayName).toBe('Academy Pilot 3')
  })

  it('only numbers the duplicate group, not unique pilots in the same list', () => {
    const result = displayPilots([pilot('academypilot'), pilot('academypilot'), pilot('bossk')])
    expect(result[0].displayName).toBe('Academy Pilot 1')
    expect(result[1].displayName).toBe('Academy Pilot 2')
    expect(result[2].displayName).toBe('Bossk')
  })

  it('treats base names from hyphenated slugs as the duplicate key', () => {
    const result = displayPilots([pilot('veteran-pilot'), pilot('veteran-ace')])
    expect(result[0].displayName).toBe('veteran 1')
    expect(result[1].displayName).toBe('veteran 2')
  })

  it('resolves pilot slug to display name via lookup', () => {
    const result = displayPilots([{ name: 'sabinewren-rz1awing', ship: 'rz1awing', points: 8 }])
    expect(result[0].displayName).toBe('Sabine Wren')
  })

  it('resolves ship slug to display name via lookup', () => {
    const result = displayPilots([{ name: 'sabinewren-rz1awing', ship: 'rz1awing', points: 8 }])
    expect(result[0].ship).toBe('RZ-1 A-wing')
  })

  it('falls back to raw pilot slug when not in lookup', () => {
    const result = displayPilots([{ name: 'unknownpilot', ship: 'unknownship', points: 5 }])
    expect(result[0].displayName).toBe('unknownpilot')
  })

  it('falls back to raw ship slug when not in lookup', () => {
    const result = displayPilots([{ name: 'unknownpilot', ship: 'unknownship', points: 5 }])
    expect(result[0].ship).toBe('unknownship')
  })

  it('numbers duplicate display names after lookup resolution', () => {
    const result = displayPilots([
      { name: 'bluesquadronescort', ship: 't65xwing', points: 10 },
      { name: 'bluesquadronescort', ship: 't65xwing', points: 10 },
    ])
    expect(result[0].displayName).toBe('Blue Squadron Escort 1')
    expect(result[1].displayName).toBe('Blue Squadron Escort 2')
  })
})
