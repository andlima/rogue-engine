# Renderer Contract

The engine exposes a small, renderer-agnostic contract so the same
game definition can drive both the ANSI (terminal) renderer and the
canvas stub (and any future renderers without schema changes).

## Surfaces consumed

Every renderer must consume these surfaces from the loaded definition:

- **Map grid** — from `getVisibleTiles(state, w, h, fovMap)`. A 2D
  array of `{ ch, color }` cells.
- **HUD** — measurements listed in `rendering.hud.measurements`,
  message log sized by `rendering.hud.message_log_size`.
- **Status rules** — conditional glyph / color overrides from
  `rendering.status_rules`.
- **Tile / being / item overrides** — from `rendering.tiles`,
  `rendering.beings`, `rendering.items`.

Interaction-flow additions:

- **Panel** — `drawPanel(panel, cursor)` renders a bordered box with
  a title, optional column headers, and a cursor-highlighted row.
  Panel rows come from `ui.panels.<id>.data` evaluated against a
  scope identical to the flow scope.
- **Prompt banner** — `drawPrompt(prompt)` renders a single-line
  prompt string. `ui.hud.prompt_banner.position` picks top vs. bottom.
- **Target reticle** — `drawReticle(grid, viewOrigin, target, ind)`
  overlays a glyph (from `ui.hud.target_indicator`) over the map grid
  while `pick_tile` / `pick_being` is active.

Input-bindings additions:

- **Help panel** — `drawHelpPanel(help)` renders the generated help
  screen. The `help` argument is the shape returned by
  `getHelpRows(definition, state)`:
  `{ title, sections: [{ header, rows: [{ keys, label, summary }] }] }`.
  The help panel is never hand-authored; both renderers consume the
  same descriptor.
- **Key hint** — `drawKeyHint(hint)` renders the one-line key-hint
  surface beneath the viewport while a flow or panel is active. The
  `hint` argument is produced by `getKeyHint(definition, state,
  intrinsic)` and combines step-intrinsic inputs (provided by the flow
  runner) with the active context's meta-bindings.

## ANSI renderer

The ANSI renderer (`src/renderer/ascii.js`) exposes:

- `renderToString(grid, rendering)` — map grid → string
- `renderStatus(state)` — HUD line
- `renderMessages(state, n)` — recent messages
- `drawPanel(panel, cursor)` — bordered panel
- `drawPrompt(prompt)` — prompt banner
- `drawReticle(grid, viewOrigin, target, indicator)` — reticle overlay
- `drawHelpPanel(help)` — generated help screen
- `drawKeyHint(hint)` — key hint beneath the viewport

All panel / prompt / reticle output is plain text; colors via ANSI
escape codes.

## Browser renderer

`src/renderer/canvas.js` paints the map grid to a `<canvas>` element.
The class is constructed with `(canvasEl, renderingConfig)` — the
element is injected so the module stays importable in Node for unit
tests. It exposes:

- `drawGrid(grid, stateOrMode)` — paints a 2D `{ch, color}` grid to
  the canvas using `ctx.fillText` per cell. Honors
  `rendering.tiles` overrides and `state.displayMode` the same way
  `renderToString` does.
- `drawReticle(grid, viewOrigin, target, indicator)` — overlays the
  indicator glyph on the already-painted grid at the target's on-grid
  position.
- `clear()` — clears the canvas between frames.

HUD / messages / help / key-hint are rendered into DOM elements by the
browser entry (`index.html`), not through renderer methods. The same
`renderStatus`, `renderMessages`, `drawHelpPanel`, and `drawKeyHint`
helpers from `ascii.js` produce the strings; the browser pastes them
to `textContent` and the CLI writes them to stdout.

v1 deferrals (not implemented in the browser):

- **Panels and prompt banners** — `drawPanel` / `drawPrompt` are CLI-
  only surfaces. If a flow step triggers a panel during browser play
  the v1 browser falls through to the default grid render; the player
  can still step / cancel via keyboard but the panel contents are not
  drawn. Silly-game's default gameplay loop doesn't invoke panels, so
  this is a cosmetic limitation, not a playability blocker.
