import { ControlRow, SegmentedControl, Sheet, Stepper, Switch } from '@pwa-shared/controls'
import { useSettings } from '../hooks/useSettings'
import { useMediaQuery, PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from '../hooks/useMediaQuery'
import { OPPONENT_DELAYS_MS } from '../data/settingsStore'
import type { BaseHealthDisplay } from '../data/settingsStore'
import { ShareGamesSummary } from './shareGamesNotice'

const paceLabel = (index: number) => {
  const ms = OPPONENT_DELAYS_MS[index]
  return ms === 0 ? 'Instant' : `${ms / 1000} s`
}

const BASE_HEALTH: { value: BaseHealthDisplay; label: string }[] = [
  { value: 'damage', label: 'Damage taken' },
  { value: 'remaining', label: 'Health left' },
]

/**
 * Sealed's own settings, in a sheet over setup or the game: opening it never routes away, which
 * would unmount `GameScreen` and the game with it, so a change applies straight away. It reads the
 * settings context directly, since a settings form has no caller-held state to be handed.
 */
export function SettingsSheet({ open, onClose, onHelp }: {
  open: boolean
  onClose: () => void
  /** Open Help on one section of the guide, by its heading. Help opens over this sheet. */
  onHelp: (section: string) => void
}) {
  const { settings, update } = useSettings()
  // The bug report is desktop only, so its switch is too.
  const phoneLandscape = useMediaQuery(PHONE_LANDSCAPE_QUERY)
  const phonePortrait = useMediaQuery(PHONE_PORTRAIT_QUERY)

  return (
    <Sheet open={open} title="Sealed settings" onClose={onClose}>
      <Switch
        label="Allow undo"
        note="Rewinds past draws and searches. For practice."
        checked={settings.allowUndo}
        onChange={allowUndo => update({ allowUndo })}
      />
      <ControlRow label="Opponent pace" note="The least time between its actions">
        <Stepper
          label="Opponent pace"
          showLabel={false}
          value={OPPONENT_DELAYS_MS.indexOf(settings.opponentDelayMs)}
          min={0}
          max={OPPONENT_DELAYS_MS.length - 1}
          format={paceLabel}
          onChange={i => update({ opponentDelayMs: OPPONENT_DELAYS_MS[i] })}
        />
      </ControlRow>
      <ControlRow label="Base health">
        <div className="min-w-0">
          <SegmentedControl label="Base health" options={BASE_HEALTH} value={settings.baseHealthDisplay} onChange={baseHealthDisplay => update({ baseHealthDisplay })} />
        </div>
      </ControlRow>
      {/* On means yes and off means no. A player who was never asked sees it off, and touching it
          is an answer either way, so the setup screen's notice does not ask afterwards. */}
      <Switch
        label="Share games to improve the bot"
        note={<ShareGamesSummary onHelp={onHelp} />}
        checked={settings.shareGames === 'yes'}
        onChange={on => update({ shareGames: on ? 'yes' : 'no' })}
      />
      {!phoneLandscape && !phonePortrait && (
        <Switch
          label="Report a bug button"
          note="Adds Report a bug to More. Desktop only."
          checked={settings.showBugReport}
          onChange={showBugReport => update({ showBugReport })}
        />
      )}
    </Sheet>
  )
}
