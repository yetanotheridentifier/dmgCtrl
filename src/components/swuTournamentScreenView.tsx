import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import { baseKey } from '../hooks/useSwuSetup'
import AppScreenLayout from './layout/appScreenLayout'
import SwuBaseSheet from './swuBaseSheet'
import { aspectIconSrc, baseAspect } from '../utils/baseAspect'
import { sectionLabelStyle } from '../styles/sectionLabel'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, DotsIcon } from './icons'
import { Button, IconButton, Sheet } from './shared/controls'
import { FORMAT_LABELS } from '../utils/formatFilter'
import { PLAY_MODE_LABELS } from '../utils/playMode'

interface Props {
  tournament: TournamentState
  // The base the next game is played on: the registered one unless changed between games.
  displayBase: Base
  baseChanged: boolean
  matchInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  points: number
  onNext: () => void
  onDrop: () => void
  onFinish: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  canChangeBase: boolean
  changeBaseOptions: Base[]
  onChangeBase: (b: Base) => void
  hasPlayerId: boolean
  onPlayerPortal: () => void
}

type OpenSheet = null | 'more' | 'drop' | 'base'

type Result = 'won' | 'lost' | 'drawn'

const RESULT_LABELS: Record<Result, string> = { won: 'Won', lost: 'Lost', drawn: 'Drawn' }
const RESULT_COLOURS: Record<Result, { color: string; background: string }> = {
  won: { color: 'var(--color-success)', background: 'rgba(var(--color-success-rgb), 0.15)' },
  lost: { color: 'var(--color-error)', background: 'rgba(var(--color-error-rgb), 0.15)' },
  drawn: { color: 'var(--color-epic)', background: 'rgba(var(--color-epic-rgb), 0.15)' },
}

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }
const mutedSmall: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--color-text-muted)' }

const pointsLabel = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`

export default function SwuTournamentScreenView({
  tournament,
  displayBase,
  baseChanged,
  matchInProgress,
  isComplete,
  totals,
  points,
  onNext,
  onDrop,
  onFinish,
  onBack,
  onHelp,
  onSettings,
  canChangeBase,
  changeBaseOptions,
  onChangeBase,
  hasPlayerId,
  onPlayerPortal,
}: Props) {
  const { isPortrait } = useOrientation()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const close = () => setOpenSheet(null)
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }

  const record = `${totals.won}–${totals.lost}–${totals.drawn}`
  const summary = `SWU · ${FORMAT_LABELS[tournament.format]} · ${PLAY_MODE_LABELS[tournament.playMode]} · ${tournament.totalRounds} rounds`
  // The round to play next: the one under way, or the first without a result.
  const unfinished = tournament.rounds.findIndex(r => r.result === null)
  const nextIndex = isComplete ? -1 : unfinished === -1 ? tournament.rounds.length : unfinished
  const nextLabel = `${matchInProgress ? 'Return to' : 'Start'} round ${nextIndex + 1}`

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.1em', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
          {isComplete ? 'Tournament complete' : 'Tournament'}
        </h1>
        {!isPortrait && <span style={{ ...mutedSmall, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>}
      </div>
      <IconButton label="More" onClick={() => setOpenSheet('more')}><DotsIcon /></IconButton>
    </div>
  )

  const recordCard = (
    <section aria-label="Record" style={cardStyle}>
      <div style={sectionLabelStyle('var(--color-accent)')}>Record</div>
      <div style={{ fontSize: '44px', fontWeight: 300, lineHeight: 1 }}>{record}</div>
      <div style={{ fontSize: '0.95rem' }}>{pointsLabel(points)}</div>
      <div style={mutedSmall}>{`Won ${totals.won}, lost ${totals.lost}, drawn ${totals.drawn}`}</div>
    </section>
  )

  const aspect = baseAspect(displayBase)
  const baseCard = (
    <section aria-label="Your base" style={{ ...cardStyle, padding: '12px 16px', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
      {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '26px', height: '26px', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayBase.name}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{baseChanged ? 'Your base for the next game' : 'Your base for this tournament'}</span>
      </div>
      {canChangeBase && <Button onClick={() => setOpenSheet('base')} style={{ flexShrink: 0 }}>Change base</Button>}
    </section>
  )

  const roundRows = Array.from({ length: tournament.totalRounds }, (_, i) => {
    const round = tournament.rounds[i]
    const played = round !== undefined && round.result !== null
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
          background: played || isNext ? 'var(--color-surface)' : 'transparent',
          boxShadow: isNext ? 'inset 0 0 0 1px var(--color-accent)' : undefined,
          opacity: played || isNext ? 1 : 0.5,
        }}
      >
        <span style={{ width: '70px', ...mutedSmall }}>{`Round ${i + 1}`}</span>
        {played && round.result && (
          <>
            <span style={{ width: '64px', height: '26px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', ...RESULT_COLOURS[round.result] }}>
              {RESULT_LABELS[round.result]}
            </span>
            <span style={{ fontSize: '0.95rem' }}>{`${round.playerScore}–${round.opponentScore}`}</span>
          </>
        )}
        {isNext && <span style={{ fontSize: '0.875rem', color: 'var(--color-accent)' }}>{matchInProgress ? 'In progress' : 'Next'}</span>}
      </li>
    )
  })

  // The list scrolls within itself when a long tournament outgrows the space; the screen never does.
  const roundsList = (
    <ol aria-label="Rounds" style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {roundRows}
    </ol>
  )

  const playerPortal = <Button onClick={onPlayerPortal}>{hasPlayerId ? 'Player portal' : 'Enter player ID'}</Button>
  const drop = <Button onClick={() => setOpenSheet('drop')}>Drop</Button>
  const primary = isComplete
    ? <Button variant="primary" onClick={onFinish} style={{ minHeight: '52px', padding: '0 20px' }}>Finish</Button>
    : <Button variant="primary" onClick={onNext} style={{ minHeight: '52px', padding: '0 20px' }}>{nextLabel}</Button>

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <Sheet open={openSheet === 'drop'} title="Drop from the tournament?" onClose={close}>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.45, color: 'var(--color-text-body)' }}>
          {`Your record (${record}, ${pointsLabel(points)}) is cleared and you go back to setup. This can’t be undone.`}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button onClick={close}>Keep playing</Button>
          <Button variant="primary" onClick={closeThen(onDrop)} style={{ minHeight: '52px', padding: '0 20px', background: 'var(--color-error)' }}>Drop</Button>
        </div>
      </Sheet>
      <SwuBaseSheet
        open={openSheet === 'base'}
        onClose={close}
        bases={changeBaseOptions}
        favouriteBases={[]}
        recentBases={[]}
        currentKey={baseKey(displayBase)}
        onChoose={b => { onChangeBase(b); close() }}
      />
    </>
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div data-testid="swu-tournament" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 16px 24px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
          {header}
          <div style={{ ...mutedSmall, marginTop: '-8px' }}>{summary}</div>
          {recordCard}
          {baseCard}
          {roundsList}
          {primary}
          {isComplete ? playerPortal : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {drop}
              {playerPortal}
            </div>
          )}
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid="swu-tournament" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            {recordCard}
            {baseCard}
          </div>
          {roundsList}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {!isComplete && drop}
          {playerPortal}
          <div style={{ flex: 1 }} />
          {primary}
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
