import { FACTION_GLYPHS } from '../data/factionGlyphs'
import { factionName } from '../utils/xwingListInfo'

// A faction's symbol, drawn in the text colour so it follows the row it sits in. Nothing for a list
// with no faction (saved before factions were kept) or one the table doesn't know.
export function FactionIcon({ faction, size = 20 }: { faction: string | undefined; size?: number }) {
  const glyph = faction ? FACTION_GLYPHS[faction] : undefined
  if (!glyph) return null
  return (
    <svg width={size} height={size} viewBox={glyph.viewBox} fill="currentColor" role="img" aria-label={factionName(faction)} style={{ flexShrink: 0 }}>
      <path transform="scale(1,-1)" d={glyph.d} />
    </svg>
  )
}
