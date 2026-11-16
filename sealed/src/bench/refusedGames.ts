import { execFileSync } from 'node:child_process'
import { loadStore, type CollectedStore, type ReplayCheck, type StoredGame } from './collectedStore'
import { readSnapshot, writeSnapshot, type ArchivedGame, type SnapshotFile } from './recordArchive'

/**
 * Collected games that no longer replay.
 *
 * A collected game replays only on rules that agree with the build that played it, so a rules fix
 * leaves some games refused by `--rows`. The store keeps each game's latest replay check beside it
 * (`ReplayCheck`, written by `--rows --collected`): the build it was checked on and the refusal's
 * reason, or none. A game refused on the build running `--rows` is left out without being replayed
 * again; a check made from a tree with uncommitted changes belongs to no build and is not kept.
 *
 * **A refused game is deleted for good**, by `--refused --delete`, after a backup of the whole store
 * that is read back to hold every game about to go. Only a game refused on the build doing the
 * deleting goes: one refused on another build may replay now, and is checked again first.
 *
 * **The exception is a flagged game**: one refused on the build that played it or the build before
 * (`HEAD` and its first parent). There the rules have not moved, so the refusal points at an engine
 * defect. It is kept, and said loudly on every run, until someone has looked at it and names it with
 * `--looked-at`. A flag stays raised however far the builds move on, and drops only when the game
 * replays.
 */

/** Whether a game's build is one of these. Commit ids are compared on the shorter one, since a short id is a prefix. */
export function playedOn(commitId: string | null, builds: string[]): boolean {
  if (!commitId) return false
  return builds.some(build => build !== '' && (build.startsWith(commitId) || commitId.startsWith(build)))
}

/**
 * The build that checks and the one before: `HEAD` and its first parent, which on `main` is the
 * merge before. Empty when git cannot say, so nothing is flagged rather than everything.
 */
export function recentBuilds(): string[] {
  try {
    return execFileSync('git', ['rev-list', '--first-parent', '-n', '2', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(line => line !== '')
  } catch {
    return []
  }
}

/** The games already known refused on this build: `--rows` leaves these out without replaying them. */
export function knownRefused(games: StoredGame[], build: string): Set<string> {
  return new Set(games.filter(g => g.check?.checkedOn === build && g.check.refusal !== null).map(g => g.gameKey))
}

/** What a `--rows` run keeps for each game it replayed on `build`, flagging as the module says. */
export function nextChecks(games: StoredGame[], results: { gameKey: string; refusal: string | null }[], build: string, recent: string[]): (ReplayCheck & { gameKey: string })[] {
  const held = new Map(games.map(g => [g.gameKey, g]))
  return results.map(({ gameKey, refusal }) => {
    const game = held.get(gameKey)
    const flagged = refusal !== null && (game?.check?.flagged === true || playedOn(game?.commitId ?? null, recent))
    return { gameKey, checkedOn: build, refusal, flagged }
  })
}

/** The build that played a game, as the listing names it. */
const buildName = (game: StoredGame): string => {
  if (game.release !== null && game.commitId !== null) return `${game.release} (${game.commitId})`
  return game.release ?? game.commitId ?? 'unknown'
}

/** A reason with its numbers set aside, so refusals of one kind count together. */
const reasonKind = (reason: string): string => reason.replace(/\d+/g, '…')

function counted(names: string[]): { name: string; games: number }[] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, games]) => ({ name, games })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
}

export interface RefusedReport {
  /** Every game whose latest check refused it, on whichever build. */
  refused: StoredGame[]
  byReason: { reason: string; games: number }[]
  /** By the build that played them. */
  byBuild: { build: string; games: number }[]
  /** The keys `--delete` removes: refused on this build, and not flagged unless named as looked at. */
  deletable: string[]
  /** Kept: a sign of an engine defect, not yet looked at. */
  flagged: StoredGame[]
  /** Refused on another build, so kept until `--rows --collected` checks them on this one. */
  otherBuild: StoredGame[]
}

/** The refused games in the store, by reason and by build, and which of them a delete on `build` removes. */
export function refusedReport(games: StoredGame[], build: string, lookedAt: Set<string> = new Set()): RefusedReport {
  const refused = games.filter(g => g.check !== null && g.check.refusal !== null)
  const onThisBuild = refused.filter(g => g.check!.checkedOn === build)
  const flagged = onThisBuild.filter(g => g.check!.flagged && !lookedAt.has(g.gameKey))
  return {
    refused,
    byReason: counted(refused.map(g => reasonKind(g.check!.refusal!))).map(({ name, games: n }) => ({ reason: name, games: n })),
    byBuild: counted(refused.map(buildName)).map(({ name, games: n }) => ({ build: name, games: n })),
    deletable: onThisBuild.filter(g => !flagged.includes(g)).map(g => g.gameKey),
    flagged,
    otherBuild: refused.filter(g => g.check!.checkedOn !== build),
  }
}

/**
 * Delete these games from the store, in this order, so a game is never gone without a copy:
 *
 * 1. the whole store is written to a snapshot in `backupDir`;
 * 2. the snapshot is read back, and must hold every game about to go;
 * 3. only then are they removed, and the store's keys read again to see that they are gone.
 *
 * Throws, having removed nothing, when 1 or 2 fails. Nothing to delete writes nothing.
 */
export function deleteRefused(
  store: CollectedStore,
  keys: string[],
  backupDir: string,
  day: string,
  readBack: (path: string) => ArchivedGame[] = readSnapshot,
): { snapshot?: SnapshotFile; deleted: string[] } {
  if (keys.length === 0) return { deleted: [] }
  const snapshot = writeSnapshot(loadStore(store), backupDir, day)
  const saved = new Set(readBack(snapshot.path).map(game => game.gameKey))
  const unsaved = keys.filter(k => !saved.has(k))
  if (unsaved.length > 0) throw new Error(`the snapshot ${snapshot.path} does not hold ${unsaved.length} of the games to delete, first ${unsaved[0]}: nothing was deleted`)
  store.remove(keys)
  const held = new Set(store.keys())
  const left = keys.filter(k => held.has(k))
  if (left.length > 0) throw new Error(`the store still holds ${left.length} of the games just deleted, first ${left[0]}`)
  return { snapshot, deleted: keys }
}
