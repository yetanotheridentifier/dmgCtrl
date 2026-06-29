import { useState } from 'react'
import type { XwingListImport } from './useXwingSetup'
import { parseXwsText } from '../utils/parseXwsText'
import type { XwingPilot } from '../utils/parseXwsText'
import type { XwingSquadFavourite } from './useXwingFavourites'

export interface SquadSlot {
  text: string
  setText: (v: string) => void
  squadName: string | undefined
  error: string | null
  confirmed: boolean
  isFromFavourite: boolean
  pilots: XwingPilot[]
  confirm: (listImport: XwingListImport) => void
  edit: () => void
  confirmFromFavourite: (fav: XwingSquadFavourite) => void
  markUnsaved: () => void
}

export function useSquadSlot(): SquadSlot {
  const [text, setText] = useState('')
  const [squadName, setSquadName] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [isFromFavourite, setIsFromFavourite] = useState(false)
  const [pilots, setPilots] = useState<XwingPilot[]>([])

  function confirm(listImport: XwingListImport) {
    if (listImport === 'XWA') {
      const result = parseXwsText(text)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPilots(result.pilots)
      setSquadName(result.name)
    }
    setError(null)
    setIsFromFavourite(false)
    setConfirmed(true)
  }

  function edit() {
    setConfirmed(false)
    setIsFromFavourite(false)
    setError(null)
  }

  function confirmFromFavourite(fav: XwingSquadFavourite) {
    setText('')
    setPilots(fav.pilots)
    setSquadName(fav.name)
    setError(null)
    setIsFromFavourite(true)
    setConfirmed(true)
  }

  function markUnsaved() {
    setIsFromFavourite(false)
  }

  return { text, setText, squadName, error, confirmed, isFromFavourite, pilots, confirm, edit, confirmFromFavourite, markUnsaved }
}
