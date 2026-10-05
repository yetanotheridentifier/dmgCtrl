import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tokenLayout, TOKEN_H, TOKEN_W, PILL_W, MAX_TOKENS, TOKEN_SPEC, TOKEN_STAT_INK } from '../components/tokens'
import type { TokenOrientation } from '../components/tokens'
import { CARD_WIDTH_PX, longEdge } from '../components/cardSizing'

/** The card slot a token sits on, in px. */
function slot(orientation: TokenOrientation): { w: number; h: number } {
  const short = CARD_WIDTH_PX, long = longEdge(CARD_WIDTH_PX)
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short }
}

/** Each token's rectangle in px, every token at the pill (widest) size. */
function rects(n: number, orientation: TokenOrientation) {
  const { w, h } = slot(orientation)
  return tokenLayout(n, orientation).map(p => {
    const cx = (p.left / 100) * w, cy = (p.top / 100) * h
    return { x0: cx - PILL_W / 2, x1: cx + PILL_W / 2, y0: cy - TOKEN_H / 2, y1: cy + TOKEN_H / 2 }
  })
}

describe('token pills: one spec', () => {
  it('makes a pill the token height and double the token width', () => {
    expect(PILL_W).toBe(TOKEN_W * 2)
    for (const kind of ['mod', 'debuff', 'shield', 'experience', 'advantage', 'weakness'] as const) {
      expect(TOKEN_SPEC[kind].width).toBe(PILL_W)
    }
  })

  it('colours each kind from its own theme token, and no two kinds alike', () => {
    const colours = Object.values(TOKEN_SPEC).map(s => s.background)
    expect(new Set(colours).size).toBe(colours.length)
    expect(TOKEN_SPEC.experience.background).toBe('var(--color-token-experience)')
    expect(TOKEN_SPEC.advantage.background).toBe('var(--color-token-advantage)')
    expect(TOKEN_SPEC.shield.background).toBe('var(--color-token-shield)')
    expect(TOKEN_SPEC.mod.background).toBe('var(--color-token-buff)')
    expect(TOKEN_SPEC.debuff.background).toBe('var(--color-token-debuff)')
    expect(TOKEN_SPEC.weakness.background).toBe('var(--color-token-weakness)')
    expect(TOKEN_SPEC.damage.background).toBe('var(--color-red)')
  })
})

describe('token pills: every colour resolves', () => {
  it('declares in index.css every custom property the token spec reads', () => {
    // jsdom resolves no CSS, so an undeclared var() would pass the style tests and paint nothing.
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const used = [...Object.values(TOKEN_SPEC).flatMap(s => [s.background, s.ink]), ...Object.values(TOKEN_STAT_INK)]
    const names = new Set(used.flatMap(v => [...v.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1])))
    expect(names.size).toBeGreaterThan(5)
    for (const name of names) expect(css, name).toMatch(new RegExp(`^\\s*${name}\\s*:`, 'm'))
  })
})

describe('tokenLayout: physical-token placement on unit cards', () => {
  it('places a single token over the middle of the art when ready (portrait)', () => {
    const pos = tokenLayout(1, 'portrait')
    expect(pos).toHaveLength(1)
    expect(pos[0].left).toBe(50) // horizontally centred
    expect(pos[0].top).toBeGreaterThan(25) // below the top iconography
    expect(pos[0].top).toBeLessThan(60) // above the bottom-third ability text
  })

  it('stacks pills in one centred column when ready (portrait), since two pills are wider than the card', () => {
    expect(PILL_W * 2).toBeGreaterThan(slot('portrait').w)
    for (let n = 1; n <= MAX_TOKENS; n++) {
      const pos = tokenLayout(n, 'portrait')
      expect(pos.every(p => p.left === 50)).toBe(true)
      for (let i = 1; i < n; i++) expect(pos[i].top).toBeGreaterThan(pos[i - 1].top)
    }
  })

  it('lays pills two to a row, centred, when exhausted (landscape)', () => {
    const four = tokenLayout(4, 'landscape')
    expect(new Set(four.map(p => p.top)).size).toBe(2)
    expect(new Set(four.map(p => p.left)).size).toBe(2)
    expect((four[0].left + four[1].left) / 2).toBeCloseTo(50)
    // An odd one out sits centred on its own row.
    expect(tokenLayout(3, 'landscape')[2].left).toBe(50)
    expect(tokenLayout(1, 'landscape')[0]).toEqual({ left: 50, top: 50 })
  })

  it('keeps every pill on the card, and never overlaps two of up to six', () => {
    for (const o of ['portrait', 'landscape'] as const) {
      const { w, h } = slot(o)
      for (let n = 1; n <= MAX_TOKENS; n++) {
        const rs = rects(n, o)
        for (const r of rs) {
          expect(r.x0).toBeGreaterThanOrEqual(-0.01)
          expect(r.x1).toBeLessThanOrEqual(w + 0.01)
          expect(r.y0).toBeGreaterThanOrEqual(-0.01)
          expect(r.y1).toBeLessThanOrEqual(h + 0.01)
        }
        if (n > 6) continue
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = rs[i], b = rs[j]
            const overlap = a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01
            expect(overlap, `${o} ${n}: tokens ${i} and ${j}`).toBe(false)
          }
        }
      }
    }
  })

  it('never returns more than the seven kinds a unit can carry', () => {
    // damage, a buff, a debuff, Shield, Experience, Advantage, Weakness
    expect(MAX_TOKENS).toBe(7)
    expect(tokenLayout(8, 'portrait')).toHaveLength(7)
    expect(tokenLayout(8, 'landscape')).toHaveLength(7)
  })
})
