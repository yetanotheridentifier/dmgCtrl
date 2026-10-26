import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingTournamentList, XwingTournamentState } from '../hooks/useXwingTournament'
import { rollScenario, XWING_SCENARIOS, type XwingScenario } from '../hooks/useXwingSetup'
import { listMeta, listPoints } from '../utils/xwingListInfo'
import { DiceIcon } from './icons'
import { Button, IconButton, OptionRow, SelectButton, Sheet } from './shared/controls'
import { DropSheet, PrimaryAction, RecordCard, RoundsList, TournamentCard, TournamentLayout } from './shared/tournament'

interface Props {
  tournament: XwingTournamentState
  roundInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  margin: number
  // The next round, against the opponent and with the scenario chosen for it.
  onStartRound: (opponent: XwingTournamentList, scenario: XwingScenario) => void
  onReturnToRound: () => void
  onDrop: () => void
  onFinish: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onLists?: () => void
}

type OpenSheet = null | 'more' | 'drop' | 'opponent' | 'scenario'

const NO_LIST: XwingTournamentList = { name: 'No list', pilots: [], deficit: 0 }

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

// Between rounds of an X-Wing tournament: the record and margin, your list, every round, and the
// next one a tap away. The tournament itself is started from the start sheet on X-Wing setup.
export default function XwingTournamentScreen({
  tournament,
  roundInProgress,
  isComplete,
  totals,
  margin,
  onStartRound,
  onReturnToRound,
  onDrop,
  onFinish,
  onBack,
  onHelp,
  onSettings,
  onLists,
}: Props) {
  const { isPortrait } = useOrientation()
  const { lists } = useXwingLists()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const close = () => setOpenSheet(null)
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }

  const { player, rounds, totalRounds } = tournament
  const record = totals.drawn > 0 ? `${totals.won}–${totals.lost}–${totals.drawn}` : `${totals.won}–${totals.lost}`
  const tally = `Won ${totals.won}, lost ${totals.lost}${totals.drawn > 0 ? `, drawn ${totals.drawn}` : ''}`
  const marginText = `margin ${signed(margin)}`
  const nextIndex = isComplete ? -1 : roundInProgress ? rounds.length - 1 : rounds.length
  const roundNumber = nextIndex + 1

  // The next round's scenario starts as the last round's each time the sheet opens.
  const lastScenario = rounds[rounds.length - 1]?.scenario ?? 'None'
  const [scenario, setScenario] = useState<XwingScenario>(lastScenario)
  const chooseOpponent = () => { setScenario(lastScenario); setOpenSheet('opponent') }
  const startOpponent = (opponent: XwingTournamentList) => { close(); onStartRound(opponent, scenario) }
  const backToOpponent = () => setOpenSheet('opponent')

  const listCard = (
    <TournamentCard label="Your list" style={{ gap: '2px' }}>
      <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        {player.pilots.length > 0 ? `Your list for this tournament · ${listPoints(player.pilots)} pts` : 'Your list for this tournament'}
      </span>
    </TournamentCard>
  )

  const primary = isComplete
    ? <PrimaryAction label="Finish" onClick={onFinish} />
    : roundInProgress
      ? <PrimaryAction label={`Return to round ${roundNumber}`} onClick={onReturnToRound} />
      : <PrimaryAction label={`Start round ${roundNumber}`} onClick={chooseOpponent} />

  const drop = <Button onClick={() => setOpenSheet('drop')}>Drop</Button>

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <DropSheet open={openSheet === 'drop'} record={`${record}, ${marginText}`} onClose={close} onDrop={onDrop} />
      <Sheet open={openSheet === 'opponent'} title={`Opponent’s list for round ${roundNumber}`} onClose={close}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <SelectButton label="Scenario" value={scenario} onClick={() => setOpenSheet('scenario')} />
          <IconButton label="Roll a scenario" onClick={() => setScenario(rollScenario())}><DiceIcon /></IconButton>
        </div>
        {lists.map(list => (
          <OptionRow
            key={list.id}
            title={list.name}
            detail={listMeta(list.pilots, list.faction)}
            onClick={() => startOpponent({ name: list.name, pilots: list.pilots, deficit: Math.max(0, 50 - listPoints(list.pilots)) })}
          />
        ))}
        {onLists && <Button onClick={closeThen(onLists)}>Import XWS</Button>}
        <OptionRow title="No list" detail="No ships to tap in the game" onClick={() => startOpponent(NO_LIST)} />
      </Sheet>
      <Sheet open={openSheet === 'scenario'} title="Scenario" onClose={backToOpponent}>
        {XWING_SCENARIOS.map(s => (
          <OptionRow key={s} title={s} selected={s === scenario} onClick={() => { setScenario(s); backToOpponent() }} />
        ))}
      </Sheet>
    </>
  )

  return (
    <TournamentLayout
      testId="xwing-tournament"
      isPortrait={isPortrait}
      isComplete={isComplete}
      summary={`X-Wing · ${totalRounds} rounds`}
      onBack={onBack}
      onMore={() => setOpenSheet('more')}
      record={<RecordCard record={record} headline={tally} detail={`Margin ${signed(margin)}`} />}
      card={listCard}
      rounds={
        <RoundsList
          totalRounds={totalRounds}
          rounds={rounds.map(r => ({ result: r.result, score: `${r.playerScore}–${r.opponentScore}`, note: r.scenario === 'None' ? `vs ${r.opponent.name}` : `vs ${r.opponent.name} · ${r.scenario}` }))}
          nextIndex={nextIndex}
          inProgress={roundInProgress}
        />
      }
      primary={primary}
      secondary={isComplete ? [] : [drop]}
      sheets={sheets}
    />
  )
}
