# Redesign review — defect evidence (26 Oct 2026)

iPhone, installed PWA, after the redesign (#869–#874). Each screenshot can be embedded in an issue with:

```
![](https://raw.githubusercontent.com/yetanotheridentifier/dmgCtrl/evidence/redesign-review/<file>)
```

Status: all raised as placeholders on 26 Oct; refine on review.

| # | Defect | Status | Evidence | Notes |
|---|--------|--------|----------|-------|
| 1 | Fade at the top of every screen, under the status bar | raised #917 | `00` | |
| 2 | Game select logos too large; SWU logo upscaled, widths differ | raised #918 | `00` | |
| 3 | Base search results hidden by the keyboard | raised #919 | `01`, `02` | With the keyboard up only the sheet's title shows; results appear only after dismissing it |
| 4 | Text and content too close to the screen's corner radius | raised #920 | `02`, `10`, `14` | Sheet title and "Building from a deck?" sit at the left edge; 2P corner buttons; Twin Suns cards near the edges |
| 5 | Rotate prompt no longer needed | raised #921 | `03` | Its back button is also clipped at the left edge |
| 6 | Start / HP readout off the card's centre | raised #922 | `04`, `05`, `10` | |
| 7 | Card outline cut off at the screen edge (outline covers badly cropped art) | raised #923 | `04`, `05`, `10` | 1P landscape: bottom border missing |
| 8 | Dashed initiative bar; consider replacing Start with "Decide initiative" | raised #924 | `04`, `05` | Dashed outline before initiative is set |
| 9 | Damage/heal feedback: colour, shake and position | raised #925 | `05` | The `−2` chip overlaps the art top-right of the number |
| 10 | Help: mixed background colours; prefer one continuous scroll, no collapsible sections | raised #926 | `06` | |
| 11 | Settings landscape: "LOF bases" segment squashed | raised #927 | `07`, `08` | Label overflows its pill |
| 12 | Settings landscape scrolls | raised #928 | `07`, `08` | |
| 13 | Settings shows every game's settings on one page; make it context-specific? | raised #929 | `07` | Likely `needs-decision` |
| 14 | 2P setup base images small | raised #930 | `09` | |
| 15 | 2P game: unneeded/inconsistent background colours and separator lines | raised #931 | `10` | |
| 16 | 2P More sheet uses a serif font (should match the app) | raised #932 | `11` | |
| 17 | 2P End game sheet uses a serif font | raised #933 | `12` | Same root cause as 16? |
| 18 | Twin Suns setup: card art sizing | raised #934 | `13` | Card text and frame show through behind the labels |
| 19 | Twin Suns game: inconsistent buttons (icon position/size) | raised #935 | `14` | |
| 20 | Twin Suns game: player's base and buttons upside down on entry | raised #936 | `14` | Rotating the phone fixes it |

## Files

- `00-game-select-portrait.png`
- `01-swu-base-sheet-keyboard-open.png`
- `02-swu-base-sheet-results.png`
- `03-rotate-prompt-portrait.png`
- `04-swu-1p-game-start-landscape.png`
- `05-swu-1p-game-damage-landscape.png`
- `06-swu-help-landscape.png`
- `07-settings-landscape.png`
- `08-settings-landscape-scrolled.png`
- `09-swu-2p-setup-portrait.png`
- `10-swu-2p-game-start-portrait.png`
- `11-swu-2p-more-sheet.png`
- `12-swu-2p-end-game-sheet.png`
- `13-twin-suns-setup-portrait.png`
- `14-twin-suns-game-landscape.png`
