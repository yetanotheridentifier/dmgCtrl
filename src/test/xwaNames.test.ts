// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildPilotNames, pilotNames, shipNames } from '../utils/xwaNames'

describe('buildPilotNames', () => {
  it('keys names by the base slug, before the first hyphen', () => {
    expect(buildPilotNames({ 'bobafett-armedanddangerous': { name: 'Boba Fett' } })).toEqual({ bobafett: 'Boba Fett' })
  })

  it('drops the scenario tag YASB adds in brackets', () => {
    expect(buildPilotNames({ 'adonfox-battleoverendor': { name: 'Adon Fox (BoE)' } })).toEqual({ adonfox: 'Adon Fox' })
  })

  it('keeps the first name when variants share a base slug', () => {
    const names = buildPilotNames({
      lukeskywalker: { name: 'Luke Skywalker' },
      'lukeskywalker-battleofyavin': { name: 'Luke Skywalker (BoY)' },
    })
    expect(names).toEqual({ lukeskywalker: 'Luke Skywalker' })
  })
})

describe('generated names', () => {
  it('resolves pilots, including ones YASB only has as scenario variants', () => {
    expect(pilotNames.lukeskywalker).toBe('Luke Skywalker')
    expect(pilotNames.adonfox).toBe('Adon Fox')
  })

  it('resolves ships, including the xwing-data2 Upsilon shuttle id', () => {
    expect(shipNames.t65xwing).toBe('T-65 X-wing')
    expect(shipNames.upsilonclassshuttle).toBe('Upsilon-Class Command Shuttle')
  })
})
