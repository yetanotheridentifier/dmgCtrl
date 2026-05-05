# dmgCtrl — Architecture

## 1. Overview

**dmgCtrl** is a mobile-first progressive web app (PWA) designed to assist players of card games with game-state tracking. The current implementation targets **Star Wars Unlimited (SWU)**.

Core functionality:
- **Loading screen** — splash screen (icon + "LOADING") with a **1-second minimum display time** while base data is fetched; transitions automatically to the setup screen
- **Base selection** — filter and choose a base card by set, aspect, and card identity; or import a deck from swudb.com
- **Damage tracking** — increment and decrement a counter against the base's HP to track remaining health
- **Hyperspace art** — optionally display the premium "hyperspace" variant of a base card
- **Epic Action tracking** — an epic action button marks the base's once-per-game ability as used; a gold token overlay appears over the card's epic action text area to indicate the spent state
- **Force token tracking** — a Force icon button is available on every base; on Force bases it is immediately active, on other bases a single enable tap unlocks it for games where the Force is gained via a card or leader ability
- **Screen wake lock** — prevents the device screen from sleeping while on the game screen
- **Drag-to-scrub** — long-pressing and dragging upward on a `+` or `−` button increments or decrements by multiple damage points in one gesture; a floating number indicator shows the pending value; capped to remaining capacity (`+` is capped at remaining HP, `−` at current damage); gated by `enableLongPress` in user settings (on by default)
- **Game action log** — a scrollable overlay panel listing all game events (damage, epic action, Force token, round changes); accessible via a log button in the bottom-right of the game screen; the most recent undoable entry shows an Undo button that restores the previous game state; gated by `enableActionLog` in user settings (on by default)
- **Round tracker** — a button in the bottom-left corner of the game screen that increments the round counter and adds a round entry to the action log; starts at Round 1 on game start; only visible when the action log is enabled
- **User settings** — persistent preferences (hyperspace art, force token, epic actions, wake lock, action log, favourites) accessible via the ⚙ button on the setup and game screens
- **Favourites** — star toggle on the setup screen marks a base as a favourite; a dedicated Favourites input mode shows a sorted dropdown of saved bases for quick reselection; saved bases can be managed in the Settings screen; gated by the Enable Favourites setting
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
├── SwuLoadingScreen      (standalone screen — icon + LOADING text; 1-second minimum display time; auto-transitions when data is ready and timer has elapsed)
├── SwuSetupScreen        (container)
│   ├── useSwuSetup       (hook — filtering, auto-select)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   ├── useFavourites     (hook — favourites list, add/remove)
│   └── SwuSetupScreenView (view — renders mode selector, selects, image preview, start button; ⚙ button opens settings)
│       └── ImagePreview  (pure view — renders art or error message from props)
├── SwuGameScreen         (container)
│   ├── useSwuGame        (hook — damage counter, epic action, Force token enabled and active state)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   ├── useWakeLock       (hook — prevents screen sleep during gameplay via Screen Wake Lock API)
│   ├── useGameLog        (hook — ordered list of game log entries with add/undo/reset; each entry records event type, message, colour, and previous game state snapshot)
│   ├── GameLogOverlay    (view — scrollable log panel; auto-scrolls to latest entry; undo button on last undoable entry)
│   └── SwuGameScreenView (view — renders counter, image, epic action token, Force token; ⚙ button always visible; calls useDragScrubber directly for drag-to-scrub gesture state)
├── SwuHelpScreen         (standalone screen — renders help.md content)
└── SwuSettingsScreen     (container)
    ├── useUserSettings   (hook — persistent user preferences)
    ├── useFavourites     (hook — favourites list, remove/clear operations)
    └── SwuSettingsScreenView (view — toggle list; landscape: two-column layout separating general and favourites settings; calls useOrientation directly for font sizing)

