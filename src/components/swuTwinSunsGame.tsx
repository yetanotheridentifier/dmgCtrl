import { useEffect, useRef, useState } from 'react'
import { Base } from '../hooks/useBases'
import { useGameHistory } from '../hooks/useGameHistory'
import { useWakeLock } from '../hooks/useWakeLock'
import { useUserSettings } from '../hooks/useUserSettings'
import { TWIN_SUNS_SEATS } from '../hooks/useSwuSetup'
import { LandscapeScreen } from './layout/fixedOrientation'
import SwuTwinSunsGameView from './swuTwinSunsGameView'
import type { Seat, TwinSunsPlayer } from './swuTwinSunsGameView'
import {
  addDamage, claim, finish, nextRound, placings, removeDamage, resolveDestroyed, setEpicUsed, startState, yourResult,
} from '../utils/twinSuns'
import type { Counter, TwinSunsState } from '../utils/twinSuns'
import { onDamageDealt, onDamageHealed, onEpicActionUsed, onGameEnd, onGameStart, onRoundIncremented, onUndoUsed } from '../services/analytics'

interface Props {
  // Your base, top left.
  base: Base
  // The opponents' bases by seat (TWIN_SUNS_SEATS order), null for an empty seat.
  seats: (Base | null)[]
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

const PLAY_MODE = 'twin-suns'
const COUNTER_NAME: Record<Counter, string> = { initiative: 'Initiative', plan: 'Plan', blast: 'Blast' }
const COUNTER_COLOUR: Record<Counter, string> = { initiative: 'var(--color-accent)', plan: '#5b8cff', blast: '#ef5350' }
const RESULT_WORD = { won: 'won', lost: 'lost', drawn: 'drawn' } as const

const secondsSince = (start: number) => Math.round((Date.now() - start) / 1000)

const seatName =(where: string) => (where.charAt(0).toUpperCase() + where.slice(1)) as Seat

// Twin Suns on one device: 3 or 4 bases round the table, each its player's damage control, with the
// counters shared between them. The game is the pure model in utils/twinSuns.ts; this holds it, the
// log that undoes it, and what is being chosen.
function SwuTwinSunsGame({ base, seats, onBack, onHelp, onSettings }: Props) {
  const { useHyperspace } = useUserSettings()
  useWakeLock(true)

  const players: TwinSunsPlayer[] = [
    { base, seat: 'Top left' },
    ...TWIN_SUNS_SEATS.flatMap((where, i) => (seats[i] ? [{ base: seats[i] as Base, seat: seatName(where) }] : [])),
  ]
  const hp = players.map(p => p.base.hp)
  const name = (i: number) => players[i].base.name

  const [state, setState] = useState<TwinSunsState>(() => startState(players.length))
  const log = useGameHistory<TwinSunsState>()
  // A counter waiting for the base that claimed it, and End game waiting for its confirmation.
  const [picking, setPicking] = useState<Counter | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const startedAt = useRef(0)

  const yourKey = `${base.set}-${base.number}`
  const startGame = () => {
    startedAt.current = Date.now()
    void onGameStart(yourKey, base.set, useHyperspace, PLAY_MODE)
  }
  const endGame = () => {
    void onGameEnd(yourKey, base.set, useHyperspace, secondsSince(startedAt.current), PLAY_MODE, PLAY_MODE)
  }
  // The game starts as the screen opens: the design has no Start step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startGame() }, [])

  const apply = (next: TwinSunsState, type: string, message: string, color: string) => {
    log.add({ type, message, color, snapshot: state })
    setState(next)
    setPicking(null)
    setConfirmEnd(false)
  }

  const keyOf = (i: number) => `${players[i].base.set}-${players[i].base.number}`

  const onIncrement = (i: number, n: number) => {
    const amount = Math.min(n, hp[i] - state.damage[i])
    if (amount <= 0 || state.out[i]) return
    apply(addDamage(state, hp, i, amount), 'hit', `${name(i)}: ${amount} damage`, 'var(--color-error)')
    void onDamageDealt(keyOf(i), players[i].base.set, amount)
  }

  const onDecrement = (i: number, n: number) => {
    const amount = Math.min(n, state.damage[i])
    if (amount <= 0 || state.out[i]) return
    apply(removeDamage(state, i, amount), 'heal', `${name(i)}: ${amount} damage removed`, 'var(--color-success)')
    void onDamageHealed(keyOf(i), players[i].base.set, amount)
  }

  // A tap on a card: the base that destroyed one, the one claiming a counter, or 1 damage.
  const onTap = (i: number) => {
    if (state.out[i] || state.finished) return
    if (state.pending.length > 0) {
      const destroyed = name(state.pending[0])
      apply(resolveDestroyed(state, i), 'destroyed', `${destroyed} destroyed by ${name(i)}, who heals 5`, 'var(--color-success)')
      return
    }
    if (picking) {
      const extra = picking === 'blast' ? ', 1 damage to every other base' : ''
      apply(claim(state, hp, picking, i), picking, `${COUNTER_NAME[picking]}: ${name(i)}${extra}`, COUNTER_COLOUR[picking])
      return
    }
    onIncrement(i, 1)
  }

  const onEpic = (i: number, used: boolean) => {
    apply(setEpicUsed(state, i, used), 'epic', `${name(i)}: epic action ${used ? 'used' : 'taken back'}`, 'var(--color-epic)')
    if (used) void onEpicActionUsed(keyOf(i), players[i].base.set)
  }

  const onRound = () => {
    apply(nextRound(state), 'round', `Round ${state.round + 1}`, '#ffffff')
    void onRoundIncremented(yourKey, base.set, state.round + 1)
  }

  const onNoOne = () => apply(resolveDestroyed(state, null), 'destroyed', `${name(state.pending[0])} destroyed`, 'var(--color-error)')

  const onFinish = () => {
    const result = yourResult(state, hp)
    apply(finish(state), 'game-result', `Game ${RESULT_WORD[result]}`, '#ffffff')
    endGame()
  }

  const onUndo = () => {
    const entry = log.undoLast()
    if (!entry) return
    setState(entry.snapshot)
    setPicking(null)
    setConfirmEnd(false)
    void onUndoUsed(yourKey, base.set, entry.type)
  }

  const onRematch = () => {
    setState(startState(players.length))
    log.reset()
    setPicking(null)
    setConfirmEnd(false)
    startGame()
  }

  const leave = () => {
    if (!state.finished) endGame()
    onBack()
  }

  return (
    <LandscapeScreen>
      <SwuTwinSunsGameView
        players={players}
        state={state}
        placings={state.finished ? placings(state, hp) : null}
        picking={picking}
        confirmEnd={confirmEnd}
        onTap={onTap}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
        onEpic={onEpic}
        onPick={c => { setPicking(c); setConfirmEnd(false) }}
        onCancelPick={() => setPicking(null)}
        onRound={onRound}
        onOpenEnd={() => { setConfirmEnd(true); setPicking(null) }}
        onKeepPlaying={() => setConfirmEnd(false)}
        onFinish={onFinish}
        onNoOne={onNoOne}
        onUndoDamage={onUndo}
        onRematch={onRematch}
        onNewSetup={onBack}
        onBack={leave}
        onHelp={onHelp}
        onSettings={onSettings}
        logEntries={log.entries}
        onUndo={onUndo}
        showLog={showLog}
        onLogToggle={() => setShowLog(v => !v)}
      />
    </LandscapeScreen>
  )
}

export default SwuTwinSunsGame
