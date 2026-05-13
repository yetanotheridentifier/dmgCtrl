import { describe, it, expect } from 'vitest'
import { isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError } from '../utils/formatFilter'
import { Base } from '../hooks/useBases'

// ---------- helpers ----------

function makeBase(set: string): Base {
  return {
    set,
    number: '001',
    name: `${set} Base`,
    subtitle: '',
    hp: 30,
    frontArt: null,
    frontArtLowRes: null,
    hyperspaceArtHiRes: null,
    hyperspaceArt: null,
    epicAction: '',
    aspects: [],
    rarity: 'Common',
  }
}

const ALL_SETS = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW', 'IBH', 'TS26']
const STANDARD_SETS = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW']

// ---------- isSetValidForFormat ----------

describe('isSetValidForFormat — eternal', () => {
  it('allows all sets', () => {
    for (const set of ALL_SETS) {
      expect(isSetValidForFormat(set, 'eternal')).toBe(true)
    }
  })

  it('allows unknown sets (future-proofing)', () => {
    expect(isSetValidForFormat('XYZ', 'eternal')).toBe(true)
  })
})

describe('isSetValidForFormat — twin-suns', () => {
  it('allows all sets', () => {
    for (const set of ALL_SETS) {
      expect(isSetValidForFormat(set, 'twin-suns')).toBe(true)
    }
  })

  it('allows unknown sets (future-proofing)', () => {
    expect(isSetValidForFormat('XYZ', 'twin-suns')).toBe(true)
  })
})

describe('isSetValidForFormat — premier', () => {
  it('excludes rotated-out standard sets (SOR, SHD, TWI)', () => {
    expect(isSetValidForFormat('SOR', 'premier')).toBe(false)
    expect(isSetValidForFormat('SHD', 'premier')).toBe(false)
    expect(isSetValidForFormat('TWI', 'premier')).toBe(false)
  })

  it('includes standard sets in the two most recent rotations', () => {
    // Rotations A and B are the only current rotations
    expect(isSetValidForFormat('JTL', 'premier')).toBe(true)
    expect(isSetValidForFormat('LOF', 'premier')).toBe(true)
    expect(isSetValidForFormat('SEC', 'premier')).toBe(true)
    expect(isSetValidForFormat('LAW', 'premier')).toBe(true)
  })

  it('always includes IBH regardless of rotation window', () => {
    expect(isSetValidForFormat('IBH', 'premier')).toBe(true)
  })

  it('excludes TS26', () => {
    expect(isSetValidForFormat('TS26', 'premier')).toBe(false)
  })

  it('allows unknown sets (forward-compatible default)', () => {
    expect(isSetValidForFormat('XYZ', 'premier')).toBe(true)
  })
})

describe('isSetValidForFormat — limited', () => {
  it('includes all standard sets regardless of rotation', () => {
    for (const set of STANDARD_SETS) {
      expect(isSetValidForFormat(set, 'limited')).toBe(true)
    }
  })

  it('excludes IBH', () => {
    expect(isSetValidForFormat('IBH', 'limited')).toBe(false)
  })

  it('excludes TS26', () => {
    expect(isSetValidForFormat('TS26', 'limited')).toBe(false)
  })

  it('allows unknown sets (forward-compatible default)', () => {
    expect(isSetValidForFormat('XYZ', 'limited')).toBe(true)
  })
})

// ---------- getValidSets ----------

describe('getValidSets', () => {
  it('eternal returns all sets unchanged', () => {
    const result = getValidSets('eternal', ALL_SETS)
    expect(result).toEqual(ALL_SETS)
  })

  it('twin-suns returns all sets unchanged', () => {
    const result = getValidSets('twin-suns', ALL_SETS)
    expect(result).toEqual(ALL_SETS)
  })

  it('premier excludes SOR/SHD/TWI and TS26, keeps IBH', () => {
    const result = getValidSets('premier', ALL_SETS)
    expect(result).toContain('JTL')
    expect(result).toContain('LOF')
    expect(result).toContain('SEC')
    expect(result).toContain('LAW')
    expect(result).toContain('IBH')
    expect(result).not.toContain('SOR')
    expect(result).not.toContain('SHD')
    expect(result).not.toContain('TWI')
    expect(result).not.toContain('TS26')
  })

  it('limited includes all standard sets only', () => {
    const result = getValidSets('limited', ALL_SETS)
    expect(result).toEqual(STANDARD_SETS)
  })

  it('preserves input order', () => {
    const result = getValidSets('limited', ['LAW', 'SOR', 'JTL'])
    expect(result).toEqual(['LAW', 'SOR', 'JTL'])
  })
})

// ---------- isBaseValidForFormat ----------

describe('isBaseValidForFormat', () => {
  it('eternal allows any base', () => {
    expect(isBaseValidForFormat('eternal', makeBase('TS26'))).toBe(true)
    expect(isBaseValidForFormat('eternal', makeBase('IBH'))).toBe(true)
    expect(isBaseValidForFormat('eternal', makeBase('SOR'))).toBe(true)
  })

  it('twin-suns allows any base', () => {
    expect(isBaseValidForFormat('twin-suns', makeBase('TS26'))).toBe(true)
    expect(isBaseValidForFormat('twin-suns', makeBase('IBH'))).toBe(true)
    expect(isBaseValidForFormat('twin-suns', makeBase('SOR'))).toBe(true)
  })

  it('premier allows JTL base', () => {
    expect(isBaseValidForFormat('premier', makeBase('JTL'))).toBe(true)
  })

  it('premier allows IBH base', () => {
    expect(isBaseValidForFormat('premier', makeBase('IBH'))).toBe(true)
  })

  it('premier rejects SOR base', () => {
    expect(isBaseValidForFormat('premier', makeBase('SOR'))).toBe(false)
  })

  it('premier rejects TS26 base', () => {
    expect(isBaseValidForFormat('premier', makeBase('TS26'))).toBe(false)
  })

  it('limited allows SOR base', () => {
    expect(isBaseValidForFormat('limited', makeBase('SOR'))).toBe(true)
  })

  it('limited rejects IBH base', () => {
    expect(isBaseValidForFormat('limited', makeBase('IBH'))).toBe(false)
  })

  it('limited rejects TS26 base', () => {
    expect(isBaseValidForFormat('limited', makeBase('TS26'))).toBe(false)
  })
})

// ---------- formatValidationError ----------

describe('formatValidationError', () => {
  it('includes set code for premier', () => {
    expect(formatValidationError('premier', makeBase('SOR'))).toBe('Base not valid for Premier format (SOR)')
  })

  it('includes set code for limited', () => {
    expect(formatValidationError('limited', makeBase('IBH'))).toBe('Base not valid for Limited format (IBH)')
  })

  it('includes set code for eternal', () => {
    expect(formatValidationError('eternal', makeBase('SOR'))).toBe('Base not valid for Eternal format (SOR)')
  })

  it('includes set code for twin-suns', () => {
    expect(formatValidationError('twin-suns', makeBase('SOR'))).toBe('Base not valid for Twin Suns format (SOR)')
  })
})
