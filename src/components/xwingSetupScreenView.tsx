import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, DiceIcon, DotsIcon } from './icons'
import { Button, IconButton, OptionRow, SegmentedControl, SelectButton, SetupHeaderMark, Sheet, Stepper } from './shared/controls'
import type { XwingMatchType, XwingScenario, XwingPlayerChoice } from '../hooks/useXwingSetup'
import { XWING_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingList } from '../hooks/useXwingLists'
import { listMeta, pilotSummary } from '../utils/xwingListInfo'
import { FactionIcon } from './factionIcon'

// A player's choice with its list looked up, so the view never sees a dangling list id.
export type ResolvedChoice = { kind: 'none' } | { kind: 'list'; list: XwingList }

export type Side = 'player' | 'opponent'
type OpenSheet = null | 'more' | 'scenario' | 'tournament' | Side

interface Props {
  matchType: XwingMatchType
  onMatchTypeChange: (v: XwingMatchType) => void
  rounds: number
  onRoundsChange: (v: number) => void
  scenario: XwingScenario
  onScenarioChange: (v: XwingScenario) => void
  onScenarioRandom: () => void
  lists: XwingList[]
  playerChoice: ResolvedChoice | null
  onPlayerChoose: (v: XwingPlayerChoice | null) => void
  opponentChoice: ResolvedChoice | null
  onOpponentChoose: (v: XwingPlayerChoice | null) => void
  lastOpponentList: XwingList | null
  playerDeficit: number
  onPlayerDeficitChange: (v: number) => void
  opponentDeficit: number
  onOpponentDeficitChange: (v: number) => void
  canStart: boolean
  onStart: () => void
  tournamentInProgress?: boolean
  onStartTournament?: () => void
  onGoToTournament?: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onLists?: () => void
  onImport?: () => void
  // Opens the list builder; the list it saves comes back chosen for that side.
  onBuild?: (side: Side) => void
}

const NO_SHIPS_NOTE = 'No ships to tap in the game'

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
}

const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--color-text-muted)' }

