# dmgCtrl — Architecture: Implementation Details

> **See also:** [Overview](architecture-overview.md) | [Process & Testing](architecture-process.md)

---

## 1. Folder Structure

```
src/
  App.tsx                  Root component — screen routing and top-level state; calls useBases() to drive loading screen transition; loads the three X-Wing screens (setup, game, Squad Lists) with `React.lazy` behind one `Suspense` (fallback `null`), so they and the XWA card table ship as separate chunks fetched on entering X-Wing, not in the main bundle; the service worker precaches those chunks, so X-Wing works offline
  main.tsx                 Entry point
  index.css                Global reset, CSS custom property palette, help screen styles
  markdown.d.ts            Type declaration for .md imports
  vite-env.d.ts            Vite environment types

  components/
    layout/
      appScreenLayout.tsx  Shared full-screen layout wrapper (background, safe area)
      splitScreenLayout.tsx One phone shared by two players facing each other: `top`, `middle` and `bottom` in a portrait column, each half a `<section>` named by `topLabel` / `bottomLabel` and a size container (`container-type: size`, so its contents size with `cq` units); the top half is turned 180°. Chosen by mode, not by `isPortrait`: when `screen.orientation.angle` (or the legacy `window.orientation`) reports a landscape turn, the whole frame (`split-screen`) swaps to 100vh × 100vw and turns back by that angle, so the halves stay put on the phone. Knows nothing about SWU
      rotatePrompt.tsx     Landscape-only prompt — renders a full-screen "Please rotate to landscape" message with a Back button; used by swuGameScreen and xwingGameScreen when isPortrait is true; Back button uses `NAV_BTN_STYLE` spread with `position: absolute` at `calc(env(safe-area-inset-*) + 2vw)`, matching the game screen button positions
    icons.tsx               Reusable SVG icon components (BackIcon, ForwardIcon, HelpIcon, CogIcon, LogIcon, ShareIcon, HomeScreenIcon, DotsIcon, ChevronDownIcon, DiceIcon, CheckIcon, EditIcon, ListIcon, CloseIcon, StarIcon, SearchIcon, PlusIcon)
    imagePreview.tsx        Pure view — renders card art or error message from props; fill='width' (default) constrains by width with aspect-ratio height; fill='height' constrains by height with aspect-ratio width, right-aligned via marginLeft:auto, or centred with `centred`; uses useLayoutEffect to check img.complete on mount so cached images show immediately without waiting for a load event that the browser may not re-fire
    initiativeToggle.tsx    Initiative bar component — vertical bar with two transparent tap zones (top half = OPP, bottom half = YOU) and a sliding counter; counter uses `transition: 'top 0.2s ease, opacity 0.15s'` between three positions (top inset = opponent, bottom inset = player, `calc(50% - COUNTER_H / 2)` = neutral); counter height `max(4vw, 28px)` (square, matches bar width); counter is invisible (`opacity: 0`) when neutral, visible (`opacity: 1`) when active; counter label shows "OPP" or "YOU" when active, empty string when neutral; a static "INIT" label in the centre identifies the bar's purpose — conditionally rendered based on available bar height; hides on compact screens; external OPP/YOU labels at top/bottom edges fade out as the counter slides over them; optical padding: `INSET_TOP = '4px'` (top of bar), `INSET_BOTTOM = '6px'` (bottom of bar) — asymmetric values compensate for the optical illusion where equal padding appears unequal; `data-testid="initiative-indicator"` with `data-position` attribute ('opponent' | 'player' | 'none'); tap zones use `data-testid="initiative-opp-zone"` / `data-testid="initiative-you-zone"`; props: `initiative: Initiative`, `onSetOpponent: () => void`, `onSetPlayer: () => void`, `interactive?: boolean` (default true — when false, tap zones are not rendered; used to lock initiative during non-Planning phases in X-Wing); uses `BAR_LABEL_STYLE` from `src/styles/barContainer.ts`
    gameLogOverlay.tsx      Game screen action log overlay — scrollable entry list; auto-scrolls to bottom; undo button on last entry (hidden when `undoable === false`); `round`-type entries get a blue gradient (`rgba(59,130,246,0.2) → rgba(59,130,246,0)` — explicit zero-alpha endpoint avoids the CSS `transparent`/black-interpolation rendering artefact), a `1px solid rgba(147,197,253,0.4)` top border, `borderRadius: '4px 4px 0 0'` (flat bottom corners so the gradient is never clipped mid-fade), and `paddingTop: 0.35rem`; all three apply to every round entry including the first (`i > 0` guard removed); non-first round entries additionally get `marginTop: 0.35rem` for visual separation from preceding content; last entry gets `rgba(255,255,255,0.08)` highlight unless it is a round entry; accepts `LogEntryLike[]` (id, type, message, color, optional undoable) so it works with `HistoryEntry<unknown>[]` from both SWU and X-Wing without casting; an optional `position` replaces its place on the left of the screen
    shared/
      timerDisplay.tsx      Shared countdown display — renders `formatTime(remaining)` with colour thresholds: > 5:00 → `--color-text-muted`, ≤ 5:00 → `--color-warning`, ≤ 1:00 → `--color-error`; accepts `remaining`, optional `testId` (default `"timer-display"`), optional `style` overrides spread after the component's own colour; used by both SWU game screen view (non-interactive timer branch) and X-Wing game screen view
      controls.tsx          The X-Wing control set agreed in #853 (filled, radius 12, at least 44px; colours from the `--color-on-accent`, `--color-surface`, `--color-surface-raised`, `--color-tonal`, `--color-tonal-text`, `--color-sheet` and `--color-backdrop` tokens): `Button` (`variant` `primary` — accent fill, the screen's one next step — or `secondary` — tonal fill; `disabled`; always `type="button"`), `IconButton` (44×44 unless a `style` override sizes it, as in the SWU game's 60px margins; named by its required `label`; for back, log, more and roll only), `SegmentedControl` (a labelled `role="group"` of `aria-pressed` buttons; `value` may be `null` for nothing chosen), `SelectButton` (shows `value` with a chevron, named `"<label>: <value>"`, `aria-haspopup="dialog"`; opens a `Sheet` in place of a native select), `Stepper` (− value + with `min`/`max`/`step`, buttons named `Decrease <label>`/`Increase <label>` and disabled at the limits), `Sheet` (modal `role="dialog"` named by its `title`, with a Close button; closes on the backdrop or Escape; `data-placement` `side` in landscape, `bottom` in portrait; a `wide` sheet, for a grid of choices, is `full` in landscape: the whole screen but a 10px margin)
      timerStepper.tsx      Shared [−] value [+] stepper for timer duration settings — props: `label`, optional `labelStyle?: React.CSSProperties` (overrides default muted 0.85em label style; used by XwingSetupScreenView deficit rows to match the orientation-aware `labelStyle(small)` of the other rows), `value`, optional `min`/`max`/`step` (arithmetic stepping), optional `values: number[]` (non-uniform value list — index-based stepping, overrides min/max/step), optional `formatValue: (v: number) => string` (custom display label; defaults to `${v} min`), `onChange: (v: number) => void`, `testId`; `data-testid` on the inner flex container; used by SettingsScreenView for bo1/bo3 (arithmetic 5–90 step 5) and X-Wing game timer (non-uniform list [5.5, 30, 35, …, 90], 5.5 formatted as '5:30 (test)')
      xwsListFields.tsx     Shared XWS list fields — `TextareaField` (paste textarea with a connected error box; maps `parseXwsText` error codes to descriptive messages) and `PilotList` (confirmed list as `displayName - ship | points` rows via `displayPilots()`); used by the X-Wing setup and lists screens
    swuGameScreen.tsx       Game screen container, for 1 and 2 players (`theirBase` given: 2 players). Uses RotatePrompt for portrait orientation in 1 player only; owns the game (and in 2 players a second `useSwuGame` for their base; the round lives in yours), match, timer, initiative and log hooks, the End game sheet state (`endGameOpen`, `endGameChoice`, opened with Lost when your base reaches 0 HP and Won when theirs does), the casual Game over sheet and `lastGame` (with `theirDamage` in 2 players); `sideOf` builds one base's handlers (damage, epic action, Force, Mystic Monastery), naming the base in log entries in 2 players ("Their base: 3 damage"); snapshots hold both bases, so undo restores either; `handleStartGame` records `gameStartTime`, fires `onGameStart` and adds an undoable Round 1 entry; `handleRecord` updates the match (not in casual), resets both bases, logs a `game-result` entry and fires `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)`; `handleReset` (Back) fires `onGameEnd` if a game is under way. Renders `SwuGameScreenView` or `SwuGame2pView` from the same props
    swuGamePieces.tsx       The pieces both SWU game views share: `BaseCard` (the card `<button>`, driven by `useCardDrag`, with the damage, HP left, Start and match states in its open art from a `CardFace`, and the epic action token over its text box; every size on it scales from `unit`, one hundredth of its height), `EpicActionButton`, `ForceButton`, `SheetActions`, and `GameSheets` (More, Change base, Round and timer, End game). Styles and words in `swuGameStyles.ts` (`marginButton`, `DISABLED_BTN`, `mutedText`, `RESULT_WORD`, the card's aspect ratio)
    swuGameScreenView.tsx   Game screen view, 1 player: a grid of left margin, card and right margin built from `shared/controls.tsx` and `swuGamePieces.tsx`; the card's sizes scale from 1vh; margins hold Back, epic action, Force, the initiative bar, Log, More, the timer and Games chips, Round, End game and the optional − / +; owns which sheet is open and renders the Game over sheet. Exports `SwuGameViewProps`
    swuGame2pView.tsx       Game screen view, 2 players: `SplitScreenLayout` with their half on top (turned round) and yours below, each a `Half`: the base card at the half's width (sized from the half with `cq` units), then a row at the player's edge with the epic action or Force, **Initiative** (one radio per half; filled on the holder, "Take initiative" outlined on the other) and the optional − / +. Their half's drags are `flipped`. The middle strip (`nav` "Game"): Back to setup, Log, Round (disabled before the game), the timer and score in a best of 1 or 3, End game (disabled before the game), More. After a casual game, each half shows its own result and the round and damage, the card keeps the damage it ended on, and the strip (`nav` "Game over") holds Log, New setup and Rematch. The log opens over your half
    xwingSetupScreen.tsx    X-Wing setup screen container — calls `useXwingSetup()` and `useXwingLists()`; `resolve(choice, lists)` turns each player's stored choice (`{ kind: 'none' }` or `{ kind: 'list', listId }`) into a `ResolvedChoice` with the list looked up — a list deleted on Squad Lists resolves to no choice, so that player picks again; looks up `lastOpponentListId` as `lastOpponentList` (null once that list is deleted); `canStart` once both players have a choice; `handleStart` gives a list player `Math.max(0, 50 − listPoints(pilots))` and its pilots, and a No list player the hook's manual deficit and no pilots; `handleScenarioRandom` picks a random entry from `XWING_NAMED_SCENARIOS`
    xwingSetupScreenView.tsx X-Wing setup screen view, built from `shared/controls.tsx` (#853 design) — top bar: Back and More `IconButton`s and an "X-Wing" title; More opens a `Sheet` with Squad lists (`onLists`), Help and Settings (`onSettings`), each closing the sheet first. Two cards (`player-card`, `opponent-card`): once chosen, a list shows its name (`{side}-chosen-name`), `listMeta()` line and a two-line `pilotSummary()` with a "Change list" button; No list shows "No list", the note "No ships to tap in the game" and a Deficit `Stepper` (0–4) — the only deficit shown; before choosing, your card has "Choose a list" and the opponent's asks "Choose opponent's list", offering last game's opponent (`lastOpponentList`) as a filled one-tap row ("Same as last game · …") above "Choose another list". Each card's button opens that side's list `Sheet` ("Your list" / "Opponent's list"): one `OptionRow` per saved list (`{side}-list-option-{id}`, the current one pressed), or "No saved lists yet", then Import XWS (`onLists`), then No list last (`{side}-no-list-btn`) as the fallback. Match `SegmentedControl` (Casual/Tournament) with a Rounds `Stepper` (2–10) for Tournament; Scenario `SelectButton` opening a Scenario sheet (None + the 5 named) and a Roll `IconButton`; primary "Go to game" disabled until `canStart`. Sets its own primary text colour (`xwing-setup`). **Portrait**: one scrolling column — top bar, your card, opponent card, Match section, Go to game at the bottom. **Landscape**: top bar, the two cards side by side, then one row with match, rounds, scenario, roll and Go to game. Exports `ResolvedChoice`
    xwingListsScreen.tsx    X-Wing Squad Lists screen container — calls `useXwingLists()`; owns the new-list form state (`text`, `error`, parsed `pilots`/`faction`, `name`); `handleCheck` runs `parseXwsText` (error code → `error`; success → parsed list and `name` pre-filled from the XWS name); `handleEdit` returns to the paste box with the text kept; `handleSave` calls `saveList(name.trim(), pilots, faction)` and resets the form; rename/delete/clear pass straight through to `renameList`/`removeList`/`clearLists`
    xwingListsScreenView.tsx X-Wing Squad Lists screen view — header (Back, "Squad Lists" h1, Help); `lists-layout` holds a **Saved lists** panel then a **New list** panel (side by side in landscape, stacked in portrait). Saved lists: one row per list with its name and `listMeta()` line (faction omitted when absent); tapping the row toggles its `PilotList`; **Rename** opens an inline input (blank disables save; a name used by another list shows "Another list already has that name."); **Delete** and **Clear All** each need a second tap to confirm; "No saved lists" when empty. New list: `TextareaField` + Check button; once valid, a name input + Edit button, the points/faction line, a `PilotList` preview and a Save button (disabled while the name is blank); saving under an existing name shows `Overwrite '{name}'?` with ✓/✕ first. View-level state: expanded row, rename draft/error, pending delete, Clear All confirm, overwrite prompt
    xwingGameScreen.tsx     X-Wing game screen container — receives `playerDeficit`, `opponentDeficit`, `scenario`, `playerPilots`, `opponentPilots` from App; `XwingGameSnapshot = { playerScore, opponentScore, playerScenarioScore, opponentScenarioScore, round, gameStarted, phaseIndex, gameOver, playerShips, opponentShips }` — ship states included so undo fully restores roster; `playerShips`/`opponentShips: ShipEntry[]` state initialised from pilot arrays in `handleStartGame` via `initShips()`; `handleStartGame` calls `game.reset()` (no args) so scores start at 0 — deficits are not applied at game start; `handleShipAdvance(side, index, skip)` — advances a ship through `alive → half → destroyed` (tap) or `alive → destroyed` (long-press, skip=true); awards `halfPoints(pts)` on damage and `remainingPoints(pts)` on destroy (or all pts when skipping); after each destruction checks `allDestroyed = nextState === 'destroyed' && updated.every(s => s.state === 'destroyed')` — when true, the relevant deficit (opponent's for a player ship, player's for an opponent ship) is bundled into the same `game.incrementOpponent/Player(pts + deficit)` call so undo reverts both together; logs `"<DisplayName> — Damaged (<pts>)"` / `"<DisplayName> — Destroyed (<pts> +N deficit)"` (suffix omitted when deficit is 0); zero-point ships transition state but produce no score change and no log entry unless the deficit applies; `handleLogUndo` restores `playerShips`/`opponentShips` from snapshot alongside score and phase; ending a round (confirming the End phase, or the round tracker) ends the game through `finishGame` when it is round 12, the timer has expired, or `reachesTarget` holds for the combined totals plus the round's pending scenario points, which are added before the result is decided; reaching 50 mid-round neither ends the game nor locks the counters; `handleLogUndo` resumes the timer when the restored snapshot's `gameOver` is false
    xwingGameScreenView.tsx X-Wing game screen view — three-column layout (player | centre | opponent); pre-game: score columns display 0 (deficits are not shown; they are only awarded at game end when ships are destroyed), centre shows "Start Game"; post-game-start: score columns show combined (ship + scenario) live scores; pilot area in each outer column switches on `gameStarted && ships.length > 0`: when active shows a scrollable column of `ShipButton` entries (alive/half visible, destroyed hidden), otherwise falls back to text pilot list pre-game or flex spacer; `ShipButton` — dmgCtrl icon (PNG) + pilot name label; icon inner side (player column: icon-right, name-left; opponent column: icon-left, name-right); `side: 'player' | 'opponent'` prop controls `data-testid` independently from `align` so flipping the icon position does not break test IDs; duplicate pilot names are numbered using `displayPilots()` called with the full squad array; `half` state renders both icon and name in `--color-warning` amber via CSS filter on image; long-press (≥400ms, ≤10px move) calls `onAdvance(index, skip=true)`; tap (pointerDown+pointerUp within 400ms) calls `onAdvance(index, skip=false)`; long-press detection uses per-button `useRef<setTimeout>` with `pointerDown`/`pointerMove`/`pointerUp`/`pointerCancel` handlers; player inc/dec shown when `gameStarted && (enableXwingAlwaysIncDec || (!scenarioScoringActive && !(opponentShips?.length > 0)))`; opponent inc/dec shown under the symmetric condition — so by default inc/dec are hidden when the opposing side has ship buttons or scenario scoring is active; when `enableXwingAlwaysIncDec` is true both sides' inc/dec are always visible regardless of ship lists or phase; inc/dec buttons positioned vertically equidistant between the round tracker bottom and the top of the score numbers via `calc(-3.5vw + 5vmin + min(0px, 4.5vw - 16.5vmin + env(safe-area-inset-top)/4 + env(safe-area-inset-bottom)/4))`; player `+` button right-aligns with ShipButton icon RHS; opponent `−` button left-aligns with ShipButton icon LHS; centre column: `TimerDisplay` during game, result banner at game over, scenario name subtitle when `gameStarted && scenario !== 'None'`, phase button in fixed bottom slot; scenario buttons ([0][2][4] player, [4][2][0] opponent) displayed as a 2×3 grid (`gridTemplateColumns: '5vw 5vw'`, `columnGap: 'max(2vmin, calc(4ch + 1em - 10vw))'`, `fontSize: clamp(1.2rem, 8vmin, 3.5rem)` on the container so `ch`/`em` resolve relative to the timer font) in the centre column, pinned to bottom via spacer-above strategy, when `scenarioScoringActive`; outer column button slots become empty spacers (`height: 10vmin`) to reserve alignment space; `paddingBottom` of the three-column row switches: `2vw` for scenario scoring (allows grid to reach log button bottom), `8vw` for ship-based games (prevents pilot list overlapping the absolutely-positioned log button), `2vw` pre-game; `SCENARIO_BTN(selected, disabled)`; `getDisabledOpponentValues` / `getDisabledPlayerValues` — pure functions, `Set<number>` of values to disable; Chance Engagement uses `VALID_CHANCE_PAIRS = [[0,0],[2,2],[4,0],[0,4]]`; round tracker and initiative bar unchanged
    helpScreen.tsx       Help screen (renders swuSetupHelp.md, swuGameHelp.md, swuTournamentHelp.md, xwingGameHelp.md, xwingSetupHelp.md, xwingListsHelp.md, or settingsHelp.md based on source prop ('setup', 'game', 'tournament', 'xwing', 'xwingSetup', 'xwingLists', or 'settings'); title row: back button + icon + "Help" h1)
    swuLoadingScreen.tsx    Loading screen (icon + "LOADING" text; calls onReady as soon as loading prop becomes false)
    gameSelectScreen.tsx Game select screen — entry point when startScreen is 'gameSelect' (default); header: app icon (`5vw × 5vw, minWidth/minHeight: 36px` — same footprint as `NAV_BTN_STYLE`) + `dmgCtrl` h1 (`lineHeight: 0.8`) on the left, ⚙ settings button (`NAV_BTN_STYLE`) on the right; gap between icon and title is `2vw` portrait / `1vw` landscape, matching the setup screen back-button gap so the title lands at the same horizontal position on both screens; outer padding `2vw` portrait / `2vw 2vw 3vw` landscape; logo buttons sized explicitly at `min(65vmin, 300px)` width and height — `vmin` is always the device's shorter dimension regardless of orientation, so buttons are identical in size in both portrait and landscape (≈ 255px on iPhone, capped at 300px on iPad); this explicit sizing replaces the old `flex: 1 + aspectRatio` approach which was width-constrained and overflowed the available height in landscape; `flexShrink: 0` prevents squeeze; button inner padding is `64px` (fixed, not percentage) — CSS percentage padding resolves against the containing block width, which differs between orientations (the portrait column block is 255px wide while the landscape row block is 534px wide), so a percentage would produce different logo sizes; `64px` gives ≈ 127px logo display area in both orientations; inner container is just a flex row/column (no `maxWidth`) — outer game-button area is a centred flex that distributes remaining space evenly above and below; Star Wars Unlimited and Star Wars X-Wing logo buttons (both enabled, blue accent border + glow); no help button (help content is game-specific); `onSelectSwu` navigates to the SWU setup screen; `onSelectXwing` navigates to the X-Wing setup screen
    installBanner.tsx    Install prompt banner — fixed bottom sheet shown on the setup screen for non-standalone users; iOS variant shows a bulleted step list: "Tap [DotsIcon] then", "[ShareIcon] Share", "[ChevronDownIcon] View More", "[HomeScreenIcon] Add to Home Screen"; Android variant shows an "Install" button that triggers the deferred `beforeinstallprompt` prompt; dismiss button (×) hides the banner for the session; font size matches setup screen (`clamp(0.9rem, 3vw, 1.1rem)`) with `WebkitTextSizeAdjust: 100%` to prevent iOS rotation inflation; rendered by SwuSetupScreen alongside SwuSetupScreenView
    swuBaseSheet.tsx        The SWU base sheet (`Sheet` `wide`, titled "Choose your base" unless `title` says otherwise: setup's their-base sheet is "Choose their base"), used by setup and by the tournament screen's Limited base change. Its body mounts only while open, so it opens afresh each time: a search box and four aspect toggles (Vigilance, Command, Aggression, Cunning; one at a time, tap again to clear), then either the results (`"N bases · Aspect · “query”"`, group `Results`) or Favourites, then Recent (favourites not repeated), or All bases when there are neither; tiles (`BaseTile`: aspect icon, name, "SET · HP", the current base pressed with a check) call `onChoose`. Takes the bases it may offer (`bases`, already filtered by the caller). With `swudb` (setup only), **Paste SWUDB link** (in the search row in landscape, at the foot in portrait) switches to the import view: the link, Load, the error, the deck name with "Deck found · its base:" and its tile, **Search instead** and **Use this base**. Exports `SwudbImport` and `SwudbImportControls`
    swuSetupScreen.tsx      SWU setup container — `useSwuSetup(onConfirm, onStartTournament)` for the kept base, recent bases, match and tournament format; in a tournament, filters the base sheet's bases, favourites and recent bases to those legal in the format (`isBaseValidForFormat`), and reports an SWUDB deck whose base isn't legal (`formatValidationError`) in place of offering it; `useBaseArt` for the base card's art (and preloads the game screen's first image); resolves favourite records to bases from the card data (one no longer there is left out); owns the SWUDB import state (`SwudbImport`: link, error, deck name, the deck's base, loading) and its analytics; the Favourite toggle adds or removes the base (aspect `None` for an aspectless base) whatever the Enable Favourites setting; renders InstallBanner via useInstallPrompt; `onConfirm(base, mode)` for a casual game or to return to a tournament under way (`tournamentInProgress`), `onStartTournament(base, settings)` from the start sheet
    swuSetupScreenView.tsx  SWU setup view, built from `shared/controls.tsx` like X-Wing setup — top bar: Back and More `IconButton`s, the dmgCtrl mark (30px) and the "Star Wars: Unlimited" h1 (22px; 17px on one line in portrait); More opens a `Sheet` with Help and Settings, each closing the sheet first. **Your base** card (`base-card`): the Favourite toggle (star and word, `aria-pressed`), the base art (`ImagePreview`, by height and centred in landscape, by width in portrait), then the aspect icon, name and "SET · HP" beside **Change base**; with no base, one large "Choose your base" button (and the card data's error, if any). In 2 players, a **Their base** card (`their-base-card`, label in `--color-opponent`) built by the same function: no Favourite toggle, "Same as last game" in its header while `theirBaseFromLastGame`, "Choose their base" when empty, opening a second `SwuBaseSheet` titled "Choose their base" with the same bases, favourites and recent bases (your recents: their base never enters them). Mode `SegmentedControl` (`SWU_MODES`: 1 player / 2 players) above Match `SegmentedControl` (Casual/Tournament, always shown); primary **Go to game** (Casual), **Start tournament** (Tournament) or **Go to tournament** (a tournament under way), disabled until `ready` (your base, and theirs in 2 players), with "Choose their base to start." under it while only theirs is missing. **Start tournament** opens the start sheet (`Sheet`, "Start a tournament"), whose body mounts only while open: your base's name, or in its place the legality error (`formatValidationError`, `role="alert"`) with **Change base** (opens the base sheet); **Format** `SegmentedControl` (Premier / Eternal / Limited, `TOURNAMENT_FORMATS`, the remembered one chosen; changing it is saved); **Match** (Best of 1 / Best of 3, Best of 3 each time); a Rounds `Stepper` (2–16, 5 each time); "Fixed once round 1 starts.", plus "In Limited you can change base between games of a match." with Limited; **Cancel** and **Start round 1** (disabled while the base isn't legal), which closes the sheet and calls `onStartTournament({ format, playMode, totalRounds })`. Fits 390px high. The base sheet is `SwuBaseSheet`. **Landscape**: the card (two side by side in 2 players, Change base then under the name) beside the controls column (Mode, Match, primary at the foot; 284px in both modes), no scrolling at 844×390. **Portrait**: top bar, card (in 2 players both cards, sharing the height, art by height), Mode, Match, primary at the foot, no scrolling at 390×844. Re-exports `SwudbImport`
    settingsScreen.tsx   Settings screen container — reads `xwingTimerMinutes`/`setXwingTimerMinutes`, `startScreen`/`setStartScreen`, `enableXwingAlwaysIncDec`/`setEnableXwingAlwaysIncDec` from useUserSettings and passes to view alongside SWU timer values
    settingsScreenView.tsx Settings screen view — toggle list; General tab includes a **Start Screen** `<select>`; X-Wing tab contains `TimerStepper` for game timer (non-uniform values list [5.5, 30, 35, …, 90], 5.5 formatted as '5:30 (test)'), an **Enable Phase Tracker** `ToggleRow` (`id="toggle-xwing-phases"`) — controls `enableXwingPhases` setting, and an **Always Show +/− Buttons** `ToggleRow` (`id="toggle-xwing-always-inc-dec"`) — controls `enableXwingAlwaysIncDec` setting; landscape sidebar tabs use `writingMode: 'vertical-rl'` + `transform: 'rotate(180deg)'`; calls `useOrientation()` directly for iOS font sizing
    swuTournamentScreen.tsx  Tournament screen container, between rounds (rendered only while a tournament exists; it is started from the setup start sheet). `canChangeBase` (Limited + bo3 + matchInProgress + hasPlayedGameInCurrentMatch + !isComplete) gates **Change base**, whose options are the card data's bases of the registered base's set (`useBases`); `candidateBase` is passed to `onGoToGame` when chosen, omitted otherwise (App falls back to tournamentCurrentBase for the game screen); a new match calls `startMatch` and plays the registered base; Drop fires `onTournamentDropped`, Finish `onTournamentEnded`, each then `dropTournament` and `onDrop`; Player portal opens melee.gg with a player ID, otherwise Settings
    swuTournamentScreenView.tsx Tournament screen view, built from `shared/controls.tsx`. Header: Back and More `IconButton`s, "Tournament" or "Tournament complete" h1 and "SWU · Format · Best of N · R rounds" (under the header in portrait); More opens a `Sheet` with Help and Settings. **Record** (`section`): W–L–D, "N points", "Won w, lost l, drawn d"; **Your base** (`section`): aspect icon, name, "Your base for this tournament" (or "for the next game" once changed) and **Change base** when offered (opens `SwuBaseSheet`, search only). **Rounds** (`ol`): one row per round of the event — a played one shows Won / Lost / Drawn and the games score, the next one is outlined with `aria-current="step"` and reads Next (In progress mid-match), later ones at half opacity; the list scrolls within itself, the screen never does. Actions: **Drop** (opens the Drop sheet: the record, "This can’t be undone.", **Keep playing** and **Drop**), **Player portal** / **Enter player ID**, and the primary **Start round N** / **Return to round N**, or **Finish** when complete (no Drop then). **Landscape** (844×390): header, a 300px column (record, base) beside the rounds, the action row at the foot. **Portrait** (390×844): header, summary, record, base, rounds, primary, then Drop and Player portal side by side

  hooks/
    useBaseArt.ts           Ordered art fallback chain shared by setup, game, and tournament screens. Exports `getFirstGameImageUrl(base, useHyperspace)` which returns the first URL from the fallback chain, used by the setup screen to preload the game image while the user is still on the setup screen
    useDragScrubber.ts      Drag gestures. `useDragScrubber`: press and drag upward on a `+`/`−` button; exposes `dragIndicator` and pointer handlers; 15px dead zone; 14px per step from 2; capped at `Math.min(max, 20)`; suppresses the click after a drag; inactive when the reachable cap is < 2. `useCardDrag`: one surface for both directions (the SWU card); a tap calls `onTap`, dragging up adds and down removes from 1 past the same dead zone and step, capped at the capacity; exposes `amount` and pointer handlers. Both take `flipped` for a surface turned round (the far half of the SWU two-player screen), where up for its player is down the screen
    useBases.ts             Fetches and caches the full list of Base cards
    useInstallPrompt.ts     PWA install prompt — detects standalone mode, iOS (userAgent), and Android (captures `beforeinstallprompt` event); returns `{ showBanner, platform, onInstall, onDismiss }`; showBanner is true for iOS non-standalone, or Android non-standalone when the deferred prompt is available; dismissed state backed by `sessionStorage` under key `install_banner_dismissed` so it survives component unmount/remount within the same session but resets next session; onInstall calls `deferredPrompt.prompt()` then dismisses; onDismiss sets the sessionStorage flag and hides
    useFavourites.ts        Favourites list — add/remove/clear operations with deduplication on key; sorted by set then card number ascending; persists FavouriteBase[] to localStorage under key `favourites`; SWU setup's star and base sheet use it whatever enableFavourites says (Settings still gates its list on it)
    useInitiative.ts        Initiative state hook — `Initiative` type ('player' | 'opponent' | null); `useInitiative()` returns `{ initiative, setInitiative, cycle, setOpponent, setPlayer, reset }`; `cycle` advances null→player→opponent→null; `setOpponent` always sets to 'opponent' (no toggle-back to null — initiative, once set, stays set unless programmatically reset); `setPlayer` always sets to 'player'; `reset` sets to null (used programmatically, e.g. X-Wing round advance); used by both game screen containers
    useGameHistory.ts       Generic game history hook — `useGameHistory<TSnapshot>()`; each `HistoryEntry<TSnapshot>` records id, type, message, color, snapshot (full game state before the action); methods: `add`, `undoLast` (pops and returns the last entry, or null if empty), `reset`; used by both SWU and X-Wing game screens
    useOrientation.ts       Detects portrait vs landscape; returns isPortrait (via matchMedia change event) and vmin (Math.min(screen.width, screen.height) — stable across rotations)
    useSwuGame.ts           Damage counter, epic action used, Force active, Mystic Monastery uses left, round; snapshot / restoreState / reset
    usePhaseTracker.ts      Generic phase cycling hook — `usePhaseTracker(phases: readonly string[])` returns `{ phase, phaseIndex, isLastPhase, advance(), reset(), restore(index) }`; stateless re: game rules — just cycles through the provided array; `XWING_PHASES = ['Planning', 'System', 'Activation', 'Engagement', 'End'] as const` exported for use by XwingGameScreen
    useXwingGame.ts         X-Wing score state — playerScore, opponentScore, playerScenarioScore, opponentScenarioScore, round (starts at 1, clamps at 12), combinedPlayer, combinedOpponent (ship plus scenario points), gameOver, result; `gameOver` is set only by `endGame()`, so reaching 50 does not end the game by itself; scores have no ceiling; exports `XWING_TARGET_SCORE` (50) and `reachesTarget(playerTotal, opponentTotal)`, true when either total is at least 50; `result` computed from combined totals; `addScenarioPoints(player, opponent)` increments scenario scores (no-op when gameOver); `endGame()` sets `gameOver = true`; `reset()` resets all scores and scenario scores to 0; `restoreState({ playerScore, opponentScore, playerScenarioScore?, opponentScenarioScore?, round, gameOver? })` — optional fields default to 0 / false
    useXwingLists.ts        X-Wing saved squad lists, shared through `XwingListsProvider` (React Context; `App` wraps its screens in it, and `useXwingLists()` throws outside it) so every screen sees the same lists — `saveList(name, pilots, faction?)` (stamps `createdAt`; a list with the same name is replaced in place), `renameList(id, name)` (no-op if another list has that name), `removeList(id)`, `clearLists()`; each list is `{ id, name, pilots, faction?, createdAt? }` (`faction`/`createdAt` absent on lists saved before they existed); points are not stored — derived with `listPoints()`; persists `XwingList[]` to localStorage under key `xwing_favourites` (the key predates the rename and is kept so existing saved squads load unchanged); exports `XwingList` type
    useXwingSetup.ts        X-Wing setup screen state — ruleset (XwingRuleset), matchType (XwingMatchType) and rounds (2–10) persisted to localStorage under key `xwing_setup`, with `playerListId` (your list, pre-filled as `playerChoice` next time; only a saved list is remembered, never No list) and `lastOpponentListId` (set whenever the opponent chooses a saved list; exposed as `lastOpponentListId` to offer, while `opponentChoice` always starts `null`); each player's choice (`playerChoice`/`opponentChoice`: `XwingPlayerChoice` — `{ kind: 'none' }` or `{ kind: 'list', listId }` — or `null` before choosing), playerDeficit/opponentDeficit (0–4 each, clamped) and scenario (XwingScenario) are otherwise session-only; fields from older versions (`playerListImport`, `opponentListImport`, `listImport`) are ignored on load and dropped on the next save; defaults: ruleset='XWA', matchType='Casual', rounds=6, scenario='None'; exports `XWING_NAMED_SCENARIOS` (the 5 named scenario strings, excludes 'None') and `XwingScenario` / `XwingPlayerChoice` types
    useSwuSetup.ts          SWU setup state, persisted to localStorage under key `swu_setup`: `baseKey` (your base, kept across games and launches; exposed as `base`, resolved against the card data, so a key no longer there reads as no base), `recentBaseKeys` (the last 6 bases played, most recent first, each once; added by `handleSubmit`, exposed as `recentBases`) `matchType` (`casual` | `tournament`; read from the older `pref_play_mode` when there is no `swu_setup` yet, where `bo1`/`bo3` mean tournament) and `format` (the tournament format offered first: `premier` | `eternal` | `limited`, Premier by default; taken from the older `pref_format` when `swu_setup` has none), `mode` (`1p` | `2p`, from `SWU_MODES`, 1 player when missing or unreadable), `theirBaseKey` (their base in 2 players, kept like yours; exposed as `theirBase`) and `lastTheirBaseKey` (their base in the last 2-player game started; `theirBaseFromLastGame` is true while the two match); `chooseBase`, `chooseTheirBase`, `setMatchType`, `setMode`, `setFormat`, `ready` (your base, and theirs in 2 players), `handleSubmit` (when ready: records your base as recent, and in 2 players their base as the last game's, then `onConfirm(base, matchType)`, with `theirBase` as a third argument in 2 players), `handleStartTournament(settings)` (the same, then `onStartTournament(base, settings[, theirBase])`); also returns `bases`, `loading`, `error`. App keeps their base for the session (`selectedTheirBase`, not persisted: a tournament resumed after a reload plays 1 player) and passes it to the game screen as `theirBase`. Every save drops the retired keys `pref_format`, `pref_selection_mode` and `pref_play_mode`. Exports `SwuMode`, `SWU_MODES` (a new mode is one more entry), `TournamentFormat`, `TOURNAMENT_FORMATS` and `TournamentSettings` (`format`, `playMode`, `totalRounds`). Exports `baseKey(base)` (`SET-NUMBER`) and `filterBases(bases, query, aspect)` (name contains the trimmed query, ignoring case, and has the aspect when given; sorted by name; every set, whatever its format)
    useMatch.ts             Match score state — playerScore, opponentScore, matchOver (computed), matchResult ('won'|'lost'|'drawn'|null, computed), incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState; maxScore is 1 for bo1, 2 for bo3; scores are clamped at maxScore; matchOver also true when matchDrawn or matchClosedByTimer flags are set; matchResult derived from final scores when match closes early
    useTimer.ts             Countdown timer hook — remaining (seconds), isRunning, isExpired; start (idempotent — only starts once), stop (freezes remaining at current value, preserves startTimeRef), resume (sets isRunning = true without clearing startTimeRef — resumes from original start time so time elapsed during the stopped period is automatically accounted for; no-op if never started), reset; until started, remaining follows a changed duration, and the duration is fixed at start; wall-clock based — records start time and computes remaining from elapsed time on each tick; visibilitychange listener recalculates when page becomes visible; used by both SWU game screen (competitive mode) and X-Wing game screen
    useUserSettings.ts      React Context — persistent user preferences (useHyperspace, forceTokenDisplay, enableEpicActions, enableWakeLock, enableFavourites, enableLongPress, enableActionLog, enableInitiativeBar, enableCompetitiveMode, enableGameSelect, enableXwingPhases, enableXwingAlwaysIncDec, enableDamageButtons, startScreen, bo1TimerMinutes, bo3TimerMinutes, xwingTimerMinutes) backed by localStorage under key `user_settings`; forceTokenDisplay is a 3-way value ('always-on' | 'lof-only' | 'always-off'), defaulting to 'lof-only'; all boolean preferences default to `true` except enableCompetitiveMode, enableXwingAlwaysIncDec and enableDamageButtons (default false); enableDamageButtons adds − and + to the SWU game screen's margins (it has no Settings switch yet); bo1TimerMinutes and bo3TimerMinutes are also set by the game length stepper on the SWU game screen's timer; enableXwingPhases defaults to true — toggles the phase tracker button on the X-Wing game screen; enableXwingAlwaysIncDec defaults to false — when true, both inc/dec button pairs are always visible on the game screen regardless of ship lists or scenario scoring state; migrates old enableForceToken boolean (false → 'always-off', true/missing → 'lof-only'); `UserSettingsProvider` wraps the app in `main.tsx`
    useTournament.ts        Tournament state — TournamentState and TournamentRound interfaces; startTournament, startMatch, completeMatch, submitRound, dropTournament; persists to localStorage under key `tournament_state`; `startMatch` uses functional setState to avoid stale-closure bugs; `points` is a derived value (win=3, draw=1, loss=0) computed from completed rounds alongside `totals`
    useWakeLock.ts          Screen Wake Lock — acquires on game screen mount, releases on unmount; reacquires on visibility change

  services/
    analytics.ts            Offline-queue analytics service (30 event functions + enqueue + flush); events written to localStorage queue first, then flushed via POST to /analytics/batch; queue preserved on network error and re-flushed on window.online; env and sessionId auto-appended to every event; worker appends country, city, and coordinates from request.cf; `game_started`/`game_ended` are unified cross-game events — `onGameStart`/`onGameEnd` (SWU) include `game: 'swu'`; `onXwingGameStarted`/`onXwingGameEnded` (X-Wing) also fire `game_started`/`game_ended` with `game: 'xwing'`; `onGameEnd` carries `format` only for a tournament game (left out of a casual game's payload); tournament events, each carrying the tournament's format: onTournamentStarted (fires from App.tsx handleStartTournament, on Start round 1), onTournamentRoundCompleted (fires from App.tsx handleMatchComplete), onTournamentDropped, onTournamentEnded (both fire from SwuTournamentScreen container); X-Wing round event: onXwingRoundAdvanced (fires on each round advance, sends from_round + to_round)

  styles/
    sectionLabel.ts         `sectionLabelStyle(color?)` (the small uppercase label over a section) and `mutedStyle` (muted note text), shared by SWU setup, the base sheet and the tournament screen
    navButton.ts            Shared `NAV_BTN_STYLE` constant (`React.CSSProperties`) — single source of truth for all navigation icon buttons (Back, Help, Settings, Log) across every screen; `5vw × 5vw`, `minWidth/minHeight: 36px`, transparent background, `--color-ui-border` border, `borderRadius: 8px`; game screens spread this and add `position: 'absolute', zIndex: 10`
    xwingForm.ts            Shared X-Wing form styles — `labelStyle`, `submitButtonStyle` (square confirm/edit button), `squadNameInputStyle`, `overwriteCancelStyle`; each takes `small` for the landscape sizing
    barContainer.ts         Two shared `React.CSSProperties` constants for vertical bar UI: `BAR_CONTAINER_STYLE` — visual style for bar containers (`background: rgba(0,0,0,0.2)`, `border: 2px solid --color-ui-border`, `borderRadius: 8px`, `boxShadow`); `BAR_LABEL_STYLE` — shared typographic style for bar labels (`fontSize: clamp(0.35rem, 0.8vw, 0.55rem)`, `letterSpacing: 0.08em`, `fontWeight: 700`, `lineHeight: 1`; no `pointerEvents` — consumers add that where needed); both used by initiative toggle and score panel
    startText.ts            Shared `START_TEXT_STYLE` constant (`React.CSSProperties`) — visual style for "Start" / "Start Game" tap targets on game screens: `fontWeight: '300'`, `color: --color-text-primary`, `textShadow` accent glow + dark outline, `cursor: 'pointer'`, `letterSpacing: 0.05em`, `userSelect: 'none'`, `WebkitTapHighlightColor: 'transparent'`; used by SWU game screen counter (always spread, cursor/letterSpacing overridden for in-game state) and X-Wing game screen pre-game text

  constants/
    setRegistry.ts          Static set registry — maps every known set code to { rotation, type }; authoritative source for format filtering; unknown sets default to allowed (forward-compatible)
    rotatedCards.ts         Lookup table of hyperspace card numbers that require 90° rotation correction

  data/
    xwaCards.ts             Generated XWA card table — `xwaPilots: Record<string, XwaPilot>` (734 pilots keyed by full XWS id, e.g. `lukeskywalker`, `lukeskywalker-battleofyavin`; each has YASB's display `name`, `ship` and `faction` XWS ids, current XWA `points`, `loadout` when YASB has one, `unique`, `limit` (per-squad cap from the card or the XWA restricted list) and YASB's numeric `yasbId`) and `xwaShips: Record<string, string>` (ship XWS id → display name, plus `upsilonclassshuttle`, the xwing-data2 id other builders export); written by `scripts/generate-xwing-data.mjs` from a pinned raithos/xwing commit; do not edit by hand

  utils/
    baseAspect.ts           SWU base display helpers: `FILTER_ASPECTS` (the base sheet's four), `aspectIconSrc(aspect)`, `baseAspect(base)` (its first aspect with an icon, or null) and `baseMeta(base)` ("SET · HP")
    formatFilter.ts         Format filtering — isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError, limitedBaseOptions (the bases of the registered base's set, for a Limited base change); exports Format type ('premier' | 'limited' | 'eternal' | 'twin-suns') and FORMAT_LABELS; pure functions with no side effects
    displayPilots.ts        Pilot display utility — `displayPilots(pilots: XwingPilot[]): DisplayPilot[]`; returns `{ displayName, ship, points }` per pilot; resolves pilot display name via `resolveXwsName(baseSlug, pilotNames)` where `baseSlug = slug.split('-')[0]`; resolves ship via `resolveXwsName(ship, shipNames)` (both from `xwaNames.ts`); both fall back to the raw slug if not in the lookup; numbers duplicate resolved display names sequentially (e.g. three `academypilot` entries → `Academy Pilot 1/2/3`); unique names are never suffixed; used by setup screen view (`PilotList` helper) and game screen view
    xwaNames.ts             Display-name lookups built from `xwaCards.ts` — `buildPilotNames(pilots)` keys each name by its base XWS slug (before the first hyphen), drops YASB's bracketed scenario tag (`Adon Fox (BoE)` → `Adon Fox`) and keeps the first entry when variants share a slug; exports `pilotNames` and `shipNames`
    resolveXwsName.ts       Name resolver — `resolveXwsName(slug: string, map: Record<string, string>): string`; returns `map[slug] ?? slug` (falls back to raw slug when not in the map)
    shipRoster.ts           Ship state types and helpers — `ShipState = 'alive' | 'half' | 'destroyed'`; `ShipEntry = { pilot: XwingPilot; state: ShipState }`; `halfPoints(pts)` = `Math.floor(pts/2)`; `remainingPoints(pts)` = `Math.ceil(pts/2)`; `initShips(pilots)` returns `ShipEntry[]` with all ships alive; used by `xwingGameScreen.tsx` for per-ship scoring
    parseXwsText.ts         XWS list parser — `parseXwsText(text: string): ParseResult`; parses XWS JSON exported by YASB; extracts `pilots: XwingPilot[]` (each with `name`, `ship`, `points` as XWS slugs), `total` from the top-level `points` field, and the optional top-level `name` and `faction` strings; validation: `too-few-ships` (< 3), `too-many-ships` (> 8), `invalid-total` (< 46 or > 50), `invalid-format` (non-JSON, missing `pilots` array, missing `points`, malformed pilot entries); zero-cost ships count toward both min and max; duplicate pilot detection deferred to #277; exports `XwingPilot` and `ParseResult` types
    xwingListInfo.ts        Saved-list helpers — `listPoints(pilots)` sums pilot points as exported (the list's cost when built, not current points); `factionName(xws)` maps an XWS faction id to its display name (unknown ids returned unchanged); `listMeta(pilots, faction)` gives the `49 pts · Rebel Alliance` line (points only when there is no faction); `pilotSummary(pilots)` gives a setup card's pilots line — display names (`pilotNames`, by base slug) in list order, a repeated pilot counted where it first appears (`3 × Academy Pilot`)
    formatTime.ts           Shared time formatter — `formatTime(seconds: number): string`; outputs `M:SS` (e.g. 4500 → "75:00", 65 → "1:05"); used by TimerDisplay
    playMode.ts             Play mode constants — PlayMode type ('casual' | 'bo1' | 'bo3'), PLAY_MODES array, PLAY_MODE_LABELS record; no logic, no side effects
    swudbUrl.ts             SWUDB URL utilities: normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck

  test/
    setup.ts                Vitest setup — jest-dom matchers + global matchMedia mock (landscape default; tests needing portrait call makeMatchMediaMock(true))
    App.test.tsx            End-to-end navigation and feature tests
    appScreenLayout.test.tsx Layout component tests
    swuGameScreen.test.tsx  Game screen tests: tap and drag damage and their limits, HP left, Start states, epic action, Force and Mystic Monastery, initiative, the damage buttons setting, Log and More, Round, timer and the game length stepper, the End game sheet (auto-open at 0 HP, Keep playing, undo), casual game over and Rematch, best of 1 and 3, base change between games; two players: the turned half, staying two-player in either orientation, the middle strip, Start from either card, independent damage (taps, drags, flipped drags on their half, − / +), each half's epic action, initiative passing between halves, End game at 0 for either base with the right result, game over on each half, Rematch keeping both bases, log entries naming the base and undo
    splitScreenLayout.test.tsx Split layout: the top half turned, the order of the parts, turning back against a landscape screen angle
    helpScreen.test.tsx  Help screen tests
    swuLoadingScreen.test.tsx Loading screen tests
    gameSelectScreen.test.tsx Game select screen component tests
    installBanner.test.tsx Install banner component tests
    swuSetupScreen.test.tsx Setup screen container tests
    settingsScreen.test.tsx Settings screen container tests
    swuTournamentScreen.test.tsx Tournament screen tests: header (summary, Back keeps the tournament, More), record and points, your base, the round list (results and scores, next marked, later dimmed, in progress), Start / Return to round N, Player portal, the Drop sheet, complete and Finish, Limited base change gating and the base sheet, portrait
    analytics.test.ts       Analytics service tests — enqueue (write, shape, append, cap, silent failure), flush (batch POST, URL, clear on 200, preserve on 500, preserve on network error, no-op when empty), window.online trigger, payload shape, PII absence, env field, sessionId consistency, all 27 event functions; `game_started`/`game_ended` payloads include `game: 'swu'` (SWU) or `game: 'xwing'` (X-Wing); X-Wing `game_ended` payload includes elapsed_seconds and timer_expired
    formatTime.test.ts      formatTime utility tests — zero, sub-minute, exact minutes, zero-padding seconds, large values (e.g. 4500 → "75:00")
    timerDisplay.test.tsx   TimerDisplay component tests — renders formatted time, custom testId, style overrides; colour thresholds (> 300s → text-muted, ≤ 300s → warning, ≤ 60s → error)
    timerStepper.test.tsx   TimerStepper component tests — renders label and value, + increments, − decrements, + disabled at max, − disabled at min
    formatFilter.test.ts    Format filtering utility tests (isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError — all formats and set types)
    swudbUrl.test.ts        SWUDB URL utility tests
    useDragScrubber.test.ts Drag-to-scrub hook tests
    useBaseArt.test.ts      Art fallback chain hook tests
    useBases.test.ts        Data layer hook tests
    useFavourites.test.ts   Favourites hook tests
    useOrientation.test.ts  Orientation hook tests
    useSwuGame.test.ts      Counter hook tests
    useSwuSetup.test.ts     Setup logic hook tests
    useMatch.test.ts        Match score hook tests
    useTimer.test.ts        Countdown timer hook tests — start/stop/reset/expire behaviour; stop preserves remaining without reset
    useUserSettings.test.ts User settings hook tests
    useTournament.test.ts   Tournament hook tests
    useInstallPrompt.test.ts PWA install prompt hook tests
    useWakeLock.test.ts     Screen Wake Lock hook tests
    useInitiative.test.ts   Initiative hook tests — initial state null, setOpponent (null→opponent, opponent stays opponent, player→opponent), setPlayer (null→player, player stays player, opponent→player), cycle (null→player→opponent→null), reset from each state, setInitiative direct
    initiativeToggle.test.tsx Initiative toggle component tests — renders OPP/YOU labels, static INIT label (always present, not in indicator), sliding indicator (no INIT text), indicator shows "OPP"/"YOU" when active, data-position attribute, tap zone callbacks (opp-zone, you-zone, already-active zone)
    xwingListsScreen.test.tsx X-Wing Squad Lists screen tests — header and back/help callbacks; empty state; list rows show name and points/faction; tap to show/hide pilots; rename (pre-filled, saves via `renameList`, name-clash error, blank disables save, cancel); delete and Clear All two-step confirm; new list: invalid paste error, valid paste shows preview and points/faction, name pre-filled from XWS, save disabled while blank, `saveList(name, pilots, faction)` with trimmed name then form reset, overwrite prompt confirm/cancel, edit keeps the pasted text; landscape side by side, portrait stacked with saved lists first
    xwingSetupScreen.test.tsx X-Wing setup screen tests (real `useXwingSetup` with a stubbed localStorage, mocked `useXwingLists`) — Back; More sheet offers Squad lists, Help and Settings and closes; no outline nav buttons; Match segmented (Casual default), Rounds only for Tournament; Scenario sheet (None + 5), choosing closes it, roll picks a named one; both cards from the start; the list sheet's saved lists with points/faction, Import XWS, No list last with its note, or an empty hint; choosing a list shows name, meta and pilots but no deficit; No list's note and deficit stepper; Change list; a deleted list falls back to choosing; your remembered list pre-filled; last game's opponent offered in one tap, filled, and not once deleted; Go to game disabled until both chosen; `onStart` gets `50 − list points` and pilots for list players, the stepper value and no pilots for No list; portrait order; own text colour
    displayPilots.test.ts    Unit tests for `displayPilots()` — resolves pilot name via lookup (base slug key), resolves unhyphenated slug, points preserved, ship resolved via lookup, unknown slug fallback, unknown ship fallback, empty input, unique pilots not numbered, duplicate resolved names numbered, only the duplicate group numbered (unique siblings unaffected), hyphenated slugs sharing same base treated as duplicates, numbering uses resolved display name as key
    resolveXwsName.test.ts   Unit tests for `resolveXwsName()` — known slug returns display name, known ship slug, unknown slug falls back to raw slug, empty slug falls back to empty string
    useXwingLists.test.ts    X-Wing lists store tests — shared state across consumers under one provider, throws outside the provider, load (empty, corrupt, legacy entries without faction/createdAt), saveList (stores name/pilots/faction/createdAt, unique ids, same name replaces in place, persists), renameList (renames, persists, no-op on name clash), removeList, clearLists
    xwingListInfo.test.ts    Unit tests for `listPoints()`, `factionName()` and `listMeta()`
    useXwingSetup.test.ts    X-Wing setup hook tests — defaults (XWA/Casual/6/0/0), localStorage load for ruleset/matchType/rounds (not deficits), save for the same (not deficits), player/opponent choices (start null, set per player, can be cleared), your list remembered and restored (No list not remembered), the opponent chosen afresh with the last opponent offered and kept through No list, old list-import fields dropped on the next save, deficit clamping at 0 and 4
    xwingGameScreen.test.tsx X-Wing game screen container tests — timer display, timer start on game start, timer stop on game over (at the end of the round in which a player reaches 50), timer does NOT stop at round 12, round tracker rendering and round advance, round advance guards, analytics, wake lock, phase tracker (visibility, cycling, End advances round, End at round 12 ends game, End with timer expired ends game, round-12 undo restores to End phase, timer-expired undo restores to End phase, undo resumes timer, phase button hidden when enableXwingPhases=false, initiative always interactive when phases disabled), initiative bar (opp/you tap zones, locked during non-Planning phases, unlocked in next Planning), scores start at 0 regardless of deficit (pre-game and post-start), game end result banners; pilot list display (lists rendered when pilots provided, absent when not, resolved display name shown, duplicates numbered with resolved names); ship scoring (ship buttons appear after game start, inc/dec visibility: all hidden when both have lists, player inc/dec kept when only player has list, opponent inc/dec kept when only opponent has list, all inc/dec shown when enableXwingAlwaysIncDec=true even with both lists, tap opponent ship → player score += floor(pts/2), tap player ship → opponent score += floor(pts/2), Damaged log entry on first tap, second tap destroys and awards remaining, Destroyed log entry, long-press skips alive→destroyed with full points, zero-point ship no score/no log, undo restores score+state from alive, undo restores destroyed→half); deficit scoring (opponent deficit not added until all opponent ships destroyed, added when last ship destroyed, player deficit mirrors this symmetrically, zero deficit adds nothing); scenario scoring: inc/dec shown during End phase when enableXwingAlwaysIncDec=true alongside scenario buttons

  assets/
    ...                     Static assets (icons, splash screens)

docs/
  architecture-overview.md      System overview, goals, tech stack, component tree, glossary
  architecture-implementation.md This document — folder structure, state, data layer, UI, feature details
  architecture-process.md       Workflow, CI/CD, analytics, testing strategy, future improvements
  swuSetupHelp.md               Setup screen user guide (imported as HTML string via custom Vite plugin)
  swuGameHelp.md                Game screen user guide (imported as HTML string via custom Vite plugin)
  swuTournamentHelp.md          Tournament screen user guide (imported as HTML string via custom Vite plugin)
  xwingGameHelp.md              X-Wing game screen user guide (imported as HTML string via custom Vite plugin)
  xwingSetupHelp.md             X-Wing setup screen user guide (imported as HTML string via custom Vite plugin)
  xwingListsHelp.md             X-Wing Squad Lists screen user guide (imported as HTML string via custom Vite plugin)
  project-overview.md           Product vision, planned features, AI assistant notes

public/
  dmgCtrl-icon-transparent-192.png  App icon (transparent background); used on loading screen and alongside screen titles
  dmgCtrl-icon-192.png              App icon 192×192 (opaque); used in PWA manifest and browser favicon
  dmgCtrl-icon-512.png              App icon 512×512 (opaque); used in PWA manifest
  dmgCtrl-force-token.png           Force token icon (512×512 PNG); used on Force button and as watermark in Force overlay
  dmgctrl-icon-192-white.svg        White starburst logo SVG (192×192); used on the epic action button and as watermark in the epic action overlay
  Star-Wars-Unlimited-logo-white.png Star Wars Unlimited logo (white); used as the SWU game button image on the game select screen
  Star-Wars-X-wing-logo.png         Star Wars X-Wing logo; used as the X-Wing game button image on the game select screen
  ...                       PWA manifest, icons

.github/
  workflows/
    deploy.yml                    CI/CD pipeline
    populate-base-aspects.yml     Daily cron + manual dispatch — refreshes the base_aspects InfluxDB measurement (see architecture-process.md)

scripts/
  inspect-base-data.mjs           Replicates the useBases merging logic; writes docs/base-data-snapshot.json and docs/base-data-summary.json for offline data inspection
  validate-bases.mjs              Playwright script — opens a headed Chromium window and iterates every base for semi-automated visual QA (see architecture-process.md)
  validate-errors.mjs             Playwright script — opens a headed Chromium window and steps through all five error/info message states for semi-automated visual QA (see architecture-process.md)
  measure-performance.mjs         Playwright script — measures setup ready time, LCP, preview image time, and game image time across three resolution tiers (low/normal/hi res) per iteration; reports min/median/max (see project-overview.md)
  populate-base-aspects.mjs       Fetches base card data from swuapi.com and the swu-db proxy (one query per set, skipping sets swu-db cannot serve), merges them into baseKey→aspect pairs, and writes to the base_aspects InfluxDB measurement; exports buildBaseAspects, toLineProtocol, fetchSetCodes and fetchSwuDbBases for unit testing; run by the GitHub Actions daily workflow and on-demand via node scripts/populate-base-aspects.mjs
  generate-xwing-data.mjs         Writes src/data/xwaCards.ts from YASB's card data (raithos/xwing `coffeescripts/content/cards-common.coffee` at the pinned `YASB_COMMIT`): YASB has no data API, so it compiles the CoffeeScript and runs YASB's own `basicCardData`/`setupCommonCardData` in `node:vm` to get the XWS ids YASB exports; exports extractXwingData and renderModule for unit testing. To pick up new XWA points, read the YASB diff, move `YASB_COMMIT` and run node scripts/generate-xwing-data.mjs
  check-influxdb-usage.mjs        Queries the dmgctrl InfluxDB bucket row count and prints an estimated storage size against the 5GB free-tier limit; reads credentials from .env.influxdb automatically; run with node scripts/check-influxdb-usage.mjs
```

