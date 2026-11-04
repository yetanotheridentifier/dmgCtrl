import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { IconButton } from '@pwa-shared/controls'
import type { EngineCard } from '../../engine/types'
import type { ParsedDeck } from '../../utils/parseProtectThePod'
import { BackIcon } from '../icons'
import { DeckList, LeaderAndBase } from './deckParts'
import { useCardShown } from './useCardShown'

/**
 * A deck seen whole before it is chosen: the leader and base, then the card list. It covers the screen,
 * over the sheet it was opened from, and Back returns to that sheet. `actions` are the header's buttons
 * (Delete and Use this deck for a saved deck; the set, Generate again and Use this deck for a generated
 * one), and `deck` is absent while there is none to show, with `status` saying why.
 */
export function DeckView({ title, subtitle, deck, cards, actions, status, portrait, onBack }: {
  title: string
  subtitle: string
  deck: ParsedDeck | null
  cards: Record<string, EngineCard | undefined>
  actions: ReactNode
  status?: ReactNode
  portrait: boolean
  onBack: () => void
}) {
  const { show, shown } = useCardShown()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="deck-view"
      style={{
        position: 'fixed',
        inset: 0,
        // Under the sheets (30), so one opened from the view (the set picker) shows over it.
        zIndex: 20,
        boxSizing: 'border-box',
        paddingTop: 'var(--edge-top)',
        paddingRight: 'var(--edge-right)',
        paddingBottom: 'var(--edge-bottom)',
        paddingLeft: 'var(--edge-left)',
        background: 'var(--color-sheet)',
        color: 'var(--color-text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: portrait ? 'wrap' : 'nowrap' }}>
        <IconButton label="Back to your decks" onClick={onBack}><BackIcon /></IconButton>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '1.15rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{subtitle}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', ...(portrait ? { width: '100%' } : {}) }}>{actions}</div>
      </div>
      {status}
      {deck && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: '16px' }}>
          <LeaderAndBase deck={deck} cards={cards} width={168} show={show} row={portrait} />
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', background: 'var(--color-surface)', borderRadius: '12px', padding: '4px 14px 10px' }}>
            <DeckList deck={deck} cards={cards} show={show} columns={portrait ? '2 140px' : '3 150px'} />
          </div>
        </div>
      )}
      {shown}
    </div>
  )
}
