# dmgCtrl — Architecture

## 1. Overview

**dmgCtrl** is a mobile-first progressive web app (PWA) designed to assist players of card games with game-state tracking. The current implementation targets **Star Wars Unlimited (SWU)**.

Core functionality:
- **Base selection** — filter and choose a base card by set, aspect, and card identity; or import a deck from swudb.com
- **Damage tracking** — increment and decrement a counter against the base's HP to track remaining health
- **Hyperspace art** — optionally display the premium "hyperspace" variant of a base card
- **Epic Action reminder** — display the base's special ability for reference during play
- **Offline capability** — PWA support means the app can be installed and used without a network connection

The app is served at `/dmgCtrl/` and is designed to be added to an iOS home screen for a native-like experience.

---

## 2. Goals and Non-Goals

### Goals

- **Mobile-first** — designed for a phone held in landscape orientation during play
- **Offline-ready** — PWA with service worker; usable without network after first load
- **Simplicity** — minimal UI, minimal dependencies, no backend
- **Fast startup** — data is cached in localStorage so repeat visits are instant
- **Accurate art** — show high-resolution card art where available, with graceful degradation

### Non-Goals

- Not a full rules engine — does not enforce card rules, abilities, or legality
- Not a deck builder or collection tracker
- Not multi-player or networked — all state is local
- Not multi-game at launch — architecture is intended to support future games, but the current data layer is SWU-specific

---

## 3. Technology Stack

| Concern | Technology |
|---|---|
| Framework | React 18 |
| Language | TypeScript |
| Build tool | Vite |
| PWA | vite-plugin-pwa (Workbox) |
| Styling | Inline styles + CSS custom properties (no CSS framework) |
| Data fetching | Custom React hooks (`useBases`) |
| Testing | Vitest + React Testing Library |
| CI/CD | GitHub Actions → GitHub Pages |
| Markdown | Custom Vite plugin (`marked`) — transforms `.md` to HTML string exports |

---

## 4. Application Architecture

### High-level structure

```
App
├── SwuSetupScreen        (container)
│   ├── useSwuSetup       (hook — filtering, auto-select, hyperspace preference)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   └── SwuSetupScreenView (view — renders mode selector, selects, image preview, start button)
│       └── ImagePreview  (pure view — renders art or error message from props)
├── SwuGameScreen         (container)
│   ├── useSwuGame        (hook — damage counter)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   └── SwuGameScreenView (view — renders counter, image, epic action)
└── SwuHelpScreen         (standalone screen — renders help.md content)

Each screen is wrapped in AppScreenLayout (shared layout component)
```

### Container / View pattern

Every screen is split into two files:

- **Container** (e.g. `swuGameScreen.tsx`) — owns all logic. Calls hooks, computes derived state, defines event handlers, and passes everything down as props.
- **View** (e.g. `swuGameScreenView.tsx`) — receives props and renders. Contains no business logic. Easy to test in isolation.

This pattern keeps views thin and ensures logic is tested via hook and container tests rather than integration tests that have to simulate complex UI interactions.

### Separation of concerns

| Layer | Responsibility | Location |
|---|---|---|
| Logic | State, derived values, side effects | `src/hooks/` |
| Utilities | Pure functions with no React dependency | `src/utils/` |
| Layout | Full-screen container, background, safe area | `src/components/layout/` |
| Presentation | Rendering from props | View components in `src/components/` |

---

## 5. Folder Structure

