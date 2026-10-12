// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadSettings, saveSettings, defaultSettings, STORAGE_KEY, OPPONENT_DELAYS_MS } from '../data/settingsStore'
import { isDev } from '../env'

// isDev is mocked per test: `allowUndo` defaults differently per build, and both
// cases have to be assertable without two test runs.
vi.mock('../env', () => ({ isDev: vi.fn(() => false) }))
const mockIsDev = vi.mocked(isDev)

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    mockIsDev.mockReturnValue(false)
  })

  describe('defaults', () => {
    it('shows base health as damage taken', () => {
      expect(defaultSettings().baseHealthDisplay).toBe('damage')
    })

    /**
     * #533: undo is a playtesting tool, not a play affordance. Undoing a mulligan (or any
     * action that revealed a card) lets you choose again knowing what was hidden, so it is
     * off in the shipped build and on while developing.
     */
    it('allows undo in dev and not in prod', () => {
      mockIsDev.mockReturnValue(true)
      expect(defaultSettings().allowUndo).toBe(true)
      mockIsDev.mockReturnValue(false)
      expect(defaultSettings().allowUndo).toBe(false)
    })

    it('shows the bug report button in dev and not in prod', () => {
      mockIsDev.mockReturnValue(true)
      expect(defaultSettings().showBugReport).toBe(true)
      mockIsDev.mockReturnValue(false)
      expect(defaultSettings().showBugReport).toBe(false)
    })

    /** Half a second between the opponent's actions, in every build. */
    it('paces the opponent at 500ms', () => {
      expect(defaultSettings().opponentDelayMs).toBe(500)
      mockIsDev.mockReturnValue(true)
      expect(defaultSettings().opponentDelayMs).toBe(500)
    })

    it('offers instant and the default among the opponent delays', () => {
      expect(OPPONENT_DELAYS_MS).toContain(0)
      expect(OPPONENT_DELAYS_MS).toContain(defaultSettings().opponentDelayMs)
    })
  })

  describe('loadSettings', () => {
    it('returns the defaults when nothing is stored', () => {
      expect(loadSettings()).toEqual(defaultSettings())
    })

    /**
     * The default for `allowUndo` is computed from the build, so persisting it on first load
     * would freeze one build's answer into storage and stop it tracking the build. Only an
     * explicit change may write.
     */
    it('does not write to storage', () => {
      loadSettings()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('reads back what was saved', () => {
      saveSettings({ allowUndo: true, baseHealthDisplay: 'remaining', showBugReport: true, opponentDelayMs: 0 })
      expect(loadSettings()).toEqual({ allowUndo: true, baseHealthDisplay: 'remaining', showBugReport: true, opponentDelayMs: 0 })
    })

    /** A delay that is not one of the offered ones could not be shown in the settings form. */
    it.each([123, -500, '500', null, true])('replaces an opponent delay of %j with the default', stored => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: true, opponentDelayMs: stored }))
      expect(loadSettings()).toEqual({ ...defaultSettings(), allowUndo: true, opponentDelayMs: 500 })
    })

    it.each([...OPPONENT_DELAYS_MS])('keeps a stored opponent delay of %ims', stored => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ opponentDelayMs: stored }))
      expect(loadSettings().opponentDelayMs).toBe(stored)
    })

    it('falls back to the defaults when the stored blob is corrupt', () => {
      localStorage.setItem(STORAGE_KEY, 'not json {')
      expect(loadSettings()).toEqual(defaultSettings())
    })

    it('falls back to the defaults when the stored blob is not an object', () => {
      localStorage.setItem(STORAGE_KEY, '"a string"')
      expect(loadSettings()).toEqual(defaultSettings())
    })

    it('replaces an unrecognised value with that field’s default, keeping the rest', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: true, baseHealthDisplay: 'sideways' }))
      expect(loadSettings()).toEqual({ allowUndo: true, baseHealthDisplay: 'damage', showBugReport: false, opponentDelayMs: 500 })
    })

    it('replaces a wrongly typed value with that field’s default', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: 'yes please' }))
      expect(loadSettings().allowUndo).toBe(defaultSettings().allowUndo)
    })

    /**
     * A blob written before a setting existed omits it, which must read as that setting's
     * default rather than wiping the ones it does carry.
     */
    it('fills in fields the stored blob omits', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseHealthDisplay: 'remaining' }))
      expect(loadSettings()).toEqual({ allowUndo: false, baseHealthDisplay: 'remaining', showBugReport: false, opponentDelayMs: 500 })
    })
  })
})
