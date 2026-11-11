import { useEffect, useState } from 'react'
import SetupScreen from './components/setupScreen'
import GameScreen from './components/gameScreen'
import { HelpPage } from './components/helpPage'
import { SettingsSheet } from './components/settingsSheet'
import { ShareGamesNotice, ShareGamesPill } from './components/shareGamesNotice'
import { SettingsProvider, useSettings } from './hooks/useSettings'
import { useUpdateOnDeckScreen } from './hooks/useUpdateOnDeckScreen'
import type { SavedDeck } from './data/deckStore'
import { retryPendingCollection } from './data/collectionSend'
import { onAppStarted } from './data/analytics'
import { RELEASE } from './buildIdentity'
import { isDev } from './env'

type Screen = 'decks' | 'game'

/**
 * The provider wraps the shell rather than living in `main.tsx`, so `<App />` is self-contained
 * and testable on its own.
 */
export default function App() {
  // Games that could not be delivered for collection when they finished are offered again, once,
  // as the app opens. Nothing waits on it and it is silent whatever happens.
  useEffect(() => {
    void retryPendingCollection()
    void onAppStarted()
  }, [])

  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  )
}

function AppShell() {
  const [screen, setScreen] = useState<Screen>('decks')
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null)
  const [opponentDeck, setOpponentDeck] = useState<SavedDeck | null>(null)
  // Settings are a sheet, not a screen: the game screen has its own entry point, and routing
  // away from a game in progress would unmount it (#541).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Help likewise, and for the same reason: it used to be a screen, so opening it mid-game
  // unmounted GameScreen and started a different game on the way back (#541). Held here rather
  // than in GameScreen so one overlay serves both screens, with the context taken from `screen`.
  const [helpOpen, setHelpOpen] = useState(false)
  // Set when help was opened by a link to one section of the guide, which it then opens at.
  const [helpSection, setHelpSection] = useState<string | undefined>(undefined)
  const openHelp = (section?: string) => {
    setHelpSection(section)
    setHelpOpen(true)
  }
  const { settings } = useSettings()
  useUpdateOnDeckScreen(screen === 'game')

  return (
    // No height of its own: in the installed app 100vh measured taller than the window, so a root
    // that tall scrolled the page. The screens size themselves.
    <div className="text-ink font-sans">
      {screen === 'game' && selectedDeck && opponentDeck ? (
        // The game screen is full-bleed: its own header (dmgCtrl icon = exit, ? =
        // help) lives in the log column, so the play area reaches the top.
        <GameScreen
          deck={selectedDeck}
          opponentDeck={opponentDeck}
          onExit={() => setScreen('decks')}
          onHelp={openHelp}
        />
      ) : (
        <SetupScreen
          onHelp={() => openHelp()}
          onSettings={() => setSettingsOpen(true)}
          // Setup only, since the game screen has its own header. Absent until the notice in the
          // page is answered.
          headerExtra={<ShareGamesPill onOpenSettings={() => setSettingsOpen(true)} />}
          // Part of the page, covering nothing, in place of Go to game until it is answered. Passed in
          // so the setup screen needs no settings, and only while it is unanswered, since Go to game
          // is shown only without it.
          notice={settings.shareGames === 'unasked' ? <ShareGamesNotice onHelp={openHelp} /> : undefined}
          onPlay={(deck, opponent) => {
            setSelectedDeck(deck)
            setOpponentDeck(opponent)
            setScreen('game')
          }}
        />
      )}

      {/* The game screen opens settings from its own More, so this covers the other screens. */}
      <SettingsSheet open={settingsOpen && screen !== 'game'} onClose={() => setSettingsOpen(false)} onHelp={openHelp} />

      {/* Help serves both screens from here: it renders over whichever is mounted, and opens at
          the section for the screen it was opened on. */}
      {helpOpen && (
        <HelpPage
          context={screen === 'game' ? 'game' : 'decks'}
          section={helpSection}
          onClose={() => setHelpOpen(false)}
        />
      )}

      {/* Dev-only build marker in the bottom-right corner (setup + game screens);
          in prod it lives at the foot of the Help page instead, so it is hidden while
          help is open rather than showing through the backdrop. */}
      {isDev() && !helpOpen && (
        <div
          data-testid="build-tag"
          style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 50 }}
          className="text-[10px] text-ink-faint"
        >
          {RELEASE}
        </div>
      )}
    </div>
  )
}
