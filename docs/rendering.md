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

## Canvas renderer stub

`src/renderer/canvas.js` ships as a thin stub so `dsl-actions-world-
rendering` can prove the contract is renderer-agnostic without
committing to a canvas implementation. Each method throws
`"not implemented"` with a TODO pointer. Accepting the same semantic
descriptors as the ANSI renderer is the whole point — future canvas
work fills in the bodies, nothing changes upstream.