- **Sprite rendering** — glyph text on canvas only; no sprite sheet.
- **Hold-to-repeat / synthetic key-repeat** — browser OS auto-repeat
  on held keys is the only repeat.
- **Touch controls and mobile action bar** — desktop keyboard only.

## Display modes

The engine ships two map-display modes:

- **`ascii`** (default) — renders single-character glyphs exactly as
  declared under `beings.<id>.glyph`, `items.<id>.glyph`, and the raw
  map tile characters (with the usual `rendering.{tiles,beings,items}`
  overrides and `rendering.status_rules` applied on top).
- **`emoji`** — prefers the `emoji` field at each layer of the override
  walk (`status_rules` → `rendering.{tiles,beings,items}.<id>.emoji`
  → archetype `emoji`) and falls back to the ASCII `glyph` when no
  emoji is declared.

### `state.displayMode`

The active mode is a plain string on `state`, initialized when the
state is created:

- Defaults to `"ascii"`.
- If `rendering.default_display_mode` is set in the game YAML (one of
  `"ascii"` or `"emoji"`), `createState()` uses that value instead.
- Mode is ephemeral — it is not persisted across saves, and every new
  game starts at the default.

### `toggle_display` built-in

`toggle_display` is a built-in action that flips `state.displayMode`
between `"ascii"` and `"emoji"`. It does **not** consume a turn and
does **not** run AI — analogous to `open_help`. Games bind it under
`input.bindings` like any other action (the silly-game YAML binds
`TAB`). Because it is declared under `BUILTIN_ACTIONS`, the generated
help panel lists it alongside user-defined actions without any special
casing.

### Fallback behavior

If the current mode is `emoji` but an entity / tile has no declared
`emoji` at any layer of the override chain, the renderer emits the
ASCII `glyph` instead. No `?` placeholder, no runtime error — this is
the guarantee that authors can adopt emoji mode incrementally.

### Cell width in emoji mode

Every map cell in the ANSI renderer is padded to two display columns
when `state.displayMode === "emoji"`. The rule:

- ASCII fallbacks (single UTF-16 code unit, e.g. `@` when no emoji is
  declared) are right-padded with one space.
- Emoji glyphs (surrogate-pair strings, e.g. `🐉`) are emitted as-is
  on the assumption that the terminal renders them in two columns.

In `ascii` mode the output is unchanged from a single-column grid, so
existing parity traces and snapshot tests keep working.

Per-glyph width measurement (east-asian-width tables, ZWJ-aware
segmentation) is intentionally out of scope — authors who pick narrow
or wide outliers (e.g. `·` as a floor emoji) accept the resulting
alignment trade-off.

Because the renderer assumes every declared emoji occupies exactly two
columns, the loader enforces that assumption at parse time. Any
`emoji` field that is not a single grapheme whose emoji-presentation
form is trustable across terminals is rejected with a `SchemaError`
pointing at the offending path. The three most common author-facing
mistakes and their fixes:

- **ZWJ sequences** (e.g. `🏴‍☠️`, `👨‍👩‍👧`) — terminals often
  render these as three or more columns, or break them apart into
  component glyphs. Pick a single-codepoint emoji that matches the
  intent (e.g. `🏴` or `☠️`).
- **Bare text-presentation emoji** (e.g. `⚔`, `☠`, `⛵`) — these are
  BMP codepoints whose default presentation is *text*, so width is
  terminal-dependent. Append U+FE0F to force emoji presentation
  (`⚔️`, `☠️`, `⛵️`).
- **Skin-tone modifiers** (e.g. `🧔🏽`) — the base emoji plus tone
  modifier is a multi-codepoint sequence whose rendered width varies.
  Drop the modifier and use the base emoji (e.g. `🧔`).

The full rule set lives in `docs/schema.md` under "Allowed emoji".

