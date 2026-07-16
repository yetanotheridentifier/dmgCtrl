# Sealed: User Guide

dmgCtrl Sealed lets you play Star Wars: Unlimited **Sealed** games against an AI opponent, using a deck built from your own sealed pool.

## Importing a deck

1. Build your sealed deck in **ProtectThePod** and copy its JSON export to the clipboard.
2. On the deck selection screen, paste the JSON into the **Import deck** box and press **Import**.
3. A legal Sealed deck needs exactly 1 leader, exactly 1 base, and at least 30 other cards. The importer will tell you if something is missing.

Your decks are saved on this device and appear in the deck list. The first time you play a deck, its card details are fetched and cached locally — later games work from the cache.

Alongside the deck selection, an **Implemented cards** panel lists which card abilities are currently built into the engine: leaders by side (**front** = undeployed leader ability, **back** = deployed leader-unit ability), and the implemented **upgrades**. Cards not listed still play — they just use their printed stats and keywords (and make fine resources) rather than their special ability text.

## Caching a full set

The **Card catalogue** section lets you cache an entire set by its code (e.g. `ASH`): one click fetches every card in the set and stores it on this device. Games and deck views then work without touching the network — and this also covers the handful of base cards whose individual lookups are unreliable upstream.

## Choosing an opponent

The **Opponent** selector controls which deck the AI plays:

