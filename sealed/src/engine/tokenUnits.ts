import type { EngineCard, KeywordInstance } from './types'

/**
 * Token units — units that abilities create rather than play from a deck (Warrior's Legacy's
 * Mandalorian, Captain Rex's Clone Troopers). Modelled as built-in `unit` cards always present in the
 * card db (like the token upgrades in `tokenUpgrades.ts`), so every stat/keyword helper picks them up.
 * Their ids carry the shared `TOKEN_` prefix so `isTokenCard` can tell them from deck cards — on
 * defeat a token ceases to exist rather than going to a discard pile (CR 7.2).
 *
 * Printed stats are recorded from the printed token cards. The card API the app reads has no token
 * units (its set listings omit tokens), so they cannot be fetched like deck cards.
 */

export const TOKEN_MANDALORIAN = 'TOKEN_MANDALORIAN'
export const TOKEN_SPY = 'TOKEN_SPY'
export const TOKEN_X_WING = 'TOKEN_X_WING'
export const TOKEN_TIE_FIGHTER = 'TOKEN_TIE_FIGHTER'
export const TOKEN_CLONE_TROOPER = 'TOKEN_CLONE_TROOPER'
export const TOKEN_BATTLE_DROID = 'TOKEN_BATTLE_DROID'
export const TOKEN_BEAST = 'TOKEN_BEAST'

// Official token card art: swu-db's CDN (routed through the art proxy by `artUrl`) where it has the
// token, the publisher's own CDN where it does not. That CDN serves its files under a doubled slash
// (as its own API writes them) and refuses the single-slash form.
const SWUDB = 'https://cdn.swu-db.com/images/cards'
const FFG = 'https://cdn.starwarsunlimited.com/'

interface TokenSpec {
  name: string
  arena: 'ground' | 'space'
  power: number
  hp: number
  aspects: string[]
  traits: string[]
  keywords?: KeywordInstance[]
  frontArt: string
}
function tokenUnit(id: string, spec: TokenSpec): EngineCard {
  return { id, type: 'unit', cost: 0, unique: false, keywords: [], ...spec }
}

/** Built-in token units, merged into every card db. */
export const TOKEN_UNIT_CARDS: Record<string, EngineCard> = {
  [TOKEN_MANDALORIAN]: tokenUnit(TOKEN_MANDALORIAN, {
    name: 'Mandalorian', arena: 'ground', power: 2, hp: 2, aspects: ['Vigilance'], traits: ['Mandalorian'],
    keywords: [{ name: 'Shielded' }], frontArt: `${SWUDB}/ASH/T01.png`,
  }),
  [TOKEN_SPY]: tokenUnit(TOKEN_SPY, {
    name: 'Spy', arena: 'ground', power: 0, hp: 2, aspects: [], traits: ['Official'],
    keywords: [{ name: 'Raid', value: 2 }], frontArt: `${SWUDB}/SEC/T01.png`,
  }),
  [TOKEN_X_WING]: tokenUnit(TOKEN_X_WING, {
    name: 'X-Wing', arena: 'space', power: 2, hp: 2, aspects: ['Heroism'], traits: ['Vehicle', 'Fighter'],
    frontArt: `${FFG}/04010_T02_EN_X_Wing_23535e05f0.png`,
  }),
  [TOKEN_TIE_FIGHTER]: tokenUnit(TOKEN_TIE_FIGHTER, {
    name: 'TIE Fighter', arena: 'space', power: 1, hp: 1, aspects: ['Villainy'], traits: ['Vehicle', 'Fighter'],
    frontArt: `${FFG}/04010_T01_EN_TIE_Fighter_797390e528.png`,
  }),
  [TOKEN_CLONE_TROOPER]: tokenUnit(TOKEN_CLONE_TROOPER, {
    name: 'Clone Trooper', arena: 'ground', power: 2, hp: 2, aspects: ['Heroism'], traits: ['Republic', 'Clone', 'Trooper'],
    frontArt: `${FFG}/0301_T02_EN_Clone_Trooper_d915e8d856.png`,
  }),
  [TOKEN_BATTLE_DROID]: tokenUnit(TOKEN_BATTLE_DROID, {
    name: 'Battle Droid', arena: 'ground', power: 1, hp: 1, aspects: ['Villainy'], traits: ['Separatist', 'Droid', 'Trooper'],
    frontArt: `${FFG}/0301_T01_EN_Battle_Droid_f1580df691.png`,
  }),
  [TOKEN_BEAST]: tokenUnit(TOKEN_BEAST, {
    name: 'Beast', arena: 'ground', power: 3, hp: 3, aspects: [], traits: ['Creature'],
    frontArt: `${FFG}/09010_T03_EN_Beast_f391b83f34.png`,
  }),
}

/** True for any built-in token card (upgrade or unit) — shared `TOKEN_` id prefix. */
export function isTokenCard(cardId: string): boolean {
  return cardId.startsWith('TOKEN_')
}
