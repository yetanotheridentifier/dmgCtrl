import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import { baseKey } from '../hooks/useSwuSetup'
import SwuBaseSheet from './swuBaseSheet'
import { aspectIconSrc, baseAspect } from '../utils/baseAspect'
import { useOrientation } from '../hooks/useOrientation'
import { Button, Sheet } from './shared/controls'
import { DropSheet, PrimaryAction, RecordCard, RoundsList, TournamentCard, TournamentLayout } from './shared/tournament'
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

  const aspect = baseAspect(displayBase)
  const baseCard = (
    <TournamentCard label="Your base" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
      {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '26px', height: '26px', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayBase.name}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{baseChanged ? 'Your base for the next game' : 'Your base for this tournament'}</span>
      </div>
      {canChangeBase && <Button onClick={() => setOpenSheet('base')} style={{ flexShrink: 0 }}>Change base</Button>}
    </TournamentCard>
  )

  const playerPortal = <Button onClick={onPlayerPortal}>{hasPlayerId ? 'Player portal' : 'Enter player ID'}</Button>
  const drop = <Button onClick={() => setOpenSheet('drop')}>Drop</Button>

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <DropSheet open={openSheet === 'drop'} record={`${record}, ${pointsLabel(points)}`} onClose={close} onDrop={onDrop} />
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

  return (
    <TournamentLayout
      testId="swu-tournament"
      isPortrait={isPortrait}
      isComplete={isComplete}
      summary={summary}
      onBack={onBack}
      onMore={() => setOpenSheet('more')}
      record={<RecordCard record={record} headline={pointsLabel(points)} detail={`Won ${totals.won}, lost ${totals.lost}, drawn ${totals.drawn}`} />}
      card={baseCard}
      rounds={
        <RoundsList
          totalRounds={tournament.totalRounds}
          rounds={tournament.rounds.map(r => ({ result: r.result, score: `${r.playerScore}–${r.opponentScore}` }))}
          nextIndex={nextIndex}
          inProgress={matchInProgress}
        />
      }
      primary={isComplete ? <PrimaryAction label="Finish" onClick={onFinish} /> : <PrimaryAction label={nextLabel} onClick={onNext} />}
      secondary={isComplete ? [playerPortal] : [drop, playerPortal]}
      sheets={sheets}
    />
  )
}