- **Random deck** — the AI picks one of your imported decks at random (it may pick the same deck you're playing).
- **A specific deck** — choose any imported deck by name.

The current AI opponent plays **random legal moves**. It exists to exercise the full rules engine; smarter opponents are on the roadmap.

## Playing a game

Press **Play** next to your deck. Cards hydrate, both players draw 6, and the board appears in the **setup step**: choose **Keep hand** or **Mulligan** (shuffle your hand back and draw a fresh 6 — once only; whoever holds the initiative decides first). Then **resource 2 cards, one pick at a time** — **click a hand card to resource it**, and you can also just avoid banking your early plays. Aim to keep a curve: something to play on turn 1 (cost ≤ 2), turn 2 (≤ 3), turn 3 (≤ 4). Once both players have resourced 2, round 1 begins. Resourcing is private: the log shows only that your opponent resourced, never which card.

The AI opponent mulligans any hand without a turn-1 play and resources the pair of cards that best preserves its early curve.

### The board

- **The battlefield** — laid out like the tabletop around a central **battlefront**. The **Space** (left) and **Ground** (right) lanes flank a central strip holding the bases and your leader: reading down the middle you'll find the opponent's base, your base, then your leader — so the two bases meet at the battlefront. Units line up **along the battlefront** (level with the bases); as you play more, they stack **further back** — the opponent's toward the top, yours toward the bottom. **Sentinels** are held at the front, closest to the battlefront.
- **The bars** — each player's **resources, hand, deck and discard** sit in a **bar** across their side of the play area: the **opponent bar** above (with the **opponent's leader centred** above their base) and **your bar** below. Your bar also holds the **action** buttons; your hand is the widest area in it.
- **Cards** — each card is shown as its **card art** (power and health are on the art itself). Any **damage** a unit has taken is shown as a **red token** (white number) over the middle of the card art, like a physical token; it stays upright even when the card is rotated, and keeps the card's name, ability text and stats visible. Cards are drawn at a fixed size in a uniform square slot and in their true orientation — units stand **portrait** when ready and rotate **landscape** (sideways, dimmed) when exhausted; a **deployed leader** shows its unit side. The square slots mean cards never overlap, even when rotated. A **highlight hugs the card edge** when it's selectable, a target, or your playable hand card. If a card's art can't be loaded, the card instead shows a **text summary** — cost, name, power/HP, keywords and abilities — so it's always readable.
- **Upgrades & tokens** — an **upgrade** attached to a unit sits **behind** the unit card, its ability text and power/health modifier protruding below; several stack. Effects also place **tokens** on a unit, drawn as small overlays like the damage token: **Shield** (blue) soaks the next instance of damage then pops, **Experience** (amber, +1/+1), and **Advantage** (gold, labelled "adv.", +1/0 on its next attack or defence). A stat boost that isn't printed on the card — a temporary **"this phase" boost** (e.g. from a leader ability) or a constant **aura** from another card (e.g. a leader buffing your units) — shows as a white **+X/+Y token**: the power bonus in red (top-left) and the health bonus in blue (bottom-right). A "this phase" boost clears at the end of the phase (a unit only that boost was keeping alive is then defeated); an aura lasts while its source is in play. A **Hidden** or **Sentinel** unit shows a small badge (Sentinel overrides Hidden — a hidden unit that gains Sentinel becomes attackable and drops the Hidden badge). A defeated card-upgrade returns to its **owner's** discard (which may not be the unit's controller); tokens simply vanish.
- **Zoom** — hold **Shift** and move the mouse over a card to enlarge it at full size for reading (or **long-press** on a touch screen); release, or move away, to dismiss. Zoom needs Shift so plain hovering doesn't get in the way of making a play. While zoomed, hold **Alt** over a **leader** to see its other (unit) side.
- **Your hand** — clickable cards are highlighted: **blue** when a click will **play** the card (action phase), **green** when a click will **resource** it (setup/regroup). Cards you can't act on are dimmed. A card's shown cost includes any **aspect penalty** (+2 per aspect icon your leader and base don't provide).
- **Your move** — playing, resourcing and attacking are done **by clicking**: click a playable hand card to play it (a **unit** enters play; an **upgrade** highlights the units it can attach to — click one to attach), or click a **glowing unit** then a highlighted target (enemy unit or their base) to attack. When an ability lets you pick a target — including a **leader ability** (click your **leader card** to use it, then a highlighted target) or an optional in-combat effect — the valid targets highlight on the board and a **Decline** button appears for optional ones. A "look at a card", **search**, **choose-a-card**, or **look at your resources** effect (e.g. picking which upgrade to defeat, or playing an upgrade from your resources) shows the card(s) **centre-screen** for you to pick — **click the highlighted card** to choose it (cards that aren't valid picks are revealed but dimmed); token cards (Shield, Advantage, Experience, Mandalorian) show their real art, and optional effects have a **Cancel** button. This is private — your opponent doesn't see it. When an effect then lets you choose where damage lands, the valid **units and bases** highlight on the board (either base can be chosen when the card says "a base") — click one. The remaining standing choices — **Mulligan, Keep hand, Take the initiative, Pass** (and skip resourcing / deploy leader / use a unit's **Action** ability) — are buttons in the **Action** column of your bar.
- **Log** — a running record of every action, in a panel on the **left** of the screen.

### Turn structure

Players alternate single actions. When both players pass consecutively, the round moves to the **regroup phase**: each player draws 2, may put 1 card from hand into resources, then everything readies and a new round begins. In regroup, **click any hand card to resource it** (or Skip resourcing to bank nothing). Whoever holds the **initiative** acts first each round — take it during a round to act first in the next one (but you'll pass for the rest of the current one).

### Winning

Deal damage to the opponent's base until it reaches its health before they do the same to you. Each base shows the **damage it has taken as a large number over the card**, counting up to its printed health (which varies from base to base). If a single action defeats **both** bases at once, the game is a **draw**. If your deck runs out, drawing deals 3 damage to your own base per missed card — don't dawdle.

### Keywords, upgrades & card abilities

The rules engine runs the cards, not just the board:

- **Keywords** apply — Sentinel (enemies must attack it), Saboteur (ignores Sentinel and defeats the defender's Shields before it attacks), Raid, Grit, Overwhelm, Restore, **Ambush** (may attack the moment it enters play), **Shielded** (enters with a Shield token), **Hidden** (can't be attacked until your next turn), **Support** (lends its abilities to another attacker), and **Advantage**.
- **Upgrades** attach to a unit — yours *or* the enemy's — and modify power/health, grant keywords, or add abilities. A **unique** upgrade (star by its name) is one-per-player: play a second copy and you choose one of the two to defeat.
- **Card abilities** resolve, including triggered effects (**when played**, **when defeated**, **when an attack ends** — which still fires even if the attacker was defeated in the combat — **when a unit readies**, **on attack/defence**), activated **Action** abilities, and the interactive choices they raise (pay-or-exhaust, play a revealed card free, deal damage, search-and-discard, an optional follow-up attack, and so on).
- **Leader abilities** — some leaders have an ability you use while they're **undeployed** (click your leader card, then a highlighted target). Once **deployed**, the leader is a unit on the board with its own (usually stronger) ability, keywords and stats.

Every upgrade in the ASH set is implemented, plus several leaders (with more to come). Still on the roadmap: the remaining leaders, **event cards**, and ability text on ordinary **unit** cards beyond keywords — those still make fine resources.

## After the game

The result banner offers a **Rematch** (fresh shuffle, same decks) or **Back to decks**. Completed games are recorded on-device for future analysis.

---

*dmgCtrl is an unofficial fan site and is not produced by or endorsed by Fantasy Flight Games, Lucasfilm or Disney. The Star Wars Unlimited cards, logos and art used on the site are property of Disney and/or Fantasy Flight Games.*
