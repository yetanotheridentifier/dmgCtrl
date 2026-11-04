import { useState } from 'react'
import type { ReactNode } from 'react'
import type { EngineCard } from '../../engine/types'
import { CardShown } from './deckParts'

/** A tap that shows a card: the handler, and the overlay to render while one is shown. */
export function useCardShown(): { show: (card: EngineCard | undefined, name: string) => void; shown: ReactNode } {
  const [shown, setShown] = useState<{ card: EngineCard | undefined; name: string } | null>(null)
  return {
    show: (card, name) => setShown({ card, name }),
    shown: shown && <CardShown card={shown.card} name={shown.name} onClose={() => setShown(null)} />,
  }
}
