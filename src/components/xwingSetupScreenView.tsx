import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CogIcon, DiceIcon, EditIcon, ForwardIcon, HelpIcon, ListIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'
import TimerStepper from './shared/timerStepper'
import type { XwingMatchType, XwingScenario, XwingPlayerChoice } from '../hooks/useXwingSetup'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import { PilotList } from './shared/xwsListFields'
import { labelStyle, submitButtonStyle, squadNameInputStyle } from '../styles/xwingForm'
import type { XwingList } from '../hooks/useXwingLists'
import { listMeta } from '../utils/xwingListInfo'

// A player's choice with its list looked up, so the view never sees a dangling list id.
export type ResolvedChoice = { kind: 'none' } | { kind: 'list'; list: XwingList }

type Side = 'player' | 'opponent'

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
  playerDeficit: number
  onPlayerDeficitChange: (v: number) => void
  opponentDeficit: number
  onOpponentDeficitChange: (v: number) => void
  canStart: boolean
  onStart: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onLists?: () => void
}

const selectStyle = (hasValue: boolean, small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '0 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  // Same height sizing as the square action buttons so selects line up with them (portrait 5vw/36px, landscape 8vh/44px).
  height: small ? '8vh' : '5vw',
  minHeight: small ? '44px' : '36px',
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: hasValue ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  WebkitAppearance: 'none',
  cursor: 'pointer',
  width: '100%',
})

// No list / New list: the select footprint, so the choice row lines up with the controls above.
const choiceButtonStyle = (small: boolean): React.CSSProperties => ({
  ...selectStyle(true, small),
  boxShadow: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
})

const mutedTextStyle = (small: boolean): React.CSSProperties => ({
  color: 'var(--color-text-muted)',
  fontWeight: '300',
  fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
  letterSpacing: '0.04em',
})

