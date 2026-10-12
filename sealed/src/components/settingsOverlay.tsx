import { useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import { OPPONENT_DELAYS_MS } from '../data/settingsStore'
import type { BaseHealthDisplay } from '../data/settingsStore'
import { SHARING_HELP_SECTION } from '../utils/helpSections'

const opponentDelayLabel = (ms: number) =>
  ms === 0 ? 'Instant' : `${ms / 1000} ${ms === 1000 ? 'second' : 'seconds'} between actions`

/**
 * The settings form, over a dark backdrop.
 *
 * An overlay rather than a screen because it has to be reachable during a game: routing away
 * unmounts `GameScreen` and the game with it (#541). It reads the settings context directly,
 * unlike the presentational overlays around it, since a settings form has no caller-held state
 * to be handed.
 */
export function SettingsOverlay({ onClose, onHelp }: {
  onClose: () => void
  /** Open Help on one section of the guide, by its heading. Help opens over this form. */
  onHelp: (section: string) => void
}) {
  const { settings, update } = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // Above the board and the card zoom, matching the bug-report overlay.
    <div data-testid="settings-overlay" className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-xl border-2 border-line/60 bg-surface-solid p-4 shadow-[0_8px_32px_rgba(0,0,0,0.7)]">
        <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Settings</h2>

        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-ink" htmlFor="setting-allow-undo">
            <input
              id="setting-allow-undo"
              data-testid="setting-allow-undo"
              type="checkbox"
              checked={settings.allowUndo}
              onChange={e => update({ allowUndo: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Allow undo
          </label>
          <p data-testid="setting-allow-undo-help" className="mt-1 text-xs text-ink-faint">
            Off by default. Undo rewinds past a mulligan, a draw or a search, so you would be
            deciding again with cards you have already seen. Turn it on to practise a line.
          </p>
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-ink" htmlFor="setting-show-bug-report">
            <input
              id="setting-show-bug-report"
              data-testid="setting-show-bug-report"
              type="checkbox"
              checked={settings.showBugReport}
              onChange={e => update({ showBugReport: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Show the bug report button
          </label>
          <p className="mt-1 text-xs text-ink-faint">
            Filing a report opens GitHub with the game so far on the clipboard. Off by default.
          </p>
        </div>

        {/* On means yes and off means no. A player who was never asked sees it off, and touching
            it is an answer either way, so the setup screen's notice does not ask afterwards. */}
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-ink" htmlFor="setting-share-games">
            <input
              id="setting-share-games"
              data-testid="setting-share-games"
              type="checkbox"
              checked={settings.shareGames === 'yes'}
              onChange={e => update({ shareGames: e.target.checked ? 'yes' : 'no' })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Share games to improve the bot
          </label>
          <p data-testid="setting-share-games-help" className="mt-1 text-xs text-ink-faint">
            Sends finished games (both decks and every decision) to train the bot. Nothing identifies
            you. Off by default.
          </p>
          <button
            type="button"
            onClick={() => onHelp(SHARING_HELP_SECTION)}
            className="mt-1 text-xs text-ink-dim underline hover:text-ink"
          >
            What is sent?
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-sm text-ink" htmlFor="setting-base-health">Base health</label>
          <select
            id="setting-base-health"
            data-testid="setting-base-health"
            value={settings.baseHealthDisplay}
            onChange={e => update({ baseHealthDisplay: e.target.value as BaseHealthDisplay })}
            className="mt-1 w-full rounded-lg border-2 border-line/60 bg-bg-dark px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="damage">Damage taken, counting up</option>
            <option value="remaining">Health remaining, counting down</option>
          </select>
        </div>

        <div className="mt-4">
          <label className="block text-sm text-ink" htmlFor="setting-opponent-delay">Opponent pace</label>
          <select
            id="setting-opponent-delay"
            data-testid="setting-opponent-delay"
            value={settings.opponentDelayMs}
            onChange={e => update({ opponentDelayMs: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border-2 border-line/60 bg-bg-dark px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {OPPONENT_DELAYS_MS.map(ms => (
              <option key={ms} value={ms}>{opponentDelayLabel(ms)}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-faint">
            The opponent's actions appear one at a time, at least this far apart, so you can see what
            each one did. Instant shows its whole reply at once.
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            data-testid="settings-close"
            onClick={onClose}
            className="rounded-xl border-2 border-accent px-4 py-1.5 text-xs text-accent shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
