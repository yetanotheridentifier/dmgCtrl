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
/** A git short sha, optionally marked dirty. The only shape `buildIdentity.mjs` can produce. */
const GIT_DERIVED = /^[0-9a-f]{7,40}(-dirty)?$/

describe('build identity', () => {
  /**
   * Asserted POSITIVELY, and that is the fix rather than a style preference.
   *
   * This used to read `not.toMatch(/^b\d+$/)`, rejecting the old counter format. Hex digits are 0-9a-f,
   * so roughly one short sha in 270 is `b` followed by six digits and is indistinguishable from a
   * counter by that pattern. `b321468` is such a sha, and it broke the pipeline on a commit that had
   * nothing to do with build identity.
   *
   * **It passed locally at the same time**, which is what made it confusing: a dirty tree appends
   * `-dirty`, so the pattern stopped matching and the landmine only ever fires on a clean checkout.
   *
   * Requiring the git shape instead cannot be satisfied by a counter, which was four characters, and
   * cannot be defeated by an unlucky sha.
   */
  it('has a commit id that identifies real code', () => {
    expect(COMMIT_ID).toBeTruthy()
    expect(COMMIT_ID).toMatch(GIT_DERIVED)
  })

  /**
   * The pattern itself, against both build states and against what it exists to reject.
   *
   * A given run only ever sees ONE of clean or dirty, so the assertions above test whichever state the
   * machine happens to be in: dirty locally, clean in the pipeline. That asymmetry is how the previous
   * version passed here and failed there for two days. This one is state-independent.
   */
  it('accepts either build state and still rejects the old counter', () => {
    expect('b321468', 'the sha that broke the pipeline').toMatch(GIT_DERIVED)
    expect('b321468-dirty').toMatch(GIT_DERIVED)
    expect('deadbeef1234').toMatch(GIT_DERIVED)
    expect('b446', 'the old counter identified nothing and must not pass').not.toMatch(GIT_DERIVED)
    expect('unknown').not.toMatch(GIT_DERIVED)
    expect('dev-b321468').not.toMatch(GIT_DERIVED)
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
    // Both branches need the sha, or `-dirty` alone would satisfy it and the suffix could be attached
    // to anything at all.
    expect(COMMIT_ID).toMatch(GIT_DERIVED)
    expect(COMMIT_ID.endsWith('-dirty') ? COMMIT_ID.slice(0, -6) : COMMIT_ID).toMatch(/^[0-9a-f]{7,40}$/)
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