const optionStyle = { color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }

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
  playerDeficit,
  onPlayerDeficitChange,
  opponentDeficit,
  onOpponentDeficitChange,
  canStart,
  onStart,
  onBack,
  onHelp,
  onSettings,
  onLists,
}: Props) {
  const { isPortrait } = useOrientation()
  const small = !isPortrait
  const showOpponent = playerChoice !== null || opponentChoice !== null

  const sides = {
    player: { label: 'Your list', deficitLabel: 'Your deficit', choice: playerChoice, onChoose: onPlayerChoose, deficit: playerDeficit, onDeficitChange: onPlayerDeficitChange },
    opponent: { label: 'Opp list', deficitLabel: 'Opp deficit', choice: opponentChoice, onChoose: onOpponentChoose, deficit: opponentDeficit, onDeficitChange: onOpponentDeficitChange },
  }

  // One player's list area — the choices until something is picked, then the pick with an edit
  // button. Shared by both players in both orientations.
  const renderSide = (side: Side) => {
    const { label, deficitLabel, choice, onChoose, deficit, onDeficitChange } = sides[side]
    const t = (id: string) => `${side}-${id}`
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: small ? '1vh' : '1.5vh' }}>
        <label style={labelStyle(small)}>{label}</label>
        {choice ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: small ? '1vw' : '1.5vw' }}>
              <div data-testid={t('chosen-name')} style={{ ...squadNameInputStyle(small), display: 'flex', alignItems: 'center' }}>
                {choice.kind === 'list' ? choice.list.name : 'No list'}
              </div>
              <button data-testid={t('edit-btn')} onClick={() => onChoose(null)} aria-label={`Change ${label.toLowerCase()}`} style={submitButtonStyle(small)}>
                <EditIcon />
              </button>
            </div>
            {choice.kind === 'list' ? (
              <>
                <div style={mutedTextStyle(small)}>{listMeta(choice.list.pilots, choice.list.faction)}</div>
                <PilotList pilots={choice.list.pilots} testId={t('pilot-list')} small={small} />
              </>
            ) : (
              <TimerStepper
                label={deficitLabel}
                labelStyle={labelStyle(small)}
                value={deficit}
                min={0}
                max={4}
                step={1}
                formatValue={(v) => String(v)}
                onChange={onDeficitChange}
                testId={t('deficit-stepper')}
              />
            )}
          </>
        ) : (
          <div data-testid={t('choices')} style={{ display: 'flex', flexDirection: 'column', gap: small ? '1vh' : '1.5vh' }}>
            <div style={{ display: 'flex', gap: small ? '1vw' : '2vw' }}>
              <button data-testid={t('no-list-btn')} onClick={() => onChoose({ kind: 'none' })} style={choiceButtonStyle(small)}>
                No list
              </button>
              {onLists && (
                <button data-testid={t('new-list-btn')} onClick={onLists} style={choiceButtonStyle(small)}>
                  ＋ New list
                </button>
              )}
            </div>
            {lists.length === 0 ? (
              <div data-testid={t('lists-empty-hint')} style={mutedTextStyle(small)}>
                No saved lists yet — tap New list to create one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {lists.map(list => (
                  <button
                    key={list.id}
                    data-testid={t(`list-option-${list.id}`)}
                    onClick={() => onChoose({ kind: 'list', listId: list.id })}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '0.3vh',
                      padding: small ? '0.8vh 0' : '1.2vh 0',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(107, 114, 128, 0.15)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{
                      color: 'var(--color-text-primary)',
                      fontWeight: '300',
                      fontSize: small ? 'clamp(0.8rem, 1.9vw, 1rem)' : 'clamp(0.9rem, 3.5vw, 1.1rem)',
                    }}>
                      {list.name}
                    </span>
                    <span style={mutedTextStyle(small)}>{listMeta(list.pilots, list.faction)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const header = (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: small ? '1vw' : '2vw' }}>
        <button onClick={onBack} aria-label="Back" style={NAV_BTN_STYLE}>
          <BackIcon />
        </button>
        <h1 style={{
          color: 'var(--color-text-primary)',
          fontWeight: '200',
          fontSize: small ? 'clamp(1.2rem, 4vw, 1.8rem)' : 'clamp(1.8rem, 8vw, 3rem)',
          letterSpacing: '0.15em',
          margin: 0,
          lineHeight: 0.8,
        }}>
          dmgCtrl
        </h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: small ? '1vw' : '2vw' }}>
        {onLists && (
          <button onClick={onLists} aria-label="Squad lists" style={NAV_BTN_STYLE}>
            <ListIcon />
          </button>
        )}
        {onSettings && (
          <button onClick={onSettings} aria-label="Settings" style={NAV_BTN_STYLE}>
            <CogIcon />
          </button>
        )}
        <button onClick={onHelp} aria-label="Help" style={NAV_BTN_STYLE}>
          <HelpIcon />
        </button>
      </div>
    </div>
  )

  const matchSelect = (
    <select
      data-testid="match-select"
      value={matchType}
      onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
      style={selectStyle(true, small)}
    >
      <option value="Casual" style={optionStyle}>Casual</option>
      <option value="Tournament" style={optionStyle}>Tournament</option>
    </select>
  )

  const scenarioControls = (
    <>
      <select
        data-testid="scenario-select"
        value={scenario}
        onChange={e => onScenarioChange(e.target.value as XwingScenario)}
        style={selectStyle(scenario !== 'None', small)}
      >
        <option value="None" style={optionStyle}>None</option>
        {XWING_NAMED_SCENARIOS.map(s => (
          <option key={s} value={s} style={optionStyle}>{s}</option>
        ))}
      </select>
      <button data-testid="scenario-random-btn" onClick={onScenarioRandom} aria-label="Random scenario" style={submitButtonStyle(small)}>
        <DiceIcon />
      </button>
    </>
  )

  const roundsStepper = matchType === 'Tournament' && (
    <TimerStepper
      label="Rounds"
      labelStyle={labelStyle(small)}
      value={rounds}
      min={2}
      max={10}
      step={1}
      formatValue={(v) => String(v)}
      onChange={onRoundsChange}
      testId="rounds-stepper"
    />
  )

  const goToGame = canStart && (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: small ? '1vw' : '2vw', flexShrink: 0, marginTop: small ? '1.5vh' : undefined }}>
      <label style={labelStyle(small)}>Go to game</label>
      <button onClick={onStart} aria-label="Start game" style={submitButtonStyle(small)}>
        <ForwardIcon />
      </button>
    </div>
  )

  if (small) {
    // The columns scroll and so clip overflow; COL_INSET gives the glow shadows room, and the
    // header and shared rows use the same inset so their buttons line up with the columns'.
    const COL_INSET = '14px'
    const columnStyle: React.CSSProperties = {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      padding: COL_INSET,
    }

    return (
      <AppScreenLayout>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '2vw 2vw 3vw' }}>
          <div style={{ padding: `0 ${COL_INSET}` }}>{header}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh', flexShrink: 0, padding: `1.5vh ${COL_INSET} 0` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
              <label style={labelStyle(small)}>Match</label>
              {matchSelect}
              <label style={labelStyle(small)}>Scenario</label>
              {scenarioControls}
            </div>
            {roundsStepper}
          </div>

          {/* Two columns: player (LHS) and opponent (RHS, revealed once the player has chosen) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, padding: '1.5vh 0 0', gap: '3vw' }}>
            <div style={columnStyle}>{renderSide('player')}</div>
            <div style={columnStyle}>
              {showOpponent ? (
                <>
                  {renderSide('opponent')}
                  {goToGame}
                </>
              ) : (
                <div data-testid="opponent-placeholder" style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  ...mutedTextStyle(small),
                  padding: '2vw',
                }}>
                  Choose your list to set up your opponent
                </div>
              )}
            </div>
          </div>
        </div>
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', padding: '2vw', gap: '2vh', overflowY: 'auto', flex: 1 }}>
        {header}

        {/* Labels share a grid column so the Match and Scenario controls line up */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', columnGap: '1.5vw', rowGap: '2vh', alignItems: 'center' }}>
          <label style={labelStyle(small)}>Match</label>
          {matchSelect}
          <span />
          {roundsStepper && <div style={{ gridColumn: '1 / -1' }}>{roundsStepper}</div>}
          <label style={labelStyle(small)}>Scenario</label>
          {scenarioControls}
        </div>

        {renderSide('player')}
        {showOpponent && renderSide('opponent')}

        {/* Go to game — directly under the opponent list, bottom-right */}
        {goToGame}
      </div>
    </AppScreenLayout>
  )
}
