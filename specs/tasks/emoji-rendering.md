---
id: emoji-rendering
status: not-started
area: rendering
priority: 50
depends_on: [dsl-actions-world-rendering, input-bindings, silly-game-port]
description: Per-entity emoji glyphs with a runtime Tab toggle in the ANSI renderer
---

# Emoji Rendering

## Goal

Add first-class emoji rendering as an alternate glyph set alongside the
existing single-character ASCII glyphs. The player can toggle between
ASCII and emoji display at runtime with `Tab`, matching the feel of the
reference silly-game. Emoji declarations live on each being/item/tile
definition so authors keep both representations co-located.

## Acceptance Criteria

### Schema additions

1. **`beings.<id>.emoji`** — optional string field, peer to `glyph` and
   `color` in the beings schema. One visual glyph (may be a
   multi-codepoint emoji with ZWJ/variation selectors). Documented in
   `docs/schema.md` alongside `glyph`.
2. **`items.<id>.emoji`** — same treatment on item archetypes.
3. **`rendering.tiles.<char>.emoji`** — optional peer to the existing
   `glyph` / `color` override fields. Applies to map tile characters.
4. **`rendering.beings.<id>.emoji` / `rendering.items.<id>.emoji`** —
   optional overrides, mirroring the existing glyph/color override
   layer.
5. **`rendering.status_rules[].emoji`** — optional peer to the existing
   `glyph` / `glyph_color` fields so conditional overrides also apply in
   emoji mode.
6. The loader (`src/config/loader.js`) accepts these fields without
   requiring them. Missing `emoji` is not an error — entities without an
   emoji fall back to their `glyph` (see criterion 11).

### Runtime display mode

7. **Display mode lives on state**: add `state.displayMode: 'ascii' |
   'emoji'`, initialized to `'ascii'` by default, or to the value of
   `rendering.default_display_mode` if the game YAML sets it.
8. **`default_display_mode`** is an optional new field under
   `rendering:` in the schema, validated as one of `ascii` | `emoji`.
9. **Tab toggles the mode**: add a built-in action `toggle_display` that
   flips `state.displayMode` between `ascii` and `emoji`. Toggling is a
   non-turn-advancing action (does not increment `state.turn`, does not
   run AI, analogous to `open_help`). The input-bindings help panel
   lists it like any other binding.
10. **Default binding in silly-game**: `games/silly/game.yaml` binds
    `TAB` to `toggle_display` and declares emoji glyphs for every being,
    item, and tile in the game (see criterion 14).

### Renderer behavior

11. **Fallback**: in emoji mode, if an entity/tile has no declared
    `emoji`, the renderer uses the ASCII `glyph` instead. No crashes, no
    `?` placeholders.
12. **Uniform cell width in emoji mode**: in the ANSI renderer, every
    map cell is padded to two display columns when
    `state.displayMode === 'emoji'`. ASCII fallbacks (e.g. `@` when no
    emoji is declared) are right-padded with one space; emoji glyphs are
    emitted as-is on the assumption they occupy two columns. In
    `ascii` mode, output is unchanged from today (single-column cells).
13. **Renderer surfaces**: `renderToString`, `getBeingAppearance`, and
    `getItemAppearance` in `src/renderer/ascii.js` all consult
    `state.displayMode` and return the right glyph. `renderToString`
    additionally takes `state` (or the display mode) so it can read the
    mode without reaching into globals. Pass existing call sites
    through.

### Silly-game parity demo

14. **Emoji mappings in `games/silly/game.yaml`**: plausible emoji for
    every declared being, item, and for the three tile characters.
    Suggested set (authors may tune):
    - Player `@` → `🧙`, rat `r` → `🐀`, skeleton `s` → `💀`,
      bear `B` → `🐻`, dragon `D` → `🐉`
    - Weapon `/` → `🗡`, armor `[` → `🛡`, food `%` → `🍞`,
      gold `$` → `💰`
    - Wall `#` → `🧱`, floor `.` → `·` (ASCII fallback acceptable),
      stairs-down if present → `🪜`
15. **README bump**: `games/silly/README.md` adds a short note showing
    how to press Tab to toggle emoji mode, plus a fourth remix example
    swapping two emoji mappings (e.g. "rename the dragon's emoji").

### Docs

16. **`docs/rendering.md`** gets a new "Display modes" subsection
    covering: the `state.displayMode` field, the `toggle_display`
    built-in, the `rendering.default_display_mode` config, the two-
    column padding rule in emoji mode, and the fallback behavior.
17. **`docs/schema.md`** documents every new field (criteria 1–6, 8).

### Tests

