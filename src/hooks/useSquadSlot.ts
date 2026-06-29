import { useState } from 'react'
import type { XwingListImport } from './useXwingSetup'
import { parseXwsText } from '../utils/parseXwsText'
import type { XwingPilot } from '../utils/parseXwsText'

export interface SquadSlot {
  text: string
  setText: (v: string) => void
  error: string | null
  confirmed: boolean
  pilots: XwingPilot[]
  confirm: (listImport: XwingListImport) => void
  edit: () => void
}

export function useSquadSlot(): SquadSlot {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pilots, setPilots] = useState<XwingPilot[]>([])

  function confirm(listImport: XwingListImport) {
    if (listImport === 'XWA') {
      const result = parseXwsText(text)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPilots(result.pilots)
    }
    setError(null)
    setConfirmed(true)
  }

  function edit() {
    setConfirmed(false)
    setError(null)
  }

  return { text, setText, error, confirmed, pilots, confirm, edit }
}
