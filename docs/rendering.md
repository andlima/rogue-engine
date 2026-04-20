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

## ANSI renderer

The ANSI renderer (`src/renderer/ascii.js`) exposes:

- `renderToString(grid, rendering)` — map grid → string
- `renderStatus(state)` — HUD line
- `renderMessages(state, n)` — recent messages
- `drawPanel(panel, cursor)` — bordered panel
- `drawPrompt(prompt)` — prompt banner
- `drawReticle(grid, viewOrigin, target, indicator)` — reticle overlay

All panel / prompt / reticle output is plain text; colors via ANSI
escape codes.

## Canvas renderer stub

`src/renderer/canvas.js` ships as a thin stub so `dsl-actions-world-
rendering` can prove the contract is renderer-agnostic without
committing to a canvas implementation. Each method throws
`"not implemented"` with a TODO pointer. Accepting the same semantic
descriptors as the ANSI renderer is the whole point — future canvas
work fills in the bodies, nothing changes upstream.