18. **Unit tests in `test/renderer.test.js`** covering:
    - Emoji glyph is used when `state.displayMode === 'emoji'` and
      entity declares an `emoji`.
    - Falls back to ASCII `glyph` when `emoji` is missing.
    - ASCII cell is padded to 2 columns in emoji mode; cell width is
      unchanged in ASCII mode.
    - `rendering.beings.<id>.emoji` override wins over
      `beings.<id>.emoji`.
    - `status_rules[].emoji` override applies when the rule's `when`
      matches.
19. **Dispatch/input test** (`test/input.test.js` or similar existing
    file) asserting that the `toggle_display` built-in flips
    `state.displayMode` and does not advance `state.turn` or mutate
    entities.
20. **Silly-game smoke test**: existing silly-game test harness runs
    unchanged after the YAML edits (i.e. adding `emoji:` fields and
    the Tab binding does not break loader validation or parity).

## Out of Scope

- Width handling for terminals with non-standard emoji widths. We
  assume every declared `emoji` is two columns wide; authors who pick
  narrow/wide outliers (e.g. `·`) accept that the fallback path
  pads with a space.
- Canvas renderer changes. `src/renderer/canvas.js` remains a stub;
  when it is implemented later it can consume `state.displayMode`
  using the same contract.
- Animated emoji, skin-tone modifiers, or emoji sequences beyond what
  a single grapheme can hold.
- Emoji in panels, prompts, messages, or the HUD beyond the map grid.
  Those surfaces continue to render as plain text — scope is the map
  viewport only.
- Per-player or save-file persistence of the chosen display mode.
  Mode resets to the default on each new game.
- A third renderer mode (e.g. Unicode box-drawing theme). Only the
  two modes — `ascii` and `emoji` — are introduced here.

## Design Notes

**Why per-entity rather than a theme map.** Keeping `emoji` next to
`glyph` and `color` means remix authors see all three forms in one
place and cannot forget to update the theme when they add a new
monster. `rendering.beings/items/tiles` still accept `emoji` for the
same reason existing glyph/color overrides exist — content-level data
vs. display-level overrides.

**Why `toggle_display` as a built-in action.** Adding a new effect
type (`set_ui`, `toggle_ui`) would generalize the concern but also
drag the effects pipeline into UI state. A built-in action handled at
dispatch time — analogous to `open_help` — is the smaller change and
keeps `EFFECT_HANDLERS` focused on world mutations. If a future spec
needs richer UI state, a `set_ui` effect can subsume `toggle_display`
without breaking existing games.

**Why force 2-column cell width in emoji mode.** Per-glyph width
measurement (east-asian-width tables, ZWJ-aware segmentation) is a
rabbit hole we don't need to descend for a feature whose point is
"make the dungeon look fun." Padding every cell to 2 columns produces
a stable grid on any terminal that renders emoji as 2 columns, which
is effectively all modern terminals. The trade-off — a wider viewport
in emoji mode — is acceptable and matches how the reference
silly-game's emoji mode looks.

**State shape.** `state.displayMode` is a plain string field on the
top-level state, same level as `turn` and `level`. Do not nest it
under a new `state.ui` object unless a second UI-state field arrives
in the same spec.

**Touch list** — the implementer will likely edit:
- `src/config/loader.js` (schema validation for new fields)
- `src/config/schema.*` or wherever the loader's schema lives
- `src/runtime/state.js` (init `displayMode`)
- `src/input/` (register `toggle_display` built-in, ensure
  non-turn-advancing)
- `src/renderer/ascii.js` (glyph resolution + cell padding)
- `docs/schema.md`, `docs/rendering.md`
- `games/silly/game.yaml`, `games/silly/README.md`
- `test/renderer.test.js`, plus an input/dispatch test

## Agent Notes

- Read `specs/dsl-actions-world-rendering.md` and
  `specs/input-bindings.md` first — they define the override layers
  and the built-in-action conventions you must extend, not replace.
- First-match wins for overrides: `status_rules` → rendering
  overrides → archetype default. Emoji resolution must walk the same
  chain, otherwise conditional glyph rules will silently fail in
  emoji mode.
- When deciding where `toggle_display` lives in the dispatch code,
  grep for how `open_help` is wired — emulate that path exactly so
  the help-panel generation in `input-bindings` picks up the new
  action without special-casing.
- The silly-game parity trace (if the silly-game-port spec has
  landed one) was captured in ASCII mode. Do not regenerate it —
  emoji mode should have zero effect on observable game state.
- Be conservative with emoji choice: stick to widely-supported
  single-codepoint emoji; avoid ZWJ sequences unless you have
  verified them rendering in at least one common terminal.