export default function XwingSetupScreenView({
  matchType,
  onMatchTypeChange,
  rounds,
  onRoundsChange,
  scenario,
  onScenarioChange,
  onScenarioRandom,
  lists,
  playerChoice,
  onPlayerChoose,
  opponentChoice,
  onOpponentChoose,
  lastOpponentList,
  playerDeficit,
  onPlayerDeficitChange,
  opponentDeficit,
  onOpponentDeficitChange,
  canStart,
  onStart,
  tournamentInProgress = false,
  onStartTournament,
  onGoToTournament,
  onBack,
  onHelp,
  onSettings,
  onLists,
  onImport,
  onBuild,
}: Props) {
  const { isPortrait } = useOrientation()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }

  const sides = {
    player: { label: 'You', sheetTitle: 'Your list', choice: playerChoice, onChoose: onPlayerChoose, deficit: playerDeficit, onDeficitChange: onPlayerDeficitChange },
    opponent: { label: 'Opponent', sheetTitle: "Opponent's list", choice: opponentChoice, onChoose: onOpponentChoose, deficit: opponentDeficit, onDeficitChange: onOpponentDeficitChange },
  }

  const renderCard = (side: Side) => {
    const { label, choice, deficit, onDeficitChange } = sides[side]
    const t = (id: string) => `${side}-${id}`
    const offerLast = side === 'opponent' && choice === null && lastOpponentList !== null
    return (
      <div data-testid={t('card')} style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minHeight: '44px' }}>
          <div style={sectionLabelStyle}>{label}</div>
          {choice !== null && <Button onClick={() => setOpenSheet(side)}>Change list</Button>}
        </div>
        {choice === null && side === 'opponent' && <div style={{ fontSize: '1.15rem' }}>Choose opponent's list</div>}
        {offerLast && (
          <OptionRow
            title={lastOpponentList.name}
            icon={<FactionIcon faction={lastOpponentList.faction} size={18} />}
            detail={`Same as last game · ${listMeta(lastOpponentList.pilots, lastOpponentList.faction)}`}
            suggested
            onClick={() => onOpponentChoose({ kind: 'list', listId: lastOpponentList.id })}
          />
        )}
        {choice === null && (
          <Button onClick={() => setOpenSheet(side)}>{offerLast ? 'Choose another list' : 'Choose a list'}</Button>
        )}
        {choice?.kind === 'list' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <FactionIcon faction={choice.list.faction} />
              <div data-testid={t('chosen-name')} style={{ fontSize: '1.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{choice.list.name}</div>
            </div>
            <div style={mutedStyle}>{listMeta(choice.list.pilots, choice.list.faction)}</div>
            <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--color-text-body)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {pilotSummary(choice.list.pilots)}
            </div>
          </>
        )}
        {choice?.kind === 'none' && (
          <>
            <div data-testid={t('chosen-name')} style={{ fontSize: '1.15rem' }}>No list</div>
            <div style={mutedStyle}>{NO_SHIPS_NOTE}</div>
            <Stepper label="Deficit" value={deficit} min={0} max={4} onChange={onDeficitChange} />
          </>
        )}
      </div>
    )
  }

  const renderListSheet = (side: Side) => {
    const { sheetTitle, choice, onChoose } = sides[side]
    const t = (id: string) => `${side}-${id}`
    const pick = (v: XwingPlayerChoice) => { onChoose(v); close() }
    return (
      <Sheet open={openSheet === side} title={sheetTitle} onClose={close}>
        {lists.length === 0 && <div style={mutedStyle}>No saved lists yet</div>}
        {lists.map(list => (
          <OptionRow
            key={list.id}
            testId={t(`list-option-${list.id}`)}
            title={list.name}
            icon={<FactionIcon faction={list.faction} size={18} />}
            detail={listMeta(list.pilots, list.faction)}
            selected={choice?.kind === 'list' && choice.list.id === list.id}
            onClick={() => pick({ kind: 'list', listId: list.id })}
          />
        ))}
        <div style={{ display: 'flex', gap: '8px' }}>
          {onBuild && <Button onClick={closeThen(() => onBuild(side))} style={{ flex: 1 }}>Build a list</Button>}
          {onImport && <Button onClick={closeThen(onImport)} style={{ flex: 1 }}>Import XWS</Button>}
        </div>
        <OptionRow
          testId={t('no-list-btn')}
          title="No list"
          detail={`${NO_SHIPS_NOTE}; set a deficit instead`}
          selected={choice?.kind === 'none'}
          onClick={() => pick({ kind: 'none' })}
        />
      </Sheet>
    )
  }

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
      <SetupHeaderMark />
      <h1 style={{ flex: 1, margin: 0, fontSize: '1.4rem', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>X-Wing</h1>
      <IconButton label="More" onClick={() => setOpenSheet('more')}><DotsIcon /></IconButton>
    </div>
  )

  const matchControl = (
    <SegmentedControl
      label="Match"
      options={[{ value: 'Casual', label: 'Casual' }, { value: 'Tournament', label: 'Tournament' }]}
      value={matchType}
      onChange={onMatchTypeChange}
    />
  )

  const scenarioControls = (
    <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: 0 }}>
      <SelectButton label="Scenario" value={scenario} onClick={() => setOpenSheet('scenario')} />
      <IconButton label="Roll a scenario" onClick={onScenarioRandom}><DiceIcon /></IconButton>
    </div>
  )

  // A new tournament is set up on its start sheet; one under way is a tap away.
  const tournament = matchType === 'Tournament'
  const primary = tournament && tournamentInProgress
    ? { label: 'Go to tournament', onClick: () => onGoToTournament?.(), disabled: false }
    : tournament
      ? { label: 'Start tournament', onClick: () => setOpenSheet('tournament'), disabled: !canStart }
      : { label: 'Go to game', onClick: onStart, disabled: !canStart }
  const goToGame = (
    <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled} style={{ minHeight: '52px', flexShrink: 0 }}>{primary.label}</Button>
  )

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        {onLists && <Button onClick={closeThen(onLists)}>Squad lists</Button>}
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <Sheet open={openSheet === 'scenario'} title="Scenario" onClose={close}>
        {XWING_SCENARIOS.map(s => (
          <OptionRow key={s} title={s} selected={s === scenario} onClick={() => { onScenarioChange(s); close() }} />
        ))}
      </Sheet>
      {renderListSheet('player')}
      {renderListSheet('opponent')}
      <Sheet open={openSheet === 'tournament'} title="Start a tournament" onClose={close}>
        <div style={mutedStyle}>{playerChoice?.kind === 'list' ? playerChoice.list.name : 'No list'}</div>
        <Stepper label="Rounds" value={rounds} min={2} max={10} onChange={onRoundsChange} />
        <div style={mutedStyle}>Fixed once round 1 starts.</div>
        <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={closeThen(onStartTournament)} style={{ minHeight: '52px', padding: '0 20px' }}>Start round 1</Button>
        </div>
      </Sheet>
    </>
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div data-testid="xwing-setup" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 16px 24px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          {topBar}
          {renderCard('player')}
          {renderCard('opponent')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={sectionLabelStyle}>Match</div>
            {matchControl}
            <div style={{ display: 'flex' }}>{scenarioControls}</div>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>{goToGame}</div>
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid="xwing-setup" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
        {topBar}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px', alignItems: 'start' }}>
          {renderCard('player')}
          {renderCard('opponent')}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ width: '220px' }}>{matchControl}</div>
          {scenarioControls}
          {goToGame}
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
