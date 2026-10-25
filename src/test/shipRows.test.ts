import { describe, it, expect } from 'vitest'
import { shipRows } from '../utils/shipRows'

const generic = (n: number) => Array.from({ length: n }, () => ({ name: 'academypilot', ship: 'tielnfighter', points: 5 }))
const UNIQUES = [
  { name: 'howlrunner', ship: 'tielnfighter', points: 9 },
  { name: 'maulermithel', ship: 'tielnfighter', points: 8 },
  { name: 'majorvynder', ship: 'tielnfighter', points: 10 },
  { name: 'countdown', ship: 'tielnfighter', points: 7 },
  { name: 'darthvader', ship: 'tieadvancedx1', points: 12 },
  { name: 'idenversio', ship: 'tielnfighter', points: 7 },
  { name: 'wampa', ship: 'tielnfighter', points: 6 },
  { name: 'gideonhask', ship: 'tielnfighter', points: 8 },
]

describe('shipRows', () => {
  it('gives each of up to 4 ships its own row, in list order', () => {
    expect(shipRows(UNIQUES.slice(0, 3))).toEqual([[0], [1], [2]])
    expect(shipRows(generic(4))).toEqual([[0], [1], [2], [3]])
  })

  it('fills 4 rows from the 5th ship, pairing non-unique pilots before unique ones', () => {
    // 4 uniques then 3 generics: one unique keeps a row; the generics pair first, from the bottom.
    const list = [...UNIQUES.slice(0, 4), ...generic(3)]
    expect(shipRows(list)).toEqual([[0], [1, 2], [3, 4], [5, 6]])
  })

  it('keeps unique pilots on their own rows when the generics alone make up the pairs', () => {
    const list = [generic(1)[0], UNIQUES[0], generic(1)[0], UNIQUES[1], UNIQUES[2]]
    // 5 ships: 3 singles and 1 pair; the two generics are the pair.
    expect(shipRows(list)).toEqual([[1], [3], [4], [0, 2]])
  })

  it('lays out 8 ships in 4 rows of two', () => {
    expect(shipRows(generic(8))).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]])
    expect(shipRows(UNIQUES)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]])
  })

  it('has no rows for no list', () => {
    expect(shipRows([])).toEqual([])
  })
})
