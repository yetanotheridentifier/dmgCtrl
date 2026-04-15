# dmgCtrl — Project Handoff Document

## What This Is

A Progressive Web App (PWA) for tracking game state in tabletop games, starting with Star Wars: Unlimited (SWU). Built to run on iPhone in landscape mode, installed via Safari "Add to Home Screen". No App Store, no native build tools required.

**Live app:** https://yetanotheridentifier.github.io/dmgCtrl/
**GitHub repo:** https://github.com/yetanotheridentifier/dmgCtrl

---

## Tech Stack

- **React + TypeScript** via Vite
- **vite-plugin-pwa** for PWA manifest and service worker
- **Vitest + React Testing Library** for tests
- **GitHub Actions** for CI/CD — deploys to GitHub Pages on push to `main`
- **Cloudflare Worker** proxy at `https://swu-proxy.dmgctrl.workers.dev` to bypass CORS on swu-db.com API

---

## Architecture

### Screens
- `src/components/swuSetupScreen.tsx` — base selection screen (portrait, shown on launch)
- `src/components/swuGameScreen.tsx` — game/counter screen (landscape, shown during play)
- `src/App.tsx` — screen orchestrator, holds `selectedBase`, `useHyperspace` state

### Data
- `src/hooks/useBases.ts` — fetches and caches base card data
  - Fetches normal bases from **swu-db.com** via proxy (name, subtitle, HP, epicAction, aspects, frontArt)
  - Fetches all base variants from **swuapi.com** directly (no CORS issue)
  - Matches hyperspace art to normal bases via `name + set_code → uuid → hyperspaceArt`
  - Caches result in `localStorage` under key `swu_bases_cache` with 24hr TTL

### External APIs
| API | URL | Used for |
|-----|-----|----------|
| swu-db.com (via proxy) | `https://swu-proxy.dmgctrl.workers.dev/cards/search?q=type:base` | Base card data, epic actions, subtitles |
| swuapi.com | `https://api.swuapi.com/cards?type=Base&variant=all` | Hyperspace image URLs |

### localStorage Keys
| Key | Type | Purpose |
|-----|------|---------|
| `swu_bases_cache` | JSON | Cached base list with 24hr TTL |
| `pref_hyperspace` | `'true'`/`'false'` | User preference for hyperspace art |

---

## Base Type

```typescript
interface Base {
  set: string           // e.g. 'SOR'
  number: string        // e.g. '023'
  name: string          // e.g. 'Command Center'
  subtitle: string      // e.g. 'Death Star'
  hp: number            // e.g. 30
  frontArt: string      // swu-db.com CDN URL
  hyperspaceArt?: string // swuapi.com CDN URL, undefined if no hyperspace variant
  epicAction: string    // epic action text, empty string if none
  aspects: string[]     // e.g. ['Command']
  rarity: string        // 'Common' | 'Rare'
}
```

---

## Current Features

### Setup Screen (`swuSetupScreen.tsx`)
- Cascading selectors: Set → Aspect → Base (each disabled until upstream selected)
- Auto-selects when only one option available in a tier
- Base preview image shown after selection
- Hyperspace variant toggle (checkbox — see known issues) appears when base has hyperspace art
- Toggle preference persisted to localStorage
- Image fallback states:
  - Hyperspace fails, normal exists: show normal + "Hyperspace variant not found"
  - Normal fails, hyperspace exists: show hyperspace + "Only hyperspace image available"
  - Both fail: show "No base images found"

### Game Screen (`swuGameScreen.tsx`)
- Base card art as background (landscape orientation)
- Damage counter (+ / − buttons)
- Remaining health display
- Back button (top left, grey) returns to setup
- Image fallback: if card art fails, shows name, subtitle, epic action on starfield

---

## Known Issues / Open GitHub Issues

- **#[X] Toggle styling** — Hyperspace variant toggle renders as a native checkbox rather than a toggle switch. CSS-only toggle implementation planned. Logged as bug.

---

## Planned Features (Backlog)

### SWU game screen
- Epic action tracker (boolean flag, with exceptions for multi-use bases)
- Force token tracker (for specific bases)
- Round tracker

### Setup screen
- Format selector (Premier, Sealed, Draft, Twin Suns, Eternal, Chaos)
- Format drives which sets are legal for base selection
- Best of 1 / Best of 3 selector
- Game counter within a match

### Future games
- X-Wing (requires round tracker)
- Kill Team (requires round tracker)
- Warhammer 40K
- Mordheim / Old World

### Infrastructure
- Settings screen (consolidate localStorage preferences)
- CSS refactor to CSS custom properties for theming
- Per-game theming (X-Wing aesthetic vs SWU aesthetic)
- Deck lookup via swudb.com API (`/api/getDeckJson/{deckId}`)
- Melee.gg integration (API exists, partially public)

---

## Development Workflow

### Setup
```bash
git clone https://github.com/yetanotheridentifier/dmgCtrl.git
cd dmgCtrl
npm install --legacy-peer-deps
```

### Daily workflow
```bash
npm run dev          # dev server at localhost:5173/dmgCtrl/
npm test             # run test suite
git add .
git commit -m "description"
git push             # triggers GitHub Actions deploy to GitHub Pages
```

### Filtered test output
```powershell
npm test 2>&1 | Select-String "×|FAIL|Tests|Test Files"
```

### Branch strategy
- `main` — always deployable, auto-deploys via GitHub Actions
- `feature/description` — one branch per GitHub issue
- PR to merge, use `Closes #X` in PR description to auto-close issue

### Run specific test file
```powershell
npx vitest run src/test/swuSetupScreen.test.tsx
```

---

## Project Structure


dmgCtrl/
├── proxy/                          # Cloudflare Worker
│   ├── worker.js
│   └── wrangler.toml
├── public/
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── components/
│   │   ├── swuGameScreen.tsx
│   │   └── swuSetupScreen.tsx
│   ├── hooks/
│   │   └── useBases.ts
│   ├── test/
│   │   ├── App.test.tsx
│   │   ├── swuGameScreen.test.tsx
│   │   ├── swuSetupScreen.test.tsx
│   │   └── useBases.test.ts
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .github/
│   └── workflows/
│       └── deploy.yml
├── project_overview.md                       # This file
├── index.html
├── vite.config.ts
└── package.json

---

## Notes for AI Assistants

- `npm install` requires `--legacy-peer-deps` due to Vite 8 / vite-plugin-pwa version conflict
- The app is designed for **landscape iPhone** — portrait mode is functional but not the primary target
- swu-db.com blocks direct browser requests (CORS) — all calls go via the Cloudflare Worker proxy
- swuapi.com has CORS enabled and can be called directly from the browser
- Set codes: `SOR` (Spark of Rebellion), `SHD` (Shadows of the Galaxy), `TWI` (Twilight of the Republic), `JTL` (Jump to Lightspeed), `LOF` (Legends of the Force), `SEC` (Secrets of Power), `LAW` (A Lawless Time), `IBH` (Intro Battle: Hoth)
- The owner's handle is `yetanotheridentifier` — replace in any URLs
- Tests use `--legacy-peer-deps` in GitHub Actions install step
- `vmin` units used for game screen sizing to work across both orientations
- localStorage cache should be cleared (`localStorage.removeItem('swu_bases_cache')`) when testing data changes