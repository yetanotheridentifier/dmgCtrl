import { useState, useMemo, useEffect } from 'react'
import { useBases, Base } from './useBases'

const ASPECT_ORDER = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'None']
const HYPERSPACE_PREF_KEY = 'pref_hyperspace'

export interface InitialSelection {
  set: string
  aspect: string
  key: string
}

export function useSwuSetup(
  onConfirm: (base: Base, useHyperspace: boolean) => void,
  initialSelection?: InitialSelection | null,
) {
  const { bases, loading, error } = useBases()

  const [selectedSet, setSelectedSet] = useState(initialSelection?.set ?? '')
  const [selectedAspect, setSelectedAspect] = useState(initialSelection?.aspect ?? '')
  const [selectedKey, setSelectedKey] = useState(initialSelection?.key ?? '')
  const [useHyperspace, setUseHyperspace] = useState<boolean>(() => {
    return localStorage.getItem(HYPERSPACE_PREF_KEY) === 'true'
  })

  const availableSets = useMemo(() => {
    return [...new Set(bases.map(b => b.set))].sort()
  }, [bases])

  const availableAspects = useMemo(() => {
    if (!selectedSet) return []
    const basesInSet = bases.filter(b => b.set === selectedSet)
    const aspects = new Set<string>()
    basesInSet.forEach(b => {
      if (b.aspects.length === 0) {
        aspects.add('None')
      } else {
        b.aspects.forEach(a => aspects.add(a))
      }
    })
    return ASPECT_ORDER.filter(a => aspects.has(a))
  }, [bases, selectedSet])

  const filteredBases = useMemo(() => {
    if (!selectedSet || !selectedAspect) return []
    return bases.filter(b => {
      if (b.set !== selectedSet) return false
      if (selectedAspect === 'None') return b.aspects.length === 0
      return b.aspects.includes(selectedAspect)
    })
  }, [bases, selectedSet, selectedAspect])

  const selectedBase = filteredBases.find(
    b => `${b.set}-${b.number}` === selectedKey
  ) ?? null

  // Auto-select aspect when only one option available
  useEffect(() => {
    if (availableAspects.length === 1) {
      setSelectedAspect(availableAspects[0])
      setSelectedKey('')
    }
  }, [availableAspects])

  // Auto-select base when only one option available
  useEffect(() => {
    if (filteredBases.length === 1) {
      setSelectedKey(`${filteredBases[0].set}-${filteredBases[0].number}`)
    }
  }, [filteredBases])

  const handleSetChange = (set: string) => {
    setSelectedSet(set)
    setSelectedAspect('')
    setSelectedKey('')
  }

  const handleAspectChange = (aspect: string) => {
    setSelectedAspect(aspect)
    setSelectedKey('')
  }

  const handleKeyChange = (key: string) => {
    setSelectedKey(key)
  }

  const handleHyperspaceToggle = (value: boolean) => {
    setUseHyperspace(value)
    localStorage.setItem(HYPERSPACE_PREF_KEY, String(value))
  }

  const handleSubmit = (effectiveHyperspace: boolean) => {
    if (!selectedBase) return
    onConfirm(selectedBase, effectiveHyperspace)
  }

  const selectBaseByKey = (key: string): boolean => {
    const base = bases.find(b => `${b.set}-${b.number}` === key)
    if (!base) return false
    const aspect = base.aspects.length === 0 ? 'None' : base.aspects[0]
    setSelectedSet(base.set)
    setSelectedAspect(aspect)
    setSelectedKey(key)
    return true
  }

  return {
    loading,
    error,
    selectedSet,
    selectedAspect,
    selectedKey,
    selectedBase,
    useHyperspace,
    availableSets,
    availableAspects,
    filteredBases,
    handleSetChange,
    handleAspectChange,
    handleKeyChange,
    handleHyperspaceToggle,
    handleSubmit,
    selectBaseByKey,
  }
}