---
id: static-map-initial-fov
status: not-started
area: runtime
priority: 50
depends_on: []
description: Fix FOV not being applied at session start for games with a static YAML map (pirate, ninja, minimal, interact-demo, toy-hit-and-heal). Root cause is state.map being null until the first transform_tile mutates it; FOV call sites guard on state.map and skip computation. Initialize state.map from definition.map at session creation.
---

# Fix initial FOV for static-map games

## Goal

Pirate, ninja, and other games with a static YAML map start with no
fog-of-war: the entire map is rendered. After the player triggers any
`transform_tile` effect (typically the `o` / `open_chest` action turning
`=` into `.`, or unlocking a `D` door with a key), FOV suddenly engages
and the rest of the map fades to black. Procedural-dungeon games (silly)
are unaffected. Players experience this as "FOV doesn't work until I
open a chest."

The fix is one line in `src/runtime/state.js`: populate `state.map`
from the parsed static map at session creation, so that `state.map` is
always the authoritative current map regardless of whether it came
from `definition.map` (static YAML) or `generateDungeon` (procedural).

## Root Cause

`src/runtime/state.js:102` returns `map: generatedMap` from
`createState`. `generatedMap` is only set when `world.dungeon` is
configured **and** there is no static `definition.map`
(`state.js:55`). For all five static-map games — pirate, ninja, minimal,
interact-demo, toy-hit-and-heal — `state.map` is therefore `null` at
session start.

The three FOV call sites all guard on `state.map`:

- `cli.js:46` — `const fovMap = state.map ? computeFOV(state.map, …) : undefined;`
- `index.html:593` — wraps the terminal-state render in `if (state.map) { … }`
- `index.html:616` — `const fovMap = state.map ? computeFOV(state.map, …) : undefined;`

When `state.map` is null they pass `undefined` to `getVisibleTiles`,
which in `src/runtime/view.js:77` only applies the visibility mask
when `fovMap` is truthy — so the entire map renders.

`handleTransformTile` in `src/runtime/effects.js:656` returns
`{ ...state, map: { ...map, tiles: newTiles } }` regardless of whether
the original map came from `state.map` or `state.definition.map`. The
first time any `transform_tile` runs, `state.map` is populated, the
guards above start passing, and FOV begins to render correctly. That
is exactly the "after I open a chest it works" symptom.

## Acceptance Criteria

1. **`state.map` is non-null after `createState` for static-map games.**
   `src/runtime/state.js`'s `createState` returns a state whose `map`
   field is populated when `definition.map` exists, regardless of
   whether `world.dungeon` is configured. The simplest correct change
   is `state.js:102`: replace `map: generatedMap,` with
   `map: generatedMap ?? map,` (where `map` is the local variable
   already destructured from `definition` at line 25). This makes
   `state.map` the single source of truth for the current map across
   the lifetime of the session.

