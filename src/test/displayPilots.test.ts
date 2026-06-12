import { describe, it, expect } from 'vitest'
import { displayPilots } from '../utils/displayPilots'

const pilot = (name: string, points = 10) => ({ name, ship: 'ship', points })

describe('displayPilots', () => {
  it('uses slug before first hyphen as display name', () => {
    expect(displayPilots([pilot('bobafett-armedanddangerous', 18)])[0].displayName).toBe('bobafett')
  })

  it('uses full slug when no hyphen', () => {
    expect(displayPilots([pilot('asajjventress', 15)])[0].displayName).toBe('asajjventress')
  })

  it('preserves points', () => {
    expect(displayPilots([pilot('bossk', 17)])[0].points).toBe(17)
  })

  it('preserves ship slug', () => {
    const result = displayPilots([{ name: 'bossk', ship: 'yv666lightfreighter', points: 17 }])
    expect(result[0].ship).toBe('yv666lightfreighter')
  })

  it('returns empty array for empty input', () => {
    expect(displayPilots([])).toEqual([])
  })

  it('does not number unique pilots', () => {
    const result = displayPilots([pilot('asajjventress'), pilot('bossk')])
    expect(result[0].displayName).toBe('asajjventress')
    expect(result[1].displayName).toBe('bossk')
  })

  it('numbers all instances when duplicates exist', () => {
    const result = displayPilots([pilot('academypilot'), pilot('academypilot'), pilot('academypilot')])
    expect(result[0].displayName).toBe('academypilot 1')
    expect(result[1].displayName).toBe('academypilot 2')
    expect(result[2].displayName).toBe('academypilot 3')
  })

  it('only numbers the duplicate group, not unique pilots in the same list', () => {
    const result = displayPilots([pilot('academypilot'), pilot('academypilot'), pilot('bossk')])
    expect(result[0].displayName).toBe('academypilot 1')
    expect(result[1].displayName).toBe('academypilot 2')
    expect(result[2].displayName).toBe('bossk')
  })

  it('treats base names from hyphenated slugs as the duplicate key', () => {
    const result = displayPilots([pilot('veteran-pilot'), pilot('veteran-ace')])
    expect(result[0].displayName).toBe('veteran 1')
    expect(result[1].displayName).toBe('veteran 2')
  })
})
