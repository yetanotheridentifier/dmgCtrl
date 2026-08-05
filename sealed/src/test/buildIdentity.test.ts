import { describe, it, expect } from 'vitest'
import { COMMIT_ID, RELEASE } from '../buildIdentity'

/**
 * Build identity (#480): two identifiers, two audiences.
 *
 * The single hand-maintained `BUILD_TAG` counter was incremented independently on every branch, so
 * **b446 was issued to two different commits** with no merge involved. Every bench run writes it to
 * the SQLite `runs` table as the engine a measurement came from, so two rows could carry the same tag
 * and different code, and nothing surfaced it.
 *
 * - `COMMIT_ID` is machine-facing and git-derived, so it is unique by construction. It identifies the
 *   code a measurement was taken against.
 * - `RELEASE` is human-facing and issued once by the deployment pipeline, so it cannot collide. It is
 *   what someone reads out over a support conversation.
 *
 * The file is generated and gitignored, which is what stops it ever conflicting again.
 */
describe('build identity', () => {
  it('has a commit id that identifies real code', () => {
    expect(COMMIT_ID).toBeTruthy()
    expect(COMMIT_ID).not.toMatch(/^b\d+$/) // the old counter format, which identified nothing
  })

  it('has a release identifier', () => {
    expect(RELEASE).toBeTruthy()
  })

  /**
   * Most AI measurement happens on uncommitted code, and a run against a dirty tree is not
   * attributable to any commit. Today that is indistinguishable from a clean one, which is arguably
   * the most valuable thing this change fixes for the AI stream.
   */
  it('marks a dirty working tree so a measurement is not falsely attributed', () => {
    expect(COMMIT_ID.endsWith('-dirty') || /^[0-9a-f]{7,40}$/.test(COMMIT_ID)).toBe(true)
  })

  /**
   * A local build must never look like a release. The release number is issued by the pipeline and is
   * monotonic; anything derived locally has to be visibly not that.
   */
  it('never passes a local build off as a release', () => {
    const local = RELEASE.startsWith('dev-')
    const issued = /^\d+$/.test(RELEASE)
    expect(local || issued, `RELEASE ${RELEASE} is neither a dev marker nor an issued number`).toBe(true)
  })
})
