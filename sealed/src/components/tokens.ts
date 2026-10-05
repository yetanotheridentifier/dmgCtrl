import { CARD_WIDTH_PX, longEdge } from './cardSizing'

export type TokenOrientation = 'portrait' | 'landscape'

/** Centre of a token, as a percentage of the card slot (both axes). */
export interface TokenPos {
  left: number
  top: number
}

/**
 * Token size in px. Damage is a rounded square wide enough for two digits; every other kind is a
 * pill the same height and twice the width, room for an abbreviated label and its value
 * ("Adv. 2", "+2/+2").
 */
export const TOKEN_W = 32
export const TOKEN_H = 26
export const PILL_W = TOKEN_W * 2

/**
 * The kinds of token a unit shows. `mod` is the buff pill (the name keeps its long-standing
 * `board-unit-mod-*` test id); `debuff` carries the negative half of the same off-card delta.
 */
export type TokenKind = 'damage' | 'mod' | 'debuff' | 'shield' | 'experience' | 'advantage' | 'weakness'

/**
 * The one spec for every on-card token: fill, text colour and width. Colours are theme tokens in
 * `index.css` (`--color-token-*`), so a palette change happens there and nowhere else. Text is dark
 * on the light fills (Advantage, buff, Experience) and white on the rest, for legibility over art.
 */
export const TOKEN_SPEC: Record<TokenKind, { background: string; ink: string; width: number }> = {
  damage: { background: 'var(--color-red)', ink: 'var(--color-ink)', width: TOKEN_W },
  mod: { background: 'var(--color-token-buff)', ink: 'var(--color-token-ink-dark)', width: PILL_W },
  debuff: { background: 'var(--color-token-debuff)', ink: 'var(--color-ink)', width: PILL_W },
  shield: { background: 'var(--color-token-shield)', ink: 'var(--color-ink)', width: PILL_W },
  experience: { background: 'var(--color-token-experience)', ink: 'var(--color-token-ink-dark)', width: PILL_W },
  advantage: { background: 'var(--color-token-advantage)', ink: 'var(--color-token-ink-dark)', width: PILL_W },
  weakness: { background: 'var(--color-token-weakness)', ink: 'var(--color-ink)', width: PILL_W },
}

/** The most kinds of token a unit can show at once: one of each `TokenKind`. */
export const MAX_TOKENS = 7

/** Space between neighbouring tokens, px. */
const GAP = 2

/**
 * Centres for `n` tokens in a line of `length` px, `step` px apart where they fit, centred on
 * `centre` but pulled inward so the outermost stay on the card. Past what fits at `step`, the step
 * shrinks so they still do (only seven tokens at once, portrait, overlap at all).
 */
function line(n: number, length: number, size: number, step: number, centre: number): number[] {
  if (n <= 0) return []
  const s = n > 1 ? Math.min(step, (length - size) / (n - 1)) : 0
  const half = ((n - 1) * s) / 2
  const c = Math.min(Math.max(centre, half + size / 2), length - half - size / 2)
  return Array.from({ length: n }, (_, i) => c - half + i * s)
}

const pct = (px: number, of: number) => (px / of) * 100

/**
 * Where 1 to 7 tokens sit on a unit card, representing physical tokens over the art, so the
 * cost and name (top), ability text (bottom) and power/HP (corners) stay visible where possible.
 *
 * - **Ready (portrait):** one centred column (two pills are wider than the card), centred on the
 *   art and growing downward and upward as tokens are added.
 * - **Exhausted (landscape):** two pills to a row, centred, with an odd last token centred on its
 *   own row.
 */
export function tokenLayout(count: number, orientation: TokenOrientation): TokenPos[] {
  const n = Math.max(0, Math.min(count, MAX_TOKENS))
  const short = CARD_WIDTH_PX, long = longEdge(CARD_WIDTH_PX)
  const step = TOKEN_H + GAP
  if (orientation === 'portrait') {
    const ART = 0.41 * long
    return line(n, long, TOKEN_H, step, ART).map(y => ({ left: 50, top: pct(y, long) }))
  }
  const rows = Math.ceil(n / 2)
  const ys = line(rows, short, TOKEN_H, step, short / 2)
  const colOffset = pct((PILL_W + 2 * GAP) / 2, long)
  const out: TokenPos[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 2)
    const alone = i === n - 1 && n % 2 === 1
    const left = alone ? 50 : i % 2 === 0 ? 50 - colOffset : 50 + colOffset
    out.push({ left, top: pct(ys[row], short) })
  }
  return out
}
