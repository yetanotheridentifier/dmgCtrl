import ash from './printingMaps/ash.json'

/**
 * Every bundled printing → its Normal (canonical) id, merged across every set shipped with data
 * (#389). Ids are globally unique (set-prefixed), so merging per-set files is safe. Add a new set
 * by generating its file (`scripts/generatePrintingMap.mjs <SET>`) and importing it here.
 */
const BUNDLED: Record<string, string> = { ...(ash as Record<string, string>) }

/** The canonical (Normal) id for a bundled printing, or undefined if it isn't bundled. */
export function bundledCanonicalId(id: string): string | undefined {
  return BUNDLED[id]
}