---

## 2. State Management

The app uses **local React state** with one shared React Context for user settings — no global state library.

**`UserSettingsProvider`** (from `useUserSettings.ts`) wraps the entire app in `main.tsx`, giving every screen access to the same settings instance. Changes made in the settings screen propagate immediately to the game screen without requiring a game restart.

All other state is owned at the component level:

| State | Owner | How it flows |
|---|---|---|
| Current screen (`loading` / `gameSelect` / `xwingSetup` / `xwing` / `setup` / `game` / `tournament` / `help` / `settings`) | `App` | Passed as callback props (`onReady`, `onConfirm`, `onBack`, `onHelp`, `onSettings`); initial screen after loading is determined by `startScreen` from `useUserSettings` ('gameSelect' default → `'gameSelect'`, 'swu' → `'setup'`, 'xwing' → `'xwingSetup'`); back from X-Wing game returns to `'xwingSetup'`; back from X-Wing or SWU setup navigates to `'gameSelect'` |
| Help source (`'setup'` / `'game'` / `'tournament'` / `'xwing'` / `'xwingSetup'` / `'settings'`) | `App` | Determines which markdown file `HelpScreen` renders; set by `handleHelp` based on the current screen before navigating to `'help'`; `'settings'` always maps to `settingsHelp.md` regardless of where settings was opened from |
| Back stack (for help/settings back-navigation) | `App` | A `Screen[]` stack; pushed when navigating to help or settings, popped on back — supports any depth of overlay navigation |
| `useBases()` loading state (for loading screen) | `App` | `App` calls `useBases()` and passes `loading` prop to `SwuLoadingScreen`; `SwuLoadingScreen` calls `onReady` as soon as the data is ready (`loading` becomes `false`) |
| Game start time | `App` (`useRef`) | Recorded at the start of `handleConfirm`; used by `handleBack` to compute `durationSeconds` for `onGameEnd` |
| Selected base | `App` | Set on `onConfirm`, passed into `SwuGameScreen` |
| SWU setup (your base, recent bases, match, tournament format) | `useSwuSetup` / localStorage | Persisted under `swu_setup`; your base is kept between games and launches; recent bases are the last 6 played; match defaults to `'casual'` and is passed to `App` via `onConfirm(base, matchType)`; the format chosen on the start sheet is remembered (Premier by default) |
| Format passed to the game screen | `App` | `tournament?.format`: the tournament's, set on the start sheet and fixed for its length; a casual game gets none |
| Start sheet Match and Rounds | `SwuSetupScreenView` | Local; Best of 3 and 5 each time the sheet opens |
| Match scores (playerScore, opponentScore) | `useMatch` | Local to game screen; reset on each navigation to the game screen; `matchOver` is derived (true when either score reaches maxScore, or when `matchDrawn` / `matchClosedByTimer` flags are set); `matchResult` ('won'/'lost'/'drawn'/null) is derived from scores and close flags; `recordDraw()` closes the match without changing scores (intentional draw or timer-expire draw); `closeByTimer()` closes the match after a win/loss recorded at expiry; `restoreState` accepts all four fields for undo |
| Base sheet search, aspect filter, import view | `SwuBaseSheet` | Local; reset each time the base sheet opens |
| Damage counter | `useSwuGame` | Local to game screen; clamped between 0 and `base.hp`; reset when the Back button is pressed in casual/bo1/bo3 play; **preserved** when navigating to the tournament screen (the game screen stays mounted via `display: none` and `isInTournament` skips the `game.reset()` call) |
| Epic action used state | `useSwuGame` | Local to game screen; toggled by the epic action button; reset on each casual/bo1/bo3 back-navigation; preserved across tournament ↔ game navigation |
| Force token active state | `useSwuGame` | Local to game screen; toggled by the Force button; reset on casual back-navigation; preserved in tournament mode |
| Action log entries | `useGameHistory<SwuGameSnapshot>` | Local to game screen; array of `HistoryEntry<SwuGameSnapshot>` records; empty on mount; Round 1 entry added when the user taps Start; each entry stores a full `SwuGameSnapshot` (game state, match state, lastGameResult) for undo; reset on casual back-navigation; preserved in tournament mode |
| Last game and sheets | `swuGameScreen` | `lastGame` (result, round, damage) until the next game starts, restored by undo; `endGameOpen` / `endGameChoice` for the End game sheet; `gameOverOpen` for the casual Game over sheet |
| Art fallback index, image load state | `useBaseArt` | Local to whichever screen called it; reset when base changes |
| User settings (hyperspace, force token display, epic actions, wake lock, action log, favourites, long press, competitive mode, bo1/bo3/xwing timer minutes) | `useUserSettings` Context / localStorage | Persisted under `user_settings` as JSON; `forceTokenDisplay` is a 3-way value ('always-on' \| 'lof-only' \| 'always-off'), default 'lof-only'; all other boolean preferences except `enableCompetitiveMode` default to `true`; `enableCompetitiveMode` defaults to `false`; bo1TimerMinutes=25, bo3TimerMinutes=55, xwingTimerMinutes=75; migrates old `enableForceToken` boolean; shared via React Context — updates propagate immediately to all mounted consumers |
| Favourites list | `useFavourites` / localStorage | Persisted under `favourites` as JSON array of `FavouriteBase`; sorted by set then card number ascending; deduplicated on `key`; SWU setup shows the star and the Favourites section whatever `enableFavourites` says |
| X-Wing saved squad lists | `useXwingLists` / localStorage | Persisted under `xwing_favourites` as JSON array of `XwingList` (`{ id, name, pilots, faction?, createdAt? }`); created/renamed/deleted on the Squad Lists screen and saved/removed via the setup screen star toggle; not gated by a feature flag |
| SWUDB link, validation error, deck name, the deck's base, loading state | `SwuSetupScreen` | Local; editing the link clears the deck; the deck's base becomes your base only on Use this base (or its tile) |
| Tournament state (`TournamentState` | null) | `useTournament` / localStorage | Persisted under `tournament_state`; survives app close so the user can return between rounds; `null` when no tournament is active; reset by `dropTournament` |
| Base for the next game of a Limited match (`candidateBase`) | `SwuTournamentScreen` | Local; cleared when the next match starts |
| Open sheet (More, Drop, base) | `SwuTournamentScreenView` | Local |
| Change-base candidate state (changingBase, candidateAspect, candidateBase) | `SwuTournamentScreen` | Local state; `changingBase` shows selectors; `candidateAspect` filters the base list; `candidateBase` is passed to `onGoToGame` and drives the art preview via `useBaseArt(candidateBase ?? base, ...)` |
| Tournament current base | `App` | `tournamentCurrentBase` — set to `newBase` in `handleGoToGame` when a candidate was selected; used as first priority in `gameBase` (`tournamentCurrentBase ?? selectedBase ?? tournament?.base`), providing sticky base behaviour between rounds; reset to `null` on `handleTournamentDrop` |
| Has played game in current match | `App` | `hasPlayedGameInCurrentMatch` — passed to `SwuTournamentScreen` to gate the change-base overlay; set to `gamesCompleted > 0` when the player presses Back from the game screen (where `gamesCompleted = match.playerScore + match.opponentScore`); round scores in `TournamentState` are only set when the full match completes, so this App-level flag is the only way to know a game was completed mid-round |
| X-Wing setup preferences (ruleset, matchType, rounds, your list, last opponent) | `useXwingSetup` / localStorage | Persisted under `xwing_setup` as JSON; the opponent's current choice, No list, the deficits and the scenario are session-only (not persisted) and survive navigation within X-Wing because `App` keeps the setup screen mounted |

