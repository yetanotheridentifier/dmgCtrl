import type { GameState, PlayerId } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Assembling an in-app bug report (#373).
 *
 * The valuable part is the **replay data**: since the AI draws from `state.rngSeed` (#366), an
 * `initialState` plus its move list re-resolves to the exact same game, so a report is a runnable
 * fixture rather than a description of one. Both #365 and the Grogu initiative hang showed the
 * visible symptom appearing several moves after the actual divergence, which a screenshot of the
 * board at the moment things looked wrong could never have caught.
 */

export interface ReportLogEntry {
  by: PlayerId
  text: string
}

export interface ReportInput {
  description: string
  buildTag: string
  isDev: boolean
  log: ReportLogEntry[]
  /** Null before a game has loaded, when there is nothing to replay. */
  initialState: GameState | null
  moves: { by: PlayerId; action: Action }[]
}

/** Explains the one thing a reader has to know to use the payload. */
export const REPLAY_NOTE =
  'The card database is omitted; it rebuilds from the deck lists via `buildCardDb`.'

const REPO = 'yetanotheridentifier/dmgCtrl'

/**
 * The prefilled "new issue" URL. Filing through GitHub's own page means the issue is authored by
 * whoever is signed in there, so the app never holds a token and attribution is right for free.
 * Only the title travels in the URL: the replay payload is ~17KB against a ~8KB URL ceiling, so it
 * goes via the clipboard instead.
 *
 * The body is deliberately left empty. A prefilled "paste the report here" line got pasted
 * *around* rather than replaced, so every issue opened with a stray instruction in it (#378). The
 * instruction belongs in the form, which is transient, not in the issue, which is permanent.
 */
export function issueUrl(title: string): string {
  const params = new URLSearchParams({ labels: 'bug', title: reportTitle(title) })
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}

/** Issue titles are prefixed so reports sort with the rest, without doubling a prefix the user typed. */
export function reportTitle(title: string): string {
  const trimmed = title.trim()
  return /^bug:/i.test(trimmed) ? trimmed : `bug: ${trimmed}`
}

function replayPayload(initialState: GameState | null, moves: ReportInput['moves']): string {
  if (!initialState) return ''
  // `cards` is ~12KB of a ~13KB state and is reconstructible, so it never goes in the report.
  return JSON.stringify({ initialState: { ...initialState, cards: undefined }, moves })
}

export function buildReportMarkdown({ description, buildTag, isDev, log, initialState, moves }: ReportInput): string {
  const payload = replayPayload(initialState, moves)
  const logLines = log.map(e => `${e.by === 'player' ? 'You' : 'Opp'}  ${e.text}`).join('\n')

  const sections = [
    '### What happened',
    description.trim() || '_No description given._',
    '',
    '### Environment',
    `- Build: \`${buildTag}\``,
    `- Environment: ${isDev ? 'dev' : 'prod'}`,
    `- Reported: ${new Date().toISOString()}`,
    '',
    '### Log',
    logLines ? '```\n' + logLines + '\n```' : '_Empty._',
    '',
  ]

  if (payload) {
    sections.push(
      '<details>',
      '<summary>Replay data (initial state + moves)</summary>',
      '',
      REPLAY_NOTE,
      '',
      '```json',
      payload,
      '```',
      '</details>',
    )
  } else {
    sections.push('_No game in progress, so there is no replay data._')
  }

  return sections.join('\n')
}
