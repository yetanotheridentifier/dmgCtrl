import { describe, it, expect } from 'vitest'
import { outcomeBanner } from '../components/outcome'

describe('outcomeBanner', () => {
  it('reports a player win', () => {
    expect(outcomeBanner('player').title).toBe('You won')
  })

  it('reports a player loss', () => {
    expect(outcomeBanner('opponent').title).toBe('You lost')
  })

  it('reports a draw when both bases fall together (#323)', () => {
    expect(outcomeBanner('draw').title).toBe('Draw')
  })

  it('gives each outcome a distinct tone class', () => {
    const tones = new Set([
      outcomeBanner('player').tone,
      outcomeBanner('opponent').tone,
      outcomeBanner('draw').tone,
    ])
    expect(tones.size).toBe(3)
  })
})
