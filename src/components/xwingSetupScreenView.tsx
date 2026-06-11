import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CheckIcon, CogIcon, DiceIcon, ForwardIcon, HelpIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'
import TimerStepper from './shared/timerStepper'
import type { XwingMatchType, XwingListImport, XwingScenario } from '../hooks/useXwingSetup'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingPilot } from '../utils/parseXwsText'

interface Props {
  matchType: XwingMatchType
  onMatchTypeChange: (v: XwingMatchType) => void
  rounds: number
  onRoundsChange: (v: number) => void
  playerListImport: XwingListImport
  onPlayerListImportChange: (v: XwingListImport) => void
  opponentListImport: XwingListImport
  onOpponentListImportChange: (v: XwingListImport) => void
  playerDeficit: number
  onPlayerDeficitChange: (v: number) => void
  opponentDeficit: number
  onOpponentDeficitChange: (v: number) => void
  playerConfirmed: boolean
  onPlayerConfirm: () => void
  onPlayerEdit: () => void
  opponentConfirmed: boolean
  onOpponentConfirm: () => void
  onOpponentEdit: () => void
  playerText: string
  onPlayerTextChange: (v: string) => void
  opponentText: string
  onOpponentTextChange: (v: string) => void
  playerError: string | null
  opponentError: string | null
  playerPilots: XwingPilot[]
  opponentPilots: XwingPilot[]
  scenario: XwingScenario
  onScenarioChange: (v: XwingScenario) => void
  onScenarioRandom: () => void
  canStart: boolean
  onStart: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

function importErrorMessage(code: string): string {
  switch (code) {
    case 'too-few-ships': return 'List must contain at least 3 ships.'
    case 'too-many-ships': return 'List must contain no more than 8 ships.'
    case 'invalid-total': return 'Points total must be between 46 and 50.'
    case 'invalid-format': return "Couldn't read list — check you've pasted the XWS export."
    default: return 'Invalid list.'
  }
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

// Textarea base style. font-size: 16px minimum prevents iOS zoom on focus.
// word-break: break-all forces long JSON strings to wrap instead of scrolling horizontally.
const textareaStyle = (small = false, fill = false): React.CSSProperties => ({
  width: '100%',
  ...(fill
    ? { flex: 1, minHeight: 0, resize: 'none' }
    : { minHeight: small ? '14vh' : '25vh', resize: 'vertical' }),
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: '16px',
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  wordBreak: 'break-all',
})

function TextareaField({ testId, errorTestId, value, onChange, error, small, fill }: {
  testId: string
  errorTestId: string
  value: string
  onChange: (v: string) => void
  error: string | null
  small: boolean
  fill?: boolean
}) {
  const hasError = error !== null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <textarea
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Paste XWS JSON"
        style={{
          ...textareaStyle(small, fill),
          ...(hasError ? {
            border: '2px solid var(--color-error)',
            borderBottom: 'none',
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            boxShadow: 'none',
          } : {}),
        }}
      />
      {hasError && (
        <div style={{
          borderLeft: '2px solid var(--color-error)',
          borderRight: '2px solid var(--color-error)',
          borderBottom: '2px solid var(--color-error)',
          borderRadius: '0 0 12px 12px',
          padding: small ? '0.4vh 1.5vw 0.5vh' : '0.5vh 2vw 0.7vh',
        }}>
          <p data-testid={errorTestId} style={{
            color: 'var(--color-error)',
            fontWeight: '300',
            fontSize: small ? 'clamp(0.55rem, 1.4vw, 0.7rem)' : 'clamp(0.6rem, 2vw, 0.8rem)',
            margin: 0,
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {importErrorMessage(error!)}
          </p>
        </div>
      )}
    </div>
  )
}

export default function XwingSetupScreenView({
  matchType,
  onMatchTypeChange,
  rounds,
  onRoundsChange,
  playerListImport,
  onPlayerListImportChange,
  opponentListImport,
  onOpponentListImportChange,
  playerDeficit,
  onPlayerDeficitChange,
  opponentDeficit,
  onOpponentDeficitChange,
  playerConfirmed,
  onPlayerConfirm,
  onPlayerEdit,
  opponentConfirmed,
  onOpponentConfirm,
  onOpponentEdit,
  playerText,
  onPlayerTextChange,
  opponentText,
  onOpponentTextChange,
  playerError,
  opponentError,
  scenario,
  onScenarioChange,
  onScenarioRandom,
  canStart,
  onStart,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const small = !isPortrait

  // CSS grid aligns all label+select+button rows. Column 1 auto-sizes to the widest label;
  // column 2 takes remaining space; column 3 auto-sizes to the widest button.
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    columnGap: small ? '1vw' : '1.5vw',
    rowGap: small ? '1.5vh' : '2vh',
    alignItems: 'center',
  }

  const optionStyle = { color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }
  const optionMuted = { color: 'var(--color-text-muted)', background: 'var(--color-bg-deep)' }

  // Renders the grid rows. In landscape, textareas are omitted (they render in the RHS column).
  const controlGrid = (renderTextareaInline: boolean) => (
    <div style={gridStyle}>

      {/* Match row — landscape splits into two grid rows; portrait keeps them side by side */}
      {small ? (
        <>
          <label style={labelStyle(small)}>Match</label>
          <select
            data-testid="match-select"
            value={matchType}
            onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
            style={selectStyle(true, true, small)}
          >
            <option value="Casual" style={optionStyle}>Casual</option>
            <option value="Tournament" style={optionStyle}>Tournament</option>
          </select>
          <span />
          {matchType === 'Tournament' && (
            <div style={{ gridColumn: '1 / -1' }}>
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
            </div>
          )}
        </>
      ) : (
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
          <label style={labelStyle(small)}>Match</label>
          <select
            data-testid="match-select"
            value={matchType}
            onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
            style={{ ...selectStyle(true, true, small), flex: 1, maxWidth: matchType === 'Tournament' ? '45%' : undefined }}
          >
            <option value="Casual" style={optionStyle}>Casual</option>
            <option value="Tournament" style={optionStyle}>Tournament</option>
          </select>
          {matchType === 'Tournament' && (
            <div style={{ flex: 1 }}>
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
            </div>
          )}
        </div>
      )}

      {/* Scenario */}
      <label style={labelStyle(small)}>Scenario</label>
      <select
        data-testid="scenario-select"
        value={scenario}
        onChange={e => onScenarioChange(e.target.value as XwingScenario)}
        style={selectStyle(true, scenario !== 'None', small)}
      >
        <option value="None" style={optionStyle}>None</option>
        {XWING_NAMED_SCENARIOS.map(s => (
          <option key={s} value={s} style={optionStyle}>{s}</option>
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

      {/* Player list */}
      <label style={labelStyle(small)}>Your list</label>
      <select
        data-testid="player-list-import-select"
        value={playerListImport}
        onChange={e => onPlayerListImportChange(e.target.value as XwingListImport)}
        style={selectStyle(true, true, small)}
        disabled={playerConfirmed}
      >
        <option value="None" style={optionStyle}>None</option>
        <option value="YASB" disabled style={optionMuted}>YASB</option>
        <option value="XWA" style={optionStyle}>XWA</option>
      </select>
      {playerConfirmed ? (
        <button
          data-testid="player-edit-btn"
          onClick={onPlayerEdit}
          style={{ ...submitButtonStyle(small), fontSize: small ? 'clamp(0.55rem, 1.4vh, 0.75rem)' : 'clamp(0.55rem, 1.4vw, 0.75rem)' }}
        >
          Edit
        </button>
      ) : (
        <button
          data-testid="player-confirm-btn"
          onClick={onPlayerConfirm}
          style={submitButtonStyle(small)}
        >
          <CheckIcon />
        </button>
      )}

      {/* Player textarea (inline portrait only) */}
      {renderTextareaInline && !playerConfirmed && playerListImport === 'XWA' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <TextareaField
            testId="player-list-textarea"
            errorTestId="player-import-error"
            value={playerText}
            onChange={onPlayerTextChange}
            error={playerError}
            small={small}
          />
        </div>
      )}

      {/* Player deficit stepper */}
      {!playerConfirmed && playerListImport === 'None' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <TimerStepper
            label="Your Deficit"
            labelStyle={labelStyle(small)}
            value={playerDeficit}
            min={0}
            max={4}
            step={1}
            formatValue={(v) => String(v)}
            onChange={onPlayerDeficitChange}
            testId="player-deficit-stepper"
          />
        </div>
      )}

      {/* Opponent section */}
      {(playerConfirmed || opponentConfirmed) && <>
        <label style={labelStyle(small)}>Opp list</label>
        <select
          data-testid="opponent-list-import-select"
          value={opponentListImport}
          onChange={e => onOpponentListImportChange(e.target.value as XwingListImport)}
          style={selectStyle(true, true, small)}
          disabled={opponentConfirmed}
        >
          <option value="None" style={optionStyle}>None</option>
          <option value="YASB" disabled style={optionMuted}>YASB</option>
          <option value="XWA" style={optionStyle}>XWA</option>
        </select>
        {opponentConfirmed ? (
          <button
            data-testid="opponent-edit-btn"
            onClick={onOpponentEdit}
            style={{ ...submitButtonStyle(small), fontSize: small ? 'clamp(0.55rem, 1.4vh, 0.75rem)' : 'clamp(0.55rem, 1.4vw, 0.75rem)' }}
          >
            Edit
          </button>
        ) : (
          <button
            data-testid="opponent-confirm-btn"
            onClick={onOpponentConfirm}
            style={submitButtonStyle(small)}
          >
            <CheckIcon />
          </button>
        )}

        {/* Opponent textarea (inline portrait only) */}
        {renderTextareaInline && !opponentConfirmed && opponentListImport === 'XWA' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <TextareaField
              testId="opponent-list-textarea"
              errorTestId="opponent-import-error"
              value={opponentText}
              onChange={onOpponentTextChange}
              error={opponentError}
              small={small}
            />
          </div>
        )}

        {/* Opponent deficit stepper */}
        {!opponentConfirmed && opponentListImport === 'None' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <TimerStepper
              label="Opp Deficit"
              labelStyle={labelStyle(small)}
              value={opponentDeficit}
              min={0}
              max={4}
              step={1}
              formatValue={(v) => String(v)}
              onChange={onOpponentDeficitChange}
              testId="opponent-deficit-stepper"
            />
          </div>
        )}
      </>}

    </div>
  )

  const titleRowStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  }

  if (!isPortrait) {
    const opponentVisible = playerConfirmed || opponentConfirmed
    const playerActive = !playerConfirmed
    const opponentActive = opponentVisible && !opponentConfirmed

    const landscapeGridStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: '1vw',
      rowGap: '1.5vh',
      alignItems: 'center',
    }

    const editBtnStyle: React.CSSProperties = {
      ...submitButtonStyle(true),
      fontSize: 'clamp(0.55rem, 1.4vh, 0.75rem)',
    }

    // Helper: select + confirm button row rendered in the RHS for the active player
    const activeImportRow = (
      label: string,
      selectTestId: string,
      confirmTestId: string,
      value: XwingListImport,
      onChange: (v: XwingListImport) => void,
      onConfirm: () => void,
    ) => (
      <div style={{ display: 'flex', gap: '1vw', alignItems: 'center', flexShrink: 0 }}>
        <label style={labelStyle(true)}>{label}</label>
        <select
          data-testid={selectTestId}
          value={value}
          onChange={e => onChange(e.target.value as XwingListImport)}
          style={{ ...selectStyle(true, true, true), flex: 1 }}
        >
          <option value="None" style={optionStyle}>None</option>
          <option value="YASB" disabled style={optionMuted}>YASB</option>
          <option value="XWA" style={optionStyle}>XWA</option>
        </select>
        <button data-testid={confirmTestId} onClick={onConfirm} style={submitButtonStyle(true)}>
          <CheckIcon />
        </button>
      </div>
    )

    return (
      <AppScreenLayout>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '2vw 2vw 3vw',
        }}>

