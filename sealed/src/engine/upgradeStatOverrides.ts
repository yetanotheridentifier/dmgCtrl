/**
 * TEMPORARY upgrade Power/HP modifiers (#308).
 *
 * Both upstream card sources (SWUDB and swuapi) currently omit Power/HP for the
 * entire **Set of Ashes (ASH)** upgrade cards — the +X/+Y is printed on the card
 * art but absent from the structured data. These values are read off the art so
 * the engine applies the modifier. `normaliseCard` uses an entry only when the
 * source provides NO Power/HP, so each override auto-drops out once the upstream
 * data is fixed. Remove the whole table when the source is complete.
 *
 * Format: `{ power, hp }` is the printed modifier (may be negative).
 */
export const UPGRADE_STAT_OVERRIDES: Record<string, { power: number; hp: number }> = {
  ASH_054: { power: 0, hp: 0 }, // Pointless to Resist
  ASH_055: { power: 2, hp: 1 }, // Blade of Talzin
  ASH_066: { power: 3, hp: 3 }, // Luke's Jedi Lightsaber
  ASH_084: { power: 0, hp: 3 }, // Arcana Star Map
  ASH_085: { power: 0, hp: 0 }, // Grav Charge
  ASH_086: { power: 1, hp: 1 }, // Durasteel Plating
  ASH_087: { power: 2, hp: 2 }, // Cybernetic Enhancements
  ASH_088: { power: 0, hp: 0 }, // The Conflict Within
  ASH_114: { power: 2, hp: 2 }, // Sabine's Lightsaber
  ASH_134: { power: 2, hp: 1 }, // Warrior's Legacy
  ASH_135: { power: 4, hp: 2 }, // The Darksaber
  ASH_150: { power: 0, hp: 0 }, // Deadly Vulnerability
  ASH_180: { power: 1, hp: 1 }, // Bokken Saber
  ASH_181: { power: 2, hp: 0 }, // Mark My Words
  ASH_182: { power: 1, hp: 1 }, // Unfettered Ambition
  ASH_183: { power: 2, hp: 2 }, // Whistling Birds
  ASH_198: { power: -2, hp: 0 }, // Nowhere to Hide
  ASH_199: { power: 2, hp: 2 }, // There Is No Conflict
  ASH_210: { power: 1, hp: 0 }, // DDC Defender
  ASH_227: { power: 0, hp: 2 }, // Heightened Awareness
  ASH_228: { power: 2, hp: 1 }, // Preparation
  ASH_229: { power: 0, hp: 0 }, // Camtono
  ASH_230: { power: 0, hp: 3 }, // Improvised Identity
  ASH_262: { power: 1, hp: 2 }, // Faith in the Empire
  ASH_263: { power: 2, hp: 0 }, // The Way of the Mand'alor (+2/+0 — cost-reduction only, no HP)
}
