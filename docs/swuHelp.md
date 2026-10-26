# SWU help

## Setup

The **Star Wars: Unlimited** setup screen opens from game select, at dmgctrl.app/swu, or on its own when SWU is the game you played last. The first time, it shows a splash for a moment while it gets the card data from the internet; after that it keeps the data for playing offline. Opened offline before it has the data, it says so: **Try again**, or **Play X-Wing** instead.

Setup has four things: **Mode**, **Your base** (and **Their base** with 2 players, or the seating grid in Twin Suns), **Match**, and the button that starts play.

### Mode

Choose **1 player** to track your base alone, **2 players** to set up a base for each side, or **Twin Suns** for 3 or 4 players round one device. Your choice is kept for next time; the first time it is 1 player.

With 2 players, **Go to game** opens the two-player game: one phone flat on the table between you, with a half each (see Game).

### Your base

The first time, the card reads **Choose your base**. Tap it to open the base sheet.

Once chosen, your base is kept: it is there next game, and next time you open the app. The card shows its art, its aspect, name, set and HP. Tap **Change base** to pick another.

### Their base

With 2 players, a **Their base** card sits beside yours. The first time it reads **Choose their base**, and the start button waits with "Choose their base to start." Tap the card, or **Change base** once there is one, to open the same base sheet as yours. Their base has no Favourite, and it never joins your Recent bases.

Their base is kept from your last 2-player game, and the card says **Same as last game** while it is unchanged.

### Twin Suns

With Twin Suns, the bases sit in a 2×2 grid that is the seating round the table. **Your base** is always top left, with its Favourite star. Every other cell reads **Add base**: add each opponent's base in the cell where they sit. A base never moves once placed.

Tap any base to change it. An opponent's base sheet is titled **Opponent's base**: it lists the bases **Used for other players before** in place of your favourites and recent bases, and has **Remove base**, which empties that cell and moves nothing else. Opponents' bases have no Favourite and never join your Recent bases.

**Go to game** needs at least 3 bases, yours and two opponents'; a fourth is optional. The line under Match says how many are playing, or how many more bases are needed. The bases and their cells are kept for your next Twin Suns game.

For now, Go to game opens the game for your base alone.

### Choosing a base

The base sheet lists:

- **Favourites** first, then **Recent**: the last 6 bases you played, without repeating a favourite. The first time, before you have either, every base is listed.
- A **search** box: type part of a base's name. Every base is searched.
- Four **aspect** buttons (Vigilance, Command, Aggression, Cunning): tap one to list only that aspect, with or without a search. Tap it again to clear it.

Each base shows its aspect, name, set and HP, and your current base has a tick. Tap a base to choose it; the sheet closes. Close the sheet with × to keep the base you had.

### From an SWUDB deck

If you have an unlisted or public deck on swudb.com, its base comes with the link:

1. In the base sheet, tap **Paste SWUDB link**
2. Paste your deck link (e.g. `https://swudb.com/deck/AbCdEfGhI`). Edit links are corrected to view links
3. Tap **Load**: the deck name appears with its base
4. Tap **Use this base**, or the base itself

A link that isn't a deck says **Invalid deck URL**; a private deck says **Deck not accessible**; a deck whose base the app doesn't know says **Base not recognised**. Tap **Search instead** to go back.

### Favourites

Tap **Favourite** on the Your base card to save your base as a favourite: the star fills. Tap it again to remove it. Favourites come first in the base sheet.

### Match

Choose **Casual** or **Tournament**; your choice is kept. With Casual, **Go to game** opens the game. With Tournament, **Start tournament** opens a sheet where you set the format, best of 1 or 3 and the rounds, then **Start round 1** goes straight to the game (see Tournament). While a tournament is under way the button reads **Go to tournament** and takes you back to it.

The button is disabled until you have chosen a base, with 2 players until you have chosen theirs too, and in Twin Suns until at least two opponents have a base.

### More

Tap ⋯ at the top right for **Help** and **Settings**. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> at the top left to go back to game select.

### Troubleshooting

**Base art isn't loading:** check your connection and try restarting the app. The app needs an internet connection on first load to fetch card data; after that it is kept on your device and refreshed every 24 hours.

**Newly previewed bases not selectable:** a new base appears once it is published to starwarsunlimited.com and the card data next refreshes.

## Game

