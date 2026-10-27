# dmgCtrl — Architecture: Implementation Details

> **See also:** [Overview](architecture-overview.md) | [Process & Testing](architecture-process.md)

---

## 1. Folder Structure

```
src/
  App.tsx                  Root component — screen routing and top-level state; opens at `launchScreen()`; calls useBases() to show the splash or offline screen in place of SWU setup while it has no card data; renders the install banner; loads the three X-Wing screens (setup, game, Squad Lists) with `React.lazy` behind one `Suspense` (fallback `null`), so they and the XWA card table ship as separate chunks fetched on entering X-Wing, not in the main bundle; the service worker precaches those chunks, so X-Wing works offline
  main.tsx                 Entry point; counts the launch (`recordLaunch()`) before rendering
  index.css                Global reset, CSS custom property palette, help screen styles
  markdown.d.ts            Type declaration for .md imports
  vite-env.d.ts            Vite environment types

  components/
    layout/
      appScreenLayout.tsx  Shared full-screen layout wrapper (background, safe area)
      splitScreenLayout.tsx One phone shared by two players facing each other: `top`, `middle` and `bottom` in a portrait column, each half a `<section>` named by `topLabel` / `bottomLabel` and a size container (`container-type: size`, so its contents size with `cq` units); the top half is turned 180°. Chosen by mode, not by `isPortrait`: when `screen.orientation.angle` (or the legacy `window.orientation`) reports a landscape turn, the whole frame (`split-screen`) swaps to 100vh × 100vw and turns back by that angle, so the halves stay put on the phone. Knows nothing about SWU
      rotatePrompt.tsx     Landscape-only prompt — renders a full-screen "Please rotate to landscape" message with a Back button; used by swuGameScreen and xwingGameScreen when isPortrait is true; Back button uses `NAV_BTN_STYLE` spread with `position: absolute` at the top and left edge tokens
    icons.tsx               Reusable SVG icon components (BackIcon, ForwardIcon, HelpIcon, CogIcon, LogIcon, ShareIcon, HomeScreenIcon, DotsIcon, ChevronDownIcon, DiceIcon, CheckIcon, EditIcon, ListIcon, CloseIcon, StarIcon, SearchIcon, PlusIcon)
    imagePreview.tsx        Pure view — renders card art or error message from props; fill='width' (default) constrains by width with aspect-ratio height; fill='height' constrains by height with aspect-ratio width, right-aligned via marginLeft:auto, or centred with `centred`; uses useLayoutEffect to check img.complete on mount so cached images show immediately without waiting for a load event that the browser may not re-fire
    gameLogOverlay.tsx      Game screen action log overlay — scrollable entry list; auto-scrolls to bottom; undo button on last entry (hidden when `undoable === false`); `round`-type entries get a blue gradient (`rgba(59,130,246,0.2) → rgba(59,130,246,0)` — explicit zero-alpha endpoint avoids the CSS `transparent`/black-interpolation rendering artefact), a `1px solid rgba(147,197,253,0.4)` top border, `borderRadius: '4px 4px 0 0'` (flat bottom corners so the gradient is never clipped mid-fade), and `paddingTop: 0.35rem`; all three apply to every round entry including the first (`i > 0` guard removed); non-first round entries additionally get `marginTop: 0.35rem` for visual separation from preceding content; last entry gets `rgba(255,255,255,0.08)` highlight unless it is a round entry; accepts `LogEntryLike[]` (id, type, message, color, optional undoable) so it works with `HistoryEntry<unknown>[]` from both SWU and X-Wing without casting; an optional `position` replaces its place on the left of the screen
    shared/
      timerDisplay.tsx      Shared countdown display — renders `formatTime(remaining)` with colour thresholds: > 5:00 → `--color-text-muted`, ≤ 5:00 → `--color-warning`, ≤ 1:00 → `--color-error`; accepts `remaining`, optional `testId` (default `"timer-display"`), optional `style` overrides spread after the component's own colour; used by both SWU game screen view (non-interactive timer branch) and X-Wing game screen view
      controls.tsx          The X-Wing control set agreed in #853 (filled, radius 12, at least 44px; colours from the `--color-on-accent`, `--color-surface`, `--color-surface-raised`, `--color-tonal`, `--color-tonal-text`, `--color-sheet` and `--color-backdrop` tokens): `Button` (`variant` `primary` — accent fill, the screen's one next step — or `secondary` — tonal fill; `disabled`; always `type="button"`), `IconButton` (44×44 unless a `style` override sizes it, as in the SWU game's 60px margins; named by its required `label`; for back, log, more and roll only), `SegmentedControl` (a labelled `role="group"` of `aria-pressed` buttons, each label on one line; `value` may be `null` for nothing chosen), `SelectButton` (shows `value` with a chevron, named `"<label>: <value>"`, `aria-haspopup="dialog"`; opens a `Sheet` in place of a native select), `OptionRow` (one choice in a `Sheet`, a title and an optional muted `detail` line; `selected` fills it tonal and sets `aria-pressed`; `suggested` fills it without `aria-pressed`, for a one-tap shortcut), `Stepper` (− value + with `min`/`max`/`step`, buttons named `Decrease <label>`/`Increase <label>` and disabled at the limits), `Sheet` (modal `role="dialog"` named by its `title`, with a Close button and an optional header `action` before it; closes on the backdrop or Escape; `data-placement` `side` in landscape, `bottom` in portrait; a `wide` sheet, for a grid of choices, is `full` in landscape: the whole screen but a 10px margin; while an on-screen keyboard that does not resize the page covers 120px or more, measured as `window.visualViewport` against `innerHeight` at its zoom, the sheet starts at the top of the visible area (a bottom sheet may grow to it) and still runs to the foot of the screen behind the keyboard, so nothing shows through, with bottom padding that ends its content at the top of the keyboard, and scrolls the focused field to its top; it follows the visible area as the browser pans it, keeps a scroll bounce to itself (`overscroll-behavior: contain`) and runs on in its colour for a screen height below the foot of the screen; with no keyboard it is laid out exactly as without one)
      tournament.tsx        The between-rounds screen both games share: `TournamentLayout` (header with Back, "Tournament" or "Tournament complete" and the summary, More; the record and the card under it, your base or your list, beside the rounds in landscape, stacked in portrait; the primary, with the `secondary` actions beside it in landscape and under it in portrait), `RecordCard` (Record label, the record, a headline and a muted detail line), `RoundsList` (one row per round: a played one's Won / Lost / Drawn chip, score and optional right-hand `note`; the next one outlined with `aria-current="step"`, reading Next or In progress), `TournamentCard` (the named card under the record), `DropSheet` ("Drop from the tournament?" with the record, Keep playing and Drop), `PrimaryAction`
    swuGameScreen.tsx       Game screen container, for 1 and 2 players (`theirBase` given: 2 players). Uses RotatePrompt for portrait orientation in 1 player only; owns the game (and in 2 players a second `useSwuGame` for their base; the round lives in yours), match, timer, initiative and log hooks, the End game sheet state (`endGameOpen`, `endGameChoice`, opened with Lost when your base reaches 0 HP and Won when theirs does), the casual Game over sheet and `lastGame` (with `theirDamage` in 2 players); `sideOf` builds one base's handlers (damage, epic action, Force, Mystic Monastery), naming the base in log entries in 2 players ("Their base: 3 damage"); snapshots hold both bases, so undo restores either; `handleStartGame` records `gameStartTime`, fires `onGameStart` and adds an undoable Round 1 entry; `handleRecord` updates the match (not in casual), resets both bases, logs a `game-result` entry and fires `onGameEnd(baseKey, baseSet, useHyperspace, durationSeconds, playMode, format)`; `handleReset` (Back) fires `onGameEnd` if a game is under way. Renders `SwuGameScreenView` or `SwuGame2pView` from the same props
    swuGamePieces.tsx       The pieces both SWU game views share: `BaseCard` (the card `<button>`, driven by `useCardDrag`, with the damage, HP left, Start and match states in its open art from a `CardFace`, and the epic action token over its text box; every size on it scales from `unit`, one hundredth of its height), `EpicActionButton`, `ForceButton`, `SheetActions`, and `GameSheets` (More, Change base, Round and timer, End game). Styles and words in `swuGameStyles.ts` (`marginButton`, `DISABLED_BTN`, `mutedText`, `RESULT_WORD`, the card's aspect ratio)
    swuGameScreenView.tsx   Game screen view, 1 player: a grid of left margin, card and right margin built from `shared/controls.tsx` and `swuGamePieces.tsx`; the card's sizes scale from 1vh; margins hold Back, epic action, Force, the initiative bar, Log, More, the timer and Games chips, Round, End game and the optional − / +; owns which sheet is open and renders the Game over sheet. Exports `SwuGameViewProps`
    swuGame2pView.tsx       Game screen view, 2 players: `SplitScreenLayout` with their half on top (turned round) and yours below, each a `Half`: the base card at the half's width (sized from the half with `cq` units), then a row at the player's edge with the epic action or Force, **Initiative** (one radio per half; filled on the holder, "Take initiative" outlined on the other) and the optional − / +. Their half's drags are `flipped`. The middle strip (`nav` "Game"): Back to setup, Log, Round (disabled before the game), the timer and score in a best of 1 or 3, End game (disabled before the game), More. After a casual game, each half shows its own result and the round and damage, the card keeps the damage it ended on, and the strip (`nav` "Game over") holds Log, New setup and Rematch. The log opens over your half
    xwingSetupScreen.tsx    X-Wing setup screen container — calls `useXwingSetup()` and `useXwingLists()`; `resolve(choice, lists)` turns each player's stored choice (`{ kind: 'none' }` or `{ kind: 'list', listId }`) into a `ResolvedChoice` with the list looked up — a list deleted on Squad Lists resolves to no choice, so that player picks again; looks up `lastOpponentListId` as `lastOpponentList` (null once that list is deleted); `canStart` once both players have a choice; `handleStart` gives a list player `Math.max(0, 50 − listPoints(pilots))` and its pilots, and a No list player the hook's manual deficit and no pilots; `handleScenarioRandom` picks a random entry from `XWING_NAMED_SCENARIOS`
    xwingSetupScreenView.tsx X-Wing setup screen view, built from `shared/controls.tsx` (#853 design) — top bar: Back and More `IconButton`s and an "X-Wing" title; More opens a `Sheet` with Squad lists (`onLists`), Help and Settings (`onSettings`), each closing the sheet first. Two cards (`player-card`, `opponent-card`): once chosen, a list shows its name (`{side}-chosen-name`), `listMeta()` line and a two-line `pilotSummary()` with a "Change list" button; No list shows "No list", the note "No ships to tap in the game" and a Deficit `Stepper` (0–4) — the only deficit shown; before choosing, your card has "Choose a list" and the opponent's asks "Choose opponent's list", offering last game's opponent (`lastOpponentList`) as a filled one-tap row ("Same as last game · …") above "Choose another list". Each card's button opens that side's list `Sheet` ("Your list" / "Opponent's list"): one `OptionRow` per saved list (`{side}-list-option-{id}`, the current one pressed), with its `FactionIcon`, or "No saved lists yet", then Build a list (`onBuild(side)`) and Import XWS (`onImport`) in a row, then No list last (`{side}-no-list-btn`) as the fallback. Match `SegmentedControl` (Casual/Tournament); Scenario `SelectButton` opening a Scenario sheet (None + the 5 named) and a Roll `IconButton`; primary **Go to game** (Casual) or **Start tournament** (Tournament), disabled until `canStart`, or **Go to tournament** (`tournamentInProgress`, calls `onGoToTournament`). **Start tournament** opens the start sheet (`Sheet`, "Start a tournament"): your list's name, a Rounds `Stepper` (2–10, the saved `rounds`; changing it is saved), "Fixed once round 1 starts.", **Cancel** and **Start round 1**, which closes the sheet and calls `onStartTournament`. Sets its own primary text colour (`xwing-setup`). **Portrait**: one scrolling column — top bar, your card, opponent card, Match section, the primary at the bottom. **Landscape**: top bar, the two cards side by side, then one row with match, scenario, roll and the primary. Exports `ResolvedChoice`
    xwingListsScreen.tsx    X-Wing Squad Lists (#858 design), three modes in one component. **Lists**: header (Back, "Squad Lists" h1, Import XWS, primary New list, Help), then one `ListCard` per saved list (one column in portrait, two in landscape): `FactionIcon` and name, `listDetail()` line (`list-meta-{id}`), `pilotSummary()`, and Edit / Rename / Delete; Rename is an inline input (blank disables Save name; a name another list uses shows "Another list already has that name."); Delete asks in an `alertdialog` naming the list. **Build**: renders `XwingListBuilder` (editing the list for Edit; from New list with Import XWS offered on its faction step); Back or a save returns to the lists. **Import** (`startWith="import"` opens here, and Back then leaves the screen): paste box with Clear and Check; `parseXwsText`, then `listProblems()` on the pilots, which are shown and saved at `atCurrentCost()`; the result panel shows the read error, or "{name} can't be saved yet" with the numbered problems (`role="alert"`), or the list's pilots and `listDetail()`; Save list (enabled only when legal) opens `XwingSaveListSheet`, which saves and returns to the lists. With problems, **Fix in builder** opens Build with `start` (the known pilots, the faction and the imported name); the pasted text is held by the screen, so Back from that builder returns to the paste and checks it again, and it is dropped on returning to the lists
    xwingListBuilder.tsx    X-Wing list builder (#858 design), used by Squad Lists and by setup's Build a list. Props: `editing?` (a saved list), `start?` (`BuilderStart`: pilots, faction and name for a new list that starts filled, from Import XWS's Fix in builder; saved as a new list under that name by default), `side?` ("for you" / "for your opponent"), `onBack`, `onSaved(listId)`, `onImport?`. A new list starts on the faction step (the seven `FACTIONS` with `FactionIcon` and ship count; Import XWS when `onImport`); Back there calls `onBack`. Then: header (Back, faction name h1 with its symbol, "New list · for you" or "Editing {name} · N pts when saved") and `Status` (`builder-status`: total / 50 pts · N ships (3–8), and `saveStatus()`'s message, with ": costs have changed" when an edited list is over 50 and its saved total differs). Landscape: ships column (`factionShips()`, A to Z, with counts), pilot column (search, the ship's pilots cheapest first as `pilot-option-{id}`, disabled by `addBlock()` with "in list" / "n of n, the limit"; at 8 ships a status line), and the **Your list** panel (`builder-list`): a unique or unknown pilot is a `list-row-{index}` with ✕, tapping it starts a swap ("Swap X for…", Cancel; options show the new total); a generic pilot's repeats share a `list-group-{id}` row with − and + (+ disabled at its limit or 8 ships). Portrait stacks status, list, swap line, a Ship `SelectButton` (a Ship sheet), search and pilots. Save list / Save changes (enabled when `saveStatus().ready`) opens `XwingSaveListSheet` and saves with `saveList`. An edited or started list is priced with `atCurrentCost()`; one without a faction takes its first known pilot's; Back with no pilots on a new list returns to the faction step, otherwise calls `onBack`
    xwingSaveListSheet.tsx  The save sheet the builder and Import XWS share: the list's `listDetail()`, a Name input (placeholder and blank-name fallback `defaultListName()`, "Left blank, it's saved as …"), the pilot summary and one primary button. Saving under the edited list's own name says "Updates {name} / Was N pts" (Save changes); a name another list has says "Replaces your saved {name}" (Overwrite {name}); an edit under a new name is Save copy. Calls `onSave(name)`
    factionIcon.tsx         `FactionIcon({ faction, size })`: the faction's symbol from `data/factionGlyphs.ts` as an inline SVG in `currentColor`, labelled with the faction name; nothing for no faction or an unknown one
    xwingGameScreen.tsx     X-Wing game screen container: receives `playerDeficit`, `opponentDeficit`, `scenario`, `matchType` and both pilot lists from App. `XwingGameSnapshot` holds scores, round, phase, gameOver, both ship rosters, `scoringOpen` (phases off: the round's scoring is open), `extraRound` (One more round) and `gameOverReason`, so undo restores all of it. Ships start from the lists (shown before the game) and advance alive → half → destroyed, awarding `halfPoints` then `remainingPoints` (all points on a long-press); the last ship of a squad brings its deficit in the same increment. Log entries use the numbered display names from `displayPilots` with a `detail` line ("+6 to you"). A round's end (`handleEndOfRound`, from the End phase or Start round) ends the game through `finishGame` at round 12, after the timer expired, after One more round, or when `reachesTarget` holds with the round's pending mission points. `canPlayOneMoreRound`: Casual, ended on time or by rounds, and neither side all destroyed. Rematch resets to before the game with the same lists. With `onRoundComplete` (a tournament game) the view gets `onBackToTournament`: game over offers only **Back to tournament**, which calls `onRoundComplete(result, combinedPlayer, combinedOpponent)` with the result as `won` / `lost` / `drawn`, and the header back button is named "Back to tournament". Score breakdowns (mission, ships against the other side, deficit, −/+ adjustments, total) are computed here for game over
    xwingGameScreenView.tsx X-Wing game screen view: a grid of your column | centre panel | opponent's column. Column headers carry Back, or Log and More. `ShipTile` is a whole-tile button (pointer events: tap, or long-press of 400ms within 10px), coloured by state, with the pilot's faction symbol (`FactionIcon`, faction from `xwaPilots`; none for an unknown pilot) before the name, or the dmgCtrl mark when destroyed; `ShipColumn` lays rows out with `shipRows`. `ScoreButtons` over a column score that column's ships. The centre panel: round-and-timer button, `ScoreTile`s (FIRST under the side with initiative), then by state: Start game; the phase button (initiative choice in Planning, `MissionPoints` in End); phases off, the First `SegmentedControl` and the round button or the scoring with Start round; game over, the result, `Breakdown` and Rematch, One more round, New setup. `LogDrawer` is a `Sheet` grouping entries under their 'round' entry, newest first, with Undo on the newest. Sheets: More (Help, Settings) and Round and timer (game length `Stepper` before the game). `getDisabledPlayerValues` / `getDisabledOpponentValues` disable impossible mission point pairs (Chance Engagement uses `VALID_CHANCE_PAIRS`)
    helpScreen.tsx       Help screen: one of three pages (swuHelp.md, xwingHelp.md, appHelp.md), opened at a section, chosen by the source prop (see Help screen under Feature Architecture)
    swuCardDataScreens.tsx  `SwuSplash` (app icon and name, an indeterminate progress bar, "Getting SWU card data"; the bar stands still with reduced motion) and `SwuOffline` ("SWU needs a connection the first time", Try again, Play X-Wing, Back to game select), shown by App in place of SWU setup while it has no card data
    gameSelectScreen.tsx Game select screen: header: app icon + `dmgCtrl` h1 on the left, Help and Settings as worded secondary `Button`s on the right; two tiles (`Star Wars: Unlimited`, `X-Wing`) side by side in landscape and stacked in portrait, filling the space left; the tile of `lastGame` is filled tonal and labelled LAST PLAYED (its accessible name ends ", last played"); the `banner` prop renders under the tiles
    installBanner.tsx    Install banner: one row (`section` "Install dmgCtrl"): app icon; Android: "Install dmgCtrl", what installing gives, Not now and Install (the deferred `beforeinstallprompt` prompt); iPhone: "Install dmgCtrl from Safari" and the steps as one list (Tap the three dots › Share › View More › Add to Home Screen), wrapping in portrait, and Not now; positioned by its screen (App floats it at the foot of the setup screens)
    swuBaseSheet.tsx        The SWU base sheet (`Sheet` `wide`, titled "Choose your base" unless `title` says otherwise: setup's their-base sheet is "Choose their base", the Twin Suns one "Opponent’s base" with its **Remove base** as the `Sheet` `action`), used by setup and by the tournament screen's Limited base change. Its body mounts only while open, so it opens afresh each time: a search box and four aspect toggles (Vigilance, Command, Aggression, Cunning; one at a time, tap again to clear), then either the results (`"N bases · Aspect · “query”"`, group `Results`) or Favourites, then Recent (favourites not repeated; `recentLabel` renames it, "Used for other players before" for Twin Suns opponents), or All bases when there are neither; tiles (`BaseTile`: aspect icon, name, "SET · HP", the current base pressed with a check) call `onChoose`. Takes the bases it may offer (`bases`, already filtered by the caller). With `swudb` (setup only), **Paste SWUDB link** (in the search row in landscape, at the foot in portrait) switches to the import view: the link, Load, the error, the deck name with "Deck found · its base:" and its tile, **Search instead** and **Use this base**. Exports `SwudbImport` and `SwudbImportControls`
    swuSetupScreen.tsx      SWU setup container — `useSwuSetup(onConfirm, onStartTournament)` for the kept base, recent bases, match and tournament format; in a tournament, filters the base sheet's bases, favourites and recent bases to those legal in the format (`isBaseValidForFormat`), and reports an SWUDB deck whose base isn't legal (`formatValidationError`) in place of offering it; `useBaseArt` for the base card's art (and preloads the game screen's first image); resolves favourite records to bases from the card data (one no longer there is left out); owns the SWUDB import state (`SwudbImport`: link, error, deck name, the deck's base, loading) and its analytics; the Favourite toggle adds or removes the base (aspect `None` for an aspectless base) whatever the Enable Favourites setting; `onConfirm(base, mode)` for a casual game or to return to a tournament under way (`tournamentInProgress`), with their base third in 2 players and the Twin Suns seats fourth in Twin Suns (App then opens `SwuTwinSunsGame`), `onStartTournament(base, settings)` from the start sheet
    swuTwinSunsGrid.tsx     Twin Suns seating grid on SWU setup (see swuSetupScreenView.tsx)
    swuTwinSunsGame.tsx     Twin Suns game container (App renders it when setup passes the seats): players are your base (`Top left`) then each filled seat in `TWIN_SUNS_SEATS` order; holds a `TwinSunsState` from `utils/twinSuns.ts` (the game starts at round 1 on mount: no Start step), a `useGameHistory` log whose snapshots are that state (every action, Undo and **Undo the damage** restore the one before), `picking` (the counter waiting for a base) and `confirmEnd`. A card tap settles a waiting destroyed base (that base heals 5), claims the counter being picked, or adds 1 damage. Analytics as the 1-player game, play mode `twin-suns`; **Finish game** logs "Game won/lost/drawn" from your side (`yourResult`) and sends `onGameEnd`. RotatePrompt in portrait. Rematch resets the state and log with the same players
    swuTwinSunsGameView.tsx Twin Suns game view: 4 players, a column of two cells each side of a full-height bar; 3 players, two rows, the bar between the pair on one side and the single cell centred (`twin-suns-row-top` / `-bottom`). Each cell is a `<section>` named by its seat, turned 180° in the top row, sizing the card from the cell with `cq` units; the card is `BaseCard` (`swuGamePieces.tsx`) driven by `useCardDrag` (flipped on top), with the counters' tokens down its left edge (Initiative a button that starts moving it; Plan and Blast `role="img"`), YOU on yours, the round epic action button or the **Epic action used** plate (tap to undo) over the text box, "+5 healed", the **Destroyed** cover and, once over, the place cover. The bar (`navigation` "Game, facing you" / "Game over, facing you") is turned to face you: Back, Log, More, the counters (Initiative's claim slot always, Plan and Blast disabled once claimed), Round or, in the last phase, the note and **Finish game**, End game; in its place while choosing, the counter's prompt and Cancel, the destroyed base's question with **No one** and **Undo the damage**, End game's confirmation, or the result list with New setup and Rematch. On a tablet (`(min-height: 600px)`) every bar control is a 94px square, one column in 4 players and two in 3. Exports `Seat`, `TwinSunsPlayer`
    swuSetupScreenView.tsx  SWU setup view, built from `shared/controls.tsx` like X-Wing setup — top bar: Back and More `IconButton`s, the dmgCtrl mark (30px) and the "Star Wars: Unlimited" h1 (22px; 17px on one line in portrait); More opens a `Sheet` with Help and Settings, each closing the sheet first. **Your base** card (`base-card`): the Favourite toggle (star and word, `aria-pressed`), the base art (`ImagePreview`, by height and centred in landscape, by width in portrait), then the aspect icon, name and "SET · HP" beside **Change base**; with no base, one large "Choose your base" button (and the card data's error, if any). In 2 players, a **Their base** card (`their-base-card`, label in `--color-opponent`) built by the same function: no Favourite toggle, "Same as last game" in its header while `theirBaseFromLastGame`, "Choose their base" when empty, opening a second `SwuBaseSheet` titled "Choose their base" with the same bases, favourites and recent bases (your recents: their base never enters them). In Twin Suns, `SwuTwinSunsGrid` (`swuTwinSunsGrid.tsx`, a `role="group"` "Bases") takes the cards' place: a 2×2 grid, your base top left (`Your base: <name>`, accent border, with a separate Favourite star button over its corner; "Choose your base" when empty) and the three `TWIN_SUNS_SEATS` in reading order, each `Opponent, <seat>: <name>` or a dashed `Add base, <seat>`; a base cell shows its art (darkened), aspect icon, name (two lines at most) and "SET · HP". Tapping your base opens your base sheet; tapping a seat opens a third `SwuBaseSheet` titled "Opponent’s base" for that seat: no favourites, `otherPlayersBases` as "Used for other players before", and **Remove base** in the header when the seat has a base. A line under Match counts the players or says what is missing (`twinSunsHint`). Mode `SegmentedControl` (`SWU_MODES`: 1 player / 2 players / Twin Suns) above Match `SegmentedControl` (Casual/Tournament, always shown); primary **Go to game** (Casual), **Start tournament** (Tournament) or **Go to tournament** (a tournament under way), disabled until `ready` (your base, and theirs in 2 players, or two opponents' in Twin Suns), with "Choose their base to start." under it while only theirs is missing. **Start tournament** opens the start sheet (`Sheet`, "Start a tournament"), whose body mounts only while open: your base's name, or in its place the legality error (`formatValidationError`, `role="alert"`) with **Change base** (opens the base sheet); **Format** `SegmentedControl` (Premier / Eternal / Limited, `TOURNAMENT_FORMATS`, the remembered one chosen; changing it is saved); **Match** (Best of 1 / Best of 3, Best of 3 each time); a Rounds `Stepper` (2–16, 5 each time); "Fixed once round 1 starts.", plus "In Limited you can change base between games of a match." with Limited; **Cancel** and **Start round 1** (disabled while the base isn't legal), which closes the sheet and calls `onStartTournament({ format, playMode, totalRounds })`. Fits 390px high. The base sheet is `SwuBaseSheet`. **Landscape**: the card (two side by side in 2 players, Change base then under the name; the grid in Twin Suns) beside the controls column (Mode, Match, the Twin Suns line, primary at the foot; 284px in every mode), no scrolling at 844×390. **Portrait**: top bar, card (in 2 players both cards, sharing the height, art by height; the grid in Twin Suns), Mode, Match, the Twin Suns line, primary at the foot, no scrolling at 390×844. Re-exports `SwudbImport`
    settingsScreen.tsx   Settings screen container — reads and writes useUserSettings (`startScreen`, `useHyperspace`, `forceTokenDisplay`, `meleePlayerGuid`, `enableDamageButtons`, `enableInitiativeBar`, `enableXwingPhases`, `enableXwingAlwaysIncDec`) and reports each change but the Melee ID with `onSettingChanged(key, value)`; passes the last game played (`readLastGame()`) to the view; props `onBack`, `onManageXwingLists`
    settingsScreenView.tsx Settings screen view — one page from `shared/controls.tsx`, no tabs, no Help: Back `IconButton` and "Settings" h1; three `<section>`s named General, Star Wars: Unlimited and X-Wing. General: Start screen `SelectButton` opening a "Start screen" `Sheet` of `OptionRow`s (Last game played, with a line saying which setup it opens now from the `lastGame` prop, Game select, Star Wars: Unlimited, X-Wing; choosing closes it). SWU: Hyperspace art, Force tokens `SegmentedControl` (Always / LOF bases / Off), Melee player ID input, Damage −/+ buttons, Initiative. X-Wing: Phase tracker, Score −/+ buttons, Squad lists `Button`. Switches are a local `SwitchRow` (`role="switch"`, `aria-checked`). Each section sets `--color-surface` to the raised colour for its controls, which sit on the section's fill. Landscape: a `5fr 6fr` grid, General and X-Wing left (`settings-left`), SWU right (`settings-right`), labelled controls beside their label at up to 280px; portrait: stacked, labelled controls under their label, and a line under each X-Wing switch
    swuTournamentScreen.tsx  Tournament screen container, between rounds (rendered only while a tournament exists; it is started from the setup start sheet). `canChangeBase` (Limited + bo3 + matchInProgress + hasPlayedGameInCurrentMatch + !isComplete) gates **Change base**, whose options are the card data's bases of the registered base's set (`useBases`); `candidateBase` is passed to `onGoToGame` when chosen, omitted otherwise (App falls back to tournamentCurrentBase for the game screen); a new match calls `startMatch` and plays the registered base; Drop fires `onTournamentDropped`, Finish `onTournamentEnded`, each then `dropTournament` and `onDrop`; Player portal opens melee.gg with a player ID, otherwise Settings
    xwingTournamentScreen.tsx X-Wing between rounds (lazy, rendered while an X-Wing tournament exists; it is started from the X-Wing setup start sheet), laid out by `shared/tournament.tsx`. Summary "X-Wing · R rounds"; **Record**: W–L (W–L–D once there is a draw), "Won w, lost l" and "Margin +n" (− for a negative margin); **Your list** (`section`): its name and "Your list for this tournament · N pts" (no points for No list); **Rounds**: each round's result, score and "vs <opponent>". Primary: **Start round N** opens the opponent sheet ("Opponent’s list for round N": an `OptionRow` per saved list from `useXwingLists`, Import XWS (`onLists`), No list), whose choice calls `onStartRound` with a copy of the list (deficit `50 − points`; No list: no pilots, deficit 0); **Return to round N** while a round is under way (`onReturnToRound`); **Finish** when complete. **Drop** (not when complete) opens the Drop sheet, whose record reads "W–L, margin +n". More: Help, Settings
    swuTournamentScreenView.tsx Tournament screen view, built from `shared/controls.tsx` and laid out by `shared/tournament.tsx`. Header: Back and More `IconButton`s, "Tournament" or "Tournament complete" h1 and "SWU · Format · Best of N · R rounds" (under the header in portrait); More opens a `Sheet` with Help and Settings. **Record** (`section`): W–L–D, "N points", "Won w, lost l, drawn d"; **Your base** (`section`): aspect icon, name, "Your base for this tournament" (or "for the next game" once changed) and **Change base** when offered (opens `SwuBaseSheet`, search only). **Rounds** (`ol`): one row per round of the event — a played one shows Won / Lost / Drawn and the games score, the next one is outlined with `aria-current="step"` and reads Next (In progress mid-match), later ones at half opacity; the list scrolls within itself, the screen never does. Actions: **Drop** (opens the Drop sheet: the record, "This can’t be undone.", **Keep playing** and **Drop**), **Player portal** / **Enter player ID**, and the primary **Start round N** / **Return to round N**, or **Finish** when complete (no Drop then). **Landscape** (844×390): header, a 300px column (record, base) beside the rounds, the action row at the foot. **Portrait** (390×844): header, summary, record, base, rounds, primary, then Drop and Player portal side by side

  hooks/
    useBaseArt.ts           Ordered art fallback chain shared by setup, game, and tournament screens. Exports `getFirstGameImageUrl(base, useHyperspace)` which returns the first URL from the fallback chain, used by the setup screen to preload the game image while the user is still on the setup screen
    useDragScrubber.ts      Drag gestures. `useDragScrubber`: press and drag upward on a `+`/`−` button; exposes `dragIndicator` and pointer handlers; 15px dead zone; 14px per step from 2; capped at `Math.min(max, 20)`; suppresses the click after a drag; inactive when the reachable cap is < 2. `useCardDrag`: one surface for both directions (the SWU card); a tap calls `onTap`, dragging up adds and down removes from 1 past the same dead zone and step, capped at the capacity; exposes `amount` and pointer handlers. Both take `flipped` for a surface turned round (the far half of the SWU two-player screen), where up for its player is down the screen
    useBases.ts             Fetches and caches the full list of Base cards; returns `{ bases, loading, error, retry }`; the cache (any age) is read in the initialiser, so cached data is there on the first render and `loading` starts true only with none; a stale cache is refreshed in the background; one fetch in flight is shared by every instance; `retry` fetches again after a failure
    useInstallPrompt.ts     PWA install prompt — detects standalone mode, iOS (userAgent), and Android (captures `beforeinstallprompt` event); returns `{ showBanner, platform, onInstall, onDismiss }`; showBanner needs the second launch (`launchCount() >= 2`) and no live 30-day hide, then is true for iOS non-standalone, or Android non-standalone when the deferred prompt is available; onDismiss (Not now) and onInstall (after `deferredPrompt.prompt()`) store `install_banner_hidden_until` = now + 30 days in localStorage and hide
    useFavourites.ts        Favourites list — add/remove/clear operations with deduplication on key; sorted by set then card number ascending; persists FavouriteBase[] to localStorage under key `favourites`; SWU setup's star (add and remove) and base sheet use it
    useInitiative.ts        Initiative state hook — `Initiative` type ('player' | 'opponent' | null); `useInitiative()` returns `{ initiative, setInitiative, cycle, setOpponent, setPlayer, reset }`; `cycle` advances null→player→opponent→null; `setOpponent` always sets to 'opponent' (no toggle-back to null — initiative, once set, stays set unless programmatically reset); `setPlayer` always sets to 'player'; `reset` sets to null (used programmatically, e.g. X-Wing round advance); used by both game screen containers
    useGameHistory.ts       Generic game history hook — `useGameHistory<TSnapshot>()`; each `HistoryEntry<TSnapshot>` records id, type, message, color, snapshot (full game state before the action); methods: `add`, `undoLast` (pops and returns the last entry, or null if empty), `reset`; used by both SWU and X-Wing game screens
    useOrientation.ts       Detects portrait vs landscape; returns isPortrait (via matchMedia change event) and vmin (Math.min(screen.width, screen.height) — stable across rotations)
    useSwuGame.ts           Damage counter, epic action used, Force active, Mystic Monastery uses left, round; snapshot / restoreState / reset
    usePhaseTracker.ts      Generic phase cycling hook — `usePhaseTracker(phases: readonly string[])` returns `{ phase, phaseIndex, isLastPhase, advance(), reset(), restore(index) }`; stateless re: game rules — just cycles through the provided array; `XWING_PHASES = ['Planning', 'System', 'Activation', 'Engagement', 'End'] as const` exported for use by XwingGameScreen
    useXwingGame.ts         X-Wing score state — playerScore, opponentScore, playerScenarioScore, opponentScenarioScore, round (starts at 1, clamps at 12), combinedPlayer, combinedOpponent (ship plus scenario points), gameOver, result; `gameOver` is set only by `endGame()`, so reaching 50 does not end the game by itself; scores have no ceiling; exports `XWING_TARGET_SCORE` (50) and `reachesTarget(playerTotal, opponentTotal)`, true when either total is at least 50; `result` computed from combined totals; `addScenarioPoints(player, opponent)` increments scenario scores (no-op when gameOver); `endGame()` sets `gameOver = true`; `reset()` resets all scores and scenario scores to 0; `restoreState({ playerScore, opponentScore, playerScenarioScore?, opponentScenarioScore?, round, gameOver? })` — optional fields default to 0 / false
    useXwingLists.ts        X-Wing saved squad lists, shared through `XwingListsProvider` (React Context; `App` wraps its screens in it, and `useXwingLists()` throws outside it) so every screen sees the same lists — `saveList(name, pilots, faction?)` returns the saved list's id (a new list gets a new id and `createdAt`; a list with the same name is replaced in place, keeping its id and `createdAt`, so an edited list stays the one setup has chosen), `renameList(id, name)` (no-op if another list has that name), `removeList(id)`; each list is `{ id, name, pilots, faction?, createdAt? }` (`faction`/`createdAt` absent on lists saved before they existed); points are not stored — derived with `listPoints()`; persists `XwingList[]` to localStorage under key `xwing_favourites` (the key predates the rename and is kept so existing saved squads load unchanged); exports `XwingList` type
    useXwingSetup.ts        X-Wing setup screen state — ruleset (XwingRuleset), matchType (XwingMatchType) and rounds (2–10) persisted to localStorage under key `xwing_setup`, with `playerListId` (your list, pre-filled as `playerChoice` next time; only a saved list is remembered, never No list) and `lastOpponentListId` (set whenever the opponent chooses a saved list; exposed as `lastOpponentListId` to offer, while `opponentChoice` always starts `null`); each player's choice (`playerChoice`/`opponentChoice`: `XwingPlayerChoice` — `{ kind: 'none' }` or `{ kind: 'list', listId }` — or `null` before choosing), playerDeficit/opponentDeficit (0–4 each, clamped) and scenario (XwingScenario) are otherwise session-only; fields from older versions (`playerListImport`, `opponentListImport`, `listImport`) are ignored on load and dropped on the next save; defaults: ruleset='XWA', matchType='Casual', rounds=6, scenario='None'; exports `XWING_NAMED_SCENARIOS` (the 5 named scenario strings, excludes 'None') and `XwingScenario` / `XwingPlayerChoice` types
    useSwuSetup.ts          SWU setup state, persisted to localStorage under key `swu_setup`: `baseKey` (your base, kept across games and launches; exposed as `base`, resolved against the card data, so a key no longer there reads as no base), `recentBaseKeys` (the last 6 bases played, most recent first, each once; added by `handleSubmit`, exposed as `recentBases`) `matchType` (`casual` | `tournament`; read from the older `pref_play_mode` when there is no `swu_setup` yet, where `bo1`/`bo3` mean tournament) and `format` (the tournament format offered first: `premier` | `eternal` | `limited`, Premier by default; taken from the older `pref_format` when `swu_setup` has none), `mode` (`1p` | `2p` | `twin-suns`, from `SWU_MODES`, 1 player when missing or unreadable), `theirBaseKey` (their base in 2 players, kept like yours; exposed as `theirBase`) and `lastTheirBaseKey` (their base in the last 2-player game started; `theirBaseFromLastGame` is true while the two match), `seatKeys` (Twin Suns opponents' bases by seat, `TWIN_SUNS_SEATS` order: top right, bottom left, bottom right; null for an empty seat; kept like yours; exposed as `seats`, a key no longer in the card data reading as empty, and anything unreadable as three empty seats) and `otherRecentBaseKeys` (the last 6 bases played for other players, their base in 2 players and the opponents' in Twin Suns, most recent first, each once; exposed as `otherPlayersBases`); `chooseBase`, `chooseTheirBase`, `chooseSeatBase(seat, base)` and `removeSeatBase(seat)` (each touching only that seat), `setMatchType`, `setMode`, `setFormat`, `ready` (your base, and theirs in 2 players, or at least `TWIN_SUNS_MIN_OPPONENTS` (2) seats filled in Twin Suns), `handleSubmit` (when ready: records your base as recent and the other players' bases as theirs, and in 2 players their base as the last game's, then `onConfirm(base, matchType)`, with `theirBase` as a third argument in 2 players, and `undefined` then the three seats in Twin Suns), `handleStartTournament(settings)` (the same, then `onStartTournament(base, settings[, theirBase])`); also returns `bases`, `loading`, `error`. App keeps their base for the session (`selectedTheirBase`, not persisted: a tournament resumed after a reload plays 1 player) and passes it to the game screen as `theirBase`; it holds the Twin Suns seats the same way (`twinSunsSeats`) while that game is open, the seats themselves being kept here. Every save drops the retired keys `pref_format`, `pref_selection_mode` and `pref_play_mode`. Exports `SwuMode`, `SWU_MODES` (a new mode is one more entry), `TournamentFormat`, `TOURNAMENT_FORMATS` and `TournamentSettings` (`format`, `playMode`, `totalRounds`). Exports `baseKey(base)` (`SET-NUMBER`) and `filterBases(bases, query, aspect)` (name contains the trimmed query, ignoring case, and has the aspect when given; sorted by name; every set, whatever its format)
    useMatch.ts             Match score state — playerScore, opponentScore, matchOver (computed), matchResult ('won'|'lost'|'drawn'|null, computed), incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState; maxScore is 1 for bo1, 2 for bo3; scores are clamped at maxScore; matchOver also true when matchDrawn or matchClosedByTimer flags are set; matchResult derived from final scores when match closes early
    useTimer.ts             Countdown timer hook — remaining (seconds), isRunning, isExpired; start (idempotent — only starts once), stop (freezes remaining at current value, preserves startTimeRef), resume (sets isRunning = true without clearing startTimeRef — resumes from original start time so time elapsed during the stopped period is automatically accounted for; no-op if never started), reset; until started, remaining follows a changed duration, and the duration is fixed at start; wall-clock based — records start time and computes remaining from elapsed time on each tick; visibilitychange listener recalculates when page becomes visible; used by both SWU game screen (competitive mode) and X-Wing game screen
    useUserSettings.ts      React Context — persistent user preferences (useHyperspace, forceTokenDisplay, enableInitiativeBar, enableXwingPhases, enableXwingAlwaysIncDec, enableDamageButtons, startScreen, bo1TimerMinutes, bo3TimerMinutes, xwingTimerMinutes, meleePlayerGuid) backed by localStorage under key `user_settings`; forceTokenDisplay is a 3-way value ('always-on' | 'lof-only' | 'always-off'), defaulting to 'lof-only'; useHyperspace and enableInitiativeBar default to true, enableXwingAlwaysIncDec and enableDamageButtons to false; enableDamageButtons adds − and + to the SWU game screen's margins; bo1TimerMinutes, bo3TimerMinutes and xwingTimerMinutes are set by the game length steppers on the game timers, not in Settings; enableXwingPhases toggles the phase tracker on the X-Wing game screen: false for a new install (nothing under `user_settings` and none of `swu_setup`, `xwing_setup`, `xwing_favourites`, `favourites`, `tournament_state`), true for an existing player who never set it (stored settings without the key, or other app data), and with nothing stored the first load saves its result so the choice is made once; retired keys (enableEpicActions, enableWakeLock, enableActionLog, enableFavourites, enableCompetitiveMode, enableLongPress, enableGameSelect) are not read, so stored settings that carry them load as before and they are dropped on the next save; enableXwingAlwaysIncDec defaults to false — when true, both inc/dec button pairs are always visible on the game screen regardless of ship lists or scenario scoring state; migrates old enableForceToken boolean (false → 'always-off', true/missing → 'lof-only'); startScreen is 'lastGame' | 'gameSelect' | 'swu' | 'xwing', defaulting to 'lastGame'; every save writes `version: 2`, and stored settings without it that hold 'gameSelect' (the old default, indistinguishable from a choice) load as 'lastGame' and are saved at once, so the migration happens once; `UserSettingsProvider` wraps the app in `main.tsx`
    useXwingTournament.ts   X-Wing tournament state, persisted to localStorage under key `xwing_tournament` on every change (unreadable state loads as none): `XwingTournamentState` (`totalRounds`, `player` and `rounds`), `XwingTournamentList` (`name`, `pilots`, `deficit`: a copy of the list, so deleting it from Squad lists leaves the tournament intact), `XwingTournamentRound` (`opponent`, `scenario`, `result` `won` / `lost` / `drawn` or null while under way, `playerScore`, `opponentScore`; a tournament saved with one top-level `scenario` loads it onto every round). `startTournament(totalRounds, scenario, player, opponent)` starts round 1 with it; `startRound(opponent, scenario)` (not while a round is under way or once complete), `completeRound(result, playerScore, opponentScore)`, `dropTournament`; derived `roundInProgress`, `isComplete`, `totals` and `margin` (the total of `playerScore − opponentScore` over rounds played)
    useTournament.ts        Tournament state — TournamentState and TournamentRound interfaces; startTournament, startMatch, completeMatch, submitRound, dropTournament; persists to localStorage under key `tournament_state`; `startMatch` uses functional setState to avoid stale-closure bugs; `points` is a derived value (win=3, draw=1, loss=0) computed from completed rounds alongside `totals`
    useWakeLock.ts          Screen Wake Lock — acquires on game screen mount, releases on unmount; reacquires on visibility change

  services/
    analytics.ts            Offline-queue analytics service (30 event functions + enqueue + flush); events written to localStorage queue first, then flushed via POST to /analytics/batch; queue preserved on network error and re-flushed on window.online; env and sessionId auto-appended to every event; worker appends country, city, and coordinates from request.cf; `game_started`/`game_ended` are unified cross-game events — `onGameStart`/`onGameEnd` (SWU) include `game: 'swu'`; `onXwingGameStarted`/`onXwingGameEnded` (X-Wing) also fire `game_started`/`game_ended` with `game: 'xwing'`; `onGameEnd` carries `format` only for a tournament game (left out of a casual game's payload); tournament events, each carrying the tournament's format: onTournamentStarted (fires from App.tsx handleStartTournament, on Start round 1), onTournamentRoundCompleted (fires from App.tsx handleMatchComplete), onTournamentDropped, onTournamentEnded (both fire from SwuTournamentScreen container); X-Wing round event: onXwingRoundAdvanced (fires on each round advance, sends from_round + to_round)

  styles/
    sectionLabel.ts         `sectionLabelStyle(color?)` (the small uppercase label over a section) and `mutedStyle` (muted note text), shared by SWU setup, the base sheet and the tournament screen
    navButton.ts            Shared `NAV_BTN_STYLE` constant (`React.CSSProperties`) — single source of truth for all navigation icon buttons (Back, Help, Settings, Log) across every screen; `5vw × 5vw`, `minWidth/minHeight: 36px`, transparent background, `--color-ui-border` border, `borderRadius: 8px`; game screens spread this and add `position: 'absolute', zIndex: 10`

  constants/
    setRegistry.ts          Static set registry — maps every known set code to { rotation, type }; authoritative source for format filtering; unknown sets default to allowed (forward-compatible)
    rotatedCards.ts         Lookup table of hyperspace card numbers that require 90° rotation correction

  data/
    xwaCards.ts             Generated XWA card table — `xwaPilots: Record<string, XwaPilot>` (734 pilots keyed by full XWS id, e.g. `lukeskywalker`, `lukeskywalker-battleofyavin`; each has YASB's display `name`, `ship` and `faction` XWS ids, current XWA `points`, `loadout` when YASB has one, `unique`, `limit` (per-squad cap from the card or the XWA restricted list) and YASB's numeric `yasbId`) and `xwaShips: Record<string, string>` (ship XWS id → display name, plus `upsilonclassshuttle`, the xwing-data2 id other builders export); written by `scripts/generate-xwing-data.mjs` from a pinned raithos/xwing commit; do not edit by hand
    factionGlyphs.ts        `FACTION_GLYPHS`: each XWS faction's symbol as an SVG path and viewBox, the xwing-miniatures font's glyph outlines (Resistance is the rebel-outline glyph) as drawn on the list-builder design; font units with y up, so drawn with `scale(1,-1)`

  utils/
    appStart.ts             App start: `gameFromPath(pathname, base)` (the game `/swu` or `/xwing` names), `launchScreen({ tournamentInProgress, xwingTournamentInProgress, route, startScreen, lastGame })` (the first screen), `readLastGame` / `recordLastGame` (`last_game`), `launchCount` / `recordLaunch` (`app_launches`, for the install banner); storage errors are swallowed
    baseAspect.ts           SWU base display helpers: `FILTER_ASPECTS` (the base sheet's four), `aspectIconSrc(aspect)`, `baseAspect(base)` (its first aspect with an icon, or null) and `baseMeta(base)` ("SET · HP")
    formatFilter.ts         Format filtering — isSetValidForFormat, getValidSets, isBaseValidForFormat, formatValidationError, limitedBaseOptions (the bases of the registered base's set, for a Limited base change); exports Format type ('premier' | 'limited' | 'eternal' | 'twin-suns') and FORMAT_LABELS; pure functions with no side effects
    displayPilots.ts        Pilot display utility — `displayPilots(pilots: XwingPilot[]): DisplayPilot[]`; returns `{ displayName, ship, points }` per pilot; resolves pilot display name via `resolveXwsName(baseSlug, pilotNames)` where `baseSlug = slug.split('-')[0]`; resolves ship via `resolveXwsName(ship, shipNames)` (both from `xwaNames.ts`); both fall back to the raw slug if not in the lookup; numbers duplicate resolved display names sequentially (e.g. three `academypilot` entries → `Academy Pilot 1/2/3`); unique names are never suffixed; used by setup screen view (`PilotList` helper) and game screen view
    xwaNames.ts             Display-name lookups built from `xwaCards.ts` — `buildPilotNames(pilots)` keys each name by its base XWS slug (before the first hyphen), drops YASB's bracketed scenario tag (`Adon Fox (BoE)` → `Adon Fox`) and keeps the first entry when variants share a slug; exports `pilotNames` and `shipNames`
    resolveXwsName.ts       Name resolver — `resolveXwsName(slug: string, map: Record<string, string>): string`; returns `map[slug] ?? slug` (falls back to raw slug when not in the map)
    shipRoster.ts           Ship state types and helpers — `ShipState = 'alive' | 'half' | 'destroyed'`; `ShipEntry = { pilot: XwingPilot; state: ShipState }`; `halfPoints(pts)` = `Math.floor(pts/2)`; `remainingPoints(pts)` = `Math.ceil(pts/2)`; `initShips(pilots)` returns `ShipEntry[]` with all ships alive; used by `xwingGameScreen.tsx` for per-ship scoring
    parseXwsText.ts         XWS list parser — `parseXwsText(text: string): ParseResult`; parses XWS JSON exported by YASB; extracts `pilots: XwingPilot[]` (each with `name`, `ship`, `points` as XWS slugs) and the optional top-level `name` and `faction` strings; the only error is `invalid-format` (non-JSON, missing `pilots` array, malformed pilot entries); it checks shape only, and the file's own `points` total is ignored: ships, points at today's costs, unknown pilots, uniques and limits are `listProblems()`, run by Import XWS; exports `XwingPilot` and `ParseResult` types
    xwingListRules.ts       What makes an XWA list legal, used by the builder and Import XWS: `POINTS_MIN`/`POINTS_MAX` (46–50), `SHIPS_MIN`/`SHIPS_MAX` (3–8); `addBlock(pilots, id)` (`'ships'` at 8, `'unique'` when that character is in the list, matching on the name before any " (" tag, `'limit'` at the pilot's `limit`, else null); `pilotProblems(pilots)` (uniques twice, generics over their limit; pilots missing from the table aren't judged); `listProblems(pilots)` (Import XWS's check: each pilot missing from the table as "Ship N: no pilot called {id}." with "Did you mean {name}?" when a known id is within a quarter of its length in edits, comparing with and without the ship suffix and preferring the same ship; then ships; then the total at `atCurrentCost()`, "N pts at today's costs"; then `pilotProblems()`); `saveStatus(pilots)` (the builder's message and whether it can save); `factionShips(faction)` (ships A to Z, pilots cheapest first); `atCurrentCost(pilots)`; `defaultListName(faction, names)` ("Galactic Empire list N", "List N" with no faction); `pilotName(id)`, `pilotLimit(id)`
    xwingListInfo.ts        Saved-list helpers (`FACTIONS` in the builder's order; `listDetail(pilots, faction)` gives Squad Lists' `49 pts · 7 ships · Rebel Alliance`) — `listPoints(pilots)` sums pilot points as exported (the list's cost when built, not current points); `factionName(xws)` maps an XWS faction id to its display name (unknown ids returned unchanged); `listMeta(pilots, faction)` gives the `49 pts · Rebel Alliance` line (points only when there is no faction); `pilotSummary(pilots)` gives a setup card's pilots line — display names (`pilotNames`, by base slug) in list order, a repeated pilot counted where it first appears (`3 × Academy Pilot`)
    formatTime.ts           Shared time formatter — `formatTime(seconds: number): string`; outputs `M:SS` (e.g. 4500 → "75:00", 65 → "1:05"); used by TimerDisplay
    playMode.ts             Play mode constants — PlayMode type ('casual' | 'bo1' | 'bo3'), PLAY_MODES array, PLAY_MODE_LABELS record; no logic, no side effects
    twinSuns.ts             Twin Suns game model, pure functions over `TwinSunsState` (round; damage, epic action used and out per player, player 0 being you; who holds initiative, Plan and Blast; `pending` destroyed bases waiting for who destroyed them; `healed`; `finished`): `startState`, `addDamage` (a base reaching its HP is out and joins `pending`), `removeDamage`, `setEpicUsed`, `claim` (Blast also deals 1 to every other base still in), `nextRound` (returns Plan and Blast; initiative stays), `resolveDestroyed(by)` (heals that base 5, or no one), `finish`, `lastPhase`, `placings` (by HP left, ties sharing a place, "1st · Won" or "1st · Draw", "Out") and `yourResult`
    swudbUrl.ts             SWUDB URL utilities: normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck

  test/
    setup.ts                Vitest setup — jest-dom matchers + global matchMedia mock (landscape default; tests needing portrait call makeMatchMediaMock(true))
    App.test.tsx            End-to-end navigation and feature tests
    appScreenLayout.test.tsx Layout component tests
    swuGameScreen.test.tsx  Game screen tests: tap and drag damage and their limits, HP left, Start states, epic action, Force and Mystic Monastery, initiative, the damage buttons setting, Log and More, Round, timer and the game length stepper, the End game sheet (auto-open at 0 HP, Keep playing, undo), casual game over and Rematch, best of 1 and 3, base change between games; two players: the turned half, staying two-player in either orientation, the middle strip, Start from either card, independent damage (taps, drags, flipped drags on their half, − / +), each half's epic action, initiative passing between halves, End game at 0 for either base with the right result, game over on each half, Rematch keeping both bases, log entries naming the base and undo
    splitScreenLayout.test.tsx Split layout: the top half turned, the order of the parts, turning back against a landscape screen angle
    helpScreen.test.tsx  Help screen tests
    swuCardDataScreens.test.tsx Splash and offline screen tests
    appStart.test.ts        Launch order, game addresses, the last game record, the launch count
    gameSelectScreen.test.tsx Game select screen component tests
    installBanner.test.tsx Install banner component tests
    swuSetupScreen.test.tsx Setup screen container tests
    settingsScreen.test.tsx Settings screen container tests
    swuTwinSunsGame.test.tsx Twin Suns game: each base in its seat with the top row turned, the bar between the side-by-side bases in 4 players, the 3-player rows (bar with the pair, single base centred) for either empty side, portrait's rotate prompt, 94px bar squares on a tablet, damage by tap and drag (flipped on top) and undo, counters shown whatever the Initiative setting, claiming Plan, Cancel, Blast's damage and undo, Round returning Plan and Blast, initiative moving from the bar or its token and staying across rounds, the epic action and its undo, the destroyed cover and question, the heal, No one, Undo the damage, an out base taking no input, Last phase and Finish game, game over places (a destroyed base keeping its cover), a tie as a draw recorded from your side, End game's confirmation, Rematch and New setup
    twinSuns.test.ts        Twin Suns model: start, damage limits, out and pending, counters, Blast (passing over bases out, destroying several), Round, initiative, the heal and No one, the healed mark, the last phase, epic action, placings and your result (ties, differing HP)
    swuTournamentScreen.test.tsx Tournament screen tests: header (summary, Back keeps the tournament, More), record and points, your base, the round list (results and scores, next marked, later dimmed, in progress), Start / Return to round N, Player portal, the Drop sheet, complete and Finish, Limited base change gating and the base sheet, portrait
    analytics.test.ts       Analytics service tests — enqueue (write, shape, append, cap, silent failure), flush (batch POST, URL, clear on 200, preserve on 500, preserve on network error, no-op when empty), window.online trigger, payload shape, PII absence, env field, sessionId consistency, all 27 event functions; `game_started`/`game_ended` payloads include `game: 'swu'` (SWU) or `game: 'xwing'` (X-Wing); X-Wing `game_ended` payload includes elapsed_seconds and timer_expired
    formatTime.test.ts      formatTime utility tests — zero, sub-minute, exact minutes, zero-padding seconds, large values (e.g. 4500 → "75:00")
    timerDisplay.test.tsx   TimerDisplay component tests — renders formatted time, custom testId, style overrides; colour thresholds (> 300s → text-muted, ≤ 300s → warning, ≤ 60s → error)
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
    useXwingTournament.test.ts X-Wing tournament hook tests — none until started; starting fixes your list and rounds and starts round 1; each round recorded from the game; the next round's opponent (No list included); each round's scenario, and a tournament saved with one scenario; a round under way is not replaced; record and margin; a draw; complete stops further rounds; reopened by a new instance; drop clears it; unreadable state
    xwingTournamentScreen.test.tsx X-Wing between-rounds tests — heading and summary, record and margin (negative, with a draw), your list and points, every round with result, score, opponent and scenario, Start round N's opponent sheet (the round's scenario, last round's to start with, chosen or rolled; saved list with its deficit, No list, Import XWS), Return to round N, the Drop sheet, Back / Help / Settings, portrait, complete and Finish
    useInstallPrompt.test.ts PWA install prompt hook tests
    useWakeLock.test.ts     Screen Wake Lock hook tests
    useInitiative.test.ts   Initiative hook tests — initial state null, setOpponent (null→opponent, opponent stays opponent, player→opponent), setPlayer (null→player, player stays player, opponent→player), cycle (null→player→opponent→null), reset from each state, setInitiative direct
    xwingListsScreen.test.tsx X-Wing Squad Lists screen tests — header and back/help callbacks; empty state; cards show faction symbol, name, points, ships, faction and pilots; rename (pre-filled, saves via `renameList`, name-clash error, blank disables save, cancel); delete confirm naming the list, and cancel; New list and Edit open the builder; Import XWS: Back from it (to the lists, or leaving when opened there), unreadable paste, a unique twice listed as problems with Save disabled, an unknown pilot with its suggestion and the total at today's costs, a list legal only at today's costs saved at today's costs, a 1-ship list read with its ship-count problem, Fix in builder offered only for a readable list with problems, opening a new list on the known pilots and faction, Back to the paste, and saving under the imported name, a valid paste's preview and Clear, saving through the save sheet (XWS name, "List N" default, overwrite)
    xwingListBuilder.test.tsx X-Wing list builder tests — faction step (seven factions with ship counts and symbols, Back, Import XWS); ships A to Z, pilots cheapest first, search; running total and ship count; unique greyed once added; generic rows with − and +; per-list limit; 8-ship cap; remove; swap in place and Cancel; Back to the faction step; Save disabled with the reason until legal; saving with the default name and handing back the id; overwrite; editing at today's costs, "costs have changed", Save changes in place; a starting list (`start`) as a new list at today's costs under its name, its faction from its pilots; faction from pilots; portrait ship sheet
    xwingListRules.test.ts   Unit tests for the list rules — `addBlock` (unique, a unique's scenario variant, unlimited generics, limits, 8 ships), `pilotProblems`, `listProblems` (ships, points at today's costs, unknown pilots with and without a suggestion), `saveStatus` messages, `factionShips`, `atCurrentCost`, `defaultListName`
    xwingSetupScreen.test.tsx X-Wing setup screen tests (real `useXwingSetup` with a stubbed localStorage, mocked `useXwingLists`) — Back; More sheet offers Squad lists, Help and Settings and closes; no outline nav buttons; Match segmented (Casual default), no rounds stepper on the screen; Tournament: Start tournament needs both lists, its sheet (your list, Rounds 2–10 from the saved value and saved when changed), Start round 1 calls `onStartTournament(rounds, scenario, player, opponent)` with copies of both lists (No list with its stepper deficit), Cancel, Go to tournament while one is under way; Scenario sheet (None + 5), choosing closes it, roll picks a named one; both cards from the start; the list sheet's saved lists with points/faction, Import XWS, No list last with its note, or an empty hint; choosing a list shows name, meta and pilots but no deficit; No list's note and deficit stepper; Change list; a deleted list falls back to choosing; your remembered list pre-filled; last game's opponent offered in one tap, filled, and not once deleted; Go to game disabled until both chosen; `onStart` gets `50 − list points` and pilots for list players, the stepper value and no pilots for No list; portrait order; own text colour
    displayPilots.test.ts    Unit tests for `displayPilots()` — resolves pilot name via lookup (base slug key), resolves unhyphenated slug, points preserved, ship resolved via lookup, unknown slug fallback, unknown ship fallback, empty input, unique pilots not numbered, duplicate resolved names numbered, only the duplicate group numbered (unique siblings unaffected), hyphenated slugs sharing same base treated as duplicates, numbering uses resolved display name as key
    resolveXwsName.test.ts   Unit tests for `resolveXwsName()` — known slug returns display name, known ship slug, unknown slug falls back to raw slug, empty slug falls back to empty string
    useXwingLists.test.ts    X-Wing lists store tests — shared state across consumers under one provider, throws outside the provider, load (empty, corrupt, legacy entries without faction/createdAt), saveList (stores name/pilots/faction/createdAt, unique ids, returns the id, same name replaces in place keeping id and createdAt, persists), renameList (renames, persists, no-op on name clash), removeList
    xwingListInfo.test.ts    Unit tests for `listPoints()`, `factionName()` and `listMeta()`
    useXwingSetup.test.ts    X-Wing setup hook tests — defaults (XWA/Casual/6/0/0), localStorage load for ruleset/matchType/rounds (not deficits), save for the same (not deficits), player/opponent choices (start null, set per player, can be cleared), your list remembered and restored (No list not remembered), the opponent chosen afresh with the last opponent offered and kept through No list, old list-import fields dropped on the next save, deficit clamping at 0 and 4
    xwingGameScreen.test.tsx X-Wing game screen container tests: timer, analytics, wake lock, scores from 0 whatever the deficit, the round end at 50, round 12 and timer expiry, phase cycling and its undo, log entries and undo, mission points and their invalid pairs, ship scoring (half, destroyed in place, long-press, zero points, undo) and deficits
    xwingGameRedesign.test.tsx X-Wing game screen tests for the redesigned layout: pre-game hint and disabled tiles, faction symbols (none for an unknown pilot, the dmgCtrl mark once destroyed), the row rule in the column, initiative and FIRST, mission points only at End, the phases-off round flow and undoing a mistaken tap, Rematch, the score breakdown, One more round (Casual only, not with a side destroyed, ends again), the game length stepper, hidden and No-list score buttons, the log drawer
    shipRows.test.ts        `shipRows` tests: a row each up to 4, generics pairing before uniques from the 5th, 8 ships in 4 rows

  assets/
    ...                     Static assets (icons, splash screens)

docs/
  architecture-overview.md      System overview, goals, tech stack, component tree, glossary
  architecture-implementation.md This document — folder structure, state, data layer, UI, feature details
  architecture-process.md       Workflow, CI/CD, analytics, testing strategy, future improvements
  swuHelp.md                    SWU help page (imported as HTML string via custom Vite plugin; each ## is a section)
  xwingHelp.md                  X-Wing help page (as above)
  appHelp.md                    App help page: starting the app, install, About (as above)
  project-overview.md           Product vision, planned features, AI assistant notes

public/
  dmgCtrl-icon-transparent-192.png  App icon (transparent background); used on the splash and alongside screen titles
  dmgCtrl-icon-192.png              App icon 192×192 (opaque); used in PWA manifest and browser favicon
  dmgCtrl-icon-512.png              App icon 512×512 (opaque); used in PWA manifest
  dmgCtrl-force-token.png           Force token icon (512×512 PNG); used on Force button and as watermark in Force overlay
  dmgctrl-icon-192-white.svg        White starburst logo SVG (192×192); used on the epic action button and as watermark in the epic action overlay
  Star-Wars-Unlimited-logo-white.png Star Wars Unlimited logo (white, 959×686); used as the SWU game button image on the game select screen
  Star-Wars-X-wing-logo.png         Star Wars X-Wing logo (1830×750); used as the X-Wing game button image on the game select screen.
                                    Both logos are drawn with the same on-screen area (LOGO_AREA in gameSelectScreen.tsx), each
                                    no wider than a third of its native pixels so neither is upscaled on a 3× screen (a test pins both)
  aggression.png ... villainy.png   SWU aspect icons (aggression, command, cunning, heroism, vigilance, villainy)
                                    Every .png and .svg here is precached by the service worker, so it shows offline
                                    (a test keeps the total under 500 KB)

.github/
  workflows/
    deploy.yml                    CI/CD pipeline
    populate-base-aspects.yml     Daily cron + manual dispatch — refreshes the base_aspects InfluxDB measurement (see architecture-process.md)

scripts/
  inspect-base-data.mjs           Replicates the useBases merging logic; writes docs/base-data-snapshot.json and docs/base-data-summary.json for offline data inspection
  qa-helpers.mjs                  Shared browser setup and SWU setup steps for the three Playwright scripts below (launch, open /swu, choose a base in the base sheet, go to game, wait for images)
  validate-bases.mjs              Playwright script: opens a Chromium window and takes every base in the card data through the base sheet to the game screen for semi-automated visual QA (see below)
  validate-errors.mjs             Playwright script: opens a Chromium window and steps through all five error/info message states on SWU setup for semi-automated visual QA (see below)
  measure-performance.mjs         Playwright script: measures setup ready time, LCP, preview image time, and game image time across three resolution tiers (low/normal/hi res) per iteration; reports min/median/max (see project-overview.md)
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
| Current screen (`gameSelect` / `xwingSetup` / `xwing` / `xwingLists` / `xwingTournament` / `setup` / `game` / `tournament` / `help` / `settings`) | `App` | Passed as callback props (`onConfirm`, `onBack`, `onHelp`, `onSettings`); the first screen is `launchScreen()` (see App startup); back from X-Wing game returns to `'xwingSetup'`, or in a tournament game (`isXwingTournamentGame`) to `'xwingTournament'` with the game kept mounted; back from X-Wing or SWU setup navigates to `'gameSelect'`; back from the X-Wing tournament goes to `'xwingSetup'` |
| X-Wing tournament game (`isXwingTournamentGame`, `xwingGameKey`) | `App` | A tournament round's game gets `onRoundComplete` (records the round, unmounts the game, shows `'xwingTournament'`); every game started bumps `xwingGameKey`, so it is a fresh game screen. **Return to round N** shows the mounted game, or after a relaunch starts the round's game again from the stored lists and the round's scenario |
| X-Wing tournament (`XwingTournamentState` | null) | `useXwingTournament` / localStorage | Persisted under `xwing_tournament`; survives app close; cleared by Drop and Finish, which return to `'xwingSetup'` |
| Help source (`'setup'` / `'game'` / `'tournament'` / `'xwing'` / `'xwingSetup'` / `'xwingLists'` / `'xwingTournament'` / `'gameSelect'`) | `App` | Determines which help page `HelpScreen` shows and the section it opens at; set by `handleHelp` based on the current screen before navigating to `'help'`. Settings has no Help button |
| Back stack (for help/settings back-navigation) | `App` | A `Screen[]` stack; pushed when navigating to help or settings, popped on back — supports any depth of overlay navigation |
| `useBases()` card data state (for the splash and offline screens) | `App` | With no bases on `'setup'`, `loading` shows `SwuSplash` and `error` shows `SwuOffline`, whose Try again calls `retry` |
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
| User settings (start screen, hyperspace, force token display, Melee ID, damage −/+ buttons, initiative, phase tracker, score −/+ buttons, bo1/bo3/xwing timer minutes) | `useUserSettings` Context / localStorage | Persisted under `user_settings` as JSON; `forceTokenDisplay` is a 3-way value ('always-on' \| 'lof-only' \| 'always-off'), default 'lof-only'; `useHyperspace` and `enableInitiativeBar` default to `true`, the other switches to `false` (the phase tracker only for a new install, see `useUserSettings.ts`); bo1TimerMinutes=25, bo3TimerMinutes=55, xwingTimerMinutes=75; migrates old `enableForceToken` boolean; shared via React Context — updates propagate immediately to all mounted consumers |
| Favourites list | `useFavourites` / localStorage | Persisted under `favourites` as JSON array of `FavouriteBase`; sorted by set then card number ascending; deduplicated on `key`; SWU setup shows the star and the Favourites section whatever `enableFavourites` says |
| X-Wing saved squad lists | `useXwingLists` / localStorage | Persisted under `xwing_favourites` as JSON array of `XwingList` (`{ id, name, pilots, faction?, createdAt? }`); built, imported, edited, renamed and deleted on the Squad Lists screen, or built from a setup list sheet; not gated by a feature flag |
| SWUDB link, validation error, deck name, the deck's base, loading state | `SwuSetupScreen` | Local; editing the link clears the deck; the deck's base becomes your base only on Use this base (or its tile) |
| Tournament state (`TournamentState` | null) | `useTournament` / localStorage | Persisted under `tournament_state`; survives app close so the user can return between rounds; `null` when no tournament is active; reset by `dropTournament` |
| Base for the next game of a Limited match (`candidateBase`) | `SwuTournamentScreen` | Local; cleared when the next match starts |
| Open sheet (More, Drop, base) | `SwuTournamentScreenView` | Local |
| Change-base candidate state (changingBase, candidateAspect, candidateBase) | `SwuTournamentScreen` | Local state; `changingBase` shows selectors; `candidateAspect` filters the base list; `candidateBase` is passed to `onGoToGame` and drives the art preview via `useBaseArt(candidateBase ?? base, ...)` |
| Tournament current base | `App` | `tournamentCurrentBase` — set to `newBase` in `handleGoToGame` when a candidate was selected; used as first priority in `gameBase` (`tournamentCurrentBase ?? selectedBase ?? tournament?.base`), providing sticky base behaviour between rounds; reset to `null` on `handleTournamentDrop` |
| Has played game in current match | `App` | `hasPlayedGameInCurrentMatch` — passed to `SwuTournamentScreen` to gate the change-base overlay; set to `gamesCompleted > 0` when the player presses Back from the game screen (where `gamesCompleted = match.playerScore + match.opponentScore`); round scores in `TournamentState` are only set when the full match completes, so this App-level flag is the only way to know a game was completed mid-round |
| X-Wing setup preferences (ruleset, matchType, rounds, your list, last opponent) | `useXwingSetup` / localStorage | Persisted under `xwing_setup` as JSON; the opponent's current choice, No list, the deficits and the scenario are session-only (not persisted) and survive navigation within X-Wing because `App` keeps the setup screen mounted |

### Note on double useBases() call

`App`, `useSwuSetup` and `SwuTournamentScreen` each call `useBases()`. Each reads the cache in its initialiser, so cached card data of any age is there on the first render (stale data is refreshed in the background), and a fetch in flight is shared at module level, so instances that ask together make one set of requests.

### Example flow: App startup

1. `main.tsx` counts the launch (`recordLaunch()`, `app_launches`), outside React so StrictMode cannot count it twice
2. `App` settles its first screen in a `useState` initialiser with `launchScreen()` (`src/utils/appStart.ts`): an SWU tournament in progress → `'tournament'`; an X-Wing tournament in progress → `'xwingTournament'`; the address names a game (`gameFromPath`) → its setup; `startScreen` `'lastGame'` (default) → the setup of `readLastGame()`, or `'gameSelect'` before either is played; `'swu'` / `'xwing'` → that setup; `'gameSelect'` → `'gameSelect'`
3. An effect on `screen` records the last game (`last_game`) whenever `'setup'` or `'xwingSetup'` opens
4. On `'setup'` with no card data, `App` renders `SwuSplash` while `useBases()` is loading, or `SwuOffline` once it has failed (Try again calls `retry()`, Play X-Wing enters X-Wing setup, Back goes to game select). No other screen waits
5. `GameSelectScreen` shows a tile per game (the last played marked), Help (the `'gameSelect'` help source: `docs/appHelp.md`) and Settings; Back from either setup returns to `'gameSelect'`
6. `App` renders the install banner from `useInstallPrompt()` on `'gameSelect'` (in the game select layout, under the tiles), `'setup'` and `'xwingSetup'` (fixed at the foot), never on a game screen

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

`scripts/validate-bases.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of every base's game screen rendering. It opens a visible Chromium window at SWU setup (`/swu`) and, for every base in set order, opens the base sheet from Your base, searches for the base by name, taps the tile whose name and `SET · HP` line match, taps Go to game, waits for the card image to load, pauses for visual inspection, then returns to setup with Back.

