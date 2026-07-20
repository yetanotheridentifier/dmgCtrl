import type { EngineCard } from './types'

/**
 * Token units — units that abilities create rather than play from a deck
 * (e.g. Warrior's Legacy's Mandalorian). Modelled as built-in `unit` cards always
 * present in the card db (like the token upgrades in `tokenUpgrades.ts`), so every
 * stat/keyword helper picks them up. Their ids carry the shared `TOKEN_` prefix so
 * `isTokenCard` can tell them from deck cards — on defeat a token ceases to exist
 * rather than going to a discard pile (CR 7.2).
 */

export const TOKEN_MANDALORIAN = 'TOKEN_MANDALORIAN'

/** Built-in token units, merged into every card db. */
export const TOKEN_UNIT_CARDS: Record<string, EngineCard> = {
  [TOKEN_MANDALORIAN]: {
    id: TOKEN_MANDALORIAN,
    name: 'Mandalorian',
    type: 'unit',
    arena: 'ground',
    cost: 0,
    power: 2,
    hp: 2,
    aspects: ['Vigilance'],
    traits: ['Mandalorian'],
    keywords: [{ name: 'Shielded' }],
    unique: false,
    frontArt: 'https://cdn.swu-db.com/images/cards/ASH/T01.png',
  },
}

/** True for any built-in token card (upgrade or unit) — shared `TOKEN_` id prefix. */
export function isTokenCard(cardId: string): boolean {
  return cardId.startsWith('TOKEN_')
}
