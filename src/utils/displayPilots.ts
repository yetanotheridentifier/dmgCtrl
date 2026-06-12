import type { XwingPilot } from './parseXwsText'

export interface DisplayPilot {
  displayName: string
  ship: string
  points: number
}

// Takes slug before the first hyphen as the base name, then numbers any
// duplicates within the list so generic pilots (e.g. academypilot x3) can
// be distinguished. Unique names are never suffixed.
export function displayPilots(pilots: XwingPilot[]): DisplayPilot[] {
  const baseName = (p: XwingPilot) => p.name.split('-')[0]

  const counts: Record<string, number> = {}
  for (const p of pilots) counts[baseName(p)] = (counts[baseName(p)] ?? 0) + 1

  const seen: Record<string, number> = {}
  return pilots.map(p => {
    const base = baseName(p)
    if (counts[base] > 1) {
      seen[base] = (seen[base] ?? 0) + 1
      return { displayName: `${base} ${seen[base]}`, ship: p.ship, points: p.points }
    }
    return { displayName: base, ship: p.ship, points: p.points }
  })
}