Each screen is wrapped in AppScreenLayout (shared layout component)
```

### Container / View pattern

Every screen is split into two files:

- **Container** (e.g. `swuGameScreen.tsx`) — owns all logic. Calls hooks, computes derived state, defines event handlers, and passes everything down as props.
- **View** (e.g. `swuGameScreenView.tsx`) — receives props and renders. Contains no business logic. Easy to test in isolation.

This pattern keeps views thin and ensures logic is tested via hook and container tests rather than integration tests that have to simulate complex UI interactions.

The exception is `SwuSettingsScreenView`, which calls `useOrientation()` directly to handle iOS Dynamic Type font scaling — the same approach used by `SwuHelpScreen`.

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
  App.tsx                  Root component — screen routing and top-level state; calls useBases() to drive loading screen transition
  main.tsx                 Entry point
  index.css                Global reset, CSS custom property palette, help screen styles
  markdown.d.ts            Type declaration for .md imports
  vite-env.d.ts            Vite environment types

  components/
    layout/
      AppScreenLayout.tsx  Shared full-screen layout wrapper (background, safe area)
    icons.tsx               Reusable SVG icon components (BackIcon, ForwardIcon, HelpIcon, CogIcon, LogIcon)
    imagePreview.tsx        Pure view — renders card art or error message from props
    GameLogOverlay.tsx      Game screen action log overlay — scrollable entry list; auto-scrolls to bottom; undo button on last undoable entry; round entries styled with blue gradient
    swuGameScreen.tsx       Game screen container
    swuGameScreenView.tsx   Game screen view (⚙ button always visible)
    swuHelpScreen.tsx       Help screen (renders help.md; title row: back button + icon + "Help" h1)
    swuLoadingScreen.tsx    Loading screen (icon + "LOADING" text; 1-second minimum display; calls onReady when both timer and data loading are done)
    swuSetupScreen.tsx      Setup screen container
    swuSetupScreenView.tsx  Setup screen view (title row: icon + "dmgCtrl" h1 + ⚙ button + help button)
    swuSettingsScreen.tsx   Settings screen container
    swuSettingsScreenView.tsx Settings screen view (toggle list; calls useOrientation directly for iOS font sizing)

  hooks/
    useBaseArt.ts           Ordered art fallback chain shared by setup and game screens
    useDragScrubber.ts      Drag-to-scrub gesture — tracks pointer events on `+`/`−` counter buttons; exposes `dragIndicator` (type, value, clientX, clientY) and pointer event handlers; 15px dead zone before scrub activates; 14px per step; caps drag value at `Math.min(max, 20)`; suppresses synthetic click after drag; disabled when `enableLongPress` is false or the reachable cap is < 2
    useBases.ts             Fetches and caches the full list of Base cards
    useFavourites.ts        Favourites list — add/remove/clear operations with deduplication on key; sorted by set then card number ascending; persists FavouriteBase[] to localStorage under key `favourites`; UI gated by enableFavourites in useUserSettings (tickets #123, #124 complete)
    useGameLog.ts           Ordered action log — add/undo/reset; each `GameLogEntry` records id, type, message, colour, `prevState` (GameState snapshot), and optional `undoable` flag (defaults to true; set false to suppress the undo button)
    useOrientation.ts       Detects portrait vs landscape; returns isPortrait (via matchMedia change event) and vmin (Math.min(screen.width, screen.height) — stable across rotations)
    useSwuGame.ts           Damage counter, epic action used state, Force token enabled and active state
    useSwuSetup.ts          Setup screen logic — filtering and auto-select
    useUserSettings.ts      React Context — persistent user preferences (useHyperspace, enableForceToken, enableEpicActions, enableWakeLock, enableFavourites, enableLongPress, enableActionLog) backed by localStorage under key `user_settings`; all seven default to `true`; `UserSettingsProvider` wraps the app in `main.tsx`
    useWakeLock.ts          Screen Wake Lock — acquires on game screen mount, releases on unmount; reacquires on visibility change

  utils/
    swudbUrl.ts             SWUDB URL utilities: normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck

  test/
    setup.ts                Vitest setup — jest-dom matchers + global matchMedia mock (landscape default; tests needing portrait call makeMatchMediaMock(true))
    App.test.tsx            End-to-end navigation and feature tests
    AppScreenLayout.test.tsx Layout component tests
    swuGameScreen.test.tsx  Game screen container tests
    swuHelpScreen.test.tsx  Help screen tests
    swuLoadingScreen.test.tsx Loading screen tests
    swuSetupScreen.test.tsx Setup screen container tests
    swuSettingsScreen.test.tsx Settings screen container tests
    swudbUrl.test.ts        SWUDB URL utility tests
    useDragScrubber.test.ts Drag-to-scrub hook tests
    useBaseArt.test.ts      Art fallback chain hook tests
    useBases.test.ts        Data layer hook tests
    useFavourites.test.ts   Favourites hook tests
    useOrientation.test.ts  Orientation hook tests
    useSwuGame.test.ts      Counter hook tests
    useSwuSetup.test.ts     Setup logic hook tests
    useUserSettings.test.ts User settings hook tests
    useWakeLock.test.ts     Screen Wake Lock hook tests

  assets/
    ...                     Static assets (icons, splash screens)

docs/
  architecture.md           This document
  help.md                   User guide (imported as HTML string via custom Vite plugin)
  project-overview.md       Product vision, planned features, AI assistant notes

public/
  dmgCtrl-icon-transparent-192.png  App icon (transparent background); used on loading screen and alongside screen titles
  dmgCtrl-icon-192.png              App icon 192×192 (opaque); used in PWA manifest and browser favicon
  dmgCtrl-icon-512.png              App icon 512×512 (opaque); used in PWA manifest
  dmgCtrl-force-token.png           Force token icon (512×512 PNG); used on Force button and as watermark in Force overlay
  dmgctrl-icon-192-white.svg        White starburst logo SVG (192×192); used on the epic action button and as watermark in the epic action overlay
  ...                       PWA manifest, icons

.github/
  workflows/
    deploy.yml              CI/CD pipeline

scripts/
  inspect-base-data.mjs     Replicates the useBases merging logic; writes docs/base-data-snapshot.json and docs/base-data-summary.json for offline data inspection
  validate-bases.mjs        Playwright script — opens a headed Chromium window and iterates every base for semi-automated visual QA (see Section 7)
  validate-errors.mjs       Playwright script — opens a headed Chromium window and steps through all five error/info message states for semi-automated visual QA (see Section 7)
```

---

## 6. State Management

The app uses **local React state** with one shared React Context for user settings — no global state library.

**`UserSettingsProvider`** (from `useUserSettings.ts`) wraps the entire app in `main.tsx`, giving every screen access to the same settings instance. Changes made in the settings screen propagate immediately to the game screen without requiring a game restart.

All other state is owned at the component level:

