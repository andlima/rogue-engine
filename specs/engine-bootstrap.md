---
id: engine-bootstrap
status: not-started
area: engine
priority: 50
depends_on: []
description: Scaffold rogue-engine as a data-driven JS project with a YAML loader and a minimal playable slice
---

# Engine Bootstrap

## Goal

Stand up `rogue-engine` as a JavaScript project whose gameplay is described
entirely by data (YAML), not code. This spec establishes the project layout,
the core schema for the game's *nouns* — measurements, beings, items — and a
YAML loader/validator. It lands a minimal end-to-end playable slice (walk on
a map, player stats read from config) that proves the data-driven pipeline
works from file → runtime → ASCII output.

Inspiration and behavioral target for later specs:
<https://github.com/andlima/silly-game>. That project hard-codes tables,
constants, and rules in `src/game.js`. rogue-engine exists so the same kind
of game can be *reshaped* by editing a YAML file instead of patching code.

## Acceptance Criteria

1. **Project layout** at the repo root:
   - `package.json` with `"type": "module"`, Node >= 20, an `npm test` script,
     and an `npm start` (or equivalent `node cli.js`) script
   - `src/` — engine modules (loader, runtime, dispatcher, ascii renderer)
   - `test/` or co-located `*.test.js` — unit tests using Jest or Node's
     built-in `node:test` (pick one and document it in the README)
   - `games/` — YAML game definitions
   - `docs/` — schema documentation
   - `README.md` explaining the project goal, how to run the sample game,
     and pointing at `docs/schema.md`

2. **Dependencies**: zero runtime dependencies *except* a YAML parser
   (`yaml` on npm is acceptable). Test-only dev dependencies are fine.
   Document the dependency policy in the README so follow-up specs know the
   bar.

3. **Core schema** documented in `docs/schema.md`, with these top-level keys
   supported by the loader in this spec:
   - `meta` — `id`, `name`, `version`, optional `description`
   - `measurements` — array of entries with fields:
     `id`, `label`, `min` (default 0), `max` (number, another measurement
     reference like `"max_hp"`, or `null` for unbounded), `initial`,
     optional `regen` (number-per-turn). These are arbitrary named numeric
     resources — `hp`, `stamina`, `hunger`, `gold`, `xp` are all the same
     kind of thing to the engine.
   - `beings` — archetype entries with fields:
     `id`, `label`, `glyph`, `color`, `measurements` (object mapping
     measurement id → initial value override), optional `tags` (string array).
     A designated `player` archetype is identified via `meta.player_archetype`
     or a `tags: [player]` convention — pick one and document it.
   - `items` — archetype entries with fields:
     `id`, `label`, `glyph`, `color`, `kind`
     (`consumable` | `equipment` | `currency` | `container`), optional `tags`.
     Item *behaviors* (what happens on pickup/use/equip) are deferred to the
     actions DSL in the next spec — this spec only defines identity and kind.
   - `map` — a minimal static map section for the bootstrap slice: `width`,
     `height`, `tiles` (array of strings where `#` = wall, `.` = floor,
     `@` = player spawn). Procedural generation is **not** in scope here.

4. **YAML loader** (`src/config/loader.js`) that:
   - Reads a YAML file from disk (Node) or from a string argument
   - Parses and validates the schema, producing a normalized
     `GameDefinition` object
   - Reports user-friendly errors that include the offending key path and,
     where the YAML library exposes it, the source line number — e.g.
     `beings.rat.measurements.mp: unknown measurement 'mp' (known: hp)`
   - At least 3 classes of validation failure covered:
     - unknown cross-references (being → measurement, map `@` spawn → no
       player archetype, etc.)
     - missing required fields
     - type mismatches (e.g. `initial` not a number)

5. **Runtime** (`src/runtime/`) exposing:
   - `createState(definition)` → initial immutable `GameState`
   - `dispatch(state, action)` → new `GameState` (functional style — no
     mutation of the previous state)
   - One built-in action in this spec: `{ type: 'move', dir: 'n'|'s'|'e'|'w' }`
   - `move` blocks on walls and out-of-bounds; no combat, no items, no
     monsters yet. Those are the next spec's problem.
   - A `getVisibleTiles(state, viewW, viewH)` helper (silly-game has one —
     read it for shape reference) returning a 2D array the renderer consumes

