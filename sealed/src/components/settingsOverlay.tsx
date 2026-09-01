import { useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import type { BaseHealthDisplay } from '../data/settingsStore'

/**
 * The settings form, over a dark backdrop.
 *
 * An overlay rather than a screen because it has to be reachable during a game: routing away
 * unmounts `GameScreen` and the game with it (#541). It reads the settings context directly,
 * unlike the presentational overlays around it, since a settings form has no caller-held state
 * to be handed.
 */
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
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
