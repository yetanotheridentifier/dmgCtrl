import { recordForCollection } from '../../data/collection'
import { defaultSettings, saveSettings } from '../../data/settingsStore'
import { gameKey } from '../../bench/trainingRows'
import { playedRecord } from './playedRecord'

/**
 * Games as the collection Worker stores them: the app's own outbound payload for a played game
 * (`recordForCollection`), serialised the way the Worker writes it, under the key the Worker gives
 * it. Nothing here is written by hand, so the store is tested against what is really collected.
 *
 * Needs a DOM (`@vitest-environment jsdom`): the payload is only built for a player who opted in,
 * and that answer is read from storage.
 */
export interface StagedGame {
  gameKey: string
  /** The stored value: the payload as JSON. */
  text: string
}

export function stagedGame(seed: number): StagedGame {
  saveSettings({ ...defaultSettings(), shareGames: 'yes' })
  const payload = recordForCollection({ ...playedRecord(seed), consentedAtFinish: true })
  if (!payload) throw new Error('stagedGame: the collection gate refused a consented record')
  const text = JSON.stringify(payload)
  return { gameKey: gameKey(JSON.parse(text) as typeof payload), text }
}
