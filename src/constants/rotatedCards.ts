// Hi-res hyperspace images stored rotated on cdn.swu-db.com.
// Keys are `${set}-${hyperspaceNumber}`. Value is degrees needed to correct display.
export const ROTATED_HYPERSPACE_CARDS: Record<string, number> = {
  'SOR-285': 90,  // Security Complex
  'TWI-294': 90,  // Pau City
  'TWI-297': 90,  // Droid Manufactory
  'TWI-301': 90,  // KCM Mining Facility
  'TWI-303': 90,  // Petranaki Arena
}

// Parses set and card number from a cdn.swu-db.com URL and returns the rotation
// correction in degrees (0 if not in the lookup table or URL doesn't match).
export function getRotationFromHyperspaceUrl(url: string): number {
  const match = url.match(/\/cards\/([A-Z]+)\/(\d+)\.png/)
  if (!match) return 0
  return ROTATED_HYPERSPACE_CARDS[`${match[1]}-${match[2]}`] ?? 0
}