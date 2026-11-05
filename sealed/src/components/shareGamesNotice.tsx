import { Button } from '@pwa-shared/controls'
import { useSettings } from '../hooks/useSettings'
import { SHARING_HELP_SECTION } from '../utils/helpSections'

/**
 * The pill in both states. The opted-in one adds the fainter colours. It sits in the setup header's
 * row, which must stay on one line: the label never wraps, and below the `sm` width, where it no
 * longer fits beside the title and the buttons, it is not shown. More beside it opens the same Settings.
 */
const PILL_CLASS = 'hidden sm:inline-block whitespace-nowrap rounded-full border px-3 py-1 text-xs hover:text-ink'

/**
 * What is sent, in a line, and a link to the Help section that says it in full. The notice and the
 * Settings switch both say it, so they say it in the same words.
 */
export function ShareGamesSummary({ onHelp }: { onHelp: (section: string) => void }) {
  return (
    <>
      Both decks and every decision; nothing identifies you.{' '}
      <button type="button" className="text-accent underline" onClick={() => onHelp(SHARING_HELP_SECTION)}>What's sent</button>
    </>
  )
}

/**
 * The setup screen's word on sharing games to train the bot, in two parts that never show
 * together: `ShareGamesNotice` (the banner) while the answer is `unasked`, `ShareGamesPill` after.
 *
 * After an answer, or once a first game has started (which `App` records as a no), the pill is all
 * there is: a small button that opens Settings, and the question is never put again. `App` puts it
 * in the setup header, just before More. It is the button alone, with no wrapper, so the row it
 * joins lays it out.
 */
export function ShareGamesPill({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { settings } = useSettings()
  if (settings.shareGames === 'unasked') return null

  const optedIn = settings.shareGames === 'yes'
  return (
    <button
      type="button"
      data-testid="share-games-pill"
      onClick={onOpenSettings}
      className={`${PILL_CLASS} ${optedIn ? 'border-line/30 text-ink-faint' : 'border-line/60 text-ink-dim'}`}
    >
      {optedIn ? 'Your games are improving the bot' : 'Improve the bot'}
    </button>
  )
}

/**
 * Until the player answers, a banner in the page: not a dialog, covering nothing, with a game
 * startable above it. It is the PWA's install banner in shape (one raised row, a title and a line
 * under it, the answers at its end), so the app asks for things one way. What is sent is a line
 * here and in full in Help, a tap away. The two answers are the same shared button and neither is
 * chosen for the player.
 *
 * `App` hands it to the setup screen, which puts it last, under Go to game. The screen spaces it, so
 * the banner has no margin of its own, and once answered it renders nothing.
 */
export function ShareGamesNotice({ onHelp }: { onHelp: (section: string) => void }) {
  const { settings, update } = useSettings()
  if (settings.shareGames !== 'unasked') return null

  return (
    <aside
      data-testid="share-games-notice"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '10px 14px', borderRadius: '12px', background: 'var(--color-surface-raised)', flexShrink: 0 }}
    >
      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Help improve the bot</h2>
        <p style={{ margin: 0, fontSize: '13px', lineHeight: '18px', color: 'var(--color-text-body)' }}>
          Share the games you finish to train the AI bot. <ShareGamesSummary onHelp={onHelp} />
        </p>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        <Button onClick={() => update({ shareGames: 'yes' })}>Share my games</Button>
        <Button onClick={() => update({ shareGames: 'no' })}>Not now</Button>
      </div>
    </aside>
  )
}