Your phone stands in for your base. The card fills the screen from top to bottom, and the controls sit in the narrow margins either side of it. Nothing covers the card's top band (HP, name, aspect) or its text box; the damage goes in the open art between them.

**Starting a game:** the card shows **Start**. Tap the card to begin round 1. Between games of a best of 3 it shows the last result and **Start game N**.

### Damage

The card is the damage control:

- **Tap the card** to add 1 damage
- **Drag up** on the card to add several, **drag down** to remove several. The amount shows on the card while you drag and is applied when you let go. It grows by 1 for roughly every 14px you move, and stops at what your base can take (up) or the damage it has (down)

The big number is the damage taken; **HP left** under it is your base's HP minus that damage.

With **Damage −/+ buttons** on, **−** sits at the foot of the left margin and **+** at the foot of the right. Tap for 1, or press, hold and drag upward on either for several.

### Left margin

From the top:

- **Back** returns to setup (or to the tournament). In casual play the damage resets
- The **epic action** button, on a base with an epic action: greyed until the game starts, then gold. Tap it once you've used the epic action: it greys out with **USED**, and an **EPIC ACTION USED** token covers the card's text box, as the physical token does
- The **Force** button, on a base that creates the Force (see below)
- The **initiative bar**: **OPP** at the top, **YOU** at the bottom. Tap the side that has the initiative; it fills in. The bar is outlined until someone takes it. Initiative doesn't reset between rounds

### Right margin

- **Log** opens the action log, a list of everything that happened this game. The newest entry has **Undo**, which takes it back; repeat to step further back. Tap Log again to close it
- **More** holds **Help** and **Settings**, and between games of a Limited best of 3, **Change base**
- In a best of 1 or 3: the **timer**, and the **Games** chip with the score so far (you first)
- **Round** (once the game has started): the current round. Tap it for the next round
- **End game** (see below)

### Ending a game

Tap **End game**, choose **Won**, **Lost** or **Draw**, and tap **Record**. **Keep playing** closes the sheet without recording. When your base reaches 0 HP, End game opens by itself with Lost chosen.

**Undo** in the log takes back a recorded result, restoring the damage and round.

**Casual:** the result is shown with the round it ended in and the damage taken. **Rematch** starts again on the same base with the damage reset; **New setup** goes back to setup.

**Best of 1 or 3:** the result advances the Games chip and the damage resets. The next game starts from the card. When the match is decided it goes to the tournament.

**Draws**, including an intentional draw agreed before game 1, are recorded through End game, which is there before game 1 of a tournament match for that reason. A draw ends the match.

**Changing base (Limited best of 3):** between games, **More › Change base** lists the bases of your set. The next game is played on the one you choose.

### Timer

Casual games have no timer. In a best of 1 or 3 the timer starts with game 1 and runs until the match ends. It turns amber under five minutes and red under one.

Tap the timer to open **Round and timer**. Before game 1, it also sets the **game length**, in 5-minute steps from 5 to 90 minutes. The length is remembered separately for best of 1 (25 minutes at first) and best of 3 (55 minutes at first), and is fixed once game 1 starts.

When time is called and you record a win or a loss, the match ends there.

### The Force

The Force button appears according to the **Force tokens** setting (LOF bases at first): on Legends of the Force bases whose ability creates the Force, on every base with **Always**, and never with **Off**.

- It is greyed until the game starts
- Tap it to gain the Force: the button fills blue
- Tap it again when you use the Force

#### Mystic Monastery

**Mystic Monastery** (LOF-022) can create the Force up to three times a game. Its Force button shows the uses left (**3 LEFT** at the start). Each tap gains the Force and uses one; tap again when you use the Force. After the third use the button is disabled.

### Two players

With **2 players** chosen in setup, one phone lies flat on the table between you. The screen is portrait and split in two: the bottom half is yours, the top half is theirs, turned round to face them. It stays that way whichever way the phone thinks it is turned, since a phone lying flat flips unreliably.

Each half has its player's base as the damage control, exactly as in 1 player: tap for 1, drag up (from that player's side) to add several, drag down to remove. Each half counts its own damage, and both can be touched at once. At each player's edge sit their **epic action** or **Force** button and **Initiative**: tap **Take initiative** on your half to take it from the other player. With **Damage −/+ buttons** on, each half has its own − and +.

