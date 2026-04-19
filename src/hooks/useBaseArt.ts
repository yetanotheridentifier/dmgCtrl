import { useState, useMemo, useEffect } from 'react'
import { Base } from './useBases'

interface ArtEntry {
  url: string
  isHyperspace: boolean
}

function buildEntries(base: Base, useHyperspace: boolean): ArtEntry[] {
  const normal: ArtEntry[] = [
    ...(base.frontArt ? [{ url: base.frontArt, isHyperspace: false }] : []),
    ...(base.frontArtLowRes ? [{ url: base.frontArtLowRes, isHyperspace: false }] : []),
  ]
  const hyper: ArtEntry[] = [
    ...(base.hyperspaceArtHiRes ? [{ url: base.hyperspaceArtHiRes, isHyperspace: true }] : []),
    ...(base.hyperspaceArt ? [{ url: base.hyperspaceArt, isHyperspace: true }] : []),
  ]
  return useHyperspace ? [...hyper, ...normal] : [...normal, ...hyper]
}

export function useBaseArt(base: Base | null, useHyperspace: boolean) {
  const [index, setIndex] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)

  const entries = useMemo(
    () => (base ? buildEntries(base, useHyperspace) : []),
    [base, useHyperspace],
  )

  useEffect(() => {
    setIndex(0)
    setImageLoaded(false)
  }, [base?.set, base?.number])

  const current = entries[index] ?? null
  const tried = entries.slice(0, index)
  const normalCount = entries.filter(e => !e.isHyperspace).length
  const hyperCount = entries.filter(e => e.isHyperspace).length

  return {
    src: current?.url ?? null,
    isHyperspace: current?.isHyperspace ?? false,
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