### Note on double useBases() call

`App.tsx` calls `useBases()` to get the `loading` boolean for the loading screen transition. `SwuSetupScreen` also calls `useBases()` internally via `useSwuSetup`. This means two separate fetch calls occur on app start. In practice, both resolve immediately on repeat visits (24-hour localStorage cache), and the first fetch completes before the setup screen mounts, so the second is nearly instant. This is an acceptable trade-off to avoid refactoring `SwuSetupScreen`'s interface.

### Example flow: App startup

1. `App` mounts with `screen = 'loading'` and calls `useBases()` — initial `loading = true`
2. `SwuLoadingScreen` renders: shows the app icon and "LOADING" text
3. `onReady()` is called as soon as `loading` becomes `false`
4. `App` reads `startScreen` from `useUserSettings`: `'gameSelect'` (default) → `setScreen('gameSelect')`; `'swu'` → `setScreen('setup')`; `'xwing'` → `setScreen('xwingSetup')`
5. `GameSelectScreen` renders two game buttons (Star Wars Unlimited, Star Wars X-Wing); tapping SWU navigates to `SwuSetupScreen`; tapping X-Wing navigates to `XwingSetupScreen`
6. Back from either screen always returns to `'gameSelect'` regardless of `startScreen`
7. `SwuSetupScreen` mounts, calls `useBases()` — resolves from cache almost immediately
8. User sees SWU setup with the base kept from last time, if any

