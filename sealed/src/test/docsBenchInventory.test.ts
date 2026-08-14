import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The bench module inventory in `ai-benchmark.md` must name every module.
 *
 * **A partial inventory is worse than none.** It reads as complete, so someone using it to find where
 * something lives concludes the thing does not exist. That is not hypothetical: the list was found at
 * 10 of 18 modules, and by the time it was fixed it had drifted to 19 of 25, because every new module
 * is one more chance to forget.
 *
 * Hand-maintaining it was the actual complaint. This makes it mechanical: add a module without
 * documenting it and the suite says so, naming the file. The alternative considered was dropping the
 * list in favour of describing the groupings, which would have been cheaper to maintain and useless
 * for the one job the list does, which is answering "where does X live" for a named X.
 *
 * Deliberately checks presence only. Whether a description is any good is a review question, and a
 * test that tried to judge it would fail on wording.
 */

const DOC = 'docs/ai-benchmark.md'
const DIR = 'src/bench'

describe('the bench module inventory', () => {
  const doc = readFileSync(join(process.cwd(), DOC), 'utf8')
  const modules = readdirSync(join(process.cwd(), DIR))
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace(/\.ts$/, ''))

  it('finds the modules and the doc, so a silent pass is impossible', () => {
    expect(modules.length, 'src/bench should hold modules').toBeGreaterThan(15)
    expect(doc).toContain('## The pieces')
  })

  it('names every module in src/bench', () => {
    const missing = modules.filter(m => !doc.includes(`bench/${m}.ts`))
    expect(missing, `undocumented in ${DOC}: ${missing.join(', ')}`).toEqual([])
  })

  /** And the reverse: a module named in the doc that no longer exists sends a reader hunting for a
   *  file that was deleted or renamed. */
  it('names nothing that no longer exists', () => {
    const named = [...doc.matchAll(/`bench\/([a-zA-Z]+)\.ts`/g)].map(m => m[1])
    const ghosts = [...new Set(named)].filter(n => !modules.includes(n))
    expect(ghosts, `named in ${DOC} but absent from ${DIR}: ${ghosts.join(', ')}`).toEqual([])
  })

  /** `main.ts` is the only impure module, and the list ends with it so the boundary is obvious. */
  it('ends with the impure entry point', () => {
    const listed = [...doc.matchAll(/^- `bench\/([a-zA-Z]+)\.ts`/gm)].map(m => m[1])
    expect(listed[listed.length - 1]).toBe('main')
  })
})
