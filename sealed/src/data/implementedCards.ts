/**
 * Implementation manifest — the cards whose abilities are built into the engine, shown as a
 * reference on the setup screen. Kept in step with the ability registry by a test
 * (`implementedCards.test.ts`) that asserts these ids exactly match the registered ASH cards.
 *
 * Leaders are two-sided: `front` = the undeployed leader ability, `back` = the deployed
 * (leader-unit) ability. A `false` marks a side still to come (see the ability-framework doc).
 */

export interface LeaderStatus {
  id: string
  name: string
  front: boolean
  back: boolean
}

export interface UpgradeStatus {
  id: string
  name: string
}

export const IMPLEMENTED_LEADERS: LeaderStatus[] = [
  { id: 'ASH_009', name: 'Ahsoka Tano', front: true, back: false },
  { id: 'ASH_003', name: 'Baylan Skoll', front: true, back: true },
  { id: 'ASH_010', name: 'Bo-Katan Kryze', front: true, back: true },
  { id: 'ASH_011', name: 'Cad Bane', front: true, back: true },
  { id: 'ASH_015', name: 'Emperor Palpatine', front: true, back: true },
  { id: 'ASH_013', name: 'Ezra Bridger', front: true, back: true },
  { id: 'ASH_005', name: 'Luke Skywalker', front: true, back: true },
  { id: 'ASH_007', name: 'Grand Admiral Sloane', front: true, back: true },
  { id: 'ASH_017', name: 'Greef Karga', front: true, back: true },
  { id: 'ASH_016', name: 'Shin Hati', front: true, back: true },
  { id: 'ASH_012', name: 'Vane', front: true, back: true },
]

export const IMPLEMENTED_UPGRADES: UpgradeStatus[] = [
  { id: 'ASH_084', name: 'Arcana Star Map' },
  { id: 'ASH_055', name: 'Blade of Talzin' },
  { id: 'ASH_180', name: 'Bokken Saber' },
  { id: 'ASH_229', name: 'Camtono' },
  { id: 'ASH_088', name: 'The Conflict Within' },
  { id: 'ASH_087', name: 'Cybernetic Enhancements' },
  { id: 'ASH_135', name: 'The Darksaber' },
  { id: 'ASH_210', name: 'DDC Defender' },
  { id: 'ASH_150', name: 'Deadly Vulnerability' },
  { id: 'ASH_086', name: 'Durasteel Plating' },
  { id: 'ASH_262', name: 'Faith in the Empire' },
  { id: 'ASH_085', name: 'Grav Charge' },
  { id: 'ASH_227', name: 'Heightened Awareness' },
  { id: 'ASH_230', name: 'Improvised Identity' },
  { id: 'ASH_066', name: "Luke's Jedi Lightsaber" },
  { id: 'ASH_181', name: 'Mark My Words' },
  { id: 'ASH_198', name: 'Nowhere to Hide' },
  { id: 'ASH_054', name: 'Pointless to Resist' },
  { id: 'ASH_228', name: 'Preparation' },
  { id: 'ASH_114', name: "Sabine's Lightsaber" },
  { id: 'ASH_199', name: 'There Is No Conflict' },
  { id: 'ASH_182', name: 'Unfettered Ambition' },
  { id: 'ASH_134', name: "Warrior's Legacy" },
  { id: 'ASH_263', name: "The Way of the Mand'alor" },
  { id: 'ASH_183', name: 'Whistling Birds' },
]