### Example flow: Setup → Game

1. With no base kept, the user opens the base sheet ("Choose your base") and taps a tile, found among favourites and recent bases, by searching, or from an SWUDB deck link
2. `useSwuSetup.chooseBase` saves the base under `swu_setup`, so it is there next time
3. User taps **Go to game** — `handleSubmit` adds the base to the recent bases and calls `onConfirm(base, 'casual')`; **Go to tournament** calls it with `'tournament'` and `App` opens the tournament screen
4. `App` sets `screen = 'game'` and `selectedBase`
5. `SwuGameScreen` receives `base`; calls `useUserSettings()` for `useHyperspace` and other preferences; `useBaseArt` builds the ordered fallback chain and manages image state

### Example flow: Damage tracking

1. The card itself is the control: the view wires `useCardDrag` (in `useDragScrubber.ts`) to the card `<button>`
2. Before the game a tap calls `onStartGame`; once started, a tap calls `onIncrement(1)`
3. The container clamps every change to what the base can take: `handleIncrement` adds at most `base.hp - count`, `handleDecrement` removes at most `count`; a change of 0 is ignored, so a tap at full HP adds no log entry
4. The container delegates to `useSwuGame` (`incrementBy` / `decrementBy`), logs a `hit` or `heal` entry, and fires the damage analytics event with the amount applied