Prerequisites:
- Dev server must be running (`npm run dev`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-bases.mjs              # every base
node scripts/validate-bases.mjs --set=LAW    # one set
node scripts/validate-bases.mjs --headless   # no window
```

The script reads the bases from the card data the app has loaded (`swu_bases_cache` in localStorage), so new bases added to the data source are picked up automatically. Progress is logged to the terminal, and the bases the sheet did not offer or whose image did not load are listed at the end:
```
[1/111] ASH-019 Fortress of the Great Mothers (ASH · 30 HP)
[2/111] ASH-020 Nevarro City, Restored (ASH · 30 HP)
...
Validation complete: 111 of 111 bases checked.
```

Timing constants at the top of the script (`VISUAL_PAUSE_MS`, `IMAGE_TIMEOUT_MS`, `BACK_PAUSE_MS`) can be adjusted if more or less inspection time is needed. The steps it shares with the other two QA scripts (launching an iPhone 15 Pro landscape context with the install banner already dismissed, opening setup, choosing a base, waiting for images) live in `scripts/qa-helpers.mjs`.

### Error message validation script

`scripts/validate-errors.mjs` is a Playwright-driven browser automation script for semi-automated visual QA of all five error and information message states. It opens a visible Chromium window and steps through each scenario in sequence, pausing 3 seconds for visual inspection before advancing. Settings changed during the run (`useHyperspace`) live in the script's own browser profile, which is discarded at the end.

**Scenarios:**
1. Base sheet, Paste SWUDB link: "Invalid deck URL" (types an invalid URL)
2. Base sheet, Paste SWUDB link: "Deck not accessible" (loads an unreachable deck URL via the proxy)
3. Your base: "No base images found" (all PNG/WebP/JPEG requests blocked via `page.route`, then a base chosen in the sheet)
4. Your base: "Hyperspace variant not found" (`useHyperspace` set to `true`, chooses a base with no hyperspace art)
5. Your base: "Only hyperspace image available" (`useHyperspace` set to `false`, blocks the base's standard art URLs so it falls back to hyperspace)

Scenarios 3 to 5 read `swu_bases_cache` in localStorage to find suitable bases automatically: no hardcoded base names are required.

Prerequisites:
- HTTPS dev server must be running (`npm run dev:https`)
- Playwright and the Chromium browser binary must be installed (one-time setup: `npm install --legacy-peer-deps && npx playwright install chromium`)

Run with:
```bash
node scripts/validate-errors.mjs
# or, for device testing on the local network:
node scripts/validate-errors.mjs https://192.168.1.100:5173/
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

Favourites have no setting: the star on SWU setup adds and removes them, and Settings does not list them.

---

## 4. UI & Layout System

### AppScreenLayout

Every screen is wrapped in `AppScreenLayout`, which provides:
- Full-screen fixed container (fills viewport)
- Dark background gradient
- Padding by the edge tokens (below), so screens add no outer padding of their own
- Animated star field background

This ensures visual consistency across screens without each screen needing to re-implement the full-screen container.

The page draws under the iPhone status bar (`viewport-fit=cover`, status bar `black-translucent`), and the starfield on `html` runs up through the top inset. In the installed app in portrait, iOS fades the top of the page about 20pt past the inset, and no setting turns that off, so the top edge is `--top-clearance` (1.5 times the top inset) rather than the inset. Where the inset is 0 (landscape, Android, desktop) the clearance is 0 too.

**Edge tokens.** Content keeps clear of the screen's rounded corners by `--edge-top`, `--edge-right`, `--edge-bottom` and `--edge-left` (`index.css`). Each is the safe-area inset (the top clearance at the top) or `--edge-margin` (16px), whichever is larger: an inset wider than the margin, such as the landscape notch side or the home indicator, is not added to. The layouts pad by them: `AppScreenLayout`, `SplitScreenLayout` (each side of its turned frame by the token of the screen edge it lies along), the Twin Suns game, and the shared `Sheet` on each side it runs to the screen edge. No component reads `safe-area-inset-*` or `--top-clearance` directly (a test enforces it).

**Text fields** spread `FIELD_STYLE` (`src/styles/field.ts`), whose text is 16px. iOS zooms the page in when a smaller field takes focus and stays zoomed, which cuts off the screen's edges; a test checks every input and textarea uses it.

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

Every screen's first row starts at the `AppScreenLayout` edge, and buttons positioned absolutely (RotatePrompt's Back, the SWU offline screen's Back) sit at `var(--edge-top)` and `var(--edge-left)`, the same place. This ensures nav buttons do not jump during screen transitions.

Title `h1` elements on all header screens use `lineHeight: 0.8` to keep header row height consistent across screens. The app icon on the Game Select screen is sized to `5vw × 5vw` (matching the `NAV_BTN_STYLE` footprint) with the same gap as the setup screen back button, so the `dmgCtrl` title text lands at the same horizontal position on both screens.

### Responsive layout

The app is designed for **landscape orientation**. `useOrientation` is used in five places:

- **Setup screen** (`SwuSetupScreenView`) — renders a two-column layout in landscape (selectors left, card preview right) and a single-column scrollable layout in portrait.
- **Game screen** (`SwuGameScreen`) — renders the full-screen card layout in landscape and a rotation prompt in portrait.
- **Help screen** (`HelpScreen`) — section links in a column beside the content in landscape, in a row above it in portrait.
- **Settings screen** (`SettingsScreenView`) — fixed px sizes from the shared controls; `isPortrait` chooses the two-column or stacked layout.
- **Tournament screen** (`SwuTournamentScreenView`) — portrait: single-column layout (config → base art preview → W/L/D totals → action buttons → round table); landscape: two flex columns (left: config rows + card preview filling remaining height; right: W/L/D totals + action buttons + scrollable round table).

`useOrientation` uses `window.matchMedia('(orientation: portrait)')` change events (reliable on iOS standalone PWA, unlike `orientationchange`/`resize`). It returns `isPortrait` (boolean) and `vmin` (`Math.min(screen.width, screen.height)` — the device's physical short dimension, which is stable across orientation changes unlike `window.innerWidth`).

---

## 5. Feature Architecture

### App startup, game addresses and install

The first screen, the splash and the offline screen are described under "Example flow: App startup" above.

- **Addresses**: a Vite plugin in `vite.config.ts` (`game-addresses`) emits the built `index.html` again as `swu/index.html` and `xwing/index.html`, so GitHub Pages serves a first visit to `/swu` or `/xwing`. The asset paths are absolute, so the copy works a folder down, and the service worker precaches both with the rest of the HTML. Offline, `/swu` without the slash falls back to `index.html`, and the app still reads the address.
- **Manifest** (`PWA_MANIFEST` in `vite.config.ts`): one install, `start_url` `.` (the root, so it follows Start screen), with `shortcuts` to `swu/` and `xwing/`.
- **Install banner** (`useInstallPrompt`): shown from the second launch (`app_launches` ≥ 2), when not standalone, on iPhone, or on Android once `beforeinstallprompt` has fired. Not now, and Install, store `install_banner_hidden_until` (now + 30 days) in localStorage.

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

A **Match** dropdown appears on the setup screen on the same row as the Format selector. Three options are available: Casual, Best of 1, Best of 3. The selection is persisted to localStorage under `pref_play_mode` and defaults to `'casual'`. The selected play mode is passed to `App` via `onConfirm(base, playMode)`, stored as `selectedPlayMode` in `App` state, and forwarded to `SwuGameScreen` as a `playMode` prop.

There is no setting for it: SWU setup always offers Casual or Tournament.

### Source selector

The setup screen supports three input modes, controlled by a `selectionMode` state (`'base-selector'` | `'swudb-import'` | `'favourites'`). The active mode is persisted to localStorage under `pref_selection_mode`. The Source selector dropdown is always visible on the setup screen.

**Base Selector mode** is the default. The three cascading dropdowns (set → aspect → base) are shown. Each base option is formatted as `${name} (${hp})` (e.g. `Catacombs of Cadera (30)`).

When a base is selected, a **star toggle** (☆/★) appears inline — in the same row as the base dropdown and start button. Tapping it:
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
8. More › **Squad lists** calls `onLists` and a list sheet's **Import XWS** calls `onImport` → `App`'s `handleXwingLists(startAtImport)` pushes the current screen onto `backStack` and shows `'xwingLists'` (at the paste box for `onImport`); Back pops it
9. A list sheet's **Build a list** sets the container's `building` side, and the container renders `XwingListBuilder` in place of the view; its `onSaved(listId)` sets that side's choice to the new list and returns to the view, so the list comes back chosen

### X-Wing Squad Lists screen

- Reached from X-Wing setup's More (**Squad lists**), a list sheet's **Import XWS** (opening at the paste box) or Settings › X-Wing › **Squad lists**; all call `App`'s `handleXwingLists`, which pushes the current screen onto `backStack` and sets `screen = 'xwingLists'`; Back uses `handleOverlayBack`, so it returns to setup or settings
- Help opens `xwingHelp.md` at Squad lists (`helpSource = 'xwingLists'`)
- Not kept mounted; it shares the lists store with the setup screen through `XwingListsProvider`, so a list saved here is offered on setup as soon as you go Back

### X-Wing game screen

1. `useUserSettings()` provides `enableXwingPhases`, `enableXwingAlwaysIncDec` and `xwingTimerMinutes`; the wake lock and the log are always on
2. `useXwingGame()` manages score state — `playerScore`, `opponentScore`, `gameOver`, `result`, `round`, `advanceRound`
3. `useTimer(xwingTimerMinutes * 60)` manages the countdown — `remaining`, `isRunning`, `isExpired`, `start`, `stop`
4. `useWakeLock(true)` acquires a Screen Wake Lock for the duration of the screen
5. Receives `playerDeficit` and `opponentDeficit` as optional props (default 0) — passed from App which received them from the setup screen; `handleStartGame` calls `game.reset()` so scores start at 0; deficits are applied in `handleShipAdvance` at the moment the last ship on a side is destroyed — bundled with the last ship's points into the same `game.incrementOpponent/Player(pts + deficit)` call so a single undo reverts both
6. `timer.start()` is called in `handleStartGame`; `useTimer.start()` is idempotent — calling it again has no effect
7. A `useEffect` on `game.gameOver` calls `timer.stop()` when the game ends — freezes `remaining` without reset
8. `handleRoundAdvance` guards against `timer.isExpired`, `game.gameOver`, and `game.round >= 12` before calling `game.advanceRound()` and firing `onXwingRoundAdvanced(fromRound, toRound)`
9. `handleBack` fires `onXwingGameEnded` with `elapsed_seconds` (duration − remaining) and `timer_expired` (from `timer.isExpired`)
10. `timerRemaining`, `timerExpired`, `round`, and `onRoundAdvance` are passed as props to the view; the view renders `<TimerDisplay testId="xwing-timer">` in the centre column while the game is in progress; the result banner replaces it at game over; the round tracker bar renders when `gameStarted` is true
11. Landscape-only: portrait shows `<RotatePrompt>`

### Settings screen

The settings screen is reached from **More** on the setup, game and tournament screens and from game select:

- `handleSettings` pushes the current screen onto `backStack` and shows `SettingsScreen`, so Back returns to where it was opened
- `SettingsScreen` (container) reads and writes `useUserSettings()`; X-Wing squad lists are managed on the Squad Lists screen via `onManageXwingLists`
- `SettingsScreenView` (view) is one page with no tabs and no Help button: Back and the "Settings" heading, then the General, Star Wars: Unlimited and X-Wing groups (see the file list above for the controls)
- Each change writes immediately to localStorage via `useUserSettings`: there is no save or cancel step
- **Start screen** (`startScreen`: Last game played, Game select, Star Wars: Unlimited or X-Wing; default 'lastGame') controls where the app opens when no tournament is in progress and the address names no game (see App startup). Back from SWU setup or X-Wing always returns to game select regardless of this setting
- Timer lengths are not in Settings: each game sets its own on the timer before the game starts. The wake lock, the log, epic actions, the tournament selector, favourites and long-press have no setting
- Landscape: General and X-Wing in the left column, SWU in the right; portrait: the three groups stacked. Neither scrolls at 844×390 or 390×844

### Help screen

There are three help pages, each a markdown file in `docs/` imported as HTML by the Vite markdown plugin: `swuHelp.md` (Setup, Game, Tournament, Rules), `xwingHelp.md` (Setup, Squad lists, Game, Tournament, Rules) and `appHelp.md` (Starting the app, Install, About, including the disclaimer for both games). A page's `#` is its title and each `##` is a section; `###` and below are headings inside a section. A new `##` appears in the section links with no code change.

- Each game's More menu opens that game's page; game select's Help opens the app page. Settings has no Help button
- `HelpScreen` takes the help source and opens at its section: `setup`, `game` and `tournament` open SWU at Setup, Game and Tournament; `xwingSetup`, `xwingLists` and `xwing` open X-Wing at Setup, Squad lists and Game; `gameSelect` opens the app page at Starting the app
- Header: Back `IconButton` and the page title. Section links are `OptionRow`s, the current one pressed: a column beside the content in landscape, a row across the top in portrait (scrolling sideways when it does not fit). Tapping one scrolls the content to that section
- The content is one scrolling column; the current section follows the scroll. At the end of the content, a short last section that cannot reach the top stays current when it was the one tapped

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
