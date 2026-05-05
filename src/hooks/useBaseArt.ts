import { useState, useMemo, useEffect } from 'react'
import { Base } from './useBases'
import { getRotationFromHyperspaceUrl } from '../constants/rotatedCards'

interface ArtEntry {
  url: string
  isHyperspace: boolean
  rotationDeg: number
}

function buildEntries(base: Base, useHyperspace: boolean, preview: boolean): ArtEntry[] {
  const normal: ArtEntry[] = preview
    ? [
        ...(base.frontArtLowRes ? [{ url: base.frontArtLowRes, isHyperspace: false, rotationDeg: 0 }] : []),
        ...(base.frontArt ? [{ url: base.frontArt, isHyperspace: false, rotationDeg: 0 }] : []),
      ]
    : [
        ...(base.frontArt ? [{ url: base.frontArt, isHyperspace: false, rotationDeg: 0 }] : []),
        ...(base.frontArtLowRes ? [{ url: base.frontArtLowRes, isHyperspace: false, rotationDeg: 0 }] : []),
      ]
  const hyper: ArtEntry[] = preview
    ? [
        ...(base.hyperspaceArt ? [{ url: base.hyperspaceArt, isHyperspace: true, rotationDeg: 0 }] : []),
        ...(base.hyperspaceArtHiRes ? [{
          url: base.hyperspaceArtHiRes,
          isHyperspace: true,
          rotationDeg: getRotationFromHyperspaceUrl(base.hyperspaceArtHiRes),
        }] : []),
      ]
    : [
        ...(base.hyperspaceArtHiRes ? [{
          url: base.hyperspaceArtHiRes,
          isHyperspace: true,
          rotationDeg: getRotationFromHyperspaceUrl(base.hyperspaceArtHiRes),
        }] : []),
        ...(base.hyperspaceArt ? [{ url: base.hyperspaceArt, isHyperspace: true, rotationDeg: 0 }] : []),
      ]
  return useHyperspace ? [...hyper, ...normal] : [...normal, ...hyper]
}

export function useBaseArt(base: Base | null, useHyperspace: boolean, preview = false) {
  const [index, setIndex] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)

  const entries = useMemo(
    () => (base ? buildEntries(base, useHyperspace, preview) : []),
    [base, useHyperspace, preview],
  )

  useEffect(() => {
    setIndex(0)
    setImageLoaded(false)
  }, [base?.set, base?.number, useHyperspace])

  const current = entries[index] ?? null
  const tried = entries.slice(0, index)
  const normalCount = entries.filter(e => !e.isHyperspace).length
  const hyperCount = entries.filter(e => e.isHyperspace).length

  return {
    src: current?.url ?? null,
    isHyperspace: current?.isHyperspace ?? false,
    rotationDeg: current?.rotationDeg ?? 0,
    allFailed: entries.length === 0 || index >= entries.length,
    normalFailed: normalCount > 0 && tried.filter(e => !e.isHyperspace).length >= normalCount,
    hyperspaceFailed: hyperCount > 0 && tried.filter(e => e.isHyperspace).length >= hyperCount,
    imageLoaded,
    onLoad: () => setImageLoaded(true),
    onError: () => {
      setImageLoaded(false)
      setIndex(i => i + 1)
    },
  }
}