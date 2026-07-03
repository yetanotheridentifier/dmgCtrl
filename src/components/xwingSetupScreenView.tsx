import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CheckIcon, CogIcon, DiceIcon, EditIcon, ForwardIcon, HelpIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'
import TimerStepper from './shared/timerStepper'
import type { XwingMatchType, XwingListImport, XwingScenario } from '../hooks/useXwingSetup'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingPilot } from '../utils/parseXwsText'
import { displayPilots } from '../utils/displayPilots'
import type { XwingSquadFavourite } from '../hooks/useXwingFavourites'

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
  playerSquadName: string | undefined
  opponentSquadName: string | undefined
  playerStarFilled: boolean
  opponentStarFilled: boolean
  favourites: XwingSquadFavourite[]
  onPlayerLoadFavourite: (fav: XwingSquadFavourite) => void
  onOpponentLoadFavourite: (fav: XwingSquadFavourite) => void
  onPlayerSave: (name: string) => void
  onOpponentSave: (name: string) => void
  onPlayerUnsave: () => void
  onOpponentUnsave: () => void
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

const starButtonStyle = (small = false): React.CSSProperties => ({
  width: small ? '8vh' : '12vw',
  minWidth: '44px',
  minHeight: '44px',
  flexShrink: 0,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(1rem, 3vh, 1.8rem)' : 'clamp(1rem, 3vw, 1.8rem)',
  fontWeight: '300',
  background: 'transparent',
  color: 'var(--color-accent)',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box' as const,
})

const squadNameInputStyle = (small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  ...(small && { height: 'max(44px, 8vh)' }),
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box' as const,
  cursor: 'default',
  width: '100%',
})

