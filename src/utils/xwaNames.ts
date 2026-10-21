import { xwaPilots, xwaShips } from '../data/xwaCards'

// Lists name pilots by full XWS id, but the display name only needs the base slug (before the
// first hyphen), so scenario variants such as `adonfox-battleoverendor` resolve too. YASB tags
// those variants in brackets, e.g. "Adon Fox (BoE)"; the tag is dropped. First entry wins.
export function buildPilotNames(pilots: Record<string, { name: string }>): Record<string, string> {
  const names: Record<string, string> = {}
  for (const [xws, { name }] of Object.entries(pilots)) {
    names[xws.split('-')[0]] ??= name.split(' (')[0]
  }
  return names
}

export const pilotNames = buildPilotNames(xwaPilots)
export const shipNames = xwaShips
