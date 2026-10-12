import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Words from other card games stay out of the source and the docs.
 *
 * `glossary.md` ends with a "Words to avoid" table. A statement written in another game's vocabulary
 * cannot be checked against the rules, and comments here carry measured facts, so the wrong word is
 * a defect rather than a style point. Without a check the vocabulary drifts back one comment at a
 * time.
 *
 * **The glossary is the list.** This reads the table's first column instead of restating it, so a
 * row added there is enforced here, or fails until someone says why it cannot be.
 *
 * **Only the words that are wrong everywhere are checked.** The others keep a correct second sense,
 * and a check that needs a long list of exceptions teaches people to add exceptions. Each is named
 * in `NOT_CHECKED` with its reason, so leaving one out is a recorded decision.
 *
 * The scan is plain text, not a parse: it reads comments, strings and identifiers alike. A whole-word
 * match does not see inside `camelCase`, so `bankMove` and `castable` are not its business.
 */

const GLOSSARY = 'docs/glossary.md'
const SELF = 'src/test/docsAvoidedTerms.test.ts'

/** Words in the table that are not checked, and why. Keys are the table's own words. */
const NOT_CHECKED: Record<string, string> = {
  deploy: 'leaders are deployed, and so is the app: only "deploy a unit" is wrong, which no pattern can tell apart',
  bank: 'the harness banks shard results to disk, in several modules and their tests',
  kill: 'a process is killed, and test helpers are named for it',
  creature: 'a trait printed on cards',
  spell: '"spells out" is ordinary English and the only use there is',
}

/** Ordinary English uses of a checked word. Short on purpose: reword before adding to it. */
const ALLOWED_PHRASES = [
  'this is a cast rather than', // a type cast
  'a single cast keeps', // a type cast
  'still burning CPU',
  'burned an afternoon',
]

/** The first word of each alternative in the table's first column: "tapped / untapped" gives two. */
function avoidedWords(glossary: string): string[] {
  const table = glossary.slice(glossary.indexOf('## Words to avoid'))
  const cells = [...table.matchAll(/^\| ([^|]+) \|/gm)].map(m => m[1].trim())
  return cells
    .filter(cell => cell !== 'Instead of' && !/^-+$/.test(cell))
    .flatMap(cell => cell.split(/[/,]/))
    .map(alternative => alternative.trim().split(' ')[0].toLowerCase())
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'fixtures') sourceFiles(path, out)
    } else if (/\.(ts|tsx|md)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

describe('words the glossary says to avoid', () => {
  const root = process.cwd()
  const words = avoidedWords(readFileSync(join(root, GLOSSARY), 'utf8'))
  const checked = words.filter(w => !(w in NOT_CHECKED))
  const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'docs'))]
    .map(path => relative(root, path))
    .filter(path => path !== GLOSSARY && path !== SELF)

  it('finds the table and the files, so a silent pass is impossible', () => {
    expect(words).toContain('cast')
    expect(words).toContain('untapped')
    expect(checked.length, 'some word must be checked').toBeGreaterThan(3)
    expect(files.length).toBeGreaterThan(300)
  })

  it('gives a reason only for words the table still holds', () => {
    const stale = Object.keys(NOT_CHECKED).filter(w => !words.includes(w))
    expect(stale, `in NOT_CHECKED but no longer in ${GLOSSARY}: ${stale.join(', ')}`).toEqual([])
  })

  it('appear nowhere in src or docs', () => {
    // An all-capitals match is SQL (`CAST(x AS REAL)`), not prose.
    const pattern = new RegExp(`\\b(${checked.join('|')})(s|ed|ing|t)?\\b`, 'gi')
    const found: string[] = []
    for (const file of files) {
      let text = readFileSync(join(root, file), 'utf8')
      for (const phrase of ALLOWED_PHRASES) text = text.split(phrase).join('')
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(pattern)) {
          if (m[0] !== m[0].toUpperCase()) found.push(`${file}:${i + 1} "${m[0]}"`)
        }
      })
    }
    expect(found, `use the game's term (see ${GLOSSARY}):\n${found.join('\n')}`).toEqual([])
  })
})
