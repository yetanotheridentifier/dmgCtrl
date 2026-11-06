import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every text field in Sealed, checked from the source.
 *
 * iOS zooms the page in when a field whose text is under 16px takes focus, and stays zoomed, cutting
 * off the screen's edges. Every input and textarea therefore takes the one shared field class, whose
 * text is 16px, and sets no text size of its own. The page's pinch zoom is left alone.
 */

const DIR = 'src/components'
const FIELD_SOURCE = join(DIR, 'field.ts')

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [])

const fields = sources(DIR).flatMap(file =>
  [...readFileSync(file, 'utf8').matchAll(/<(input|textarea)\b[\s\S]*?\/>/g)].map(([tag]) => ({ file, tag })))

/** A text size smaller than Tailwind's `text-base`, or any inline font size. */
const SMALL_TEXT = /\btext-(xs|sm|\[\d*\.?\d+(px|rem|em)\])|fontSize/

describe('text fields', () => {
  it('share one field class whose text is 16px', () => {
    const field = readFileSync(FIELD_SOURCE, 'utf8')
    expect(field).toMatch(/export const FIELD_CLASS = '[^']*\btext-base\b/)
    expect(field).not.toMatch(SMALL_TEXT)
  })

  it('all take the field class', () => {
    expect(fields.length).toBeGreaterThanOrEqual(4)
    expect(fields.filter(({ tag }) => !tag.includes('FIELD_CLASS')).map(({ file }) => file)).toEqual([])
  })

  it('never set a text size under 16px', () => {
    expect(fields.filter(({ tag }) => SMALL_TEXT.test(tag)).map(({ file, tag }) => `${file}: ${tag.match(SMALL_TEXT)?.[0]}`)).toEqual([])
  })
})
