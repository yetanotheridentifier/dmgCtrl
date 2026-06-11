import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CogIcon, DiceIcon, ForwardIcon, HelpIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'
import TimerStepper from './shared/timerStepper'
import type { XwingMatchType, XwingListImport, XwingScenario } from '../hooks/useXwingSetup'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'

interface Props {
  matchType: XwingMatchType
  onMatchTypeChange: (v: XwingMatchType) => void
  rounds: number
  onRoundsChange: (v: number) => void
  listImport: XwingListImport
  onListImportChange: (v: XwingListImport) => void
  playerDeficit: number
  onPlayerDeficitChange: (v: number) => void
  opponentDeficit: number
  onOpponentDeficitChange: (v: number) => void
  scenario: XwingScenario
  onScenarioChange: (v: XwingScenario) => void
  onScenarioRandom: () => void
  onStart: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

const labelStyle = (small = false): React.CSSProperties => ({
  color: 'var(--color-accent)',
  fontWeight: '300',
  fontSize: small ? 'clamp(0.8rem, 3vw, 1rem)' : 'clamp(0.9rem, 4vw, 1.2rem)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  flexShrink: 0,
})

const selectStyle = (enabled: boolean, hasValue: boolean, small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  ...(small && { height: 'max(44px, 8vh)' }),
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: hasValue ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  WebkitAppearance: 'none',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.4,
  width: '100%',
})

const submitButtonStyle = (small = false): React.CSSProperties => ({
  width: small ? '8vh' : '12vw',
  minWidth: '44px',
  minHeight: '44px',
  flexShrink: 0,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(1rem, 3vh, 1.8rem)' : 'clamp(1rem, 3vw, 1.8rem)',
  fontWeight: '300',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  border: '2px solid var(--color-text-primary)',
  borderRadius: '12px',
  cursor: 'pointer',
  boxShadow: '0 0 12px rgba(255, 255, 255, 0.2)',
  WebkitTapHighlightColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
})

export default function XwingSetupScreenView({
  matchType,
  onMatchTypeChange,
  rounds,
  onRoundsChange,
  listImport,
  onListImportChange,
  playerDeficit,
  onPlayerDeficitChange,
  opponentDeficit,
  onOpponentDeficitChange,
  scenario,
  onScenarioChange,
  onScenarioRandom,
  onStart,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const small = !isPortrait

  const controls = (
    <>
      {/* Row 1: Match | Rounds (inline when Tournament) */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '2vw', alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
          <label style={labelStyle(small)}>Match</label>
          <select
            data-testid="match-select"
            value={matchType}
            onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
            style={selectStyle(true, true, small)}
          >
            <option value="Casual" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>Casual</option>
            <option value="Tournament" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>Tournament</option>
          </select>
        </div>
        {matchType === 'Tournament' && (
          <div style={{ flex: 1 }}>
            <TimerStepper
              label="Rounds"
              value={rounds}
              min={2}
              max={10}
              step={1}
              formatValue={(v) => String(v)}
              onChange={onRoundsChange}
              testId="rounds-stepper"
            />
          </div>
        )}
      </div>

      {/* Row 2: Scenario */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
        <label style={labelStyle(small)}>Scenario</label>
        <select
          data-testid="scenario-select"
          value={scenario}
          onChange={e => onScenarioChange(e.target.value as XwingScenario)}
          style={selectStyle(true, scenario !== 'None', small)}
        >
          <option value="None" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>None</option>
          {XWING_NAMED_SCENARIOS.map(s => (
            <option key={s} value={s} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>{s}</option>
          ))}
        </select>
        <button
          data-testid="scenario-random-btn"
          onClick={onScenarioRandom}
          aria-label="Random scenario"
          style={submitButtonStyle(small)}
        >
          <DiceIcon />
        </button>
      </div>

      {/* Row 3: Import | > start */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
        <label style={labelStyle(small)}>Import</label>
        <select
          data-testid="list-import-select"
          value={listImport}
          onChange={e => onListImportChange(e.target.value as XwingListImport)}
          style={selectStyle(true, true, small)}
        >
          <option value="None" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>None</option>
          <option value="YASB" disabled style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-deep)' }}>YASB</option>
          <option value="Text" disabled style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-deep)' }}>Text</option>
        </select>
        <button
          onClick={onStart}
          aria-label="Start game"
          style={submitButtonStyle(small)}
        >
          <ForwardIcon />
        </button>
      </div>

      {/* Rows 4–5: Your Deficit / Opponent's Deficit (None import only) */}
      {listImport === 'None' && (
        <>
          <TimerStepper
            label="Your Deficit"
            value={playerDeficit}
            min={0}
            max={4}
            step={1}
            formatValue={(v) => String(v)}
            onChange={onPlayerDeficitChange}
            testId="player-deficit-stepper"
          />
          <TimerStepper
            label="Opponent's Deficit"
            value={opponentDeficit}
            min={0}
            max={4}
            step={1}
            formatValue={(v) => String(v)}
            onChange={onOpponentDeficitChange}
            testId="opponent-deficit-stepper"
          />
        </>
      )}
    </>
  )

  if (!isPortrait) {
    return (
      <AppScreenLayout>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '2vw 2vw 3vw',
        }}>

          {/* Title row — full width, matches SWU landscape */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
              <button onClick={onBack} aria-label="Back" style={NAV_BTN_STYLE}>
                <BackIcon />
              </button>
              <h1 style={{
                color: 'var(--color-text-primary)',
                fontWeight: '200',
                fontSize: 'clamp(1.2rem, 4vw, 1.8rem)',
                letterSpacing: '0.15em',
                margin: 0,
                lineHeight: 0.8,
              }}>
                dmgCtrl
              </h1>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
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

          {/* Content row — left column with controls, right column empty */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            minHeight: 0,
            padding: '1.5vh 0 0',
            gap: '3vw',
          }}>
            <div style={{
              flex: '0 0 55%',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              gap: '1.5vh',
              padding: '14px',
            }}>
              {controls}
            </div>
            <div style={{ flex: 1 }} />
          </div>

        </div>
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '2vw',
        gap: '2vh',
        overflowY: 'auto',
        flex: 1,
      }}>

        {/* Title row */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2vw' }}>
            <button onClick={onBack} aria-label="Back" style={NAV_BTN_STYLE}>
              <BackIcon />
            </button>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontWeight: '200',
              fontSize: 'clamp(1.8rem, 8vw, 3rem)',
              letterSpacing: '0.15em',
              margin: 0,
              lineHeight: 0.8,
            }}>
              dmgCtrl
            </h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2vw' }}>
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

        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh' }}>
          {controls}
        </div>

      </div>
    </AppScreenLayout>
  )
}