6. **ASCII renderer + CLI entrypoint** (`cli.js` or `src/cli.js`):
   - `node cli.js --game games/minimal.yaml` loads the game, prints the map,
     reads key input (arrow keys or WASD), and dispatches move actions
   - Quit with `q`
   - No FOV, no fancy color handling required — plain ASCII is fine
   - The CLI exists to prove the pipeline end-to-end, not to be pretty

7. **Sample game** `games/minimal.yaml`:
   - One measurement: `hp`
   - One being archetype: `player` with `hp: 10`
   - No items, no monsters
   - A 10×10 hand-drawn room with walls around the edge and a player spawn
   - Loads cleanly, plays walkably

8. **Unit tests**, at minimum:
   - Schema validation produces useful errors for each of the three failure
     classes from criterion 4
   - Loading `games/minimal.yaml` produces the expected `GameDefinition`
     shape (snapshot or field-by-field asserts)
   - `dispatch(state, { type: 'move', dir: 'e' })` moves the player one tile
     east when the target is a floor
   - `dispatch(state, { type: 'move', dir: 'e' })` is a no-op when the
     target is a wall (state is returned unchanged, or with an explicit
     "blocked" flag — document the choice)
   - Running the loader twice on the same input produces equal
     `GameDefinition` objects (determinism)

## Out of Scope

- Actions beyond `move` — attack, use, interact, descend, useFood all come
  in the next spec
- Effect expressions (formulas written in YAML)
- Procedural dungeon generation
- Multiple levels / level transitions
- FOV / lighting
- Monsters and their AI
- Item behaviors (pickup, use, equip effects)
- Rendering beyond ASCII stdout
- Porting silly-game content — this spec proves the *pipeline*, not parity
- Browser frontend, audio, save/load, multiplayer

## Design Notes

- Keep `GameDefinition` (loaded + validated config, read-only) and
  `GameState` (per-turn runtime state, replaced on each dispatch) as
  distinct types. Validate at load time so runtime can trust its inputs.
- The engine runtime should be **functional and immutable** — every
  `dispatch` returns a new state. silly-game's `src/game.js` is a good
  reference for the style; do **not** copy its hard-coded tables.
- *Nothing* in the engine core should say `player.hp` or know what `hp`
  means. `hp` is just one of the measurements declared in the YAML. This is
  the single most important architectural constraint — if you find yourself
  hard-coding `hp`, you've drifted.
- The loader is allowed to compute derived caches (e.g. measurement-id
  lookup tables), but the shape it returns must be a pure data projection
  of the YAML — no functions, no classes, so it can be serialized and
  compared in tests.
- Pick one test runner (Jest or `node:test`) and commit to it; follow-up
  specs will build on that choice.
- The YAML `max` field accepting either a literal number or another
  measurement id (e.g. `max: max_hp`) is the first hint that measurements
  can reference each other — keep the resolution logic isolated so it can
  grow into the expression language in the next spec.

## Agent Notes

- Read `AGENTS.md` and `CLAUDE.md` at the repo root before editing. The
  worktree-only editing rule is strict.
- Read silly-game's `src/game.js` (on GitHub at `andlima/silly-game`) as a
  style reference for immutable state + action dispatcher. **Do not** copy
  its hard-coded monster/equipment tables — that defeats the whole point.
- Build in this order to keep each step testable:
  1. `docs/schema.md` — write the schema down before the loader
  2. `src/config/loader.js` + unit tests (schema validation errors first)
  3. `games/minimal.yaml` + loader integration test
  4. `src/runtime/` + `dispatch` unit tests for `move`
  5. `cli.js` + ASCII renderer (manual smoke test is enough)
- When in doubt between adding a feature and deferring, **defer**. The
  follow-up specs (`dsl-actions-world-rendering`, `silly-game-port`) exist
  to carry that weight.
- Common pitfall: inventing effect types, action types, or formula syntax
  in this spec. Resist. Spec 2 owns the verbs.