### Example flow: Drag on the card

1. `onPointerDown` (only when the game has started and the match is not over) captures the pointer and records the start position
2. `onPointerMove` computes `delta = startY - clientY`; within the 15px dead zone nothing is pending. Past it, up is `+` and down is `−`, with `value = round((|delta| - 15) / 14) + 1`, capped at `hpLeft` (up) or `count` (down)
3. The pending amount is exposed as `amount` and drawn as a chip on the card (`drag-amount`, "+5" / "−3")
4. `onPointerUp` applies the amount once and sets `dragApplied`, so the click that follows the pointer-up is swallowed instead of adding 1; a release inside the dead zone is a tap
5. `onPointerCancel` clears the drag without applying it

With **Damage −/+ buttons** on (`enableDamageButtons`), − and + sit at the foot of the margins and use `useDragScrubber` as before: tap for 1, press and drag upward for several (from 2, 14px a step, capped at the capacity and at 20). Their pending amount shows in the same chip on the card.

### Example flow: Epic action

1. `showEpicAction = /epic action/i.test(base.epicAction)`: excludes passive abilities and Mystic Monastery (whose text is "Action:")
2. The button is greyed and disabled before the game (`round === 0`), gold once it starts, and disabled with **USED** once marked
3. Tapping it calls `onEpicActionMark`: the container calls `game.markEpicActionUsed()` and logs an `epic` entry
4. While used, the card shows the **EPIC ACTION USED** token over the text box, the one thing allowed over the card's text. Undo in the log reverts it; a new game resets it

