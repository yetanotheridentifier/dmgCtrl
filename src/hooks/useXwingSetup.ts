import { useState } from 'react'

const STORAGE_KEY = 'xwing_setup'

export type XwingRuleset = 'XWA' | 'Legacy' | 'AMG' | '2.0' | '1.0'
export type XwingMatchType = 'Casual' | 'Tournament'
export type XwingListImport = 'None' | 'YASB' | 'XWA'
export type XwingScenario = 'None' | 'Assault at the Satellite Array' | 'Chance Engagement' | 'Salvage Mission' | 'Scramble the Transmissions' | 'Ancient Knowledge'

export const XWING_NAMED_SCENARIOS: XwingScenario[] = [
  'Assault at the Satellite Array',
  'Chance Engagement',
  'Salvage Mission',
  'Scramble the Transmissions',
  'Ancient Knowledge',
]

interface PersistedSetup {
  ruleset: XwingRuleset
  matchType: XwingMatchType
  rounds: number
  playerListImport: XwingListImport
}

const DEFAULTS: PersistedSetup = {
  ruleset: 'XWA',
  matchType: 'Casual',
  rounds: 6,
  playerListImport: 'None',
}

function migrateListImport(value: unknown): XwingListImport {
  if (value === 'Text') return 'None'
  if (value === 'None' || value === 'YASB' || value === 'XWA') return value as XwingListImport
  return DEFAULTS.playerListImport
}

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const rawImport = parsed.playerListImport ?? parsed.listImport
    return {
      ruleset: (parsed.ruleset as XwingRuleset) ?? DEFAULTS.ruleset,
      matchType: (parsed.matchType as XwingMatchType) ?? DEFAULTS.matchType,
      rounds: (parsed.rounds as number) ?? DEFAULTS.rounds,
      playerListImport: migrateListImport(rawImport),
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

export interface XwingSetupValue {
  ruleset: XwingRuleset
  setRuleset: (v: XwingRuleset) => void
  matchType: XwingMatchType
  setMatchType: (v: XwingMatchType) => void
  rounds: number
  setRounds: (v: number) => void
  playerListImport: XwingListImport
  setPlayerListImport: (v: XwingListImport) => void
  opponentListImport: XwingListImport
  setOpponentListImport: (v: XwingListImport) => void
  playerDeficit: number
  setPlayerDeficit: (v: number) => void
  opponentDeficit: number
  setOpponentDeficit: (v: number) => void
  scenario: XwingScenario
  setScenario: (v: XwingScenario) => void
}

export function useXwingSetup(): XwingSetupValue {
  const [persisted, setPersisted] = useState<PersistedSetup>(load)
  const [opponentListImport, setOpponentListImportState] = useState<XwingListImport>('None')
  const [playerDeficit, setPlayerDeficitState] = useState(0)
  const [opponentDeficit, setOpponentDeficitState] = useState(0)
  const [scenario, setScenario] = useState<XwingScenario>('None')

  function update(patch: Partial<PersistedSetup>) {
    setPersisted(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  return {
    ruleset: persisted.ruleset,
    setRuleset: (v) => update({ ruleset: v }),
    matchType: persisted.matchType,
    setMatchType: (v) => update({ matchType: v }),
    rounds: persisted.rounds,
    setRounds: (v) => update({ rounds: v }),
    playerListImport: persisted.playerListImport,
    setPlayerListImport: (v) => update({ playerListImport: v }),
    opponentListImport,
    setOpponentListImport: setOpponentListImportState,
    playerDeficit,
    setPlayerDeficit: (v) => setPlayerDeficitState(clampDeficit(v)),
    opponentDeficit,
    setOpponentDeficit: (v) => setOpponentDeficitState(clampDeficit(v)),
    scenario,
    setScenario,
  }
}
