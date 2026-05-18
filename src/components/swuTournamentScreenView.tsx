import type { TournamentState } from '../hooks/useTournament'
import { BackIcon, CogIcon, HelpIcon } from './icons'
import AppScreenLayout from './layout/AppScreenLayout'
import { useOrientation } from '../hooks/useOrientation'

type ActionButtonLabel =
  | `Start Match ${number}`
  | `Return to Match ${number}`

function actionButtonLabel(
  tournament: TournamentState | null,
  matchInProgress: boolean,
): ActionButtonLabel | null {
  if (!tournament) return 'Start Match 1'
  if (matchInProgress) {
    const n = tournament.rounds[tournament.rounds.length - 1].roundNumber
    return `Return to Match ${n}`
  }
  return `Start Match ${tournament.rounds.length + 1}`
}

// --- Style helpers (matching setup screen conventions) ---

const labelStyle = (small = false): React.CSSProperties => ({
  color: 'var(--color-accent)',
  fontWeight: '300',
  fontSize: small ? 'clamp(0.8rem, 3vw, 1rem)' : 'clamp(0.9rem, 4vw, 1.2rem)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  flexShrink: 0,
})

const inputStyle = (hasValue: boolean, readOnly = false, small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(1rem, 1.8vw, 1.2rem)' : 'clamp(1rem, 3vw, 1.2rem)',
  ...(small && { height: 'max(44px, 8vh)' }),
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: hasValue ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: readOnly ? 'none' : '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  opacity: readOnly ? 0.6 : 1,
  width: '100%',
  minWidth: 0,
})

const selectStyle = (enabled: boolean, small = false): React.CSSProperties => ({
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
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  WebkitAppearance: 'none',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.4,
  width: '100%',
})