```
src/
  App.tsx                  Root component — screen routing and top-level state
  flags.ts                 Build-time feature flags (read from Vite env variables)
  main.tsx                 Entry point
  index.css                Global reset, CSS custom property palette, help screen styles
  markdown.d.ts            Type declaration for .md imports
  vite-env.d.ts            Vite environment types

  components/
    layout/
      AppScreenLayout.tsx  Shared full-screen layout wrapper (background, safe area)
    imagePreview.tsx        Pure view — renders card art or error message from props
    swuGameScreen.tsx       Game screen container
    swuGameScreenView.tsx   Game screen view
    swuHelpScreen.tsx       Help screen (renders help.md)
    swuSetupScreen.tsx      Setup screen container
    swuSetupScreenView.tsx  Setup screen view

  hooks/
    useBaseArt.ts           Ordered art fallback chain shared by setup and game screens
    useBases.ts             Fetches and caches the full list of Base cards
    useOrientation.ts       Detects portrait vs landscape via resize event
    useSwuGame.ts           Damage counter
    useSwuSetup.ts          Setup screen logic — filtering, auto-select, hyperspace preference

  utils/
    swudbUrl.ts             Pure URL utilities: normaliseSwudbUrl, isValidSwudbUrl

  test/
    setup.ts                Vitest setup (jest-dom matchers)
    App.test.tsx            End-to-end navigation and feature tests
    AppScreenLayout.test.tsx Layout component tests
    swuGameScreen.test.tsx  Game screen container tests
    swuHelpScreen.test.tsx  Help screen tests
    swuSetupScreen.test.tsx Setup screen container tests
    swudbUrl.test.ts        SWUDB URL utility tests
    useBaseArt.test.ts      Art fallback chain hook tests
    useBases.test.ts        Data layer hook tests
    useOrientation.test.ts  Orientation hook tests
    useSwuGame.test.ts      Counter hook tests
    useSwuSetup.test.ts     Setup logic hook tests

  assets/
    ...                     Static assets (icons, splash screens)

docs/
  architecture.md           This document
  help.md                   User guide (imported as HTML string via custom Vite plugin)
  project-overview.md       Product vision, planned features, known issues, AI assistant notes

public/
  ...                       PWA manifest, icons

.github/
  workflows/
    deploy.yml              CI/CD pipeline
```

---

## 6. State Management

The app uses **local React state only** — no global state library, no context.

State is owned at the appropriate level:

| State | Owner | How it flows |
|---|---|---|
| Current screen (`setup` / `game` / `help`) | `App` | Passed as callback props (`onStartGame`, `onBack`, `onHelp`) |
| Previous screen (for help back-navigation) | `App` | Stored so the help screen knows where to return |
| Selected base | `App` | Set on `onStartGame`, passed into `SwuGameScreen` |
| Last setup selection (`set`, `aspect`, `key`) | `App` | Saved on `handleConfirm`; passed as `initialSelection` prop to `SwuSetupScreen` so dropdowns are pre-populated on back navigation |
| Hyperspace preference | `App` / localStorage | Read at startup, toggled on setup screen, passed to game screen |
| Filter state (set, aspect, card) | `useSwuSetup` | Seeded from `initialSelection` on mount; local after that |
| Damage counter | `useSwuGame` | Local to game screen |
| Art fallback index, image load state | `useBaseArt` | Local to whichever screen called it; reset when base changes |
| Selection mode (`base-selector` / `swudb-import`) | `SwuSetupScreen` / localStorage | Persisted under `pref_selection_mode`; defaults to `base-selector` |
| SWUDB URL input, validation error, loaded deck name | `SwuSetupScreen` | Local; `swudbDeckName` remains `null` until a successful API load (wired in #74) |

### Example flow: Setup → Game

1. User selects set, aspect, and base in setup screen dropdowns
2. `useSwuSetup` manages the filter state and auto-selects when only one option remains
3. User clicks `>` — `handleSubmit` in `useSwuSetup` calls `onStartGame(selectedBase, effectiveHyperspace)`
4. `App` sets `screen = 'game'`, `selectedBase`, and `useHyperspace`
5. `SwuGameScreen` receives `base` and `useHyperspace`, `useBaseArt` builds the ordered fallback chain and manages image state

### Example flow: Damage tracking

1. User taps `+` or `−` buttons in the game screen view
2. View calls `onIncrement` / `onDecrement` prop (callbacks from container)
3. Container delegates to `useSwuGame` — `increment()` / `decrement()`
4. `count` state updates; view re-renders showing new value
5. `decrement` is clamped at 0 — HP cannot go negative

---

## 7. Data Layer

### `useBases` hook

The primary data hook. Fetches card data from two external APIs in parallel, merges them, caches the result in localStorage, and returns a `Base[]` array.

```typescript
export interface Base {
  set: string
  number: string              // zero-padded card number, e.g. '023'
  name: string
  subtitle: string
  hp: number
  frontArt: string | null     // standard art — swu-db.com CDN (1560×1120); null if not yet indexed
  frontArtLowRes: string | null  // standard art — swuapi.com CDN (400×286); null for SOR/SHD/TWI
  hyperspaceArtHiRes: string | null  // hi-res hyperspace art — swu-db.com CDN; null if unavailable
  hyperspaceArt: string | null       // reliable hyperspace art — swuapi.com CDN; null for SOR/SHD/TWI
  epicAction: string
  aspects: string[]
  rarity: string
}
```

### External APIs

| API | URL | Purpose |
|---|---|---|
| swu-db proxy | `swu-proxy.dmgctrl.workers.dev` | Card text, HP, aspects, rarity, standard art; source of truth for SOR/SHD/TWI |
| swuapi.com | `api.swuapi.com/cards?type=Base&variant=all&limit=100` | Primary source for active-format bases; provides low-res art URLs and hyperspace metadata |

**swuapi.com pagination:** The API returns 100 cards per page with cursor-based pagination. `useBases` follows `pagination.next_cursor` until it is `null`, accumulating all pages before merging.

**Source split by set:** swuapi.com no longer returns SOR, SHD, or TWI bases (those sets have rotated out of Premier format). Those sets are sourced exclusively from the swu-db proxy. Sets currently active in swuapi.com are treated as the primary source, with swu-db.com providing supplementary text and hi-res art.

**Hyperspace cards:** Identified in swuapi.com by `variant_type: 'Hyperspace'` and a non-null `variant_of_uuid`. They are merged onto their parent `Standard` card and **not** included as standalone entries in the returned `Base[]`.

### Static hyperspace map

For sets no longer in swuapi.com (SOR, SHD, TWI), hyperspace card numbers are derived from a static offset: all three sets use an offset from the standard card number. This was verified by probing `cdn.swu-db.com`.

The static map is embedded in `useBases.ts` and also duplicated in `scripts/inspect-base-data.mjs` for offline data inspection.

### Image URL resolution

Card art is served from two CDNs with different characteristics:

| CDN | Example URL | Resolution | Reliability |
|---|---|---|---|
| `cdn.swu-db.com` | `.../images/cards/SOR/023.png` | 1560×1120 | Only indexed for sets confirmed by swu-db.com; newer sets may 403 |
| `cdn.starwarsunlimited.com` | Returned directly by swuapi.com | 400×286 | Always reliable — URL is fetched from the API, not constructed |

The `Base` interface captures all four possible art sources: `frontArt`, `frontArtLowRes`, `hyperspaceArtHiRes`, `hyperspaceArt`. Any field may be `null` depending on the set's data availability.

#### Art fallback chain (`useBaseArt`)

Both the setup screen and the game screen call `useBaseArt(base, useHyperspace)`, which builds an ordered URL list (filtering out `null` entries) and maintains a fallback index. On each `onError` the index advances; `allFailed` only becomes `true` once all URLs are exhausted. The hook also tracks `imageLoaded`, `normalFailed`, and `hyperspaceFailed` so callers can derive UI state without re-inspecting the base object.

**Hyperspace preferred** (`useHyperspace = true`):
```
hyperspaceArtHiRes → hyperspaceArt → frontArt → frontArtLowRes → text/error
```

**Normal preferred** (`useHyperspace = false`):
```
frontArt → frontArtLowRes → hyperspaceArtHiRes → hyperspaceArt → text/error
```

The normal-preferred chain always falls back to hyperspace art before giving up — a base image is always better than a text fallback.

Some hi-res hyperspace images on cdn.swu-db.com are stored rotated 90°. `useBaseArt` calls `getRotationFromHyperspaceUrl` for each hyperspace hi-res entry and includes the correction as `rotationDeg` in the returned state. When `rotationDeg` is non-zero, both views switch to a portrait layout box sized to the card's inverse dimensions (`CARD_H/CARD_W` wide × `CARD_W/CARD_H` tall), centered with `translate(-50%,-50%) rotate(90deg)`, so the rotated visual output fills the landscape container without overflowing or changing aspect ratio. When `rotationDeg` is zero the image fills the container normally (`inset:0; width:100%; height:100%`). The lookup table in `src/constants/rotatedCards.ts` is the single place to add new entries as they are discovered.

The setup screen uses `normalFailed`, `hyperspaceFailed`, and `imageLoaded` to control the hyperspace toggle and contextual messages ("Only hyperspace image available", "Hyperspace variant not found"): both are suppressed until `imageLoaded` is true, preventing flicker during the loading window. The game screen uses `allFailed` to switch to the text fallback (base name, subtitle, epic action).

### Caching

Fetched and merged data is written to localStorage under key `swu_bases_cache` with a `lastChecked` timestamp. On subsequent loads, if the cache age is less than **7 days**, the fetch is skipped and the cached `Base[]` is returned directly.

If the cache is stale and a fresh fetch fails (network error), the stale cached data is served rather than showing an error — the app remains usable offline or on poor connections. An error is only shown if there is no cache at all and the fetch fails.

To force a fresh fetch during development: `localStorage.removeItem('swu_bases_cache')` in the browser console.

### Data inspection script

`scripts/inspect-base-data.mjs` is a standalone Node.js script that replicates the `useBases` merging logic and writes two files (gitignored):

- `docs/base-data-snapshot.json` — full merged `Base[]` array
- `docs/base-data-summary.json` — compact summary with art coverage stats per base

Run with `node scripts/inspect-base-data.mjs` to inspect the live merged dataset without running the app.

---

## 8. UI & Layout System

### AppScreenLayout

Every screen is wrapped in `AppScreenLayout`, which provides:
- Full-screen fixed container (fills viewport)
- Dark background gradient
- CSS safe area insets (for iOS notch/home indicator)
- Animated star field background

This ensures visual consistency across screens without each screen needing to re-implement the full-screen container.

### Styling approach

All styling is done with **inline styles** (React `style` prop). There is no CSS framework, no CSS Modules, and no styled-components. `index.css` contains a minimal global reset, the CSS custom property palette, and styles for the help screen's rendered HTML content.

**CSS custom properties** are defined in `:root` in `index.css` and referenced in inline styles via `var()` syntax (e.g. `color: 'var(--color-accent)'`). This gives a single source of truth for the colour palette while keeping styling co-located with component logic.

| Token | Value | Usage |
|---|---|---|
| `--color-accent` | `#4fc3f7` | Borders, headings, button highlights |
| `--color-accent-rgb` | `79, 195, 247` | `rgba()` shadow values using the accent colour |
| `--color-bg-dark` | `#000510` | Darkest background |
| `--color-bg-mid` | `#0d1b2a` | Gradient midpoint |
| `--color-bg-deep` | `#0a0e1a` | Primary background, select option backgrounds |
| `--color-text-primary` | `#ffffff` | Headings, counter, button text |
| `--color-text-body` | `#d0d0d8` | Help screen body text |
| `--color-text-muted` | `#a8a8b3` | Subtitles, secondary labels |
| `--color-text-disabled` | `#6b7280` | Disabled/placeholder states |
| `--color-ui-border` | `#6b7280` | Back/help button borders |
| `--color-ui-border-muted` | `#9ca3af` | Back/help button icon colour |
| `--color-ui-border-muted-rgb` | `156, 163, 175` | `rgba()` shadow values using the UI border colour |
| `--color-error` | `#ff6b6b` | Error messages, fallback states |

Pros: no class name conflicts, styling is co-located with component logic, easy to make props-driven style decisions, palette changes are a one-line edit in `index.css`.

Cons: no media query support in inline styles (workaround: derive breakpoint-based values in component logic), harder to override from outside.

### Responsive layout

The app is designed for **landscape orientation**. `useOrientation` is used in two places:

- **Setup screen** (`SwuSetupScreenView`) — renders a two-column layout in landscape (selectors left, card preview right) and a single-column scrollable layout in portrait.
- **Game screen** (`SwuGameScreen`) — renders the full-screen card layout in landscape and a rotation prompt in portrait.

---

## 9. Feature Architecture

### Base selection flow

1. `useBases` fetches and returns `Base[]` (cached after first load)
2. `useSwuSetup` receives `bases` and exposes derived lists:
   - `availableSets` — distinct set codes
   - `availableAspects` — aspects for the selected set
   - `filteredBases` — bases matching the selected set and aspect
3. Auto-select effects: if only one value is available for a dropdown, it is selected automatically
4. User selects a base → `selectedBase` is set
5. On submit, `effectiveHyperspace` is computed: `useHyperspace || (normalImageFailed && !!(selectedBase.hyperspaceArtHiRes || selectedBase.hyperspaceArt))`. If the standard art has already failed on the setup screen, the game screen automatically uses hyperspace art.

### Base input mode selector and SWUDB import

The setup screen supports two input modes, controlled by a `selectionMode` state (`'base-selector'` | `'swudb-import'`). The active mode is persisted to localStorage under `pref_selection_mode`.

**Base Selector mode** is the default. The three cascading dropdowns (set → aspect → base) are shown.

**Import from SWUDB mode** shows a URL input field and a two-row layout:
- Row 1 (always visible): URL text input + Load button
- Row 2 (visible only after a successful deck load): deck name + `>` submit button

The Load and `>` buttons are stacked vertically and share the same width so they align.

URL validation is handled by pure utility functions in `src/utils/swudbUrl.ts`:

```typescript
normaliseSwudbUrl(url)  // converts /deck/edit/<id> → /deck/<id>
isValidSwudbUrl(url)    // tests against /^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/
```

SWUDB deck IDs are alphanumeric and variable length (observed range: 9–13 characters). The URL is validated on every change; edit URLs are normalised before validation so they pass. An error message appears below the URL field for invalid input; focusing the field clears the error.

The SWUDB import mode is gated behind the `FEATURE_SWUDB_IMPORT` flag in `src/flags.ts`. The mode selector and import UI are only rendered when the flag is `true`. API integration (the actual deck load) is implemented in #74; the Load button is wired up as a stub in #73.

### Feature flags

Build-time feature flags live in `src/flags.ts`:

```typescript
export const FEATURE_SWUDB_IMPORT = import.meta.env.VITE_FEATURE_SWUDB_IMPORT === 'true'
```

Flags are read from Vite environment variables. Set `VITE_FEATURE_SWUDB_IMPORT=true` in `.env.local` to enable locally. `.env.local` is gitignored and not present in CI — all test files that render `SwuSetupScreen` must mock the flags module explicitly:

```typescript
vi.mock('../flags', () => ({ FEATURE_SWUDB_IMPORT: true }))
```

### Game screen

1. `useBaseArt(base, useHyperspace)` manages the ordered fallback chain and image load state
2. `useSwuGame()` manages the damage counter
3. `art.src`, `art.imageLoaded`, `art.allFailed`, `art.onLoad`, `art.onError` are passed as props to the view
4. View renders the counter, card image, and epic action text

### Adding a new feature

When adding a new feature:
1. Define the logic in a hook (`src/hooks/`) or pure utility (`src/utils/`)
2. Add the hook to the relevant container
3. Pass derived state and handlers as props to the view
4. Write hook/utility tests first, then container/view tests

Avoid putting logic directly in view components. If a view needs to compute something non-trivial, move that computation to the container or a hook.

---

## 10. Workflow & Development Process

### Branching strategy

| Branch type | Naming convention | Purpose |
|---|---|---|
| Feature | `feature/<short-description>` | New functionality |
| Bug fix | `bug/<short-description>` | Defect corrections |
| Refactor | `refactor/<short-description>` | Code improvements without behaviour change |
| Docs | `docs/<short-description>` | Documentation only |

All development happens on short-lived branches. `main` is the stable, deployable branch.

### PR workflow

1. Branch from `main`
2. Develop and commit on the feature branch
3. Open a pull request targeting `main`
4. All tests must pass (enforced by GitHub Actions)
5. Merge when ready

### Commit messages

Commit messages follow the pattern `<branch-name> <description>`, e.g.:

```
bug/hyperspace-art-resolution improves resolution of hyperspace art
```

---

## 11. CI/CD

### Pipeline: `.github/workflows/deploy.yml`

Triggered on push to `main` and on pull requests targeting `main`. Three sequential jobs:

```
test → build → deploy
```

| Job | Steps |
|---|---|
| `test` | `npm ci` → `npm test` (Vitest) |
| `build` | `npm ci` → `tsc` → `vite build` |
| `deploy` | Upload `dist/` to GitHub Pages |

### Deployment target

The app is hosted on **GitHub Pages** at `/dmgCtrl/`. The `base` config in `vite.config.ts` is set to `/dmgCtrl/` to ensure all asset paths are correct.

### What triggers the pipeline

- Push to `main` — runs all three jobs and deploys on success
- PRs targeting `main` — runs `test` and `build` jobs; deploy is skipped

---

## 12. Testing Strategy

### Philosophy

Tests verify behaviour, not implementation. Hook tests cover logic in isolation; container/screen tests cover integration between hooks and views; `App.test.tsx` covers top-level navigation and feature flows.

### Test types

| Type | Location | Tools |
|---|---|---|
| Hook unit tests | `src/test/use*.test.ts` | Vitest, `renderHook`, `act` |
| Utility unit tests | `src/test/*.test.ts` | Vitest |
| Component tests | `src/test/*.test.tsx` | Vitest, React Testing Library, `userEvent` |
| End-to-end (within app) | `src/test/App.test.tsx` | Same |

### Mocking approach

- External APIs are mocked with `vi.stubGlobal('fetch', ...)` — no real network calls in tests
- localStorage is mocked with `vi.stubGlobal('localStorage', ...)` to test caching paths
- Feature flags are mocked with `vi.mock('../flags', () => ({ ... }))` — `.env.local` is not present in CI
- All mocks are torn down with `vi.unstubAllGlobals()` in `afterEach`

### Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Always use `npm test`. The `npx vitest run` form has a cache glitch that causes spurious first-run failures.

### Coverage expectations

- All hooks must have unit tests
- All utility functions must have unit tests
- All screens must have container/view tests covering primary interaction flows
- New features must include tests before merging

---

## 13. Performance Considerations

### Mobile-first

The app targets mobile browsers and PWA installation. Key performance constraints:

- Minimal bundle size — no large dependencies
- Fast startup — localStorage cache means data is available immediately on repeat visits
- No unnecessary network requests — the 7-day cache prevents redundant API calls on repeat visits

### Avoiding unnecessary re-renders

- State is co-located with the component that needs it — no prop drilling through many layers
- Derived values (e.g. `filteredBases`) are computed in hooks with `useMemo`; `useBaseArt` entries are memoised so the array only rebuilds when `base` or `useHyperspace` changes

### Image loading

- Card art is lazy-loaded via the browser's default `<img>` behaviour
- The fallback chain in `useBaseArt` means a broken image never leaves a blank gap — it advances to the next URL or shows text
- The setup screen image preview is displayed before game start, giving the browser time to cache the URL before the game screen renders it

---

## 14. Future Improvements

### Architecture

- **Global state** — if the app grows to more screens or games, consider React Context or a lightweight state manager (e.g. Zustand) to avoid prop drilling
- **Multi-game support** — the `Base` type and `useBases` hook are SWU-specific; a game-agnostic data abstraction layer would be needed for additional games

### Data

- **Backend / sync** — currently all data is fetched from third-party APIs; a first-party backend could provide more reliable image hosting, faster response, and support for user-specific data (favourites, history)
- **Art coverage** — swu-db.com CDN does not yet host hyperspace art for all sets; `hyperspaceArtHiRes` will become more reliable as their index grows

### UI

- **Theming system** — CSS custom properties are now in place; per-game themes (e.g. X-Wing aesthetic) could be implemented by swapping the `:root` values at runtime
- **Animations** — damage counter and screen transitions could benefit from subtle animations

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Base** | A card type in Star Wars Unlimited representing a location that acts as the player's "health bar". Each base has an HP value (typically 24–35). |
| **Epic Action** | A special ability on some base cards that can be triggered once per game. Displayed on the game screen for reference. |
| **Hyperspace** | A premium variant of a card with alternate artwork. In this app, selecting "hyperspace" shows the alternate art version of the base. |
| **Standard art** | The default card artwork. `frontArt` is the swu-db.com hi-res version (1560×1120); `frontArtLowRes` is the swuapi.com version (400×286). |
| **hyperspaceArt** | The reliable low-res hyperspace image URL from swuapi.com (`cdn.starwarsunlimited.com`, 400×286). `null` for SOR/SHD/TWI (no longer in swuapi.com). |
| **hyperspaceArtHiRes** | A constructed hi-res hyperspace image URL from swu-db.com (`cdn.swu-db.com`, 1560×1120). Derived from card number for active sets, or from the static offset map for SOR/SHD/TWI. May 403 for a small number of unindexed cards. |
| **Static hyperspace map** | A hardcoded mapping of SOR, SHD, and TWI base card numbers to their hyperspace card numbers (offset). Used because those sets no longer appear in swuapi.com. |
| **Fallback chain** | The ordered list of image URLs managed by `useBaseArt`. Hyperspace preferred: `[hyperspaceArtHiRes, hyperspaceArt, frontArt, frontArtLowRes]`. Normal preferred: `[frontArt, frontArtLowRes, hyperspaceArtHiRes, hyperspaceArt]`. The next URL is tried on `onError`; text fallback shown only when all are exhausted. |
| **Container** | A React component that owns logic — calls hooks, computes derived state, and passes everything to a View component as props. |
| **View** | A React component that only renders — receives all data and callbacks as props, contains no business logic. |
| **AppScreenLayout** | The shared full-screen layout wrapper that provides background, safe area padding, and star field for every screen. |
| **CSS custom properties** | Variables defined in `:root` in `index.css` (e.g. `--color-accent`) and referenced in inline styles via `var()`. Single source of truth for the colour palette. |
| **swu-db proxy** | A Cloudflare Worker at `swu-proxy.dmgctrl.workers.dev` that proxies requests to swu-db.com to avoid CORS issues. |
| **PWA** | Progressive Web App — a web app that can be installed on a device and used offline. |
| **SOR** | Spark of Rebellion — the first set of Star Wars Unlimited cards. |
| **LAW** | Legends of the Alliance — a later set of Star Wars Unlimited cards. |
| **SWUDB** | swudb.com — a third-party Star Wars Unlimited database site. Deck lists can be imported via a URL of the form `https://swudb.com/deck/<id>`. |
| **Feature flag** | A build-time boolean in `src/flags.ts` read from a Vite env variable. Used to gate in-development features so they can be merged to `main` without being visible in production. |