const overwriteCancelStyle = (small = false): React.CSSProperties => ({
  background: 'transparent',
  border: '1px solid rgba(107, 114, 128, 0.5)',
  borderRadius: '8px',
  color: 'var(--color-text-muted)',
  fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
  padding: small ? '0.4vh 0.8vw' : '0.8vh 1.5vw',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
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

function PilotList({ pilots, testId, small }: { pilots: XwingPilot[], testId: string, small: boolean }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: small ? '0.4vh' : '0.6vh' }}>
      {displayPilots(pilots).map((p, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
          fontWeight: '300',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}>
          <span>{p.displayName} - {p.ship}</span>
          <span>{p.points}</span>
        </div>
      ))}
    </div>
  )
}


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
  playerPilots,
  opponentPilots,
  playerSquadName,
  opponentSquadName,
  playerStarFilled,
  opponentStarFilled,
  favourites,
  onPlayerLoadFavourite,
  onOpponentLoadFavourite,
  onPlayerSave,
  onOpponentSave,
  onPlayerUnsave,
  onOpponentUnsave,
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

  const [playerSelectedFavId, setPlayerSelectedFavId] = useState('')
  const [opponentSelectedFavId, setOpponentSelectedFavId] = useState('')
  const [playerShowOverwrite, setPlayerShowOverwrite] = useState(false)
  const [opponentShowOverwrite, setOpponentShowOverwrite] = useState(false)

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
        onChange={e => { onPlayerListImportChange(e.target.value as XwingListImport); setPlayerSelectedFavId('') }}
        style={selectStyle(true, true, small)}
        disabled={playerConfirmed}
      >
        <option value="None" style={optionStyle}>None</option>
        <option value="YASB" disabled style={optionMuted}>YASB</option>
        <option value="XWA" style={optionStyle}>XWA</option>
        {favourites.length > 0 && <option value="Favourites" style={optionStyle}>Favourites</option>}
      </select>
      {playerConfirmed ? (
        <button
          data-testid="player-edit-btn"
          onClick={() => { onPlayerEdit(); setPlayerShowOverwrite(false) }}
          style={submitButtonStyle(small)}
        >
          <EditIcon />
        </button>
      ) : (
        <button
          data-testid="player-confirm-btn"
          disabled={playerListImport === 'Favourites' && !playerSelectedFavId}
          onClick={() => {
            if (playerListImport === 'Favourites') {
              const fav = favourites.find(f => f.id === playerSelectedFavId)
              if (fav) onPlayerLoadFavourite(fav)
            } else {
              onPlayerConfirm()
            }
          }}
          style={submitButtonStyle(small)}
        >
          <CheckIcon />
        </button>
      )}

      {/* Player favourites picker */}
      {!playerConfirmed && playerListImport === 'Favourites' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <select
            data-testid="player-favourites-select"
            value={playerSelectedFavId}
            onChange={e => setPlayerSelectedFavId(e.target.value)}
            style={selectStyle(true, !!playerSelectedFavId, small)}
          >
            <option value="" disabled style={optionMuted}>Select a squad</option>
            {favourites.map(f => (
              <option key={f.id} value={f.id} style={optionStyle}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Player squad name + star */}
      {playerConfirmed && playerSquadName !== undefined && <>
        <span />
        <input
          type="text"
          readOnly
          value={playerSquadName}
          style={squadNameInputStyle(small)}
        />
        <button
          data-testid="player-star-btn"
          aria-pressed={playerStarFilled}
          aria-label={playerStarFilled ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => {
            if (playerStarFilled) { onPlayerUnsave(); setPlayerShowOverwrite(false) }
            else if (favourites.some(f => f.name === playerSquadName)) { setPlayerShowOverwrite(true) }
            else { onPlayerSave(playerSquadName) }
          }}
          style={starButtonStyle(small)}
        >
          {playerStarFilled ? '★' : '☆'}
        </button>
      </>}
      {playerShowOverwrite && playerSquadName !== undefined && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: small ? '1vw' : '2vw' }}>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: '300', fontSize: small ? 'clamp(0.55rem, 1.4vw, 0.7rem)' : 'clamp(0.7rem, 2.5vw, 0.85rem)', flex: 1 }}>
            Overwrite '{playerSquadName}'?
          </span>
          <button data-testid="player-overwrite-confirm-btn" aria-label="Confirm overwrite"
            onClick={() => { onPlayerSave(playerSquadName); setPlayerShowOverwrite(false) }}
            style={starButtonStyle(small)}>★</button>
          <button data-testid="player-overwrite-cancel-btn" aria-label="Cancel"
            onClick={() => setPlayerShowOverwrite(false)}
            style={overwriteCancelStyle(small)}>✕</button>
        </div>
      )}

      {/* Confirmed player pilot list */}
      {playerConfirmed && playerListImport !== 'None' && playerPilots.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <PilotList pilots={playerPilots} testId="player-pilot-list" small={small} />
        </div>
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
          onChange={e => { onOpponentListImportChange(e.target.value as XwingListImport); setOpponentSelectedFavId('') }}
          style={selectStyle(true, true, small)}
          disabled={opponentConfirmed}
        >
          <option value="None" style={optionStyle}>None</option>
          <option value="YASB" disabled style={optionMuted}>YASB</option>
          <option value="XWA" style={optionStyle}>XWA</option>
          {favourites.length > 0 && <option value="Favourites" style={optionStyle}>Favourites</option>}
        </select>
        {opponentConfirmed ? (
          <button
            data-testid="opponent-edit-btn"
            onClick={() => { onOpponentEdit(); setOpponentShowOverwrite(false) }}
            style={submitButtonStyle(small)}
          >
            <EditIcon />
          </button>
        ) : (
          <button
            data-testid="opponent-confirm-btn"
            disabled={opponentListImport === 'Favourites' && !opponentSelectedFavId}
            onClick={() => {
              if (opponentListImport === 'Favourites') {
                const fav = favourites.find(f => f.id === opponentSelectedFavId)
                if (fav) onOpponentLoadFavourite(fav)
              } else {
                onOpponentConfirm()
              }
            }}
            style={submitButtonStyle(small)}
          >
            <CheckIcon />
          </button>
        )}

        {/* Opponent favourites picker */}
        {!opponentConfirmed && opponentListImport === 'Favourites' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <select
              data-testid="opponent-favourites-select"
              value={opponentSelectedFavId}
              onChange={e => setOpponentSelectedFavId(e.target.value)}
              style={selectStyle(true, !!opponentSelectedFavId, small)}
            >
              <option value="" disabled style={optionMuted}>Select a squad</option>
              {favourites.map(f => (
                <option key={f.id} value={f.id} style={optionStyle}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Opponent squad name + star */}
        {opponentConfirmed && opponentSquadName !== undefined && <>
          <span />
          <input
            type="text"
            readOnly
            value={opponentSquadName}
            style={squadNameInputStyle(small)}
          />
          <button
            data-testid="opponent-star-btn"
            aria-pressed={opponentStarFilled}
            aria-label={opponentStarFilled ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => {
              if (opponentStarFilled) { onOpponentUnsave(); setOpponentShowOverwrite(false) }
              else if (favourites.some(f => f.name === opponentSquadName)) { setOpponentShowOverwrite(true) }
              else { onOpponentSave(opponentSquadName) }
            }}
            style={starButtonStyle(small)}
          >
            {opponentStarFilled ? '★' : '☆'}
          </button>
        </>}
        {opponentShowOverwrite && opponentSquadName !== undefined && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: small ? '1vw' : '2vw' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: '300', fontSize: small ? 'clamp(0.55rem, 1.4vw, 0.7rem)' : 'clamp(0.7rem, 2.5vw, 0.85rem)', flex: 1 }}>
              Overwrite '{opponentSquadName}'?
            </span>
            <button data-testid="opponent-overwrite-confirm-btn" aria-label="Confirm overwrite"
              onClick={() => { onOpponentSave(opponentSquadName); setOpponentShowOverwrite(false) }}
              style={starButtonStyle(small)}>★</button>
            <button data-testid="opponent-overwrite-cancel-btn" aria-label="Cancel"
              onClick={() => setOpponentShowOverwrite(false)}
              style={overwriteCancelStyle(small)}>✕</button>
          </div>
        )}

        {/* Confirmed opponent pilot list */}
        {opponentConfirmed && opponentListImport !== 'None' && opponentPilots.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <PilotList pilots={opponentPilots} testId="opponent-pilot-list" small={small} />
          </div>
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
    const landscapeGridStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: '1vw',
      rowGap: '1.5vh',
      alignItems: 'center',
    }

    // One player's column: flex column that holds the import grid (and, for the opponent, Go to game).
    const landscapeColStyle: React.CSSProperties = {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      padding: '14px',
    }

    const editBtnStyle: React.CSSProperties = submitButtonStyle(true)

    // Renders one player's full import column — active editing state (unconfirmed) or the
    // confirmed state (squad name + star + pilot list). Used for both the player (LHS) and
    // opponent (RHS) columns.
    const renderImportColumn = (side: 'player' | 'opponent') => {
      const isPlayer = side === 'player'
      const confirmed = isPlayer ? playerConfirmed : opponentConfirmed
      const listImport = isPlayer ? playerListImport : opponentListImport
      const onListImportChange = isPlayer ? onPlayerListImportChange : onOpponentListImportChange
      const squadName = isPlayer ? playerSquadName : opponentSquadName
      const starFilled = isPlayer ? playerStarFilled : opponentStarFilled
      const pilots = isPlayer ? playerPilots : opponentPilots
      const selectedFavId = isPlayer ? playerSelectedFavId : opponentSelectedFavId
      const setSelectedFavId = isPlayer ? setPlayerSelectedFavId : setOpponentSelectedFavId
      const showOverwrite = isPlayer ? playerShowOverwrite : opponentShowOverwrite
      const setShowOverwrite = isPlayer ? setPlayerShowOverwrite : setOpponentShowOverwrite
      const text = isPlayer ? playerText : opponentText
      const onTextChange = isPlayer ? onPlayerTextChange : onOpponentTextChange
      const error = isPlayer ? playerError : opponentError
      const deficit = isPlayer ? playerDeficit : opponentDeficit
      const onDeficitChange = isPlayer ? onPlayerDeficitChange : onOpponentDeficitChange
      const onEdit = isPlayer ? onPlayerEdit : onOpponentEdit
      const onConfirm = isPlayer ? onPlayerConfirm : onOpponentConfirm
      const onLoadFavourite = isPlayer ? onPlayerLoadFavourite : onOpponentLoadFavourite
      const onSave = isPlayer ? onPlayerSave : onOpponentSave
      const onUnsave = isPlayer ? onPlayerUnsave : onOpponentUnsave
      const label = isPlayer ? 'Your list' : 'Opp list'
      const deficitLabel = isPlayer ? 'Your Deficit' : 'Opp Deficit'
      const t = (suffix: string) => `${side}-${suffix}`

      return (
        <div style={landscapeGridStyle}>
          <label style={labelStyle(true)}>{label}</label>
          <select
            data-testid={t('list-import-select')}
            value={listImport}
            disabled={confirmed}
            onChange={e => { onListImportChange(e.target.value as XwingListImport); setSelectedFavId('') }}
            style={selectStyle(!confirmed, true, true)}
          >
            <option value="None" style={optionStyle}>None</option>
            <option value="YASB" disabled style={optionMuted}>YASB</option>
            <option value="XWA" style={optionStyle}>XWA</option>
            {favourites.length > 0 && <option value="Favourites" style={optionStyle}>Favourites</option>}
          </select>
          {confirmed ? (
            <button data-testid={t('edit-btn')} onClick={() => { onEdit(); setShowOverwrite(false) }} style={editBtnStyle}>
              <EditIcon />
            </button>
          ) : (
            <button
              data-testid={t('confirm-btn')}
              disabled={listImport === 'Favourites' && !selectedFavId}
              onClick={() => {
                if (listImport === 'Favourites') {
                  const fav = favourites.find(f => f.id === selectedFavId)
                  if (fav) onLoadFavourite(fav)
                } else {
                  onConfirm()
                }
              }}
              style={submitButtonStyle(true)}
            >
              <CheckIcon />
            </button>
          )}

          {/* Unconfirmed: favourites picker / textarea / deficit stepper */}
          {!confirmed && listImport === 'Favourites' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <select
                data-testid={t('favourites-select')}
                value={selectedFavId}
                onChange={e => setSelectedFavId(e.target.value)}
                style={selectStyle(true, !!selectedFavId, true)}
              >
                <option value="" disabled style={optionMuted}>Select a squad</option>
                {favourites.map(f => (
                  <option key={f.id} value={f.id} style={optionStyle}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
          {!confirmed && listImport === 'XWA' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <TextareaField
                testId={t('list-textarea')}
                errorTestId={t('import-error')}
                value={text}
                onChange={onTextChange}
                error={error}
                small={true}
              />
            </div>
          )}
          {!confirmed && listImport === 'None' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <TimerStepper
                label={deficitLabel}
                labelStyle={labelStyle(true)}
                value={deficit}
                min={0}
                max={4}
                step={1}
                formatValue={(v) => String(v)}
                onChange={onDeficitChange}
                testId={t('deficit-stepper')}
              />
            </div>
          )}

          {/* Confirmed: squad name + star, overwrite warning, pilot list */}
          {confirmed && squadName !== undefined && <>
            <span />
            <input type="text" readOnly value={squadName} style={squadNameInputStyle(true)} />
            <button
              data-testid={t('star-btn')}
              aria-pressed={starFilled}
              aria-label={starFilled ? 'Remove from favourites' : 'Add to favourites'}
              onClick={() => {
                if (starFilled) { onUnsave(); setShowOverwrite(false) }
                else if (favourites.some(f => f.name === squadName)) { setShowOverwrite(true) }
                else { onSave(squadName) }
              }}
              style={starButtonStyle(true)}
            >
              {starFilled ? '★' : '☆'}
            </button>
          </>}
          {confirmed && showOverwrite && squadName !== undefined && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '1vw' }}>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: '300', fontSize: 'clamp(0.55rem, 1.4vw, 0.7rem)', flex: 1 }}>
                Overwrite '{squadName}'?
              </span>
              <button data-testid={t('overwrite-confirm-btn')} aria-label="Confirm overwrite"
                onClick={() => { onSave(squadName); setShowOverwrite(false) }}
                style={starButtonStyle(true)}>★</button>
              <button data-testid={t('overwrite-cancel-btn')} aria-label="Cancel"
                onClick={() => setShowOverwrite(false)}
                style={overwriteCancelStyle(true)}>✕</button>
            </div>
          )}
          {confirmed && listImport !== 'None' && pilots.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <PilotList pilots={pilots} testId={t('pilot-list')} small={true} />
            </div>
          )}
        </div>
      )
    }

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

          {/* Shared settings — Match / Rounds / Scenario span the top */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh', flexShrink: 0, padding: '1.5vh 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
              <label style={labelStyle(true)}>Match</label>
              <select
                data-testid="match-select"
                value={matchType}
                onChange={e => onMatchTypeChange(e.target.value as XwingMatchType)}
                style={{ ...selectStyle(true, true, true), flex: 1 }}
              >
                <option value="Casual" style={optionStyle}>Casual</option>
                <option value="Tournament" style={optionStyle}>Tournament</option>
              </select>
              <label style={labelStyle(true)}>Scenario</label>
              <select
                data-testid="scenario-select"
                value={scenario}
                onChange={e => onScenarioChange(e.target.value as XwingScenario)}
                style={{ ...selectStyle(true, scenario !== 'None', true), flex: 1 }}
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
            </div>
            {matchType === 'Tournament' && (
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
            )}
          </div>

          {/* Two columns: player (LHS) and opponent (RHS, revealed once the player confirms) */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            minHeight: 0,
            padding: '1.5vh 0 0',
            gap: '3vw',
          }}>
            <div style={landscapeColStyle}>
              {renderImportColumn('player')}
            </div>
            <div style={landscapeColStyle}>
              {(playerConfirmed || opponentConfirmed) ? (
                <>
                  {renderImportColumn('opponent')}
                  {canStart && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1vw', flexShrink: 0, marginTop: '1.5vh' }}>
                      <label style={labelStyle(true)}>Go to game</label>
                      <button onClick={onStart} aria-label="Start game" style={submitButtonStyle(true)}>
                        <ForwardIcon />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div data-testid="opponent-placeholder" style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontWeight: '300',
                  fontSize: 'clamp(0.7rem, 2.5vw, 0.9rem)',
                  letterSpacing: '0.04em',
                  padding: '2vw',
                }}>
                  Confirm your list to set up your opponent
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

        {controlGrid(true)}

        {/* Go to game — floats directly under the opponent list, bottom-right */}
        {canStart && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: '2vw' }}>
            <label style={labelStyle(false)}>Go to game</label>
            <button onClick={onStart} aria-label="Start game" style={submitButtonStyle(false)}>
              <ForwardIcon />
            </button>
          </div>
        )}

      </div>
    </AppScreenLayout>
  )
}