2. **FOV renders from turn 0 in pirate and ninja.** Loading
   `games/pirate.yaml` or `games/ninja.yaml` and inspecting the
   initial render (no actions taken) shows that tiles outside the
   torch radius (default 6, see `src/runtime/fov.js:11`) are blanked
   to `' '` — i.e. the same visibility behavior players see today
   *after* opening a chest. This holds for both the CLI
   (`node cli.js --game games/pirate.yaml`) and the browser
   (`index.html`'s canvas render).

3. **No regression for procedural games.** `games/silly/game.yaml`
   continues to work exactly as before. `state.map` for silly is
   still the procedurally generated dungeon (`generatedMap` wins
   the `??`), not the (non-existent) `definition.map`. The
   `silly-parity.test.js` suite passes unchanged.

4. **No regression for static games.** `games/minimal.yaml`,
   `games/interact-demo.yaml`, `games/toy-hit-and-heal.yaml`
   continue to work — their action contracts, entity placements,
   and tile transforms behave identically. The `e2e.test.js` suite
   passes unchanged.

5. **`transform_tile` still works.** Opening a chest, unlocking a
   door (`D` → `'`), and any other `transform_tile` effect produce
   the same post-effect map mutation as before. The mutation flow
   (`effects.js:636-657`) is untouched. After the change, the input
   `map` to `handleTransformTile` will always be a real object
   (either `state.map` because it's now populated, or
   `state.definition.map` via the existing `||` fallback), so the
   `if (!map) return state;` short-circuit on line 638 is now
   effectively dead for any session that ever reaches that handler
   — that is fine and out of scope to remove.

6. **Regression test added.** `test/runtime.test.js` gains one new
   `it(...)` case in the existing `describe('createState', ...)`
   block, asserting that for a static-map game `state.map` is
   non-null and exposes `width`, `height`, and `tiles` matching
   `definition.map`. The existing inline `GAME_YAML` fixture at the
   top of the file (which already has a static map) is sufficient
   — no new fixture file is needed. Sample shape:

   ```js
   it('initializes state.map from a static definition.map', () => {
     const state = makeState();
     assert.ok(state.map, 'state.map is populated for static-map games');
     assert.equal(state.map.width, 5);
     assert.equal(state.map.height, 5);
     assert.equal(state.map.tiles[2][2], '.');
   });
   ```

7. **`npm test` is green.** All existing tests pass without modification.

## Out of Scope

- **Removing the `state.map || state.definition.map` fallback** in
  `src/runtime/dispatch.js` (lines 26, 50, 70, 126),
  `src/runtime/effects.js` (lines 151, 637), and
  `src/runtime/view.js:14`. After this fix, `state.map` is always
  set, so the `|| state.definition.map` branch is dead code. Leave
  it — it is defensive and harmless, and removing it is a
  cross-cutting cleanup that is not required to fix the bug. A
  follow-up cleanup spec can take it on if desired.
- **Removing the `state.map ?` guards** at the FOV call sites
  (`cli.js:46`, `index.html:593,616`). Same reasoning — defensive
  and harmless. The bug fix lands at the source, not at every
  caller.
- **Changing the FOV algorithm or torch radius.** `port-silly-fov`
  already settled the algorithm and `src/runtime/fov.js:11`
  exports `TORCH_RADIUS = 6`. No FOV math changes here.
- **Adding FOV-state assertions to `silly-parity.test.js` or
  `e2e.test.js`.** FOV is a render-time effect; the existing tests
  exercise engine state transitions. The new `createState` test in
  AC #6 is sufficient regression coverage for this fix.
- **Pre-populating `state.map` with a deep copy of
  `definition.map`.** The shallow share is fine — `transform_tile`
  already creates a new map object via spread
  (`{ ...map, tiles: newTiles }`), so `definition.map` is never
  mutated through `state.map`.

## Design Notes

**Why fix at `createState` rather than at the call sites.** The bug
manifests in three places (`cli.js`, two spots in `index.html`) and
two of them are duplicated. Patching the source — `state.map` being
null when it shouldn't be — is one line and prevents future
recurrences (e.g. if a new renderer or a new caller of `computeFOV`
forgets the fallback). The dual-source pattern
(`state.map || state.definition.map`) is a known minor smell across
`dispatch.js`, `effects.js`, and `view.js`; this fix doesn't remove
it but does make `state.map` the canonical source so a future cleanup
spec can drop the fallbacks safely.

**Why `??` over `||`.** Either works in this context (`generatedMap`
is either a non-null object or `null`/`undefined`; `map` is the same).
`??` matches the intent more precisely (null-coalesce, not
falsy-coalesce) and reads as "use the generated map if we made one,
otherwise fall back to the static map." Implementer's choice if they
prefer `||` for stylistic consistency with `state.map || state.definition.map`
elsewhere in the codebase — either is acceptable.

**Why no deep copy.** `definition.map.tiles` is a 2D array of
single-character strings. `handleTransformTile` already does an
immutable update — it spreads `map.tiles` into a new array and
replaces the affected row — so the underlying `definition.map.tiles`
is never written through `state.map`. Sharing the reference at
session start is safe and saves a clone.

**Why the `placements` field on `definition.map` doesn't matter.**
`validateMap` in `src/config/loader.js:392` returns
`{ width, height, tiles, spawn, placements }`. `placements` is only
consumed once at session creation (`state.js:67-77`) to seed
entities; it is not read at runtime. Carrying it through on
`state.map` after this fix is harmless — no code path inspects it
on `state.map`.

**Side effect: terminal-state rendering of static-map games.**
`index.html:591-600` currently wraps the terminal-state map render
in `if (state.map) { … }`. For static-map games where the player
dies before triggering any `transform_tile`, this means the final
frame isn't redrawn (only the game-over overlay is shown). After
this fix, `state.map` is always set, so the final frame is always
rendered before the overlay. This is a small positive side effect,
not a separate fix to verify exhaustively.

## Touch List

- `src/runtime/state.js` — change line 102 from `map: generatedMap,`
  to `map: generatedMap ?? map,`.
- `test/runtime.test.js` — add one `it(...)` case in the existing
  `describe('createState', ...)` block (see AC #6).
- No other files. `cli.js`, `index.html`, `src/runtime/fov.js`,
  `src/runtime/view.js`, `src/runtime/effects.js`, and
  `src/runtime/dispatch.js` are not modified.

## Agent Notes

- Read `src/runtime/state.js` lines 24-108 (the `createState`
  function) end-to-end before making the change so you understand
  the `map` variable's scope: it's destructured from `definition`
  at line 25 and is the same object `validateMap` returned during
  loading. The `generatedMap` local is `null` whenever the static
  branch ran (line 64-78). After the fix, `state.map` is exactly
  `generatedMap` for procedural games, exactly `definition.map` for
  static games.
- The `if (!map && world?.dungeon)` check at line 55 controls
  whether procedural generation runs. Don't touch it. The fix is
  strictly about what `createState` *returns* in its final object
  literal.
- Run `npm test` once after the change and confirm green. The
  existing test suite (`runtime.test.js`, `e2e.test.js`,
  `silly-parity.test.js`, `browser-interface.test.js`) covers
  static-map and procedural games end-to-end and will catch any
  regression.
- Manual verification (optional, not a blocker for green tests):
  `node cli.js --game games/pirate.yaml` and confirm the initial
  frame already has the FOV mask — only a small disc around the
  player is visible, the rest is blanked. Press `o` (open chest)
  on a `=` tile and confirm the disc still tracks the player after
  the chest opens. Same for `games/ninja.yaml`. No code change is
  needed in `cli.js`.
- `git diff --stat` should show two files modified
  (`src/runtime/state.js` and `test/runtime.test.js`). If anything
  else changes, you're out of scope.