| State | Owner | How it flows |
|---|---|---|
| Current screen (`loading` / `setup` / `game` / `help` / `settings`) | `App` | Passed as callback props (`onReady`, `onConfirm`, `onBack`, `onHelp`, `onSettings`) |
| Back stack (for help/settings back-navigation) | `App` | A `Screen[]` stack; pushed when navigating to help or settings, popped on back — supports any depth of overlay navigation |
| `useBases()` loading state (for loading screen) | `App` | `App` calls `useBases()` and passes `loading` prop to `SwuLoadingScreen`; `SwuLoadingScreen` calls `onReady` only when both the data is ready and the 1-second minimum timer has elapsed |
| Selected base | `App` | Set on `onConfirm`, passed into `SwuGameScreen` |
| Last setup selection (`set`, `aspect`, `key`) | `App` | Saved on `handleConfirm`; passed as `initialSelection` prop to `SwuSetupScreen` so dropdowns are pre-populated on back navigation |
| Filter state (set, aspect, card) | `useSwuSetup` | Seeded from `initialSelection` on mount; local after that |
| Damage counter | `useSwuGame` | Local to game screen; clamped between 0 and `base.hp`; reset on each navigation to the game screen |
| Epic action used state | `useSwuGame` | Local to game screen; toggled by the epic action button; reset on each navigation to the game screen |
| Force token enabled state | `useSwuGame` | Local to game screen; set to `true` by the enable tap on non-Force bases; combined with `isForceBase` in the container to derive `effectiveForceEnabled`; reset on each navigation |
| Force token active state | `useSwuGame` | Local to game screen; toggled by the Force button and overlay; reset on each navigation to the game screen |
| Action log entries | `useGameLog` | Local to game screen; array of `GameLogEntry` records; initial Round 1 entry added on mount (not undoable) via a `useRef` guard; reset on game reset |
| Epic overlay dismissed | `swuGameScreen` | Local `epicOverlayDismissed` boolean; controls overlay visibility independently of `game.epicActionUsed`; set to `false` when epic action is marked; set to `true` by tapping the overlay when action log is disabled |
| Art fallback index, image load state | `useBaseArt` | Local to whichever screen called it; reset when base changes |
| User settings (hyperspace, force token, epic actions, wake lock, action log, favourites, long press) | `useUserSettings` Context / localStorage | Persisted under `user_settings` as JSON; all seven preferences (`useHyperspace`, `enableForceToken`, `enableEpicActions`, `enableWakeLock`, `enableFavourites`, `enableLongPress`, `enableActionLog`) default to `true`; shared via React Context — updates propagate immediately to all mounted consumers |
| Favourites list | `useFavourites` / localStorage | Persisted under `favourites` as JSON array of `FavouriteBase`; sorted by set then card number ascending; deduplicated on `key`; UI visibility gated by `enableFavourites` in `useUserSettings` |
| Selection mode (`base-selector` / `swudb-import` / `favourites`) | `SwuSetupScreen` / localStorage | Persisted under `pref_selection_mode`; defaults to `base-selector`; `'favourites'` is only restored on load if `enableFavourites` is true and the favourites list is non-empty; falls back to `'base-selector'` at runtime if either condition becomes false. On mode switch: entering `'swudb-import'` always clears the base selection and deck name; entering `'favourites'` clears the selection unless the current base is already in the favourites list; entering `'base-selector'` always preserves the current selection |
| SWUDB URL input, validation error, deck name, loading state | `SwuSetupScreen` | Local; `swudbDeckName` remains `null` until a successful API load |

### Note on double useBases() call

`App.tsx` calls `useBases()` to get the `loading` boolean for the loading screen transition. `SwuSetupScreen` also calls `useBases()` internally via `useSwuSetup`. This means two separate fetch calls occur on app start. In practice, both resolve immediately on repeat visits (24-hour localStorage cache), and the first fetch completes before the setup screen mounts, so the second is nearly instant. This is an acceptable trade-off to avoid refactoring `SwuSetupScreen`'s interface.

### Example flow: App startup

1. `App` mounts with `screen = 'loading'` and calls `useBases()` — initial `loading = true`
2. `SwuLoadingScreen` renders: shows the app icon and "LOADING" text; starts a **1-second minimum timer** (`timerDone = false`)
3. `dataReady` is set to `true` as soon as `loading` becomes `false` (may happen before the timer)
4. `onReady()` is called only when **both** `timerDone` and `dataReady` are `true`
5. `App` sets `screen = 'setup'`
6. `SwuSetupScreen` mounts, calls `useBases()` — resolves from cache almost immediately
7. User sees the dmgCtrl screen with selectors populated

### Example flow: Setup → Game

1. User selects set, aspect, and base in setup screen dropdowns
2. `useSwuSetup` manages the filter state and auto-selects when only one option remains
3. User clicks the start game button (→) — `handleSubmit` in `useSwuSetup` calls `onConfirm(selectedBase)`
4. `App` sets `screen = 'game'` and `selectedBase`
5. `SwuGameScreen` receives `base`; calls `useUserSettings()` for `useHyperspace` and other preferences; `useBaseArt` builds the ordered fallback chain and manages image state

### Example flow: Damage tracking

1. User taps `+` or `−` buttons in the game screen view
2. View calls `onIncrement` / `onDecrement` prop (callbacks from container)
3. Container delegates to `useSwuGame` — `increment()` / `decrement()`
4. `count` state updates; view re-renders showing new value
5. `increment` is clamped at `maxHp` and `decrement` is clamped at 0 — remaining HP stays in the range [0, base.hp]

### Example flow: Drag-to-scrub

1. User presses and holds `+` or `−` — `handlePointerDown` sets pointer capture on the button; `useDragScrubber` records start position
2. User drags upward — `handlePointerMove` computes `delta = startY - clientY`; below 15px (dead zone) nothing happens
3. Once delta exceeds 15px, `dragRef.current.active = true` and the indicator state is set: `{ type, value, clientX, clientY }`
4. The view renders a fixed-position floating number (e.g. "+3") offset toward the centre of the screen from the touch point; value increments by 1 per 14px of upward travel, capped at `Math.min(max, 20)` where `max` is the remaining capacity for that direction
5. User releases — `handlePointerUp` fires the increment/decrement callback `value` times; sets `dragApplied.current = true`
6. The synthetic `click` event that follows a pointer-up is suppressed by `handleClick` checking `dragApplied.current` — prevents a double-count
7. Indicator is cleared; `dragRef.current` reset to null

### Example flow: Epic action