The strip across the middle holds **Back**, **Log**, **Round**, **End game** and **More**, and in a best of 1 or 3 the timer with the games score. Before the game both cards say **Start**: tap either to begin. Round and End game wait for the game to start. The middle strip's text faces the bottom player.

Log entries name the base ("Their base: 3 damage"), and the log opens over your half. Undo takes back the newest entry, on whichever half it was.

**Ending a game:** when either base reaches 0 HP, End game opens by itself, worded for the bottom player: Won when their base is destroyed, Lost when yours is. Results are recorded from your side, in casual play, best of 1 and 3 and tournaments alike. After a casual game each half shows its own result (**Game won** or **Game lost**), and the middle strip offers **New setup** and **Rematch** (both bases kept, damage reset).

### Troubleshooting

**The wrong base is showing:** tap Back on the game screen to return to setup and choose again.

**Card art isn't loading:** the image server may be unavailable. The card shows the base name and game text instead, and the game still works.

## Tournament

The Tournament screen tracks your W–L–D record across the rounds of a structured event. Your progress is saved automatically: you can close the app between rounds, and opening it again brings you back to the tournament.

### Starting a tournament

On the setup screen, choose your base and **Tournament** under Match, then tap **Start tournament**. A sheet opens with:

- **Format**: **Premier**, **Eternal** or **Limited**. Premier the first time; your last choice is remembered.
- **Match**: **Best of 1** (a single game) or **Best of 3** (first to 2 wins), Best of 3 to begin with, to match your event.
- **Rounds**: the number of Swiss rounds in your event, 2 to 16 (5 to begin with).

All three are fixed once round 1 starts. Tap **Start round 1** to go straight to the game, or **Cancel** to go back to setup.

### Format

A casual game has no format: the base sheet lists every base, whatever its set. In a tournament your base must be legal in the format. While Tournament is chosen, the base sheet lists only bases legal in your last format, for both players, and a deck loaded from an SWUDB link says so if its base is not. If the base you have chosen isn't legal in the format picked on the sheet, the sheet says so, offers **Change base**, and **Start round 1** waits until it is.

| Format | Bases allowed |
|---|---|
| **Premier** | The two most recent rotations, plus sets that are always Premier legal |
| **Eternal** | Every set |
| **Limited** | Standard sets (Sealed, Draft and Chaos) |

### Between rounds

When a match ends, the game returns here. The header shows the game, format, match and number of rounds. On the left are your **record** (wins–losses–draws), your points, and your base. On the right is every round of the event:

- a played round shows **Won**, **Lost** or **Drawn** and the games score (yours–theirs);
- the next round is outlined and marked **Next** (or **In progress** if you left a match part way through);
- rounds still to come are dimmed. A long event scrolls within the list.

Tap **Start round N** to play the next round, or **Return to round N** to go back to a match you left. **Back** takes you to setup and keeps the tournament; **Go to tournament** there brings you back. Help and Settings are under **More** (the ⋯ button).

A win scores 3 points, a draw 1 and a loss 0.

### Dropping or finishing

**Drop** opens a sheet showing your record. **Keep playing** closes it; **Drop** leaves the tournament, clears your record and returns you to setup. This can't be undone.

Once every round is played the screen reads **Tournament complete**, with your final record. **Finish** clears the tournament and returns you to setup.

### Change base (Limited, best of 3)

In a Limited best of 3 tournament you may switch your base between games of a match. After a game of the match is played and you go back to the tournament, **Change base** appears beside your base: it opens the base sheet on the bases of your base's set, and your choice applies for the rest of the match. The next round goes back to your registered base.

### Player portal

The **Player portal** button opens your melee.gg profile page, where you can check pairings and submit results.

To set it up, tap **Enter player ID**: this opens Settings, where you enter your **Melee player ID** (the identifier shown in your melee.gg profile URL). Once entered, the button changes to **Player portal** and opens melee.gg directly in your browser. The ID is remembered, and you can change it at any time in Settings.

### Match timer

In a tournament the game screen has a match timer: 55 minutes at first for best of 3, 25 for best of 1. Set the length on the game's timer before the match starts; each is remembered for next time. It starts when you tap **Start** at the beginning of the first game and runs until the match ends (see Game › Timer).

## Rules

The full Comprehensive Rules for Star Wars: Unlimited are on the official website:

[starwarsunlimited.com/how-to-play](https://starwarsunlimited.com/how-to-play?chapter=rules)
