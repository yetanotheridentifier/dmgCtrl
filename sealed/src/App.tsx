import { useState } from 'react'
import DeckSelectScreen from './components/deckSelectScreen'
import GameScreen from './components/gameScreen'
import HelpScreen from './components/helpScreen'
import type { SavedDeck } from './data/deckStore'
import { BUILD_TAG } from './buildTag'
import { isDev } from './env'

type Screen = 'decks' | 'game' | 'help'

export default function App() {
  const [screen, setScreen] = useState<Screen>('decks')
  const [helpReturn, setHelpReturn] = useState<Screen>('decks')
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null)
  const [opponentDeck, setOpponentDeck] = useState<SavedDeck | null>(null)

  function openHelp() {
    setHelpReturn(screen)
    setScreen('help')
  }

  return (
    <div className="min-h-screen text-ink font-sans">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}dmgCtrl-icon-192.png`}
            alt="dmgCtrl"
            className="w-9 h-9"
          />
          <h1 className="text-2xl font-extralight tracking-[0.15em] text-ink">
            dmgCtrl <span className="text-ink-dim">· Sealed</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {screen === 'game' && (
            <button
              data-testid="exit-btn"
              onClick={() => setScreen('decks')}
              className="h-9 px-3 flex items-center justify-center border-2 border-line rounded-lg text-sm text-ink-dim hover:text-ink shadow-[0_0_8px_rgba(156,163,175,0.2)]"
            >
              Exit
            </button>
          )}
          {screen !== 'help' && (
            <button
              onClick={openHelp}
              aria-label="Help"
              className="w-9 h-9 flex items-center justify-center border-2 border-line rounded-lg text-ink-dim hover:text-ink shadow-[0_0_8px_rgba(156,163,175,0.2)]"
            >
              ?
            </button>
          )}
        </div>
      </header>
      <main className="px-6 py-4">
        {screen === 'decks' && (
          <DeckSelectScreen
            onPlay={(deck, opponent) => {
              setSelectedDeck(deck)
              setOpponentDeck(opponent)
              setScreen('game')
            }}
          />
        )}
        {screen === 'game' && selectedDeck && opponentDeck && (
          <GameScreen deck={selectedDeck} opponentDeck={opponentDeck} onExit={() => setScreen('decks')} />
        )}
        {screen === 'help' && <HelpScreen onBack={() => setScreen(helpReturn)} />}
      </main>

      {/* Dev-only build marker in the bottom-right corner (setup + game screens);
          in prod it lives at the foot of the Help page instead (#332). */}
      {isDev() && screen !== 'help' && (
        <div
          data-testid="build-tag"
          style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 50 }}
          className="text-[10px] text-ink-faint"
        >
          {BUILD_TAG}
        </div>
      )}
    </div>
  )
}
