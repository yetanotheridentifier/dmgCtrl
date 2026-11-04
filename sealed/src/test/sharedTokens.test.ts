import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The palette has one source, the PWA's tokens in src/styles/tokens.css, loaded by both apps.
// Sealed's Tailwind theme maps its class names onto those tokens in an `@theme inline reference`
// block, which writes no variables of its own; only the colours Sealed alone uses are declared as
// variables, in a plain `@theme`. These read the files as written: a token the CSS cannot find
// renders as nothing, which no rendered test can see in jsdom.

const SEALED = fileURLToPath(new URL('../../', import.meta.url))
const ROOT = join(SEALED, '..')
const read = (path: string) => readFileSync(path, 'utf8')

const TOKENS_CSS = read(join(ROOT, 'src/styles/tokens.css'))
const SEALED_CSS = read(join(SEALED, 'src/index.css'))

/** Every `--name:` declared in a block of CSS. */
const declared = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
/** Every `var(--name)` read in some text. */
const used = (text: string) => new Set([...text.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))

/** The body of each `@theme <options> { ... }` block, keyed by its options ('' for a plain one). */
function themeBlocks(css: string): Map<string, string> {
  const blocks = new Map<string, string>()
  for (const m of css.matchAll(/@theme([^{]*)\{([^}]*)\}/g)) blocks.set(m[1].trim(), (blocks.get(m[1].trim()) ?? '') + m[2])
  return blocks
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'test') sourceFiles(path, out) }
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path)
  }
  return out
}

const TOKENS = declared(TOKENS_CSS)
const themes = themeBlocks(SEALED_CSS)
const MAPPED = themes.get('inline reference') ?? ''
const EMITTED = declared(themes.get('') ?? '')

describe('the shared tokens', () => {
  it('Sealed loads the tokens file and not the PWA stylesheet', () => {
    expect(SEALED_CSS).toMatch(/@import\s+["']\.\.\/\.\.\/src\/styles\/tokens\.css["']/)
    expect(SEALED_CSS).not.toMatch(/src\/index\.css/)
  })

  it('defines every token the shared controls read', () => {
    const shared = join(ROOT, 'src/components/shared')
    const missing = readdirSync(shared)
      .flatMap(file => [...used(read(join(shared, file)))])
      .filter(name => !TOKENS.has(name))
    expect(missing).toEqual([])
  })

  it('holds Sealed\'s deep damage red beside the PWA\'s error colour', () => {
    expect(TOKENS_CSS).toMatch(/--color-damage:\s*#d42121/)
    expect(TOKENS_CSS).toMatch(/--color-error:\s*#ff6b6b/)
  })
})

describe('Sealed\'s Tailwind theme', () => {
  it('maps its colours onto tokens that exist', () => {
    const missing = [...used(MAPPED)].filter(name => !TOKENS.has(name))
    expect(missing).toEqual([])
    expect(MAPPED).toMatch(/--color-red:\s*var\(--color-damage\)/)
  })

  it('declares no variable the shared tokens also declare', () => {
    // A clash overrides one app's colour with the other's, whichever loads last: Sealed's
    // translucent `surface` against the controls' opaque one is the case this guards.
    expect([...EMITTED].filter(name => TOKENS.has(name))).toEqual([])
  })

  it('every variable Sealed reads is a shared token or one it declares', () => {
    const known = (name: string) => TOKENS.has(name) || EMITTED.has(name) || !name.startsWith('--color-')
    const missing = sourceFiles(join(SEALED, 'src'))
      .flatMap(path => [...used(read(path))].filter(name => !known(name)).map(name => `${path.slice(SEALED.length)} ${name}`))
    expect(missing).toEqual([])
  })
})
