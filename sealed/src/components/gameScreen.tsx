import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { GameState, PlayerId, UnitState } from '../engine/types'
import { describeAction } from '../utils/describeAction'

interface Props {
  deck: SavedDeck
  opponentDeck: SavedDeck
  onExit: () => void
  /** Injectable for deterministic tests; defaults to real randomness. */
  gameOptions?: UseGameOptions
}

function UnitLine({ state, unit }: { state: GameState; unit: UnitState }) {
  const card = state.cards[unit.cardId]
  const hp = card?.hp ?? 0
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={unit.exhausted ? 'text-ink-faint' : 'text-ink'}>
        {card?.name ?? unit.cardId}
        {unit.isLeader && <span className="text-accent"> ♦</span>}
      </span>
      <span className="text-ink-dim font-mono text-xs">
        {card?.power ?? 0}/{hp - unit.damage}
        {unit.damage > 0 && <span className="text-red"> ({unit.damage} dmg)</span>}
      </span>
      {unit.exhausted && <span className="text-ink-faint text-xs">exhausted</span>}
    </li>
  )
}

function Arena({ state, side, arena }: { state: GameState; side: PlayerId; arena: 'ground' | 'space' }) {
  const units = state.players[side].units.filter(u => u.arena === arena)
  return (
    <div data-testid={`${side}-${arena}-units`}>
      <span className="text-ink-faint text-xs uppercase tracking-widest">{arena}</span>
      {units.length === 0 ? (
        <p className="text-ink-faint text-xs italic">empty</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {units.map(u => (
            <UnitLine key={u.instanceId} state={state} unit={u} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SidePanel({ state, side }: { state: GameState; side: PlayerId }) {
  const p = state.players[side]
  const baseCard = state.cards[p.base.cardId]
  const leaderCard = state.cards[p.leader.cardId]
  const baseHp = baseCard?.hp ?? 0
  const readyRes = p.resources.filter(r => !r.exhausted).length

  const leaderStatus = p.leader.deployed
    ? 'deployed'
    : p.leader.epicActionUsed
      ? 'epic action used'
      : 'undeployed'

  return (
    <section data-testid={`${side}-panel`} className="border-2 border-line/60 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">{side === 'player' ? 'You' : 'Opponent'}</h3>
        <span className="text-sm">
          Base <span data-testid={`${side}-base-hp`} className="font-mono">{baseHp - p.base.damage}/{baseHp}</span>
        </span>
        <span className="text-sm">
          Resources <span data-testid={`${side}-resources`} className="font-mono">{readyRes}/{p.resources.length}</span>
        </span>
        <span className="text-sm text-ink-dim">
          {leaderCard?.name ?? 'Leader'} · {leaderStatus}
        </span>
        {side === 'opponent' && (
          <span className="text-sm">
            Hand <span data-testid="opponent-hand-count" className="font-mono">{p.hand.length}</span>
          </span>
        )}
        <span className="text-sm text-ink-faint">Deck {p.deck.length} · Discard {p.discard.length}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <Arena state={state} side={side} arena="ground" />
        <Arena state={state} side={side} arena="space" />
      </div>
    </section>
  )
}

export default function GameScreen({ deck, opponentDeck, onExit, gameOptions }: Props) {
  const { status, errorDetail, gameState, legal, log, act, rematch } = useGame(deck, opponentDeck, gameOptions)

  if (status === 'loading') {
    return (
      <div data-testid="game-loading" className="text-ink-dim text-sm">
        Hydrating cards…
      </div>
    )
  }

  if (status === 'error' || !gameState) {
    return (
      <div data-testid="game-error" className="max-w-xl">
        <p className="text-red text-sm">Couldn't load the cards for this deck — check your connection and try again.</p>
        {errorDetail && (
          <p data-testid="game-error-detail" className="mt-2 text-ink-dim text-xs font-mono">
            {errorDetail}
          </p>
        )}
        <button data-testid="exit-btn" onClick={onExit} className="mt-4 px-5 py-2 text-sm border-2 border-line/60 rounded-xl text-ink-dim hover:text-ink">
          Back to decks
        </button>
      </div>
    )
  }

  const playableHandIndices = new Set(
    legal.filter(a => a.type === 'playCard').map(a => (a.type === 'playCard' ? a.handIndex : -1)),
  )
  const hand = gameState.players.player.hand

  return (
    <div data-testid="game-screen" className="max-w-5xl space-y-4">
      <div data-testid="game-board" className="space-y-4">
        <div className="flex items-center gap-6 text-sm text-ink-dim">
          <span>Round <span className="font-mono text-ink">{gameState.round}</span></span>
          <span>Phase <span className="font-mono text-ink">{gameState.phase}</span></span>
          <span>Initiative <span className="font-mono text-ink">{gameState.initiative === 'player' ? 'you' : 'opponent'}</span></span>
          <button data-testid="exit-btn" onClick={onExit} className="ml-auto px-3 py-1 text-xs border-2 border-line/60 rounded-lg text-ink-dim hover:text-ink">
            Exit
          </button>
        </div>

        <SidePanel state={gameState} side="opponent" />
        <SidePanel state={gameState} side="player" />

        {/* Your hand */}
        <section className="border-2 border-line/60 rounded-xl bg-surface p-4">
          <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Your hand</h3>
          <ul data-testid="player-hand" className="mt-2 flex flex-wrap gap-2">
            {hand.length === 0 && <li className="text-ink-faint text-xs italic">empty</li>}
            {hand.map((cardId, i) => {
              const card = gameState.cards[cardId]
              const playable = playableHandIndices.has(i)
              return (
                <li
                  key={`${cardId}-${i}`}
                  data-testid={`hand-card-${i}`}
                  data-playable={playable}
                  className={`border-2 rounded-xl px-3 py-2 text-sm ${playable ? 'border-accent text-ink shadow-[0_0_12px_rgba(79,195,247,0.3)]' : 'border-line/50 text-ink-faint'}`}
                >
                  <span className="font-mono text-xs">({card?.cost ?? '?'})</span> {card?.name ?? cardId}
                  {card?.type === 'unit' && (
                    <span className="font-mono text-xs text-ink-dim"> {card.power}/{card.hp}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Game over or action menu */}
        {gameState.winner !== null ? (
          <section data-testid="game-over-banner" className="border-2 border-amber rounded-xl bg-surface p-6 text-center shadow-[0_0_12px_rgba(245,166,35,0.3)]">
            <p className={`text-xl font-semibold ${gameState.winner === 'player' ? 'text-green' : 'text-red'}`}>
              {gameState.winner === 'player' ? 'You won' : 'You lost'}
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button data-testid="rematch-btn" onClick={rematch} className="px-5 py-2 text-sm border-2 border-green text-green rounded-xl shadow-[0_0_12px_rgba(34,197,94,0.3)] hover:bg-green/10">
                Rematch
              </button>
              <button onClick={onExit} className="px-5 py-2 text-sm border-2 border-line/60 text-ink-dim rounded-xl hover:text-ink">
                Back to decks
              </button>
            </div>
          </section>
        ) : (
          <section data-testid="action-menu" className="border-2 border-line/60 rounded-xl bg-surface p-4">
            <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">
              {legal.length > 0 ? 'Your move' : 'Opponent is thinking…'}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {legal.map((action, i) => (
                <button
                  key={i}
                  data-testid={`action-btn-${i}`}
                  onClick={() => act(action)}
                  className="px-4 py-1.5 text-sm border-2 border-accent text-accent rounded-xl shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10"
                >
                  {describeAction(gameState, 'player', action)}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Log */}
        <section className="border-2 border-line/60 rounded-xl bg-surface p-4">
          <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Log</h3>
          <ol data-testid="game-log" className="mt-2 space-y-0.5 text-xs font-mono text-ink-dim max-h-48 overflow-y-auto">
            {log.map((entry, i) => (
              <li key={i}>
                <span className={entry.by === 'player' ? 'text-accent' : 'text-amber'}>
                  {entry.by === 'player' ? 'you' : 'opp'}
                </span>{' '}
                {entry.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