const primaryButtonStyle = (enabled: boolean, small = false): React.CSSProperties => ({
  width: '100%',
  minHeight: '44px',
  ...(small && { height: 'max(44px, 8vh)' }),
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(0.85rem, 2vw, 1.05rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  fontWeight: '300',
  letterSpacing: '0.08em',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  border: '2px solid var(--color-text-primary)',
  borderRadius: '12px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  boxShadow: enabled ? '0 0 12px rgba(255, 255, 255, 0.2)' : 'none',
  WebkitTapHighlightColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: enabled ? 1 : 0.4,
  boxSizing: 'border-box',
})

const dropEndButtonStyle = (enabled: boolean, confirm: boolean, small = false): React.CSSProperties => ({
  minHeight: '44px',
  minWidth: '44px',
  ...(small && { height: 'max(44px, 8vh)' }),
  flexShrink: 0,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(1rem, 3vw, 1.2rem)',
  fontWeight: confirm ? '400' : '300',
  letterSpacing: '0.06em',
  background: 'transparent',
  color: confirm ? 'var(--color-error)' : enabled ? 'var(--color-error)' : 'var(--color-text-disabled)',
  border: `2px solid ${confirm ? 'var(--color-error)' : enabled ? 'var(--color-error)' : 'var(--color-text-disabled)'}`,
  borderRadius: '12px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.4,
  WebkitTapHighlightColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  boxShadow: confirm ? '0 0 8px rgba(var(--color-error-rgb, 239,68,68), 0.4)' : 'none',
  transition: 'all 0.15s ease',
})

const iconButtonStyle = (small = false): React.CSSProperties => ({
  width: small ? '5vh' : '5vw',
  height: small ? '5vh' : '5vw',
  minWidth: '36px',
  minHeight: '36px',
  flexShrink: 0,
  background: 'transparent',
  border: '2px solid var(--color-ui-border)',
  borderRadius: '8px',
  color: 'var(--color-ui-border-muted)',
  fontSize: small ? 'clamp(0.8rem, 2vh, 1.2rem)' : 'clamp(0.8rem, 2vw, 1.2rem)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
})

interface Props {
  tournament: TournamentState | null
  matchInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  localTournamentId: string
  localPlayMode: 'bo1' | 'bo3'
  localTotalRounds: number
  onLocalTournamentIdChange: (id: string) => void
  onLocalPlayModeChange: (mode: 'bo1' | 'bo3') => void
  onLocalTotalRoundsChange: (rounds: number) => void
  showDropConfirm: boolean
  onActionButton: () => void
  onDropClick: () => void
  onDropCancel: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

function resultLabel(result: 'won' | 'lost' | 'drawn' | null): string {
  if (result === 'won') return 'W'
  if (result === 'lost') return 'L'
  if (result === 'drawn') return 'D'
  return '—'
}

function resultColor(result: 'won' | 'lost' | 'drawn' | null): string {
  if (result === 'won') return '#22c55e'
  if (result === 'lost') return 'var(--color-error)'
  if (result === 'drawn') return '#facc15'
  return 'var(--color-text-disabled)'
}

export default function SwuTournamentScreenView({
  tournament,
  matchInProgress,
  isComplete,
  totals,
  localTournamentId,
  localPlayMode,
  localTotalRounds,
  onLocalTournamentIdChange,
  onLocalPlayModeChange,
  onLocalTotalRoundsChange,
  showDropConfirm,
  onActionButton,
  onDropClick,
  onDropCancel,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const isStarted = tournament !== null
  const configLocked = isStarted

  const tournamentIdValue = isStarted ? tournament.tournamentId : localTournamentId
  const playModeValue = isStarted ? tournament.playMode : localPlayMode
  const totalRoundsValue = isStarted ? tournament.totalRounds : localTotalRounds

  const dropEndLabel = showDropConfirm ? 'Confirm' : isComplete ? 'End Tournament' : 'Drop'
  const actionLabel = actionButtonLabel(tournament, matchInProgress)

  // --- Shared sub-sections ---

  const titleRow = (small = false) => (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: small ? '1vw' : '3vw' }}>
        {!isStarted ? (
          <button aria-label="Back" onClick={onBack} style={iconButtonStyle(small)}>
            <BackIcon />
          </button>
        ) : (
          <img
            src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
            alt="dmgCtrl"
            style={{ height: small ? 'clamp(1.2rem, 4vw, 1.8rem)' : 'clamp(1.8rem, 8vw, 3rem)', width: 'auto' }}
          />
        )}
        <h1 style={{
          color: 'var(--color-text-primary)',
          fontWeight: '200',
          fontSize: small ? 'clamp(1.2rem, 4vw, 1.8rem)' : 'clamp(1.8rem, 8vw, 3rem)',
          letterSpacing: '0.15em',
          margin: 0,
        }}>
          Tournament
        </h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: small ? '1vw' : '2vw' }}>
        {onSettings && (
          <button onClick={onSettings} aria-label="⚙" style={iconButtonStyle(small)}>
            <CogIcon />
          </button>
        )}
        <button onClick={onHelp} aria-label="Help" style={iconButtonStyle(small)}>
          <HelpIcon />
        </button>
      </div>
    </div>
  )

  const idAndDropRow = (small = false) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
      <label style={labelStyle(small)}>ID</label>
      <input
        data-testid="tournament-id-input"
        type="text"
        value={tournamentIdValue}
        readOnly={isStarted}
        onChange={e => onLocalTournamentIdChange(e.target.value)}
        placeholder="Tournament ID"
        style={inputStyle(tournamentIdValue !== '', isStarted, small)}
      />
      <button
        data-testid="drop-end-button"
        disabled={!isStarted}
        onClick={onDropClick}
        onBlur={showDropConfirm ? onDropCancel : undefined}
        style={{ ...dropEndButtonStyle(isStarted, showDropConfirm, small), position: 'relative', zIndex: 101 }}
      >
        {dropEndLabel}
      </button>
    </div>
  )

  const modeRoundsRow = (small = false) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
      <label style={labelStyle(small)}>Match</label>
      <select
        data-testid="tournament-play-mode"
        value={playModeValue}
        disabled={configLocked}
        onChange={e => onLocalPlayModeChange(e.target.value as 'bo1' | 'bo3')}
        style={{ ...selectStyle(!configLocked, small), flex: 2 }}
      >
        <option value="bo1" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>Best of 1</option>
        <option value="bo3" style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>Best of 3</option>
      </select>
      <label style={labelStyle(small)}>Rounds</label>
      <select
        data-testid="tournament-total-rounds"
        value={totalRoundsValue}
        disabled={configLocked}
        onChange={e => onLocalTotalRoundsChange(Number(e.target.value))}
        style={{ ...selectStyle(!configLocked, small), flex: 1 }}
      >
        {Array.from({ length: 15 }, (_, i) => i + 2).map(n => (
          <option key={n} value={n} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>{n}</option>
        ))}
      </select>
    </div>
  )

  const configSection = (small = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: small ? '1vh' : '1.5vh' }}>
      {idAndDropRow(small)}
      {modeRoundsRow(small)}
    </div>
  )

  const recordRow = (small = false) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: small ? 'clamp(1rem, 2.5vw, 1.4rem)' : 'clamp(1.2rem, 5vw, 2rem)',
      fontWeight: '200',
      letterSpacing: '0.1em',
      color: 'var(--color-text-primary)',
      flexShrink: 0,
    }}>
      {totals.won}–{totals.lost}–{totals.drawn}
    </div>
  )

  const actionButtons = (small = false) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: small ? '1vw' : '2vw', flexShrink: 0 }}>
      <button disabled style={{ ...primaryButtonStyle(false, small), flex: 1 }}>Find Next Match</button>
      {!isComplete && actionLabel && (
        <button onClick={onActionButton} style={{ ...primaryButtonStyle(true, small), flex: 1 }}>
          {actionLabel}
        </button>
      )}
    </div>
  )

  const roundsTable = (small = false) => {
    if (!tournament || tournament.rounds.length === 0) return null
    const cellStyle: React.CSSProperties = {
      padding: small ? '0.4vh 0.8vw' : '0.5vh 1vw',
      fontSize: small ? 'clamp(0.65rem, 1.4vw, 0.8rem)' : 'clamp(0.75rem, 2.5vw, 1rem)',
      fontWeight: '300',
      textAlign: 'center',
      borderBottom: '1px solid rgba(var(--color-ui-border-muted-rgb), 0.2)',
    }
    const headerStyle: React.CSSProperties = {
      ...cellStyle,
      color: 'var(--color-accent)',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      fontSize: small ? 'clamp(0.55rem, 1.2vw, 0.7rem)' : 'clamp(0.65rem, 2vw, 0.85rem)',
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', flexShrink: 0 }}>
        <thead>
          <tr>
            <th style={headerStyle}>Round</th>
            <th style={headerStyle}>Result</th>
            <th style={headerStyle}>Score</th>
          </tr>
        </thead>
        <tbody>
          {tournament.rounds.map(r => (
            <tr key={r.roundNumber}>
              <td style={{ ...cellStyle, color: 'var(--color-text-primary)' }}>{r.roundNumber}</td>
              <td style={{ ...cellStyle, color: resultColor(r.result), fontWeight: '400' }}>
                {resultLabel(r.result)}
              </td>
              <td style={{ ...cellStyle, color: 'var(--color-text-primary)' }}>
                {r.playerScore}–{r.opponentScore}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const cancelOverlay = showDropConfirm
    ? <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={onDropCancel} />
    : null

  // --- Landscape layout ---
  // CSS Grid: 2 cols × 3 rows so left/right rows share the same grid row height,
  // giving automatic vertical alignment between config rows and score/button rows.
  if (!isPortrait) {
    return (
      <AppScreenLayout>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '3vw 4vw',
        }}>
          {cancelOverlay}
          {titleRow(true)}

          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            gap: '1.5vh',
            paddingTop: '1.5vh',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '45% 1fr',
              gridTemplateRows: 'auto auto',
              columnGap: '3vw',
              rowGap: '1.5vh',
            }}>
              {/* Row 1: ID + Drop  |  W–L–D score */}
              {idAndDropRow(true)}
              {recordRow(true)}

              {/* Row 2: Match + Rounds  |  Action buttons */}
              {modeRoundsRow(true)}
              {actionButtons(true)}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {roundsTable(true)}
            </div>
          </div>
        </div>
      </AppScreenLayout>
    )
  }

  // --- Portrait layout ---
  return (
    <AppScreenLayout>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '5vw',
        gap: '2vh',
        overflowY: 'auto',
      }}>
        {cancelOverlay}
        {titleRow(false)}
        {configSection(false)}
        {recordRow(false)}
        {actionButtons(false)}
        {roundsTable(false)}
      </div>
    </AppScreenLayout>
  )
}