### Example flow: Force token

1. The container derives from `forceTokenDisplay` (`'always-on' | 'lof-only' | 'always-off'`):
   - `isForceBase = /the force is with you/i.test(base.epicAction)`
   - `isMysticMonastery = base.set === 'LOF' && base.number === '022'`
   - `showForce`: not Off, not Mystic Monastery, and Always on or a Force base
   - `showMysticMonastery`: Mystic Monastery and not Off
2. The Force button has two states: ready ("Gain the Force", tonal) and active ("The Force is with you: tap to clear", accent fill). It is disabled before the game starts
3. `handleForceToggle` flips `forceActive` and logs `force-gain` or `force-use`
4. **Mystic Monastery**: the button shows the uses left ("3 LEFT"). When ready, a tap calls `gainForceViaMonastery()` (one use, Force active, `monastery` log entry); when active, a tap clears it as above. With no uses left and the Force not active it is disabled ("No Force uses left")
5. Nothing is drawn on the card for the Force: its state is the button's

### Example flow: Settings navigation

1. User taps the ⚙ button on the setup or game screen
2. `App` pushes the current screen onto `backStack` and sets `screen = 'settings'`
3. `SettingsScreen` renders — user adjusts preferences; each toggle writes immediately to localStorage via `useUserSettings`
4. User taps the back button — `App` pops the top of `backStack` and sets `screen` to that value, returning to wherever they came from
5. Because `useUserSettings` is a shared React Context, the updated preferences are reflected immediately in all mounted consumers — the game screen does not need to be restarted

---

## 3. Data Layer

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
| swu-db proxy | `worker.dmgctrl.app` | Card text, HP, aspects, rarity, standard art; source of truth for SOR/SHD/TWI |
| Analytics endpoint | `worker.dmgctrl.app/analytics/batch` (primary), `/analytics` (backwards compat) | Accepts `POST` from the frontend; writes events to InfluxDB Cloud in line-protocol format; batch endpoint uses `queued_at` as the InfluxDB timestamp so offline events are attributed to when they occurred |
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

**Hyperspace preferred:**
```
hyperspaceArtHiRes → hyperspaceArt → frontArt → frontArtLowRes → text/error
```

**Normal preferred:**
```
frontArt → frontArtLowRes → hyperspaceArtHiRes → hyperspaceArt → text/error
```

The normal-preferred chain always falls back to hyperspace art before giving up — a base image is always better than a text fallback.

Some hi-res hyperspace images on cdn.swu-db.com are stored rotated 90°. `useBaseArt` calls `getRotationFromHyperspaceUrl` for each hyperspace hi-res entry and includes the correction as `rotationDeg` in the returned state. When `rotationDeg` is non-zero, both views switch to a portrait layout box sized to the card's inverse dimensions (`CARD_H/CARD_W` wide × `CARD_W/CARD_H` tall), centered with `translate(-50%,-50%) rotate(90deg)`, so the rotated visual output fills the landscape container without overflowing or changing aspect ratio. When `rotationDeg` is zero the image fills the container normally (`inset:0; width:100%; height:100%`). The lookup table in `src/constants/rotatedCards.ts` is the single place to add new entries as they are discovered.

