import type { Base } from '../hooks/useBases'

// The aspects the base sheet filters by, and the ones a base can show an icon for.
export const FILTER_ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning']
const ICON_ASPECTS = [...FILTER_ASPECTS, 'Heroism', 'Villainy']

export const aspectIconSrc = (aspect: string) => `${import.meta.env.BASE_URL}${aspect.toLowerCase()}.png`

// The aspect a base is shown with: its first that has an icon.
export function baseAspect(base: Base): string | null {
  return ICON_ASPECTS.find(a => base.aspects.includes(a)) ?? null
}

export const baseMeta = (base: Base) => `${base.set} · ${base.hp} HP`
