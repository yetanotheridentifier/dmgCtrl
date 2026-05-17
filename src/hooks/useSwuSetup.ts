import { useState, useMemo, useEffect } from 'react'
import { useBases, Base } from './useBases'
import { Format, getValidSets } from '../utils/formatFilter'
import { SetupMode } from '../utils/playMode'

const ASPECT_ORDER = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'None']

export interface InitialSelection {
  set: string
  aspect: string
  key: string
}

export function useSwuSetup(
  onConfirm: (base: Base, mode: SetupMode) => void,
  initialSelection?: InitialSelection | null,
) {
  const { bases, loading, error } = useBases()

  const [selectedSet, setSelectedSet] = useState(initialSelection?.set ?? '')
  const [selectedAspect, setSelectedAspect] = useState(initialSelection?.aspect ?? '')
  const [selectedKey, setSelectedKey] = useState(initialSelection?.key ?? '')

  const [selectedFormat, setSelectedFormat] = useState<Format>(() => {
    const saved = localStorage.getItem('pref_format')
    if (saved === 'limited' || saved === 'eternal' || saved === 'twin-suns') return saved
    if (saved === 'sealed' || saved === 'draft' || saved === 'chaos') return 'limited'
    return 'premier'
  })

  const [selectedMode, setSelectedMode] = useState<SetupMode>(() => {
    const saved = localStorage.getItem('pref_play_mode')
    if (saved === 'tournament') return 'tournament'
    if (saved === 'bo1' || saved === 'bo3') return 'tournament'
    return 'casual'
  })

  const availableSets = useMemo(() => {
    return [...new Set(bases.map(b => b.set))].sort()
  }, [bases])

  const validSets = useMemo(() => {
    return getValidSets(selectedFormat, availableSets)
  }, [selectedFormat, availableSets])

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedAspect(availableAspects[0])
      setSelectedKey('')
    }
  }, [availableAspects])

  // Auto-select base when only one option available
  useEffect(() => {
    if (filteredBases.length === 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedKey(`${filteredBases[0].set}-${filteredBases[0].number}`)
    }
  }, [filteredBases])

  const handleModeChange = (mode: SetupMode) => {
    setSelectedMode(mode)
    localStorage.setItem('pref_play_mode', mode)
  }

  const handleFormatChange = (format: Format) => {
    setSelectedFormat(format)
    localStorage.setItem('pref_format', format)
    // Clear selection if the current set is no longer valid for the new format
    if (selectedSet && !getValidSets(format, availableSets).includes(selectedSet)) {
      setSelectedSet('')
      setSelectedAspect('')
      setSelectedKey('')
    }
  }

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


  const handleSubmit = () => {
    if (!selectedBase) return
    onConfirm(selectedBase, selectedMode)
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
    selectedFormat,
    selectedMode,
    selectedSet,
    selectedAspect,
    selectedKey,
    selectedBase,
    availableSets,
    validSets,
    availableAspects,
    filteredBases,
    handleFormatChange,
    handleModeChange,
    handleSetChange,
    handleAspectChange,
    handleKeyChange,
    handleSubmit,
    selectBaseByKey,
  }
}