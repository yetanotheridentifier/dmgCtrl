import { SET_REGISTRY } from '../constants/setRegistry'
import { Base } from '../hooks/useBases'

export type Format = 'premier' | 'limited' | 'eternal'

export const FORMAT_LABELS: Record<Format, string> = {
  premier: 'Premier',
  limited: 'Limited',
  eternal: 'Eternal / Twin Suns',
}

export const FORMATS: Format[] = ['premier', 'limited', 'eternal']

function getMostRecentRotations(count: number): Set<string> {
  const rotations = [...new Set(
    Object.values(SET_REGISTRY)
      .filter(info => info.type === 'standard' && info.rotation !== null)
      .map(info => info.rotation as string)
  )].sort()
  return new Set(rotations.slice(-count))
}

export function isSetValidForFormat(setCode: string, format: Format): boolean {
  const info = SET_REGISTRY[setCode]
  if (!info) return true  // unknown sets: allow by default (forward-compatible)

  if (format === 'eternal') return true

  if (format === 'premier') {
    if (info.type === 'premier-legal-special') return true
    if (info.type === 'eternal-only') return false
    // standard: must be in the two most recent rotations
    if (info.rotation === null) return false
    return getMostRecentRotations(2).has(info.rotation)
  }

  // limited: standard sets only (Sealed, Draft, and Chaos all share this rule)
  return info.type === 'standard'
}

export function getValidSets(format: Format, allSets: string[]): string[] {
  return allSets.filter(set => isSetValidForFormat(set, format))
}

export function isBaseValidForFormat(format: Format, base: Base): boolean {
  return isSetValidForFormat(base.set, format)
}

export function formatValidationError(format: Format, base: Base): string {
  return `Base not valid for ${FORMAT_LABELS[format]} format (${base.set})`
}
