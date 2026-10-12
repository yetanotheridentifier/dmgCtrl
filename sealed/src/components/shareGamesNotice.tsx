import { useSettings } from '../hooks/useSettings'

/** Both answers, one style: neither is the highlighted one. */
const ANSWER_CLASS = 'px-4 py-1.5 text-sm border-2 border-line text-ink rounded-xl hover:bg-white/10'

/**
 * The pill in both states. The opted-in one adds the fainter colours. It sits in the app header's
 * button row, which must stay on one line: the label never wraps, and below the `sm` width, where
 * it no longer fits beside the title and the two buttons, it is not shown. The cog next to it
 * opens the same Settings.
 */
const PILL_CLASS = 'hidden sm:inline-block whitespace-nowrap rounded-full border px-3 py-1 text-xs hover:text-ink'

/**
 * The setup screen's word on sharing games to train the bot, in two parts that never show
 * together: `ShareGamesNotice` (the card) while the answer is `unasked`, `ShareGamesPill` after.
 *
 * After an answer, or once a first game has started (which `App` records as a no), the pill is all
 * there is: a small button that opens Settings, and the question is never put again. `App` puts it
 * in its header, to the left of the settings and help buttons. It is the button alone, with no
 * wrapper, so the row it joins lays it out.
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
 * Until the player answers, a card in the page: not a dialog, covering nothing, with a game
 * startable beside it. The two answers are styled alike and neither is chosen for the player.
 *
 * `App` hands it to the deck screen, which puts it at the head of the card catalogue column. The
 * column spaces its sections, so the card has no margin of its own, and once answered it renders
 * nothing, so the column starts at its first heading.
 *
 * The card's wording is the Help section's ("Improving the bot" in `docs/userGuide.md`), and a test
 * holds the two together.
 */
export function ShareGamesNotice() {
  const { settings, update } = useSettings()
  if (settings.shareGames !== 'unasked') return null

  return (
    <aside data-testid="share-games-notice" className="rounded-xl border-2 border-line/60 bg-surface px-4 py-3">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Help improve gameplay</h2>
      <div className="mt-2 space-y-2 text-sm text-ink-dim">
        <p>
          The AI bot gets better by learning from real games. If you opt in, each game you finish is
          sent to train it.
        </p>
        <p>
          <strong className="text-ink">What is sent:</strong> both decks as loaded, every decision
          made in the game by you and the bot, who won, how long it took, and the app version.
        </p>
        <p>
          <strong className="text-ink">What is not sent:</strong> your name, your deck names, or
          anything else that identifies you. There is no account, and your IP address is not linked
          to games. Because of that, a game cannot be traced back to you, and it also cannot be found
          and deleted later.
        </p>
        <p>
          This data export is disabled unless you turn it on, and you can change it at any time in
          Settings.
        </p>
      </div>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={() => update({ shareGames: 'yes' })} className={ANSWER_CLASS}>
          Share my games
        </button>
        <button type="button" onClick={() => update({ shareGames: 'no' })} className={ANSWER_CLASS}>
          Not now
        </button>
      </div>
    </aside>
  )
}
