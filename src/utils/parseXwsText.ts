export interface XwingPilot {
  name: string
  ship: string
  points: number
}

export type ParseResult =
  | { ok: true; pilots: XwingPilot[]; name: string | undefined; faction: string | undefined }
  | { ok: false; error: 'invalid-format' }

// Reads an XWS export's pilots, name and faction. Whether the list is legal (ships, points at
// today's costs, known pilots) is listProblems' call, so a list that breaks a rule still reads.
export function parseXwsText(text: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-format' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'invalid-format' }
  }

  const obj = parsed as Record<string, unknown>

  if (!Array.isArray(obj.pilots)) {
    return { ok: false, error: 'invalid-format' }
  }

  const pilots: XwingPilot[] = []
  for (const entry of obj.pilots) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).ship !== 'string' ||
      typeof (entry as Record<string, unknown>).points !== 'number'
    ) {
      return { ok: false, error: 'invalid-format' }
    }
    const e = entry as Record<string, unknown>
    pilots.push({ name: e.name as string, ship: e.ship as string, points: e.points as number })
  }

  const name = typeof obj.name === 'string' ? obj.name : undefined
  const faction = typeof obj.faction === 'string' ? obj.faction : undefined
  return { ok: true, pilots, name, faction }
}
