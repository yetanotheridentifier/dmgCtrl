// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { extractXwingData, renderModule } from '../../scripts/generate-xwing-data.mjs'

const fixture = readFileSync(new URL('./fixtures/yasbCards.coffee', import.meta.url), 'utf-8')

describe('extractXwingData', () => {
  const { pilots, ships } = extractXwingData(fixture)

  it('keys pilots by the XWS id YASB assigns, in YASB id order', () => {
    expect(Object.keys(pilots)).toEqual([
      'lukeskywalker',
      'academypilot',
      'lukeskywalker-battleofyavin',
      'contractedscout',
      'lieutenantlappin',
    ])
  })

  it('records name, ship and faction XWS ids, points, loadout, uniqueness and YASB id', () => {
    expect(pilots.lukeskywalker).toEqual({
      name: 'Luke Skywalker',
      ship: 't65xwing',
      faction: 'rebelalliance',
      points: 14,
      loadout: 10,
      unique: true,
      yasbId: 0,
    })
    expect(pilots.academypilot).toEqual({
      name: 'Academy Pilot',
      ship: 'tielnfighter',
      faction: 'galacticempire',
      points: 5,
      loadout: 0,
      unique: false,
      yasbId: 1,
    })
  })

  it('leaves loadout out when YASB has none', () => {
    expect(pilots['lukeskywalker-battleofyavin']).not.toHaveProperty('loadout')
  })

  it('takes the per-squad limit from the XWA restricted list or the card', () => {
    expect(pilots.contractedscout.limit).toBe(2)
    expect(pilots.lieutenantlappin.limit).toBe(2)
    expect(pilots.academypilot).not.toHaveProperty('limit')
  })

  it('leaves out pilots YASB skips', () => {
    expect(Object.values(pilots).map(p => p.name)).not.toContain('Old Pilot')
  })

  it('keys ships by XWS id', () => {
    expect(ships.t65xwing).toBe('T-65 X-wing')
    expect(ships.tielnfighter).toBe('TIE/ln Fighter')
    expect(ships.upsilonclasscommandshuttle).toBe('Upsilon-Class Command Shuttle')
  })

  it('adds the xwing-data2 Upsilon shuttle id other builders export', () => {
    expect(ships.upsilonclassshuttle).toBe('Upsilon-Class Command Shuttle')
  })
})

describe('renderModule', () => {
  const data = {
    pilots: {
      lukeskywalker: { name: 'Luke Skywalker', ship: 't65xwing', faction: 'rebelalliance', points: 14, loadout: 10, unique: true, yasbId: 0 },
      '104thbattalionpilot': { name: '104th Battalion Pilot', ship: 'arc170starfighter', faction: 'galacticrepublic', points: 9, loadout: 0, unique: false, limit: 2, yasbId: 1 },
    },
    ships: { t65xwing: 'T-65 X-wing' },
  }
  const source = renderModule(data, 'abc123')

  it('names the YASB commit it was generated from', () => {
    expect(source).toContain('raithos/xwing@abc123')
  })

  it('writes one pilot per line, in the order given', () => {
    const luke = '  "lukeskywalker": {"name":"Luke Skywalker","ship":"t65xwing","faction":"rebelalliance","points":14,"loadout":10,"unique":true,"yasbId":0},'
    const battalion = '  "104thbattalionpilot": {"name":"104th Battalion Pilot","ship":"arc170starfighter","faction":"galacticrepublic","points":9,"loadout":0,"unique":false,"limit":2,"yasbId":1},'
    expect(source).toContain(luke)
    expect(source.indexOf(luke)).toBeLessThan(source.indexOf(battalion))
  })

  it('exports typed pilot and ship tables', () => {
    expect(source).toContain('export const xwaPilots: Record<string, XwaPilot> = {')
    expect(source).toContain('export const xwaShips: Record<string, string> = {')
    expect(source).toContain('  "t65xwing": "T-65 X-wing",')
  })
})
