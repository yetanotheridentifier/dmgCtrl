import { useEffect, useState } from 'react'

const STORAGE_KEY = 'xwing_setup'

export type XwingRuleset = 'XWA' | 'Legacy' | 'AMG' | '2.0' | '1.0'
export type XwingMatchType = 'Casual' | 'Tournament'
// A player's list for the next game: No list (manual deficit) or a saved list by id.
export type XwingPlayerChoice = { kind: 'none' } | { kind: 'list'; listId: string }

export type XwingScenario = 'None' | 'Assault at the Satellite Array' | 'Chance Engagement' | 'Salvage Mission' | 'Scramble the Transmissions' | 'Ancient Knowledge'

export const XWING_NAMED_SCENARIOS: XwingScenario[] = [
  'Assault at the Satellite Array',
  'Chance Engagement',
  'Salvage Mission',
  'Scramble the Transmissions',
  'Ancient Knowledge',
]

export const XWING_SCENARIOS: XwingScenario[] = ['None', ...XWING_NAMED_SCENARIOS]

// The dice button: one of the named scenarios at random, never None.
export const rollScenario = (): XwingScenario =>
  XWING_NAMED_SCENARIOS[Math.floor(Math.random() * XWING_NAMED_SCENARIOS.length)]

interface PersistedSetup {
  ruleset: XwingRuleset
  matchType: XwingMatchType
  rounds: number
  // Your list rarely changes between games, so it is pre-filled; the opponent's is only offered.
  playerListId?: string
  lastOpponentListId?: string
}

const DEFAULTS: PersistedSetup = {
  ruleset: 'XWA',
  matchType: 'Casual',
  rounds: 6,
}

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      ruleset: (parsed.ruleset as XwingRuleset) ?? DEFAULTS.ruleset,
      matchType: (parsed.matchType as XwingMatchType) ?? DEFAULTS.matchType,
      rounds: (parsed.rounds as number) ?? DEFAULTS.rounds,
      playerListId: typeof parsed.playerListId === 'string' ? parsed.playerListId : undefined,
      lastOpponentListId: typeof parsed.lastOpponentListId === 'string' ? parsed.lastOpponentListId : undefined,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(setup: PersistedSetup): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
}

function clampDeficit(v: number): number {
  return Math.max(0, Math.min(4, v))
}

/**
 * The choices for the next game are kept for the session, not for good: a reload into a new
 * version keeps them, and a fresh launch starts them afresh. Your list is also remembered for
 * good, above, so it is here only to keep a choice of No list.
 */
const SESSION_KEY = 'xwing_setup_session'

interface SessionChoices {
  playerDeficit: number
  opponentDeficit: number
  scenario: XwingScenario
  playerChoice: XwingPlayerChoice | null | undefined
  opponentChoice: XwingPlayerChoice | null
}

function isChoice(v: unknown): v is XwingPlayerChoice {
  const c = v as Partial<{ kind: unknown; listId: unknown }> | null
  return !!c && typeof c === 'object' && (c.kind === 'none' || (c.kind === 'list' && typeof c.listId === 'string'))
}

function loadSession(): SessionChoices {
  let parsed: Record<string, unknown> = {}
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Unreadable: start afresh, as a new session would.
  }
  const deficit = (v: unknown) => typeof v === 'number' ? clampDeficit(v) : 0
  return {
    playerDeficit: deficit(parsed.playerDeficit),
    opponentDeficit: deficit(parsed.opponentDeficit),
    scenario: XWING_SCENARIOS.includes(parsed.scenario as XwingScenario) ? parsed.scenario as XwingScenario : 'None',
    playerChoice: isChoice(parsed.playerChoice) ? parsed.playerChoice : undefined,
    opponentChoice: isChoice(parsed.opponentChoice) ? parsed.opponentChoice : null,
  }
}

/** Leaving X-Wing for game select starts its setup afresh, within the session too. */
export function clearXwingSetupSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage refused: nothing was kept to clear.
  }
}

function saveSession(choices: SessionChoices): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(choices))
  } catch {
    // Storage refused: the choices still hold until the page reloads.
  }
}

export interface XwingSetupValue {
  ruleset: XwingRuleset
  setRuleset: (v: XwingRuleset) => void
  matchType: XwingMatchType
  setMatchType: (v: XwingMatchType) => void
  rounds: number
  setRounds: (v: number) => void
  playerChoice: XwingPlayerChoice | null
  setPlayerChoice: (v: XwingPlayerChoice | null) => void
  opponentChoice: XwingPlayerChoice | null
  setOpponentChoice: (v: XwingPlayerChoice | null) => void
  lastOpponentListId: string | null
  playerDeficit: number
  setPlayerDeficit: (v: number) => void
  opponentDeficit: number
  setOpponentDeficit: (v: number) => void
  scenario: XwingScenario
  setScenario: (v: XwingScenario) => void
}

export function useXwingSetup(): XwingSetupValue {
  const [persisted, setPersisted] = useState<PersistedSetup>(load)
  const [session] = useState(loadSession)
  const [playerDeficit, setPlayerDeficitState] = useState(session.playerDeficit)
  const [opponentDeficit, setOpponentDeficitState] = useState(session.opponentDeficit)
  const [scenario, setScenario] = useState<XwingScenario>(session.scenario)
  const [playerChoice, setPlayerChoiceState] = useState<XwingPlayerChoice | null>(() => {
    if (session.playerChoice !== undefined) return session.playerChoice
    const id = persisted.playerListId
    return id ? { kind: 'list', listId: id } : null
  })
  const [opponentChoice, setOpponentChoiceState] = useState<XwingPlayerChoice | null>(session.opponentChoice)

  useEffect(() => {
    saveSession({ playerDeficit, opponentDeficit, scenario, playerChoice, opponentChoice })
  }, [playerDeficit, opponentDeficit, scenario, playerChoice, opponentChoice])

  function update(patch: Partial<PersistedSetup>) {
    setPersisted(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  // No list is a last resort (no ships to tap in the game), so only a saved list is remembered.
  const setPlayerChoice = (v: XwingPlayerChoice | null) => {
    setPlayerChoiceState(v)
    update({ playerListId: v?.kind === 'list' ? v.listId : undefined })
  }

  const setOpponentChoice = (v: XwingPlayerChoice | null) => {
    setOpponentChoiceState(v)
    if (v?.kind === 'list') update({ lastOpponentListId: v.listId })
  }

  return {
    ruleset: persisted.ruleset,
    setRuleset: (v) => update({ ruleset: v }),
    matchType: persisted.matchType,
    setMatchType: (v) => update({ matchType: v }),
    rounds: persisted.rounds,
    setRounds: (v) => update({ rounds: v }),
    playerChoice,
    setPlayerChoice,
    opponentChoice,
    setOpponentChoice,
    lastOpponentListId: persisted.lastOpponentListId ?? null,
    playerDeficit,
    setPlayerDeficit: (v) => setPlayerDeficitState(clampDeficit(v)),
    opponentDeficit,
    setOpponentDeficit: (v) => setOpponentDeficitState(clampDeficit(v)),
    scenario,
    setScenario,
  }
}