1. Container reads `enableEpicActions` from `useUserSettings()` and computes `showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)` — excludes Mystic Monastery (whose text is "Action:", not "Epic Action:")
2. When `showEpicAction` is true, the view renders the epic action button; its position in the left column adjusts based on whether `showForce` is also true
3. User taps the epic action button — view calls `onEpicActionMark` prop; the button becomes `disabled`
4. Container calls `game.markEpicActionUsed()`, adds an epic log entry via `useGameLog`, and resets `epicOverlayDismissed` to `false`
5. View derives `epicActionOverlayVisible = game.epicActionUsed && !epicOverlayDismissed` and re-renders: button is disabled; a gold token overlay appears over the lower portion of the card
6. **When action log is enabled:** the overlay stays visible; undo is performed via the log's Undo button, which calls `undoLast()` to restore the previous game state
7. **When action log is disabled:** the overlay has an `onClick` handler (`onEpicActionOverlayDismiss`); tapping it sets `epicOverlayDismissed = true`, hiding the overlay without reverting game state

### Example flow: Force token

1. Container reads `enableForceToken` from `useUserSettings()` and sets `showForce = enableForceToken`; the Force button slot is rendered when `showForce` is true
2. Container computes `isForceBase = /the force is with you/i.test(base.epicAction)` and `effectiveForceEnabled = isForceBase || forceEnabled`
3. **Locked state** (`!effectiveForceEnabled`): view renders a dimmed Force icon button (`force-btn-locked`). User taps it → `onForceEnable` → `enableForce()` sets `forceEnabled = true` → `effectiveForceEnabled` becomes `true`
4. **Ready state** (`effectiveForceEnabled && !forceActive`): view renders the full blue Force button (`force-btn`). User taps it → `onForceToggle` → `toggleForce()` sets `forceActive = true`
5. View re-renders: the full blue Force button (`force-btn`) is replaced by a greyed-out Force button (`force-btn-active`); a blue "The Force is With You" overlay appears over the lower portion of the card, with a translucent watermark of the Force token icon
6. Tapping the overlay or the greyed Force button calls `onForceToggle`, returning `forceActive` to `false` and restoring the ready-state button — ready to gain the Force again
7. Force bases (`isForceBase = true`) skip step 3 entirely: `effectiveForceEnabled` is `true` from mount, so the full blue button is shown immediately
8. **Mystic Monastery (LOF-022)** is detected by `isMysticMonastery = base.set === 'LOF' && base.number === '022'`. It renders an additional action counter button (`mystic-action-btn`) in the epic action slot. Tapping it decrements `mysticUsesRemaining` (3 → 0) and sets `forceActive = true`. The regular Force button remains available at all times for gaining the Force through other in-game means. The Force button (`force-btn`) hides when `forceActive` is true (the greyed `force-btn-active` appears as usual). The counter button (`mystic-action-btn`) is always visible but rendered disabled (greyed, `disabled` attribute set) when `forceActive` is true or `mysticUsesRemaining` reaches 0 — it never disappears from the layout.

### Example flow: Both overlays active

When `epicActionUsed && showEpicAction && forceActive && showForce` are all true simultaneously (a non-Force base with an epic action that has also gained the Force), the view computes `bothOverlaysActive = true`. In this state:
- The epic action overlay occupies the **left half** of the card's bottom section
- The Force token overlay occupies the **right half**
- Both are independently tappable to dismiss

### Example flow: Settings navigation

1. User taps the ⚙ button on the setup or game screen
2. `App` pushes the current screen onto `backStack` and sets `screen = 'settings'`
3. `SwuSettingsScreen` renders — user adjusts preferences; each toggle writes immediately to localStorage via `useUserSettings`
4. User taps the back button — `App` pops the top of `backStack` and sets `screen` to that value, returning to wherever they came from
5. Because `useUserSettings` is a shared React Context, the updated preferences are reflected immediately in all mounted consumers — the game screen does not need to be restarted

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

The setup screen uses `normalFailed`, `hyperspaceFailed`, and `imageLoaded` to control contextual messages ("Only hyperspace image available", "Hyperspace variant not found"): both are suppressed until `imageLoaded` is true, preventing flicker during the loading window. The game screen uses `allFailed` to switch to the text fallback (base name, subtitle, epic action).

### Caching

Fetched and merged data is written to localStorage under key `swu_bases_cache` with a `lastChecked` timestamp. On subsequent loads, if the cache age is less than **24 hours**, the fetch is skipped and the cached `Base[]` is returned directly.

If the cache is stale and a fresh fetch fails (network error), the stale cached data is served rather than showing an error — the app remains usable offline or on poor connections. An error is only shown if there is no cache at all and the fetch fails.

To force a fresh fetch during development: `localStorage.removeItem('swu_bases_cache')` in the browser console.

### Data inspection script

`scripts/inspect-base-data.mjs` is a standalone Node.js script that replicates the `useBases` merging logic and writes two files (gitignored):

- `docs/base-data-snapshot.json` — full merged `Base[]` array
- `docs/base-data-summary.json` — compact summary with art coverage stats per base

Run with `node scripts/inspect-base-data.mjs` to inspect the live merged dataset without running the app.

### Base validation script

`scripts/validate-bases.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of every base's game screen rendering. It opens a visible Chromium window, iterates through every set / aspect / base combination, navigates to the game screen for each base, waits for the card image to load, pauses for visual inspection, then returns to the setup screen.

Prerequisites:
- Dev server must be running (`npm run dev`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-bases.mjs
```

The script reads set, aspect, and base options live from the DOM, so new bases added to the data source are picked up automatically. Progress is logged to the terminal:
```
[1] SOR / Aggression / Catacombs of Cadera
[2] SOR / Cunning / Energy Conversion Lab
...
Validation complete — 42 bases checked.
```

Timing constants at the top of the script (`VISUAL_PAUSE_MS`, `BACK_PAUSE_MS`) can be adjusted if more or less inspection time is needed.

### Error message validation script

