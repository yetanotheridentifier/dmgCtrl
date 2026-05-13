# dmgCtrl — Architecture Overview

> **See also:** [Implementation Details](architecture-implementation.md) | [Process & Testing](architecture-process.md)

---

## 1. Overview

**dmgCtrl** is a mobile-first progressive web app (PWA) designed to assist players of card games with game-state tracking. The current implementation targets **Star Wars Unlimited (SWU)**.

Core functionality:
- **Loading screen** — splash screen (icon + "LOADING") while base data is fetched; transitions to the setup screen as soon as data is ready
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
- **Format selection** — a Format dropdown on the setup screen filters the available sets by format (Premier, Limited, Eternal / Twin Suns); selection is persisted across sessions; invalid bases in SWUDB Import mode show an error and disable the start button; changing format re-evaluates without re-fetching
- **Favourites** — star toggle on the setup screen marks a base as a favourite; a dedicated Favourites input mode shows a sorted dropdown of saved bases for quick reselection; only bases valid for the current format are shown; saved bases can be managed in the Settings screen; gated by the Enable Favourites setting
- **Offline capability** — PWA support means the app can be installed and used without a network connection

The app is served at `/dmgCtrl/` and is designed to be added to an iOS home screen for a native-like experience.

---

## 2. Goals and Non-Goals

### Goals

- **Mobile-first** — designed for a phone held in landscape orientation during play
- **Offline-ready** — PWA with service worker; usable without network after first load
- **Simplicity** — minimal UI, minimal dependencies, lightweight infrastructure
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
| API proxy | Cloudflare Worker (`worker.dmgctrl.app`) — proxies card data and receives analytics events |
| Analytics storage | InfluxDB Cloud free tier — time-series store for custom game events; queried via SQL |

---

## 4. Application Architecture

### High-level structure

```
App
├── SwuLoadingScreen      (standalone screen — icon + LOADING text; transitions as soon as data is ready)
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
│   ├── GameLogOverlay    (view — scrollable log panel; auto-scrolls to latest entry; undo button on last undoable entry; round entries styled with blue gradient)
│   └── SwuGameScreenView (view — renders counter, image, epic action token, Force token; ⚙ button always visible; calls useDragScrubber directly for drag-to-scrub gesture state)
├── SwuHelpScreen         (standalone screen — renders swuSetupHelp.md or swuGameHelp.md based on source prop)
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

## 5. Glossary

| Term | Definition |
|---|---|
| **Base** | A card type in Star Wars Unlimited representing a location that acts as the player's "health bar". Each base has an HP value (typically 24–35). |
| **Epic Action** | A special ability on some base cards that can be triggered once per game. The game screen shows an epic action button when the base has an epic action and `enableEpicActions` is true in user settings; tapping it marks the ability as used, adds a log entry, and renders a gold token overlay. The button is then disabled. When the action log is enabled, undo is performed via the log's Undo button. When the action log is disabled, tapping the overlay dismisses it visually without reverting game state. The button is only shown when the base's `epicAction` text contains the phrase 'Epic Action' (case-insensitive). Passive-effect bases and Force trigger bases are therefore excluded. |
| **Epic action token** | The in-app UI element (a translucent yellow rectangle with a gold border, "Epic Action Used" text, and a starburst watermark) that overlays the lower portion of the base card when the epic action has been used, mirroring the physical token used in the tabletop game. When the Force token is also active, it occupies the left half of the overlay area. |
| **Favourites** | A user-curated list of bases for quick reselection. Managed by `useFavourites`; persisted to localStorage under `favourites`. Visibility gated by `enableFavourites` in `useUserSettings` (default: `true`). Setup screen shows a star toggle and a Favourites selection mode; Settings screen supports removing individual entries and clearing the list. |
| **Force** | A recurring ability on some LOF base cards, identified by the phrase "The Force is with you" in their `epicAction` text. Force bases start the game with the Force button already enabled. Any base can also gain the Force via card or leader abilities — the locked Force icon is available on all bases for this purpose. |
| **Force token button** | The blue icon button (showing `dmgCtrl-force-token.png`) that appears in the first slot below the back button when `forceEnabled` is true. Tapping it sets `forceActive = true` and renders the Force token overlay. On non-Force bases, the slot first shows a locked/dimmed version; tapping the dimmed icon once enables it. |
| **Force token overlay** | The in-app UI element (a royal-blue rectangle with a light-blue border and a "The Force is With You" label) that overlays the lower portion of the base card when `forceActive` is true. A translucent watermark of `dmgCtrl-force-token.png` appears behind the text. Tapping the overlay returns `forceActive` to `false`. When the epic action token is also active, it occupies the right half of the overlay area. |
| **Action log** | The scrollable game event log shown as an overlay on the game screen when `enableActionLog` is true. Rendered by `GameLogOverlay`. Managed by `useGameLog`. Each entry shows a coloured left strip, event message, and (for the last undoable entry) an Undo button. Round entries are styled with a blue gradient background. |
| **Round tracker** | A round counter button in the bottom-left corner of the game screen. Increments the round number and adds a round entry to the action log on each tap. Starts at Round 1 on game start (initial entry is not undoable). Only visible when the action log is enabled. |
| **GameLogEntry** | The record stored by `useGameLog` for each action. Fields: `id` (UUID), `type` (string tag for styling, e.g. `round`), `message`, `color` (left strip accent), `prevState` (GameState snapshot for undo), optional `undoable` (defaults to true; set false to suppress the Undo button). |
| **UserSettingsProvider** | The React Context provider from `useUserSettings.ts`. Wraps the app in `main.tsx` so all screens share one settings instance. Updates propagate immediately to all mounted consumers. |
| **Hyperspace** | A premium variant of a card with alternate artwork. In this app, the `useHyperspace` setting (in `useUserSettings`) controls whether the Hyperspace variant is preferred on the game screen. |
| **Loading screen** | The first screen shown on app start (`SwuLoadingScreen`). Displays the app icon and "LOADING" text. Transitions to the setup screen as soon as `useBases()` resolves — there is no minimum display time. |
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
| **swu-db proxy** | A Cloudflare Worker at `worker.dmgctrl.app` that proxies requests to swu-db.com and swudb.com to avoid CORS issues, and exposes a `POST /analytics` endpoint that writes structured game events to InfluxDB Cloud in line-protocol format. Credentials are stored as Cloudflare Worker secrets. The card-data proxy routes use open CORS (`*`); the analytics endpoint restricts to an allowed-origins set (`https://dmgctrl.app`, `https://dev.dmgctrl.app`). |
| **PWA** | Progressive Web App — a web app that can be installed on a device and used offline. |