          <div style={titleRowStyle}>
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

          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            minHeight: 0,
            padding: '1.5vh 0 0',
            gap: '3vw',
          }}>
            {/* LHS: stable fields + confirmed list rows */}
            <div style={{
              flex: '0 0 45%',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: '14px',
            }}>
              <div style={landscapeGridStyle}>

                {/* Match select spans cols 2+3 so its RHS aligns with the random button */}
                <label style={labelStyle(true)}>Match</label>
                <select
                  data-testid="match-select"
                  value={matchType}
                  onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
                  style={{ ...selectStyle(true, true, true), gridColumn: '2 / 4' }}
                >
                  <option value="Casual" style={optionStyle}>Casual</option>
                  <option value="Tournament" style={optionStyle}>Tournament</option>
                </select>

                {matchType === 'Tournament' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <TimerStepper
                      label="Rounds"
                      labelStyle={labelStyle(true)}
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

                <label style={labelStyle(true)}>Scenario</label>
                <select
                  data-testid="scenario-select"
                  value={scenario}
                  onChange={e => onScenarioChange(e.target.value as XwingScenario)}
                  style={selectStyle(true, scenario !== 'None', true)}
                >
                  <option value="None" style={optionStyle}>None</option>
                  {XWING_NAMED_SCENARIOS.map(s => (
                    <option key={s} value={s} style={optionStyle}>{s}</option>
                  ))}
                </select>
                <button
                  data-testid="scenario-random-btn"
                  onClick={onScenarioRandom}
                  aria-label="Random scenario"
                  style={submitButtonStyle(true)}
                >
                  <DiceIcon />
                </button>

                {/* Confirmed player row */}
                {playerConfirmed && (
                  <>
                    <label style={labelStyle(true)}>Your list</label>
                    <select
                      data-testid="player-list-import-select"
                      value={playerListImport}
                      disabled
                      onChange={e => onPlayerListImportChange(e.target.value as XwingListImport)}
                      style={selectStyle(false, true, true)}
                    >
                      <option value="None" style={optionStyle}>None</option>
                      <option value="YASB" style={optionStyle}>YASB</option>
                      <option value="XWA" style={optionStyle}>XWA</option>
                    </select>
                    <button data-testid="player-edit-btn" onClick={onPlayerEdit} style={editBtnStyle}>
                      Edit
                    </button>
                  </>
                )}

                {/* Confirmed opponent row */}
                {opponentConfirmed && (
                  <>
                    <label style={labelStyle(true)}>Opp list</label>
                    <select
                      data-testid="opponent-list-import-select"
                      value={opponentListImport}
                      disabled
                      onChange={e => onOpponentListImportChange(e.target.value as XwingListImport)}
                      style={selectStyle(false, true, true)}
                    >
                      <option value="None" style={optionStyle}>None</option>
                      <option value="YASB" style={optionStyle}>YASB</option>
                      <option value="XWA" style={optionStyle}>XWA</option>
                    </select>
                    <button data-testid="opponent-edit-btn" onClick={onOpponentEdit} style={editBtnStyle}>
                      Edit
                    </button>
                  </>
                )}

              </div>
            </div>

            {/* RHS: active (unconfirmed) import section, or Go to game when both confirmed */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '14px 14px 14px 0',
              gap: '1.5vh',
            }}>
              {/* Go to game sits at the top of the RHS, level with the Match row */}
              {canStart && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', flexShrink: 0 }}>
                  <label style={labelStyle(true)}>Go to game</label>
                  <button onClick={onStart} aria-label="Start game" style={submitButtonStyle(true)}>
                    <ForwardIcon />
                  </button>
                </div>
              )}
              {playerActive && (
                <>
                  {activeImportRow('Your list', 'player-list-import-select', 'player-confirm-btn', playerListImport, onPlayerListImportChange, onPlayerConfirm)}
                  {playerListImport === 'XWA' && (
                    <TextareaField
                      testId="player-list-textarea"
                      errorTestId="player-import-error"
                      value={playerText}
                      onChange={onPlayerTextChange}
                      error={playerError}
                      small={true}
                      fill
                    />
                  )}
                  {playerListImport === 'None' && (
                    <TimerStepper
                      label="Your Deficit"
                      labelStyle={labelStyle(true)}
                      value={playerDeficit}
                      min={0}
                      max={4}
                      step={1}
                      formatValue={(v) => String(v)}
                      onChange={onPlayerDeficitChange}
                      testId="player-deficit-stepper"
                    />
                  )}
                </>
              )}
              {opponentActive && (
                <>
                  {activeImportRow('Opp list', 'opponent-list-import-select', 'opponent-confirm-btn', opponentListImport, onOpponentListImportChange, onOpponentConfirm)}
                  {opponentListImport === 'XWA' && (
                    <TextareaField
                      testId="opponent-list-textarea"
                      errorTestId="opponent-import-error"
                      value={opponentText}
                      onChange={onOpponentTextChange}
                      error={opponentError}
                      small={true}
                      fill
                    />
                  )}
                  {opponentListImport === 'None' && (
                    <TimerStepper
                      label="Opp Deficit"
                      labelStyle={labelStyle(true)}
                      value={opponentDeficit}
                      min={0}
                      max={4}
                      step={1}
                      formatValue={(v) => String(v)}
                      onChange={onOpponentDeficitChange}
                      testId="opponent-deficit-stepper"
                    />
                  )}
                </>
              )}
            </div>
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

        <div style={{ ...titleRowStyle, flexShrink: undefined }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1vh' }}>
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
            {canStart && (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2vw' }}>
                <label style={labelStyle(false)}>Go to game</label>
                <button onClick={onStart} aria-label="Start game" style={submitButtonStyle(false)}>
                  <ForwardIcon />
                </button>
              </div>
            )}
          </div>
        </div>

        {controlGrid(true)}

      </div>
    </AppScreenLayout>
  )
}
