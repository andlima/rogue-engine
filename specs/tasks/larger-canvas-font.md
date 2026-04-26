---
id: larger-canvas-font
status: not-started
area: browser
priority: 50
depends_on: []
description: Increase the browser canvas grid font/tile size by ~50% so the game itself reads larger; HTML chrome (HUD, launcher, action bar) is untouched.
---

# Larger Canvas Font

## Goal

The browser canvas currently renders glyphs at 20px inside 28px tiles, which
is small on modern high-DPI displays. Bump the canvas grid font by ~50% so
the actual game is more readable. HTML chrome (status, messages, key-hint,
help panel, launcher, game-over overlay, action bar) keeps its current
sizing — this task is about the canvas only.

## Acceptance Criteria

1. **Canvas font size is 30px.** In `src/renderer/canvas.js`,
   `DEFAULT_FONT_SIZE` is changed from `20` to `30`.

2. **Canvas tile size is 42px.** In `src/renderer/canvas.js`,
   `DEFAULT_TILE_SIZE` is changed from `28` to `42`. Tile size scales 1:1
   with font size so glyphs stay visually centered the same way they do
   today (the existing `offsetY = Math.floor((this.tileSize - this.fontSize) / 2)`
   formula keeps working — `(42 - 30) / 2 = 6`, vs. today's `(28 - 20) / 2 = 4`).

3. **Initial canvas dimensions match the new tile size.** The placeholder
   `<canvas id="game" width="588" height="420">` in `index.html` is updated
   to `width="882" height="630"` (21 × 42 = 882, 15 × 42 = 630, matching
   `VIEW_W = 21` and `VIEW_H = 15` in `index.html`). The canvas already
   resizes itself in `drawGrid()` once a session loads, so this is purely
   to prevent a layout flash before the first draw.

4. **No new constants, options, or YAML fields.** The change is two
   numeric edits in `canvas.js` plus the canvas attribute update in
   `index.html`. No per-game override, no environment toggle, no
   `rendering.font_size` field.

5. **HTML chrome font sizes are untouched.** All `font-size` rules in
   `index.html` (`#status`, `#messages`, `#key-hint`, `#help pre`,
   `#game-over*`, `#launcher*`, `.launcher-game*`, `#back-to-menu`,
   `#action-bar button`) keep their current px values. The action bar's
   button label size (`13px`) is explicitly preserved — it was sized for
   tap targets, not readability.

6. **CLI is untouched.** `cli.js`, `src/renderer/ascii.js`, and the
   runtime modules under `src/runtime/` are not modified. ANSI output to
   the terminal does not have a "font size" — this task is canvas-only.

7. **Tests pass unchanged.** `npm test` is green. The existing
   `CanvasRenderer` tests in `test/renderer.test.js` use a stub canvas
   and do not assert on the literal values of `DEFAULT_FONT_SIZE` or
   `DEFAULT_TILE_SIZE`, so they continue to pass without edits.

### Manual verification (done by implementer before reporting)

8. Run `npm run serve`. Open `http://localhost:8000/?game=silly` in a
   desktop browser. The canvas glyphs are visibly larger than before;
   surrounding HUD text (status line, message log, key hint) is the same
   size as today. Repeat for `?game=pirate` and `?game=ninja` —
   glyphs scale up uniformly across all three games.

9. Same flow under Chrome devtools mobile emulation (Pixel-class
   viewport so `pointer: coarse` matches). The action bar at the bottom
   is unchanged in size; the canvas above it is larger. Tapping the
   canvas quadrants still moves the player (the tap-quadrant math in
   `src/browser/touch-controls.js` uses `getBoundingClientRect()`, which
   is independent of tile size — no math change needed there).

## Out of Scope

- **CSS chrome resizing.** The HUD, launcher, help panel, game-over
  overlay, and action bar all keep their current font sizes. If those
  need bumping later, that's a separate task with its own design
  conversation (e.g. whether to switch to `rem`-based sizing).

- **Per-game tile size override.** No new YAML field on `rendering` to
  pick a custom font/tile size. Every game uses the new defaults.

- **CLI / ANSI font.** The terminal renderer has no font size to scale.

- **Responsive scaling.** No media-query-based variants ("smaller font
  on phones", "even bigger on 4K"). One value, applied unconditionally.
  If the canvas overflows a small viewport, that's a layout concern for
  a future responsive-canvas task — not this one.

- **Image-rendering / DPI handling.** The canvas already has
  `image-rendering: pixelated` in CSS; this task doesn't touch it. No
  `devicePixelRatio` scaling work.

## Design Notes

**Why scale tile size with font size.** `drawGrid()` computes per-cell
position as `x * this.tileSize` and centers the glyph using
`offsetY = (this.tileSize - this.fontSize) / 2`. If only `fontSize` grew,
the tiles would clip the larger glyphs; if only `tileSize` grew, the
glyphs would float in oversized cells. The 1:1 ratio (28→42 = 30/20 ×
28) preserves the current visual proportion exactly.

**Why update the static `<canvas>` `width`/`height` too.** `drawGrid()`
sets `canvas.width`/`canvas.height` on its first call, which would
override the HTML attributes. But until the first draw, the canvas
renders at the HTML-attribute size — keeping `588 × 420` would cause a
visible layout jump from the small placeholder to the larger live
canvas during boot. Updating the attributes makes the placeholder match
the live size.

**Why 1.5× and not a configurable ratio.** "Around 50% larger" is
specific enough to commit to fixed numbers. A configurable ratio would
add a new YAML field, a new environment variable, or a localStorage
setting — none of which are justified by this task. If a future use
case needs configurability, the constants in `canvas.js` are the
natural seam to expand.

## Touch List

- `src/renderer/canvas.js` — change `DEFAULT_FONT_SIZE` from `20` to
  `30` and `DEFAULT_TILE_SIZE` from `28` to `42`. No other edits.

- `index.html` — change the `<canvas id="game" width="588" height="420">`
  attributes to `width="882" height="630"`. No CSS changes; no script
  changes.

## Agent Notes

- Don't touch `src/renderer/ascii.js` — that's the terminal renderer
  and has no concept of font size.

- Don't introduce a `RENDER_SCALE` multiplier or a `getDefaultTileSize()`
  helper. Two numeric edits is the entire change — anything else is
  scope creep per the "Don't add features... beyond what the task
  requires" rule in CLAUDE.md / project conventions.

- The existing tests in `test/renderer.test.js` use a stub canvas with
  `width: 0, height: 0` and don't assert on literal pixel values, so
  no test edits are needed. If you find a test that does pin `20` or
  `28` (search for them with `grep -rn`), pause and re-scope — none
  exists today, so a hit means the search itself caught a near-miss
  somewhere unexpected.

- The canvas tap-quadrant logic in `src/browser/touch-controls.js`
  uses `getBoundingClientRect()` and computes the canvas center from
  the rect, not from `tileSize`. No change is needed there. Verify
  by reading `computeTouchDir` — it takes `clientX, clientY, rect`
  and never references tile size.
