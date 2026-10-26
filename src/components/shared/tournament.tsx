import { Fragment, type ReactNode } from 'react'
import AppScreenLayout from '../layout/appScreenLayout'
import { sectionLabelStyle } from '../../styles/sectionLabel'
import { BackIcon, DotsIcon } from '../icons'
import { Button, IconButton, Sheet } from './controls'

// The between-rounds screen both games share: the record, the card under it (your base or your
// list), every round, the primary and the secondary actions, and the Drop confirmation.

export type RoundResult = 'won' | 'lost' | 'drawn'

const RESULT_LABELS: Record<RoundResult, string> = { won: 'Won', lost: 'Lost', drawn: 'Drawn' }
const RESULT_COLOURS: Record<RoundResult, { color: string; background: string }> = {
  won: { color: 'var(--color-success)', background: 'rgba(var(--color-success-rgb), 0.15)' },
  lost: { color: 'var(--color-error)', background: 'rgba(var(--color-error-rgb), 0.15)' },
  drawn: { color: 'var(--color-epic)', background: 'rgba(var(--color-epic-rgb), 0.15)' },
}

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }
const mutedSmall: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--color-text-muted)' }
const bigButton: React.CSSProperties = { minHeight: '52px', padding: '0 20px' }

// The card under the record: your base, or your list.
export function TournamentCard({ label, style, children }: { label: string; style?: React.CSSProperties; children: ReactNode }) {
  return <section aria-label={label} style={{ ...cardStyle, padding: '12px 16px', ...style }}>{children}</section>
}

export function RecordCard({ record, headline, detail }: { record: string; headline: string; detail: string }) {
  return (
    <section aria-label="Record" style={cardStyle}>
      <div style={sectionLabelStyle('var(--color-accent)')}>Record</div>
      <div style={{ fontSize: '44px', fontWeight: 300, lineHeight: 1 }}>{record}</div>
      <div style={{ fontSize: '0.95rem' }}>{headline}</div>
      <div style={mutedSmall}>{detail}</div>
    </section>
  )
}

// One played round: its result, its score and, where the game has one, a note on the right.
export interface PlayedRound {
  result: RoundResult | null
  score: string
  note?: string
}

export function RoundsList({ totalRounds, rounds, nextIndex, inProgress }: {
  totalRounds: number
  rounds: PlayedRound[]
  // The round to play next, or -1 once every round is played.
  nextIndex: number
  inProgress: boolean
}) {
  const rows = Array.from({ length: totalRounds }, (_, i) => {
    const round = rounds[i]
    const result = round?.result ?? null
    const isNext = i === nextIndex
    return (
      <li
        key={i}
        aria-current={isNext ? 'step' : undefined}
        style={{
          height: '40px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '0 14px',
          borderRadius: '10px',
          background: result || isNext ? 'var(--color-surface)' : 'transparent',
          boxShadow: isNext ? 'inset 0 0 0 1px var(--color-accent)' : undefined,
          opacity: result || isNext ? 1 : 0.5,
        }}
      >
        <span style={{ width: '70px', flexShrink: 0, ...mutedSmall }}>{`Round ${i + 1}`}</span>
        {result && (
          <>
            <span style={{ width: '64px', height: '26px', flexShrink: 0, borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', ...RESULT_COLOURS[result] }}>
              {RESULT_LABELS[result]}
            </span>
            <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{round.score}</span>
          </>
        )}
        {isNext && <span style={{ fontSize: '0.875rem', flexShrink: 0, color: 'var(--color-accent)' }}>{inProgress ? 'In progress' : 'Next'}</span>}
        {round?.note && (
          <span style={{ flex: 1, minWidth: 0, textAlign: 'right', ...mutedSmall, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{round.note}</span>
        )}
      </li>
    )
  })
  // The list scrolls within itself when a long tournament outgrows the space; the screen never does.
  return (
    <ol aria-label="Rounds" style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {rows}
    </ol>
  )
}

export function DropSheet({ open, record, onClose, onDrop }: { open: boolean; record: string; onClose: () => void; onDrop: () => void }) {
  return (
    <Sheet open={open} title="Drop from the tournament?" onClose={onClose}>
      <div style={{ fontSize: '0.9rem', lineHeight: 1.45, color: 'var(--color-text-body)' }}>
        {`Your record (${record}) is cleared and you go back to setup. This can’t be undone.`}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <Button onClick={onClose}>Keep playing</Button>
        <Button variant="primary" onClick={() => { onClose(); onDrop() }} style={{ ...bigButton, background: 'var(--color-error)' }}>Drop</Button>
      </div>
    </Sheet>
  )
}

export function PrimaryAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="primary" onClick={onClick} style={bigButton}>{label}</Button>
}

interface LayoutProps {
  testId: string
  isPortrait: boolean
  isComplete: boolean
  summary: string
  onBack: () => void
  onMore: () => void
  record: ReactNode
  // Under the record: your base, or your list.
  card: ReactNode
  rounds: ReactNode
  primary: ReactNode
  // Drop and the like: beside the primary in landscape, under it in portrait.
  secondary: ReactNode[]
  sheets: ReactNode
}

export function TournamentLayout({ testId, isPortrait, isComplete, summary, onBack, onMore, record, card, rounds, primary, secondary, sheets }: LayoutProps) {
  const actions = secondary.map((action, i) => <Fragment key={i}>{action}</Fragment>)
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.1em', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
          {isComplete ? 'Tournament complete' : 'Tournament'}
        </h1>
        {!isPortrait && <span style={{ ...mutedSmall, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>}
      </div>
      <IconButton label="More" onClick={onMore}><DotsIcon /></IconButton>
    </div>
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div data-testid={testId} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 16px 24px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
          {header}
          <div style={{ ...mutedSmall, marginTop: '-8px' }}>{summary}</div>
          {record}
          {card}
          {rounds}
          {primary}
          {secondary.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${secondary.length}, 1fr)`, gap: '8px' }}>
              {actions}
            </div>
          )}
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid={testId} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            {record}
            {card}
          </div>
          {rounds}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {actions}
          <div style={{ flex: 1 }} />
          {primary}
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