`scripts/validate-errors.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of all five error and information message states. It opens a visible Chromium window and steps through each scenario in sequence, pausing 3 seconds for visual inspection before advancing. Settings modified during the run (e.g. `useHyperspace`) are restored to defaults at the end.

**Scenarios:**
1. SWUDB Import — "Invalid deck URL" (types an invalid URL)
2. SWUDB Import — "Deck not accessible" (loads an unreachable deck URL via the proxy)
3. Base Selector — "No base images found" (all PNG/WebP/JPEG requests blocked via `page.route`)
4. Base Selector — "Hyperspace variant not found" (`useHyperspace` set to `true`, selects a base with no hyperspace art)
5. Base Selector — "Only hyperspace image available" (`useHyperspace` set to `false`, blocks the base's standard art URLs so it falls back to hyperspace)

Scenarios 4 and 5 query `swu_bases_cache` in localStorage via `page.evaluate` to find suitable bases automatically — no hardcoded base names are required.

Prerequisites:
- HTTPS dev server must be running (`npm run dev:https`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-errors.mjs
# or, for device testing on the local network:
node scripts/validate-errors.mjs https://192.168.1.100:5173/dmgCtrl/
```

Timing can be adjusted via `VISUAL_PAUSE_MS` at the top of the script.

### `useFavourites` hook

Manages a persistent list of favourite bases for quick reselection.

```typescript
export interface FavouriteBase {
  key: string       // `${set}-${number}`, e.g. "SHD-018"
  set: string
  name: string
  hp: number
  aspect: string
  cardNumber: number
}
```

**Persistence:** Stored as a `FavouriteBase[]` JSON array in localStorage under the key `favourites`. Falls back to an empty list if the key is absent or the stored value is corrupt.

**Deduplication:** Adding an entry whose `key` already exists is a no-op.

**Sort order:** The list is sorted on every mutation — set code ascending (alphabetical), then `cardNumber` ascending within a set.

**API:** `{ favourites, addFavourite, removeFavourite, clearFavourites }`.

**Feature flag:** `enableFavourites` in `useUserSettings` (default: `true`) gates UI visibility. The stored data is retained regardless of the toggle state — disabling and re-enabling restores the list intact. Setup screen integration (star toggle + Favourites mode) was added in ticket #123. Settings screen management (remove individual, clear all) was added in ticket #124.

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
| `--color-epic` | `#f5c518` | Epic action button, token overlay border and glow |
| `--color-epic-rgb` | `245, 197, 24` | `rgba()` shadow values using the epic colour |

Pros: no class name conflicts, styling is co-located with component logic, easy to make props-driven style decisions, palette changes are a one-line edit in `index.css`.

Cons: no media query support in inline styles (workaround: derive breakpoint-based values in component logic), harder to override from outside.

### Responsive layout

The app is designed for **landscape orientation**. `useOrientation` is used in four places:

- **Setup screen** (`SwuSetupScreenView`) — renders a two-column layout in landscape (selectors left, card preview right) and a single-column scrollable layout in portrait.
- **Game screen** (`SwuGameScreen`) — renders the full-screen card layout in landscape and a rotation prompt in portrait.
- **Help screen** (`SwuHelpScreen`) — uses `vmin` to compute JS-based font sizes for the title row; `isPortrait` is used as a React `key` to force DOM remount on rotation, flushing any cached computed styles.
- **Settings screen** (`SwuSettingsScreenView`) — uses `vmin` for JS-based font sizes; `isPortrait` as a React `key` for DOM remount on rotation; `fontFamily` set to `Helvetica, Arial, sans-serif` with `-webkit-text-size-adjust: 100%` to prevent iOS Dynamic Type scaling the toggle labels.

`useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events (reliable on iOS standalone PWA, unlike `orientationchange`/`resize`). It returns `isPortrait` (boolean) and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, which is stable across orientation changes unlike `window.innerWidth`).

---

## 9. Feature Architecture

### App startup and loading screen

1. `App` mounts with `screen = 'loading'` and calls `useBases()` to get the `loading` boolean
2. `SwuLoadingScreen` renders: displays the app icon (`dmgCtrl-icon-transparent-192.png`) and "LOADING" text; starts a **1-second minimum timer**
3. Two conditions must both be true before `onReady()` is called: `timerDone` (1 second has elapsed) and `dataReady` (the `loading` prop became `false`)
4. `App` responds to `onReady` by setting `screen = 'setup'`

### Base selection flow

1. `useBases` fetches and returns `Base[]` (cached after first load)
2. `useSwuSetup` receives `bases` and exposes derived lists:
   - `availableSets` — distinct set codes
   - `availableAspects` — aspects for the selected set
   - `filteredBases` — bases matching the selected set and aspect
3. Auto-select effects: if only one value is available for a dropdown, it is selected automatically
4. User selects a base → `selectedBase` is set
5. On submit, `onConfirm(selectedBase)` is called — the game screen reads `useHyperspace` from `useUserSettings` independently

### Input mode selector

The setup screen supports three input modes, controlled by a `selectionMode` state (`'base-selector'` | `'swudb-import'` | `'favourites'`). The active mode is persisted to localStorage under `pref_selection_mode`. The mode selector dropdown is always visible on the setup screen.

**Base Selector mode** is the default. The three cascading dropdowns (set → aspect → base) are shown. Each base option is formatted as `${name} (${hp})` (e.g. `Catacombs of Cadera (30)`).

When `enableFavourites` is true and a base is selected, a **star toggle** (☆/★) appears inline — in the same row as the base dropdown and start button. Tapping it:
- Adds the current base to favourites (`addFavourite`) if not already saved, recording `set`, `name`, `hp`, `cardNumber` (`parseInt(base.number, 10)`), and the selected aspect (or `'None'` for bases with no aspects)
- Removes it (`removeFavourite`) if already favourited

`isFavourited` is a derived boolean in the container, computed by matching `` `${base.set}-${base.number}` `` against the `key` fields in the favourites list.

**SWUDB Import mode** shows a URL input field and a two-row layout:
- Row 1 (always visible): URL text input + Load button
- Row 2 (visible only after a load attempt): deck name + start game button (→)

The Load and start game buttons are stacked vertically and share the same width so they align.

On a successful load, `selectBaseByKey` in `useSwuSetup` is called with the base key from the deck response. This sets `selectedSet`, `selectedAspect`, and `selectedKey` so that switching back to Base Selector mode shows the correct base pre-selected. The card art preview appears below the import controls once a base is resolved, mirroring the Base Selector experience. When `enableFavourites` is true and a base has been resolved, a star toggle (☆/★) appears between the deck name and the start button, identical in behaviour to the one in Base Selector mode.

URL validation is handled by pure utility functions in `src/utils/swudbUrl.ts`:

```typescript
normaliseSwudbUrl(url)   // converts /deck/edit/<id> → /deck/<id>
isValidSwudbUrl(url)     // tests against /^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/
fetchSwudbDeck(deckId)   // fetches via the Cloudflare Worker proxy; returns { deckName, baseKey }
```

SWUDB deck IDs are alphanumeric and variable length (observed range: 9–13 characters). The URL is validated on every change; edit URLs are normalised before validation so they pass. An error message appears below the URL field for invalid input, extending the field's border in a drop-down style; focusing the field clears the error.

The Load button is disabled while a fetch is in progress (shows `...`). Possible error states after clicking Load:
- `'Invalid deck URL'` — URL failed validation (should not normally reach Load in this state)
- `'Deck not accessible'` — non-200 response or network error
- `'Base not recognised'` — deck loaded but the base key was not found in the local `Base[]`

When the base is not recognised, the deck name is still shown (so the user can see which deck was loaded) but the start game button is disabled.

**Favourites mode** is available when `enableFavourites` is `true` and the favourites list is non-empty. The Favourites option only appears in the mode selector dropdown when both conditions are met. The mode shows a single dropdown listing all saved favourites, sorted by set then card number. Each option is formatted as `${set}: ${name} (${hp})` (e.g. `SOR: Catacombs of Cadera (30)`). Selecting an entry calls `selectBaseByKey` to populate the setup state and enables the start game button. A card art preview appears once a base is selected, consistent with the other modes.

**Mode transitions:** When switching to SWUDB Import mode, the current base selection and any loaded deck name are always cleared — the form starts fresh. When switching to Favourites mode, the selection is cleared unless the currently selected base is already in the favourites list (in which case it is pre-selected in the dropdown). Switching to Base Selector mode always preserves the current selection — a base resolved via SWUDB Import or chosen from Favourites will be pre-populated in the cascading dropdowns.

If `enableFavourites` becomes `false` or the favourites list becomes empty while Favourites mode is active, a `useEffect` in the container resets `selectionMode` to `'base-selector'`. The `'favourites'` value is also rejected when restoring mode from localStorage if these conditions are not met on load.

### Game screen

1. `useUserSettings()` provides `enableForceToken`, `enableEpicActions`, `enableWakeLock`, `useHyperspace`, and `enableLongPress` — all user preferences for this screen
2. `useBaseArt(base, useHyperspace)` manages the ordered fallback chain and image load state
3. `useSwuGame(base.hp)` manages the damage counter, epic action, and Force token (enabled + active) state
4. `useGameLog()` manages the ordered action log; the container adds entries on counter changes, epic action mark, Force token toggle, and round increment; an initial Round 1 entry (not undoable) is added once on mount via a `logInitialized` useRef guard (prevents React StrictMode double-invocation)
5. `useWakeLock(enableWakeLock)` acquires a Screen Wake Lock on mount to prevent the screen sleeping during gameplay; the lock is automatically released when the component unmounts or the page becomes hidden, and reacquired when the page becomes visible again
6. The container computes:
   - `showEpicAction = enableEpicActions && /epic action/i.test(base.epicAction)`
   - `showForce = enableForceToken` — the Force button slot is shown for every base when enabled
   - `isForceBase = /the force is with you/i.test(base.epicAction)` — LOF bases whose ability explicitly creates a Force token
   - `effectiveForceEnabled = isForceBase || forceEnabled` — Force bases start enabled; others start locked until the user taps the dimmed icon
   - `epicActionOverlayVisible = game.epicActionUsed && !epicOverlayDismissed` — separates overlay visibility from game state
7. Key props passed to the view: art state, counter callbacks, `epicActionUsed`, `epicActionOverlayVisible`, `onEpicActionMark`, `onEpicActionOverlayDismiss` (only when action log is disabled), `showEpicAction`, force state, `enableActionLog`, `round`, `onRoundIncrement`, `showLog`, `onToggleLog`, `logEntries`, `onLogUndo`; the view calls `useDragScrubber` directly to manage drag gesture state
8. The left-side button column (top to bottom): back → Force icon (locked, ready, or overlay-active/greyed) when `showForce` → epic action button when `showEpicAction`; when Force is hidden the epic action button moves up to fill the gap
9. The right-side button column (top to bottom): help → ⚙ settings
10. The bottom row (when action log is enabled): round counter button (bottom-left, blue gradient header) → log button (bottom-right, ☰ icon)
11. View renders the card image, counter, and up to two overlays over the bottom portion of the card:
    - **Epic action token** (gold, "Epic Action Used"): when `epicActionOverlayVisible && showEpicAction`
    - **Force token** (blue, "The Force is With You"): when `forceActive && showForce`
    - When **both** are active, `bothOverlaysActive = true` renders them side by side (epic action left, Force right), each at half width

### Settings screen

The settings screen is accessible from both the setup and game screens via the ⚙ button in the top-right area:

- Tapping ⚙ navigates to `SwuSettingsScreen`; the current screen is pushed onto `backStack` so the back button returns to the correct place
- `SwuSettingsScreen` (container) calls `useUserSettings()` and `useFavourites()` to read and write preferences and manage the saved bases list
- `SwuSettingsScreenView` (view) renders a header row (back button, icon, "Settings" h1, help button) and toggle list
- Each toggle writes immediately to localStorage via `useUserSettings` — there is no save/cancel step
- The six toggles: **Use Hyperspace Art**, **Enable Force Token**, **Enable Epic Actions**, **Enable Screen Wake Lock**, **Enable Action Log**, **Enable Favourites**
- When **Enable Favourites** is on, a saved-bases list appears directly below the toggle (inset with a left accent border to show hierarchy): each entry shows `SET: Name — HPHp (Aspect)` with a Remove button; a Clear All button (with a two-step inline Confirm/Cancel) appears when the list is non-empty; "No favourites saved" is shown when the list is empty
- **Landscape layout**: two `role="group"` columns — "General settings" (first five toggles: Hyperspace Art, Force Token, Epic Actions, Wake Lock, Action Log) on the left, "Favourites settings" (Enable Favourites toggle + list) on the right; each column scrolls independently. Portrait: single scrollable column.
- `SwuSettingsScreenView` calls `useOrientation()` directly (not via props) and applies `fontFamily: 'Helvetica, Arial, sans-serif'` to prevent iOS Dynamic Type from overriding font sizes

### Screen Wake Lock

`useWakeLock(enabled)` wraps the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API):

- Calls `navigator.wakeLock.request('screen')` on mount when `enabled` is true
- Stores the `WakeLockSentinel` in a ref; calls `.release()` on unmount
- Listens for `visibilitychange`: reacquires the lock when `document.visibilityState === 'visible'` (the OS releases the lock automatically when the app is backgrounded)
- Silently swallows errors from `request()` (e.g. battery saver mode, permissions denied)
- No-ops if `navigator.wakeLock` is absent (older browsers, non-installed iOS Safari)

**Platform support:**
- Android Chrome: supported since Chrome 84 (2020)
- iOS Safari PWA: supported since iOS 16.4 (March 2023); only works when installed to home screen — not in a regular Safari tab

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

## 12. Analytics

### Cloudflare Web Analytics

A Cloudflare Web Analytics beacon is embedded in `index.html`. It fires on every page load (i.e. every app start) and provides:

- App load counts over time
- Unique visitor counts (privacy-preserving, no cookies, no consent banner required)
- Countries, browsers, devices

The beacon token (`aaed1e18376f4bdd9f56a0050acce291`) is a public identifier — it is not a secret and is safe to commit.

Custom event tracking (game starts, base popularity) is not covered by the Cloudflare beacon, which only records page loads. That is handled separately by the Worker + InfluxDB pipeline (see issues #97, #98, #99).

---

## 13. Testing Strategy

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
- All mocks are torn down with `vi.unstubAllGlobals()` in `afterEach`
- `useUserSettings` is mocked with `vi.mock('../hooks/useUserSettings', ...)` in tests that exercise preference-gated behaviour; `vi.hoisted` is used for mock values that need per-test control
- `useFavourites` is mocked with `vi.mock('../hooks/useFavourites', ...)` in setup screen tests; `vi.hoisted` provides per-test control over `favourites`, `addFavourite`, `removeFavourite`
- `App.test.tsx` mocks `useBases` at the module level (`vi.mock('../hooks/useBases', ...)`) so data is available synchronously; this allows the tests to focus on navigation logic rather than data loading. The 1-second loading screen timer is waited out with a `waitFor` timeout of 4 seconds.

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

## 14. Performance Considerations

### Mobile-first

The app targets mobile browsers and PWA installation. Key performance constraints:

- Minimal bundle size — no large dependencies
- Fast startup — localStorage cache means data is available immediately on repeat visits
- No unnecessary network requests — the 24-hour cache prevents redundant API calls on repeat visits

### Avoiding unnecessary re-renders

- State is co-located with the component that needs it — no prop drilling through many layers
- Derived values (e.g. `filteredBases`) are computed in hooks with `useMemo`; `useBaseArt` entries are memoised so the array only rebuilds when `base` or `useHyperspace` changes

### Image loading

- Card art is lazy-loaded via the browser's default `<img>` behaviour
- The fallback chain in `useBaseArt` means a broken image never leaves a blank gap — it advances to the next URL or shows text
- The setup screen image preview is displayed before game start, giving the browser time to cache the URL before the game screen renders it

---

## 15. Future Improvements

### Architecture

- **Global state** — React Context is now used for user settings; if the app grows further, a lightweight state manager (e.g. Zustand) may be worth adopting for broader shared state
- **Multi-game support** — the `Base` type and `useBases` hook are SWU-specific; a game-agnostic data abstraction layer would be needed for additional games

### Data

- **Backend / sync** — currently all data is fetched from third-party APIs; a first-party backend could provide more reliable image hosting, faster response, and support for user-specific data (favourites, history)
- **Art coverage** — swu-db.com CDN does not yet host hyperspace art for all sets; `hyperspaceArtHiRes` will become more reliable as their index grows

### UI

- **Theming system** — CSS custom properties are now in place; per-game themes (e.g. X-Wing aesthetic) could be implemented by swapping the `:root` values at runtime
- **Animations** — damage counter and screen transitions could benefit from subtle animations

---

## 16. Glossary

| Term | Definition |
|---|---|
| **Base** | A card type in Star Wars Unlimited representing a location that acts as the player's "health bar". Each base has an HP value (typically 24–35). |
| **Epic Action** | A special ability on some base cards that can be triggered once per game. The game screen shows an epic action button when the base has an epic action and `enableEpicActions` is true in user settings; tapping it marks the ability as used, adds a log entry, and renders a gold token overlay. The button is then disabled. When the action log is enabled, undo is performed via the log's Undo button. When the action log is disabled, tapping the overlay dismisses it visually without reverting game state. The button is only shown when the base's `epicAction` text contains the phrase 'Epic Action' (case-insensitive). Passive-effect bases and Force trigger bases are therefore excluded. |
| **Epic action token** | The in-app UI element (a translucent yellow rectangle with a gold border, "Epic Action Used" text, and a starburst watermark) that overlays the lower portion of the base card when the epic action has been used, mirroring the physical token used in the tabletop game. When the Force token is also active, it occupies the left half of the overlay area. |
| **Favourites** | A user-curated list of bases for quick reselection. Managed by `useFavourites`; persisted to localStorage under `favourites`. Visibility gated by `enableFavourites` in `useUserSettings` (default: `true`). Setup screen integration (star toggle + Favourites mode) added in ticket #123. Settings screen management UI (remove individual, clear all) added in ticket #124. |
| **Force** | A recurring ability on some LOF base cards, identified by the phrase "The Force is with you" in their `epicAction` text. Force bases start the game with the Force button already enabled. Any base can also gain the Force via card or leader abilities — the locked Force icon is available on all bases for this purpose. |
| **Force token button** | The blue icon button (showing `dmgCtrl-force-token.png`) that appears in the first slot below the back button when `forceEnabled` is true. Tapping it sets `forceActive = true` and renders the Force token overlay. On non-Force bases, the slot first shows a locked/dimmed version; tapping the dimmed icon once enables it. |
| **Force token overlay** | The in-app UI element (a royal-blue rectangle with a light-blue border and a "The Force is With You" label) that overlays the lower portion of the base card when `forceActive` is true. A translucent watermark of `dmgCtrl-force-token.png` appears behind the text. Tapping the overlay returns `forceActive` to `false`. When the epic action token is also active, it occupies the right half of the overlay area. |
| **Action log** | The scrollable game event log shown as an overlay on the game screen when `enableActionLog` is true. Rendered by `GameLogOverlay`. Managed by `useGameLog`. Each entry shows a coloured left strip, event message, and (for the last undoable entry) an Undo button. Round entries are styled with a blue gradient background. |
| **Round tracker** | A round counter button in the bottom-left corner of the game screen. Increments the round number and adds a round entry to the action log on each tap. Starts at Round 1 on game start (initial entry is not undoable). Only visible when the action log is enabled. |
| **GameLogEntry** | The record stored by `useGameLog` for each action. Fields: `id` (UUID), `type` (string tag for styling, e.g. `round`), `message`, `color` (left strip accent), `prevState` (GameState snapshot for undo), optional `undoable` (defaults to true; set false to suppress the Undo button). |
| **UserSettingsProvider** | The React Context provider from `useUserSettings.ts`. Wraps the app in `main.tsx` so all screens share one settings instance. Updates propagate immediately to all mounted consumers. |
| **Hyperspace** | A premium variant of a card with alternate artwork. In this app, the `useHyperspace` setting (in `useUserSettings`) controls whether the Hyperspace variant is preferred on the game screen. |
| **Loading screen** | The first screen shown on app start (`SwuLoadingScreen`). Displays the app icon and "LOADING" text. Has a **1-second minimum display time**: `onReady` is called only when both the data has loaded and the 1-second timer has elapsed. Automatically transitions to the setup screen. |
| **Standard art** | The default card artwork. `frontArt` is the swu-db.com hi-res version (1560×1120); `frontArtLowRes` is the swuapi.com version (400×286). |
| **hyperspaceArt** | The reliable low-res hyperspace image URL from swuapi.com (`cdn.starwarsunlimited.com`, 400×286). `null` for SOR/SHD/TWI (no longer in swuapi.com). |
| **hyperspaceArtHiRes** | A constructed hi-res hyperspace image URL from swu-db.com (`cdn.swu-db.com`, 1560×1120). Derived from card number for active sets, or from the static offset map for SOR/SHD/TWI. May 403 for a small number of unindexed cards. |
| **Static hyperspace map** | A hardcoded mapping of SOR, SHD, and TWI base card numbers to their hyperspace card numbers (offset). Used because those sets no longer appear in swuapi.com. |
| **Fallback chain** | The ordered list of image URLs managed by `useBaseArt`. Hyperspace preferred: `[hyperspaceArtHiRes, hyperspaceArt, frontArt, frontArtLowRes]`. Normal preferred: `[frontArt, frontArtLowRes, hyperspaceArtHiRes, hyperspaceArt]`. The next URL is tried on `onError`; text fallback shown only when all are exhausted. |
| **Container** | A React component that owns logic — calls hooks, computes derived state, and passes everything to a View component as props. |
| **View** | A React component that only renders — receives all data and callbacks as props, contains no business logic. |
| **AppScreenLayout** | The shared full-screen layout wrapper that provides background, safe area padding, and star field for every screen. |
| **CSS custom properties** | Variables defined in `:root` in `index.css` (e.g. `--color-accent`) and referenced in inline styles via `var()`. Single source of truth for the colour palette. |
| **Screen Wake Lock** | A browser API (`navigator.wakeLock.request('screen')`) that prevents the device screen from sleeping. Used by `useWakeLock` on the game screen when `enableWakeLock` is true in user settings. Supported on Android Chrome and iOS Safari PWA (iOS 16.4+). |
| **swu-db proxy** | A Cloudflare Worker at `swu-proxy.dmgctrl.workers.dev` that proxies requests to swu-db.com and swudb.com to avoid CORS issues. |
| **PWA** | Progressive Web App — a web app that can be installed on a device and used offline. |
| **SOR** | Spark of Rebellion — the first set of Star Wars Unlimited cards. |
| **LAW** | Legends of the Alliance — a later set of Star Wars Unlimited cards. |
| **SWUDB** | swudb.com — a third-party Star Wars Unlimited database site. Deck lists can be imported via a URL of the form `https://swudb.com/deck/<id>`. |