The setup screen also calls `getFirstGameImageUrl(base, useHyperspace)` in a `useEffect` to eagerly preload the game-mode image into the browser HTTP cache whenever the selected base changes. This means the image is typically already cached by the time the user clicks Start, eliminating the fetch delay on the game screen transition.

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

**Feature flag:** `enableFavourites` in `useUserSettings` (default: `true`) gates UI visibility. The stored data is retained regardless of the toggle state — disabling and re-enabling restores the list intact.

---

## 4. UI & Layout System

### AppScreenLayout

Every screen is wrapped in `AppScreenLayout`, which provides:
- Full-screen fixed container (fills viewport)
- Dark background gradient
- CSS safe area insets (for iOS notch/home indicator)
- Animated star field background

This ensures visual consistency across screens without each screen needing to re-implement the full-screen container.

### Styling approach

All styling is done with **inline styles** (React `style` prop). There is no CSS framework, no CSS Modules, and no styled-components. `index.css` contains a minimal global reset, the CSS custom property palette (including the filled-surface tokens used by `shared/controls.tsx`), and styles for the help screen's rendered HTML content.

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
| `--color-error` | `#ff6b6b` | Error/loss states — timer ≤ 1:00, loss button, hit log entry |
| `--color-error-rgb` | `255, 107, 107` | `rgba()` fill/shadow values using the error colour |
| `--color-warning` | `#f5a623` | Timer amber warning state (≤ 5:00 remaining); DRAW confirm button |
| `--color-warning-rgb` | `245, 166, 35` | `rgba()` fill/shadow values using the warning colour |
| `--color-success` | `#22c55e` | Win/heal states — win button, heal log entry, tournament win result |
| `--color-success-rgb` | `34, 197, 94` | `rgba()` fill/shadow values using the success colour |
| `--color-force` | `#3b82f6` | Force gain log entries, install banner button |
| `--color-epic` | `#f5c518` | Epic action button, token overlay, epic log entry, tournament drawn result |
| `--color-epic-rgb` | `245, 197, 24` | `rgba()` shadow values using the epic colour |

Pros: no class name conflicts, styling is co-located with component logic, easy to make props-driven style decisions, palette changes are a one-line edit in `index.css`.

Cons: no media query support in inline styles (workaround: derive breakpoint-based values in component logic), harder to override from outside.

### Nav button positioning system

All navigation icon buttons (Back `<`, Help `?`, Settings `⚙`, Log `☰`) share a single style constant — `NAV_BTN_STYLE` in `src/styles/navButton.ts` — which defines `5vw × 5vw`, `minWidth/minHeight: 36px`, transparent background, `--color-ui-border` border, and `borderRadius: 8px`.

All non-game screens (Help, Settings, Game Select, SWU Setup, Tournament, RotatePrompt) use an outer container with `2vw` padding on the top and horizontal edges, placing buttons `2vw` from the `AppScreenLayout` safe-area boundary. Game screens position their buttons absolutely at `calc(env(safe-area-inset-*) + 2vw)`, which resolves to the same visual position since `AppScreenLayout` already pads the container by the safe-area insets. This ensures nav buttons do not jump during screen transitions.

Title `h1` elements on all header screens use `lineHeight: 0.8` to keep header row height consistent across screens. The app icon on the Game Select screen is sized to `5vw × 5vw` (matching the `NAV_BTN_STYLE` footprint) with the same gap as the setup screen back button, so the `dmgCtrl` title text lands at the same horizontal position on both screens.

### Responsive layout

The app is designed for **landscape orientation**. `useOrientation` is used in five places:

- **Setup screen** (`SwuSetupScreenView`) — renders a two-column layout in landscape (selectors left, card preview right) and a single-column scrollable layout in portrait.
- **Game screen** (`SwuGameScreen`) — renders the full-screen card layout in landscape and a rotation prompt in portrait.
- **Help screen** (`HelpScreen`) — uses `vmin` to compute JS-based font sizes for the title row; `isPortrait` is used as a React `key` to force DOM remount on rotation, flushing any cached computed styles.
- **Settings screen** (`SettingsScreenView`) — uses `vmin` for JS-based font sizes; `isPortrait` as a React `key` for DOM remount on rotation; `fontFamily` set to `Helvetica, Arial, sans-serif` with `-webkit-text-size-adjust: 100%` to prevent iOS Dynamic Type scaling the toggle labels.
- **Tournament screen** (`SwuTournamentScreenView`) — portrait: single-column layout (config → base art preview → W/L/D totals → action buttons → round table); landscape: two flex columns (left: config rows + card preview filling remaining height; right: W/L/D totals + action buttons + scrollable round table).

`useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events (reliable on iOS standalone PWA, unlike `orientationchange`/`resize`). It returns `isPortrait` (boolean) and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, which is stable across orientation changes unlike `window.innerWidth`).

---

## 5. Feature Architecture

### App startup and loading screen

1. `App` mounts with `screen = 'loading'` and calls `useBases()` to get the `loading` boolean
2. `SwuLoadingScreen` renders: displays the app icon (`dmgCtrl-icon-transparent-192.png`) and "LOADING" text
3. `onReady()` is called as soon as `loading` becomes `false`
4. `App` responds to `onReady` by reading `startScreen` from `useUserSettings`: `'gameSelect'` (default) → `setScreen('gameSelect')`; `'swu'` → `setScreen('setup')`; `'xwing'` → `setScreen('xwingSetup')`

### Base selection flow

1. `useBases` fetches and returns `Base[]` (cached after first load)
2. `useSwuSetup` receives `bases` and exposes derived lists:
   - `availableSets` — distinct set codes
   - `availableAspects` — aspects for the selected set
   - `filteredBases` — bases matching the selected set and aspect
3. Auto-select effects: if only one value is available for a dropdown, it is selected automatically
4. User selects a base → `selectedBase` is set
5. On submit, `onConfirm(selectedBase, playMode)` is called — the game screen reads `useHyperspace` from `useUserSettings` independently; `playMode` is passed to the game screen and drives the score panel and timer display

### Format selection

The setup screen exposes a **Format** dropdown on the same row as the Match selector (when competitive mode is enabled) or alone (when it is not). Four formats are available: Premier, Limited, Eternal, Twin Suns. Eternal and Twin Suns are separate dropdown options with identical filtering behaviour — all sets are valid for both. The selection is persisted to localStorage under `pref_format` and defaults to `'premier'`. On first load, any previously stored `'sealed'`, `'draft'`, or `'chaos'` value is silently migrated to `'limited'`.

Format filtering is implemented as pure functions in `src/utils/formatFilter.ts`, driven by a static registry (`src/constants/setRegistry.ts`) that classifies each set:

| Set type | Description | Example sets | Premier | Limited | Eternal / Twin Suns |
|---|---|---|---|---|---|
| `standard` with recent rotation | Current sets (most recent 2 rotation labels, alphabetical) | JTL, LOF, SEC, LAW | ✓ | ✓ | ✓ |
| `standard` with old/null rotation | Rotated-out sets | SOR, SHD, TWI | ✗ | ✓ | ✓ |
| `premier-legal-special` | Always Premier-legal; excluded from Limited | IBH | ✓ | ✗ | ✓ |
| `eternal-only` | Valid in Eternal / Twin Suns only | TS26 | ✗ | ✗ | ✓ |

"Most recent 2 rotations" is derived at runtime by collecting all unique non-null rotation labels from `standard` sets, sorting alphabetically, and taking the last two. This means the filter automatically adapts when a new rotation is added to the registry.

Unknown set codes (not in the registry) default to **allowed** in all formats for forward compatibility with sets not yet registered.

Format state lives in `useSwuSetup`. When the format changes, `validSets` is recomputed and the current set/aspect/base selection is cleared if the current set is no longer valid. The view receives `validSets` (not `availableSets`) for the set dropdown.

**SWUDB Import format validation:** After a successful deck load, the loaded base is re-evaluated against the selected format on every render — `swudbFormatError` is derived state, not stored state. This means changing the format immediately re-evaluates without re-fetching the deck. If the base is invalid for the current format, the start game button is disabled and an error message is shown (e.g. `Base not valid for Premier format`; sealed/draft errors append the set code). Switching to a valid format immediately re-enables the button.

**Favourites format filtering:** `validFavourites` (passed to the view) is filtered by the current format using `isSetValidForFormat`. The Favourites input mode option only appears in the mode selector when `validFavourites` is non-empty.

### Play mode selector (competitive mode)

When `enableCompetitiveMode` is `true` in user settings, a **Match** dropdown appears on the setup screen on the same row as the Format selector. Three options are available: Casual, Best of 1, Best of 3. The selection is persisted to localStorage under `pref_play_mode` and defaults to `'casual'`. The selected play mode is passed to `App` via `onConfirm(base, playMode)`, stored as `selectedPlayMode` in `App` state, and forwarded to `SwuGameScreen` as a `playMode` prop.

`enableCompetitiveMode` defaults to `true` and is toggled in the Settings screen.

### Source selector

The setup screen supports three input modes, controlled by a `selectionMode` state (`'base-selector'` | `'swudb-import'` | `'favourites'`). The active mode is persisted to localStorage under `pref_selection_mode`. The Source selector dropdown is always visible on the setup screen.

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

In the portrait layout, the mode content area is wrapped in `<div key={selectionMode} style={{ display: 'contents' }}>`. The `key` forces React to fully replace the DOM node (rather than reconcile in-place) when the mode changes. Without this, iOS Safari retains GPU compositing layer tiles from the removed box-shadow elements (the base/aspect dropdowns and start button), leaving a faint ghost line in the empty area below the controls when switching from Base Selector mode with no base selected. `display: contents` makes the wrapper layout-transparent so the Fragment children from `baseSelectorContent` continue to participate directly in the outer flex column's gap spacing.

### Game screen

The layout is a three-column grid: a 60px column of controls in the left margin, the card, and a 60px column in the right margin. The card is drawn at its own shape (1560:1120), `min((100vh - 8px) × ratio, 100vw - 152px)` wide, so it fills the screen height on a phone and leaves each margin at least 76px. Nothing covers the card's top band or its text box except the epic action token; the damage, HP left and the Start states sit in the open art between them (`game-counter`, 17% to 62% of the card's height).

1. `useUserSettings()` provides `forceTokenDisplay`, `useHyperspace`, `enableInitiativeBar`, `enableDamageButtons`, `bo1TimerMinutes` / `bo3TimerMinutes` and their setters. Epic actions, the log and the wake lock are always on: the screen does not read `enableEpicActions`, `enableActionLog`, `enableWakeLock` or `enableLongPress`
2. `useBaseArt(base, useHyperspace)` manages the ordered fallback chain and image load state; when every URL fails, the card shows the base's name, ability text and subtitle where the card prints them
3. `useSwuGame(base.hp)` holds damage, epic action used, Force active, Mystic Monastery uses and the round
4. `useGameHistory<SwuGameSnapshot>()` holds the log. Each entry stores a snapshot (game state, match scores, `lastGame`) for undo. Starting a game clears the log and adds an undoable Round 1 entry
5. `useWakeLock(true)` keeps the screen on while the game screen is mounted
6. `useMatch(playMode)` keeps the games score for best of 1 and 3 (a casual game does not touch it)
7. `useTimer(minutes × 60)` runs the match timer; the minutes come from `bo1TimerMinutes` or `bo3TimerMinutes`. `start()` is called by every game start but only starts once; until it starts, `remaining` follows the duration, so the length stepper shows at once

**Left margin**, top to bottom: Back (`IconButton`); the epic action button; the Force or Mystic Monastery button; the initiative bar (`role="radiogroup"`, OPP and YOU as `role="radio"` squares at each end, INIT between, flexing to fill the column with a 132px minimum, dashed outline until someone holds it); − when the damage buttons are on.

**Right margin**: Log and More (`IconButton`s); in a best of 1 or 3 the timer chip (`TimerDisplay`, opens the Round and timer sheet) and the Games chip ("1–0", you first); a spacer; once started, Round (accent, "Round 4: tap for round 5") and End game; + when the damage buttons are on.

**Sheets** (shared `Sheet`, `SegmentedControl`, `Stepper`, `Button`):
- **More**: Help, Settings and, between games of a Limited best of 3, Change base, which opens `SwuBaseSheet` over `changeBaseOptions` (App passes `limitedBaseOptions(bases, tournament.base)`, the bases of the registered base's set) and calls `onChangeBase`, which App stores as `tournamentCurrentBase`
- **Round and timer**: the round (or "Before game N") and the time left; before game 1 of a match (`onTimerMinutesChange` set), a Game length `Stepper` (5 to 90, step 5) that writes the remembered minutes for that match type
- **End game**: title "End game" (casual) or "End game N"; "Your base is destroyed" at 0 HP; Won / Lost / Draw; a line saying what recording does (the match score after it, or that it ends the match); Keep playing and Record win / loss / draw (disabled until a result is chosen)
- **Game over** (casual only): "Game won / lost / drawn", "Ended in round R · D damage taken", New setup (`onBack`) and Rematch (clears the result and the initiative; the card shows Start)

**End game flow:**
1. End game is offered once the game has started, and before game 1 of a tournament match (an intentional draw); not between games and not once the match is decided
2. A `useEffect` on `game.count` opens it with Lost chosen when `count >= base.hp` in a started game, unless it is already open. Keep playing closes it; it reopens only when the damage changes again and is still at full
3. `handleRecord(result)`: in a best of 1 or 3, `incrementPlayerScore` / `incrementOpponentScore` (plus `closeByTimer` when the timer has expired) or `recordDraw`, which ends the match; then `game.reset()`, a `game-result` log entry ("Game won" casual, "Game 2 lost" in a match), `onGameEnd`, and `lastGame = { result, round, damage }`. Casual opens the Game over sheet
4. When the match is decided, an effect fires `onMatchCompleted` and `onMatchComplete`, and App returns to the tournament
5. Undo of the `game-result` entry restores the game, the scores and `lastGame` from the snapshot. Undo of a Round 1 entry resets the timer only when no game of the match has been played

**The card's open art:** before a game, "Start" / "tap the card" (with "GAME WON" above it after a casual result); between games of a match, "GAME 1 WON · 1–0", "Start game 2"; in play, the damage (`damage`) and "N HP left", both in `--color-error` at 0 HP; once the match is decided, "Match won / lost / drawn" and the card is disabled.

The log is `GameLogOverlay`, toggled by Log.

### X-Wing setup screen

Each player's list and the scenario are chosen on `XwingSetupScreen` before the game starts. `App` stores the values returned from `onStart` and passes them to `XwingGameScreen`.

1. `useXwingSetup()` provides `matchType`/`rounds`, your list and the last opponent (persisted), `scenario`, `playerDeficit`/`opponentDeficit` (0–4) and the opponent's choice (session-only)
2. `useXwingLists()` provides the saved lists, shared through `XwingListsProvider`; the container resolves each choice against them, so a deleted list clears that player's choice
3. Until a player has chosen, their area offers **No list**, **＋ New list** (opens Squad Lists via `onLists`) and one tappable row per saved list; choosing sets `{ kind: 'none' }` or `{ kind: 'list', listId }`; the edit button sets the choice back to `null`; changing one player's choice does not affect the other
4. The opponent's area appears once either player has chosen (landscape shows `opponent-placeholder` until then)
5. "Go to game" appears once both players have chosen (`canStart`), bottom-right in both orientations, under the opponent's list/column
6. `handleStart` gives a list player `Math.max(0, 50 − listPoints(pilots))` and its pilots, a No list player the stepper deficit and no pilots; calls `onStart(playerDeficit, opponentDeficit, scenario, playerPilots, opponentPilots)` → App sets state, navigates to `'xwing'`
7. **Kept mounted:** `App` sets `isInXwingSetup` when entering setup (`enterXwingSetup` — from game select, the start screen, or Back from the game) and renders the setup screen inside a `display: none` wrapper whenever another screen is showing, so choices, deficits and scenario survive Squad Lists, Help, Settings and a game (Back from the game is a one-tap rematch); Back from setup (`leaveXwingSetup`) clears the flag and goes to `'gameSelect'`, so the next visit starts fresh
8. The header **Squad lists** button (`ListIcon`, before Settings) and **＋ New list** both call `onLists` → `App` pushes the current screen onto `backStack` and shows `'xwingLists'`; Back pops it

### X-Wing Squad Lists screen

- Reached from the X-Wing setup header (**Squad lists**) or Settings → X-Wing → **Manage lists**; both call `App`'s `handleXwingLists`, which pushes the current screen onto `backStack` and sets `screen = 'xwingLists'`; Back uses `handleOverlayBack`, so it returns to setup or settings
- Help opens `xwingListsHelp.md` (`helpSource = 'xwingLists'`)
- Not kept mounted; it shares the lists store with the setup screen through `XwingListsProvider`, so a list saved here is offered on setup as soon as you go Back

### X-Wing game screen

1. `useUserSettings()` provides `enableLongPress`, `enableActionLog`, `enableWakeLock`, and `xwingTimerMinutes`
2. `useXwingGame()` manages score state — `playerScore`, `opponentScore`, `gameOver`, `result`, `round`, `advanceRound`
3. `useTimer(xwingTimerMinutes * 60)` manages the countdown — `remaining`, `isRunning`, `isExpired`, `start`, `stop`
4. `useWakeLock(enableWakeLock)` acquires a Screen Wake Lock for the duration of the screen
5. Receives `playerDeficit` and `opponentDeficit` as optional props (default 0) — passed from App which received them from the setup screen; `handleStartGame` calls `game.reset()` so scores start at 0; deficits are applied in `handleShipAdvance` at the moment the last ship on a side is destroyed — bundled with the last ship's points into the same `game.incrementOpponent/Player(pts + deficit)` call so a single undo reverts both
6. `timer.start()` is called in `handleStartGame`; `useTimer.start()` is idempotent — calling it again has no effect
7. A `useEffect` on `game.gameOver` calls `timer.stop()` when the game ends — freezes `remaining` without reset
8. `handleRoundAdvance` guards against `timer.isExpired`, `game.gameOver`, and `game.round >= 12` before calling `game.advanceRound()` and firing `onXwingRoundAdvanced(fromRound, toRound)`
9. `handleBack` fires `onXwingGameEnded` with `elapsed_seconds` (duration − remaining) and `timer_expired` (from `timer.isExpired`)
10. `timerRemaining`, `timerExpired`, `round`, and `onRoundAdvance` are passed as props to the view; the view renders `<TimerDisplay testId="xwing-timer">` in the centre column while the game is in progress; the result banner replaces it at game over; the round tracker bar renders when `gameStarted` is true
11. Landscape-only: portrait shows `<RotatePrompt>`

### Settings screen

The settings screen is accessible from both the setup and game screens via the ⚙ button in the top-right area:

- Tapping ⚙ navigates to `SettingsScreen`; the current screen is pushed onto `backStack` so the back button returns to the correct place
- `SettingsScreen` (container) calls `useUserSettings()` and `useFavourites()` to read and write preferences and manage the saved SWU bases; X-Wing squad lists are managed on the Squad Lists screen via `onManageXwingLists`
- `SettingsScreenView` (view) renders a header row (back button, icon, "Settings" h1, help button) and toggle list
- Each toggle writes immediately to localStorage via `useUserSettings` — there is no save/cancel step
- **General** tab includes a **Start Screen** `<select>` (options: Select Game / Star Wars Unlimited / Star Wars X-Wing, persisted as `startScreen`; default: 'gameSelect') — controls which screen appears immediately after the loading screen. Back navigation from SWU setup or X-Wing always returns to game select regardless of this setting.
- The seven toggles: **Use Hyperspace Art**, **Enable Force Token**, **Enable Epic Actions**, **Enable Screen Wake Lock**, **Enable Action Log**, **Enable Competitive Mode** (beta, defaults off), **Enable Favourites**
- When **Enable Competitive Mode** is on, a `TimerStepper` row appears for **Bo1 Timer** (min=5, max=90, step=5) and **Bo3 Timer** (min=5, max=90, step=5), plus a **Melee Player ID** text input — all inset under the competitive mode toggle
- An **X-Wing** section (always visible, not gated by any feature flag) contains a `TimerStepper` row for **Game Timer** (min=30, max=90, step=5, default=75 minutes) with a section header label; after the toggle rows, a **Squad Lists** row (`xwing-lists-row`, laid out like a toggle row: label + subtitle on the left) has a **Manage lists** button on the right (rendered when `onManageXwingLists` is passed) that opens the X-Wing Squad Lists screen; saved squads are no longer listed in Settings
- When **Enable Favourites** is on, a saved-bases list appears directly below the toggle (inset with a left accent border to show hierarchy): each entry shows `SET: Name — HPHp (Aspect)` with a Remove button; a Clear All button (with a two-step inline Confirm/Cancel) appears when the list is non-empty; "No favourites saved" is shown when the list is empty
- **Landscape layout**: vertical sidebar of tab buttons on the left (text rotated anticlockwise via `writingMode: 'vertical-rl'` + `transform: 'rotate(180deg)'`, each button `flex: 1` to fill full sidebar height); active tab indicated by `borderLeft` (appears on the right edge after rotation); tab content area fills the remaining width. Portrait: tab buttons across the top; each tab content is a single scrollable column. The SWU tab is always a single column regardless of orientation.
- `SettingsScreenView` calls `useOrientation()` directly (not via props) and applies `fontFamily: 'Helvetica, Arial, sans-serif'` to prevent iOS Dynamic Type from overriding font sizes

### Tournament screen

The tournament screen (`SwuTournamentScreen` / `SwuTournamentScreenView`) allows players to track multiple rounds in a structured event:

1. `useTournament()` owns all tournament state — `TournamentState | null`, `matchInProgress` (derived: last round has `result === null`), `isComplete` (derived: all rounds filled and total reached), and win/loss/draw `totals`
2. Tournament state is persisted to localStorage under `tournament_state` so the app can be closed between rounds and the player returns to the correct screen on reopen
3. **Starting** happens on SWU setup, not here. With Tournament chosen, **Start tournament** opens the start sheet (Format, Match, Rounds); **Start round 1** calls App's `handleStartTournament`, which fires `onTournamentStarted`, calls `startTournament(base, format, playMode, totalRounds)` and `startMatch()` together, and goes straight to the game. The format is the one tournaments are played in from then on: it is passed to the game screen (`tournament.format`) and carried by every `tournament_*` event and the tournament's `game_ended` events. Setup's base sheet and SWUDB import keep to bases legal in the remembered format while Tournament is chosen, and the start sheet will not start with a base illegal in the format chosen there.
4. **The primary** reads **Start round N** between rounds (calls `startMatch`, clears any changed base, then `onGoToGame(playMode, registeredBase)`), or **Return to round N** with a match under way (`onGoToGame(playMode, candidateBase)` when a base was changed, `onGoToGame(playMode)` otherwise, so App keeps `tournamentCurrentBase`); when complete it is **Finish**, which fires `onTournamentEnded`, then `dropTournament` and `onDrop`.
5. **The round list** has a row for every round of the event: played rows show the result and games score; the next round (the first without a result, or the one under way) is outlined, `aria-current="step"`, reading Next or In progress; later rows are at half opacity. The list scrolls within itself, so neither 844×390 nor 390×844 scrolls the screen, even at 16 rounds.
6. **Drop** opens a sheet with the record, **Keep playing** (closes it) and **Drop** (fires `onTournamentDropped`, then `dropTournament` and `onDrop`). There is no Drop on a complete tournament.
7. **Back** returns to setup and keeps the tournament; setup's primary then reads **Go to tournament** and calls `onConfirm(base, 'tournament')`, which App routes back here.
8. **Change base (Limited Bo3 only):** when `canChangeBase` is true (limited format, bo3 mode, match in progress, `hasPlayedGameInCurrentMatch`, not complete), **Change base** appears on the Your base card. It opens `SwuBaseSheet` (search only) over the card data's bases of the registered base's set; choosing one sets `candidateBase`, and the card names it "for the next game". The next match goes back to the registered base.
9. **App routing:** `App.tsx` restores the `'tournament'` screen on load if `tournament !== null` (persisted state implies an active tournament) and renders the screen only while one exists; the game screen navigates back to `'tournament'` after a round is complete, passing the result via `useTournament.completeMatch`

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

## 6. Performance Considerations

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
- When a base is selected on the setup screen, `getFirstGameImageUrl` is called in a `useEffect` that fires a `new Image()` prefetch for the game-mode URL. This warms the browser cache so the game screen image is typically instant on Start
