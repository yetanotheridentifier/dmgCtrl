# dmgCtrl — Architecture Overview

> **See also:** [Implementation Details](architecture-implementation.md) | [Process & Testing](architecture-process.md)

---

## 1. Overview

**dmgCtrl** is a mobile-first progressive web app (PWA) designed to assist players of tabletop games with game-state tracking. The current implementation supports **Star Wars Unlimited (SWU)** and **Star Wars X-Wing**.

Core functionality:
- **App start**: the app opens at the first that applies: a tournament in progress; the game named by the address (`/swu`, `/xwing`, also the manifest shortcuts); the `startScreen` setting: 'lastGame' (default) → the setup of the game played last (a game counts as played once its setup opens), or game select before either is played; 'swu' or 'xwing' → that setup; 'gameSelect' → game select. Back from either game's setup always returns to game select
- **Card data gate**: only SWU setup waits for SWU card data, and only when there is none cached: a splash while it loads, an offline screen (Try again, Play X-Wing, Back) when it could not be fetched. Game select and X-Wing never wait
- **Install banner**: on game select and the setup screens (never a game screen) from the second launch; Android opens the browser's install prompt, iPhone shows the Safari steps; Not now hides it for 30 days
- **Base selection** — your base is kept between games and launches; the base sheet offers favourites and the last 6 bases played, a search over every base by name with four aspect filters, and an SWUDB deck link that brings its base
- **Damage tracking**: on the SWU game screen the base card is the control: tap it for 1 damage, drag up to add several and down to remove several; the damage and HP left show in the card's open art
- **Hyperspace art** — optionally display the premium "hyperspace" variant of a base card
- **Epic Action tracking**: an epic action button marks the base's once-per-game ability as used; a gold token covers the card's text box to show the spent state
- **Force token tracking**: a Force button (ready, active) on Force bases, or on every base with Force tokens set to Always; Mystic Monastery shows its uses left
- **Screen wake lock**: prevents the device screen from sleeping while on a game screen (always on in the SWU game)
- **Drag-to-scrub**: dragging on the SWU card applies several damage at once (up adds, down removes), with the running amount shown on the card; the optional − and + buttons (and X-Wing's buttons) take a press and upward drag
- **Game action log**: a scrollable overlay listing the game's events (damage, epic action, Force, rounds, results); the most recent entry has Undo, which restores the previous state. Always on in the SWU game, opened from Log in the right margin
- **Round tracker**: on the SWU game screen, the Round button at the foot of the right margin appears once the game has started (by tapping the card) and moves to the next round on each tap, adding an undoable log entry. X-Wing has its own round tracker bar (see `XwingGameScreen`). Advancing the round in X-Wing resets initiative to neutral (to reflect the per-round roll-off); SWU does not reset initiative on round advance (initiative is set once per game by a roll-off and held until the end of the game).
- **Initiative bar**: on the SWU game screen, a bar in the left margin with OPP and YOU as square buttons at each end and INIT between; the side holding initiative fills in, and the bar is outlined until someone takes it. X-Wing uses `InitiativeToggle`, a vertical bar with a sliding counter. State is managed by `useInitiative`. Gated by the `enableInitiativeBar` setting, shown in Settings as **Initiative** (on by default; it also gates the 2-player Initiative buttons).
- **User settings**: persistent preferences on one Settings page, reached from the More menu on the setup and game screens and from game select: Start screen; SWU hyperspace art, Force tokens, Melee player ID, damage −/+ buttons, initiative; X-Wing phase tracker (off for a new install), score −/+ buttons and a Squad lists button. Timer lengths are stored too but set on each game's timer. Wake lock, the action log, epic actions, the tournament selector, favourites and long-press are always on, with no setting
- **Format**: chosen only for a tournament, as Premier / Eternal / Limited on the start sheet (remembered); while Tournament is chosen, the base sheet lists only bases legal in that format (`formatFilter.ts`) and an SWUDB deck with an illegal base says so; a casual game has no format and lists every base
- **Match** — SWU setup always shows Casual / Tournament, kept between launches; Tournament makes the primary **Start tournament**, which opens a start sheet (Format, Best of 1 or 3, Rounds) whose **Start round 1** goes straight to the game. In **competitive play** (beta) a **score panel** in the right column of the game screen (fixed 16vw from top, below the ⚙ button) is styled as a vertical bar (matching the initiative bar — same `BAR_CONTAINER_STYLE` and `BAR_LABEL_STYLE` font) containing **OPP** at the top, opponent markers, a **countdown timer / DRAW**, player markers, and **YOU** at the bottom; **OPP** and **YOU** are `flex:1` transparent tap zones (no border) in their default state, styled with `BAR_LABEL_STYLE`; tapping **OPP** replaces its label with a counter-sized **LOSE** button (`max(4vw, 28px)` height, 80% width, `--color-error` accent, `rgba(--color-error-rgb, 0.18)` background); tapping **YOU** replaces its label with a counter-sized **WIN** button (`--color-success` accent, same sizing); tapping the LOSE/WIN button confirms the result; the **DRAW** slot (between markers, in the absolutely-positioned centre block) is visible before the first game and when the timer expires — rendered as plain muted text initially; tapping it once highlights it with `--color-warning` amber (border + background); tapping it again records the draw; reaching 0 HP auto-triggers LOSE (replaces OPP); when the timer expires mid-match any recorded result also closes the match; undo on the game-result log entry restores the previous score, damage, and log state; in Bo3, the counter shows "Start Game N" between games; when the match is decided, "Match Won", "Match Lost", or "Match Drawn" is displayed
- **Favourites** — the Favourite toggle on the SWU setup base card marks your base as a favourite; favourites come first in the base sheet; the star adds and removes them (there is no favourites setting or list in Settings)
- **Tournament mode** (beta) — started from SWU setup's start sheet (Format Premier / Eternal / Limited, Best of 1 or 3, Rounds 2–16, all fixed once round 1 starts), then a between-rounds screen that tracks every round of a structured event (e.g. a local game-store Premier event); persists tournament state across sessions so the app can be closed between rounds, and launch reopens it; shows the record (W–L–D), cumulative points (Win=3, Draw=1, Loss=0) and your base beside a list of every round (result and games score, the next one marked, later ones dimmed); Drop is confirmed in a sheet, and a complete tournament offers Finish; game state (damage counter, action log) is preserved when navigating between the game screen and the tournament screen mid-match — the game screen stays mounted behind the tournament screen via `display: none` and the Back button does not reset game state when `isInTournament` is true
- **Offline capability** — PWA support means the app can be installed and used without a network connection

The app is served at the root of `dmgctrl.app` and is designed to be added to an iOS home screen for a native-like experience.

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
- Not a unified data layer — X-Wing is a self-contained tracker with no card data; the SWU card data layer is SWU-specific

---

## 3. Technology Stack

| Concern | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite |
| PWA | vite-plugin-pwa (Workbox) |
| Styling | Inline styles + CSS custom properties (no CSS framework) |
| Data fetching | Custom React hooks (`useBases`) |
| Testing | Vitest + React Testing Library |
| CI/CD | GitHub Actions → GitHub Pages, with a Cloudflare Worker per pull request as its preview |
| Markdown | Custom Vite plugin (`marked`) — transforms `.md` to HTML string exports |
| API proxy | Cloudflare Worker (`worker.dmgctrl.app`) — proxies card data and receives analytics events |
| Analytics storage | InfluxDB Cloud free tier — time-series store for custom game events; queried via SQL |

---

## 4. Application Architecture

### High-level structure

```
App
├── launchScreen()        (pure: the screen App opens at, from the tournament, the address, Start screen and the last game played; `src/utils/appStart.ts`)
├── useInstallPrompt      (hook: install banner state: second launch, 30-day Not now, standalone detection, platform, deferred prompt)
├── SwuSplash / SwuOffline (standalone screens in place of SWU setup while it has no card data: loading, or the fetch failed)
├── GameSelectScreen      (standalone screen: header with Help and Settings buttons; a tile per game, the one played last marked Last played; the install banner under the tiles)
├── InstallBanner         (view: one row: Android Install, iPhone Safari steps, Not now; floats at the foot of the setup screens)
├── XwingSetupScreen      (standalone screen, kept mounted by App while in X-Wing — X-Wing game setup built from the shared controls; portrait + landscape layouts; top bar Back / "X-Wing" / More (sheet: Squad lists, Help, Settings); a card per player — your remembered list pre-filled, the opponent's asking "Choose opponent's list" with last game's opponent one tap away — each opening a list sheet of saved lists, Import XWS and No list last (manual deficit stepper 0–4, the only deficit shown); Match segmented control (Casual/Tournament) with Rounds stepper (2–10) for Tournament; Scenario select sheet (None + 5 named) with a roll button; primary "Go to game" disabled until both have chosen; match, rounds, your list and the last opponent persisted to `xwing_setup`, the opponent's choice, deficits and scenario session-only but kept across Squad Lists, Help, Settings and a game)
│   ├── useXwingSetup     (hook — ruleset, matchType, rounds, your list and the last opponent persisted to localStorage; the opponent's choice, No list, playerDeficit/opponentDeficit (clamped 0–4) and scenario session-only)
│   ├── useXwingLists (hook — shared via XwingListsProvider, which App wraps around its screens; saved squad lists {id,name,pilots,faction?,createdAt?} persisted to `xwing_favourites`; save (replaces same name)/rename/remove/clear)
│   └── XwingSetupScreenView (view — header has a Squad lists button that opens XwingListsScreen)
├── XwingListsScreen      (standalone overlay screen via backStack — create a list by pasting XWS (validated, named, overwrite prompt on name clash); saved lists show name + points + faction, tap to show pilots, rename, delete, Clear All; opened from X-Wing setup or Settings › X-Wing › Squad lists)
│   ├── useXwingLists     (hook)
│   └── XwingListsScreenView (view — saved lists and new-list panels; side by side in landscape, stacked in portrait)
├── XwingGameScreen       (standalone screen, landscape only with RotatePrompt: three columns, your ships | centre panel | opponent's ships. Receives deficits, scenario, match type and both pilot lists from setup. Ship tiles are the whole target (tap: half, again or long-press: destroyed, stays in place), laid out by `shipRows`; the centre panel holds the round-and-timer button, both scores and, by state, Start game, the phase button (with initiative in Planning and FIRST under a score), the phases-off round button and mission points, or game over (result, score breakdown, Rematch, One more round in Casual after time or round 12, New setup). Score −/+ show over a column only with `enableXwingAlwaysIncDec` or when that side has no list. Log as a drawer (`Sheet`), newest first by round; Undo takes back the newest entry. Game length set in the round-and-timer sheet before Start game, stored as `xwingTimerMinutes`)
│   ├── useGameHistory    (hook — generic ordered history; each HistoryEntry<TSnapshot> stores id, type, message, color, snapshot; add/undoLast/reset)
│   ├── useXwingGame      (hook — scores, scenario scores, round, gameOver, result; endGame, reopenForRound (One more round, may pass round 12), reset, restoreState for undo)
│   ├── usePhaseTracker   (hook — generic phase cycling; accepts readonly string[] phases; returns phase, phaseIndex, isLastPhase, advance(), reset(), restore(index); XWING_PHASES exported)
│   ├── useInitiative     (hook — initiative state: 'player' | 'opponent' | null; toggleOpponent, togglePlayer, reset)
│   ├── useTimer          (hook — countdown; start, stop, reset, resume)
│   ├── useWakeLock       (hook)
│   └── XwingGameScreenView (view)
├── SwuSetupScreen        (container)
│   ├── useSwuSetup       (hook — kept base, recent bases, match, mode (1 or 2 players), their base; persisted under `swu_setup`)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   ├── useFavourites     (hook — favourites list, add/remove)
│   ├── SwuSetupScreenView (view — shared controls: top bar with More (Help, Settings), Your base card, Their base card in 2 players, Mode, Match, Go to game / Start tournament / Go to tournament; the Start a tournament sheet: Format, Match, Rounds, base legality)
│   │   └── SwuBaseSheet  (view: the base sheet, with favourites, recent, search with aspect filters, SWUDB link)
│   │   └── ImagePreview  (pure view — renders art or error message from props)
├── SwuGameScreen         (container)
│   ├── useSwuGame        (hook — damage counter, epic action used, Force active, Mystic Monastery uses, round)
│   ├── useBaseArt        (hook — ordered art fallback chain, image load state)
│   ├── useWakeLock       (hook — prevents screen sleep during gameplay via Screen Wake Lock API)
│   ├── useGameHistory    (hook — generic action-log hook; each `HistoryEntry<SwuGameSnapshot>` records id, type, message, color, and a full game snapshot for undo; shared with X-Wing)
│   ├── useMatch          (hook — match scores: playerScore, opponentScore, matchOver, matchResult; incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState)
│   ├── useTimer          (hook — countdown timer: remaining seconds, isRunning, isExpired; start, stop, reset, resume; start is idempotent; stop freezes remaining without reset; resume restarts counting from original start time, accounting for elapsed time during the stopped period; wall-clock based — catches up after screen-off via visibilitychange)
│   ├── useInitiative     (hook — initiative state: 'player' | 'opponent' | null; toggleOpponent, togglePlayer, reset)
│   ├── GameLogOverlay    (view — scrollable log panel of the SWU game screens (X-Wing has its own log drawer); auto-scrolls to latest entry; undo button on last undoable entry; round-type entries get a blue gradient with flat bottom corners and a top separator border, applied to all round entries including the first)
│   ├── SwuGameScreenView (view, 1 player: left margin, card, right margin; the card is the damage control via useCardDrag; End game, Game over, More, Round and timer and base sheets from shared/controls.tsx)
│   └── SwuGame2pView     (view, 2 players: SplitScreenLayout with a half each, their half turned round, and the shared strip between; built from the same pieces in swuGamePieces.tsx)
├── useTournament         (hook, called by App: tournament state: rounds, results, totals; persisted to localStorage)
├── SwuTournamentScreen   (container: between rounds)
│   └── SwuTournamentScreenView (view: shared controls, with header with Back and More, record, your base, every round, Start round N, Drop sheet, Player portal, Finish; portrait and landscape layouts)
│       └── SwuBaseSheet  (view: the base sheet, for a Limited base change between games)
├── HelpScreen         (standalone screen — renders swuSetupHelp.md, swuGameHelp.md, swuTournamentHelp.md, xwingGameHelp.md, xwingSetupHelp.md, xwingListsHelp.md, or settingsHelp.md based on source prop: 'setup', 'game', 'tournament', 'xwing', 'xwingSetup', 'xwingLists', or 'settings' (no screen opens 'settings' now that Settings has no Help button); title row: back button + icon + "Help" h1)
└── SettingsScreen     (container — reads and writes useUserSettings; reports each choice with onSettingChanged)
    ├── useUserSettings   (hook — persistent user preferences)
    └── SettingsScreenView (view — one page from the shared controls, no tabs, no Help: Back and "Settings"; groups General (Start screen SelectButton opening a Sheet of OptionRows), Star Wars: Unlimited (Hyperspace art, Force tokens SegmentedControl, Melee player ID, Damage −/+ buttons, Initiative) and X-Wing (Phase tracker, Score −/+ buttons, Squad lists Button); switches are a local SwitchRow; landscape: General and X-Wing left, SWU right; portrait: stacked, with a line under each X-Wing switch)

Each screen is wrapped in AppScreenLayout (shared layout component)
```

### Container / View pattern

Every screen is split into two files:

- **Container** (e.g. `swuGameScreen.tsx`) — owns all logic. Calls hooks, computes derived state, defines event handlers, and passes everything down as props.
- **View** (e.g. `swuGameScreenView.tsx`) — receives props and renders. Contains no business logic. Easy to test in isolation.

This pattern keeps views thin and ensures logic is tested via hook and container tests rather than integration tests that have to simulate complex UI interactions.

The exception is `SettingsScreenView`, which calls `useOrientation()` directly to choose its landscape or portrait layout.

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
| **Epic Action** | A special ability on some base cards that can be triggered once per game. The game screen shows an epic action button when the base's `epicAction` text contains "Epic Action" (case-insensitive), so passive abilities and Force bases are excluded. The button is disabled until the game has started; tapping it marks the ability as used, adds a log entry and shows the epic action token. Undo in the log reverts it. |
| **Epic action token** | The gold "EPIC ACTION USED" rectangle drawn over the card's text box once the epic action is used, mirroring the physical token. It is the only thing drawn over the card's text. |
| **Favourites** | A user-curated list of bases for quick reselection. Managed by `useFavourites`; persisted to localStorage under `favourites`. SWU setup shows a Favourite toggle on the base card, which adds and removes, and a Favourites section first in the base sheet. |
| **Force** | A recurring ability on some LOF base cards, identified by the phrase "The Force is with you" in their `epicAction` text. With Force tokens set to Always, every base has a Force button, for games where the Force comes from a card or leader. |
| **Force token button** | The button in the game screen's left margin that tracks the Force: ready (tap to gain the Force) and active (filled, tap to clear when used). Disabled until the game has started. On Mystic Monastery it shows the uses left. |
| **Action log** | The scrollable game event log, over the game screen: `GameLogOverlay` on the SWU screens, a drawer (`Sheet`) on the X-Wing screen that lists entries newest first under their round. Managed by `useGameHistory<TSnapshot>` in both games: `useGameHistory<SwuGameSnapshot>` for SWU, `useGameHistory<XwingGameSnapshot>` for X-Wing. Each entry shows the event message and (for the last entry) an Undo button. All entries are undoable; undoing the first game's Round 1 entry also resets the timer. Round-type entries get a blue gradient header with a top separator border. Always on in both games. |
| **Round tracker** | In SWU: a round counter button in the bottom-right corner of the game screen. When round is 0 (start phase), tapping starts the game and advances to Round 1 (entry is undoable; undoing it also resets the timer). When round ≥ 1, each tap increments the round and adds an undoable round entry. Only visible when the action log is enabled; hidden when the match is over. In X-Wing: a continuous 12-segment bar spanning the top of the screen; see `XwingGameScreen`. |
| **HistoryEntry** | The record stored by `useGameHistory<TSnapshot>` for each action. Fields: `id` (UUID), `type` (string tag for styling: `hit`, `heal`, `epic`, `force-gain`, `force-use`, `monastery`, `round`, `game-result`), `message`, `color` (left strip accent), `snapshot` (full game state before the action — typed as `TSnapshot`), optional `undoable` (defaults to true; set false to suppress the Undo button). `GameLogOverlay` accepts `LogEntryLike[]` (the common structural subset) so both `HistoryEntry<SwuGameSnapshot>` and `HistoryEntry<XwingGameSnapshot>` can be passed without casting. |
| **UserSettingsProvider** | The React Context provider from `useUserSettings.ts`. Wraps the app in `main.tsx` so all screens share one settings instance. Updates propagate immediately to all mounted consumers. |
| **Hyperspace** | A premium variant of a card with alternate artwork. In this app, the `useHyperspace` setting (in `useUserSettings`) controls whether the Hyperspace variant is preferred on the game screen. |
| **Splash** | `SwuSplash`: the app icon, a progress bar and "Getting SWU card data", shown in place of SWU setup only while `useBases()` is loading with nothing cached. `useBases()` reads its cache, of any age, on the first render, so with card data on hand there is no splash at all. |
| **Last game played** | The game whose setup opened last, stored under `last_game` (`swu` or `xwing`). The default Start screen opens its setup; game select marks its tile. |
| **Game addresses** | `/swu` and `/xwing`. The build writes the app's page at `swu/index.html` and `xwing/index.html` (GitHub Pages has no fallback), the service worker precaches both, and the manifest's `shortcuts` point at them. One install, started at the root. |
| **Standard art** | The default card artwork. `frontArt` is the swu-db.com hi-res version (1560×1120); `frontArtLowRes` is the swuapi.com version (400×286). |
| **hyperspaceArt** | The reliable low-res hyperspace image URL from swuapi.com (`cdn.starwarsunlimited.com`, 400×286). `null` for SOR/SHD/TWI (no longer in swuapi.com). |
| **hyperspaceArtHiRes** | A constructed hi-res hyperspace image URL from swu-db.com (`cdn.swu-db.com`, 1560×1120). Derived from card number for active sets, or from the static offset map for SOR/SHD/TWI. May 403 for a small number of unindexed cards. |
| **Static hyperspace map** | A hardcoded mapping of SOR, SHD, and TWI base card numbers to their hyperspace card numbers (offset). Used because those sets no longer appear in swuapi.com. |
| **Fallback chain** | The ordered list of image URLs managed by `useBaseArt`. Hyperspace preferred: `[hyperspaceArtHiRes, hyperspaceArt, frontArt, frontArtLowRes]`. Normal preferred: `[frontArt, frontArtLowRes, hyperspaceArtHiRes, hyperspaceArt]`. The next URL is tried on `onError`; text fallback shown only when all are exhausted. |
| **Container** | A React component that owns logic — calls hooks, computes derived state, and passes everything to a View component as props. |
| **View** | A React component that only renders — receives all data and callbacks as props, contains no business logic. |
| **AppScreenLayout** | The shared full-screen layout wrapper that provides background, safe area padding, and star field for every screen. |
| **Tournament mode** | A screen (`SwuTournamentScreen`) for tracking multiple rounds in a structured event, started from the start sheet on SWU setup. State is persisted to localStorage under `tournament_state` so the app can be closed between rounds. Has a format (Premier, Eternal or Limited) and supports Bo1 and Bo3 match formats with a configurable total round count. The `useTournament` hook manages `TournamentState` (base, format, playMode, totalRounds, rounds[]) and `TournamentRound` (roundNumber, playerScore, opponentScore, result, submitted) records. |
| **CSS custom properties** | Variables defined in `:root` in `index.css` (e.g. `--color-accent`) and referenced in inline styles via `var()`. Single source of truth for the colour palette. |
| **Screen Wake Lock** | A browser API (`navigator.wakeLock.request('screen')`) that prevents the device screen from sleeping. Used by `useWakeLock`: always held on the SWU and X-Wing game screens. Supported on Android Chrome and iOS Safari PWA (iOS 16.4+). |
| **swu-db proxy** | A Cloudflare Worker at `worker.dmgctrl.app` that proxies requests to swu-db.com and swudb.com to avoid CORS issues, and exposes a `POST /analytics` endpoint that writes structured game events to InfluxDB Cloud in line-protocol format. Credentials are stored as Cloudflare Worker secrets. The card-data proxy routes use open CORS (`*`); the analytics endpoint restricts to an allowed-origins set (`https://dmgctrl.app`, `https://dev.dmgctrl.app`). |
| **PWA** | Progressive Web App — a web app that can be installed on a device and used offline. |
