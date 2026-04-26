---
id: port-silly-fov
status: not-started
area: runtime
priority: 50
depends_on: []
description: Replace src/runtime/fov.js with a port of silly-game's current recursive shadowcasting (github.com/andlima/silly-game src/fov.js), keeping the same exported computeFOV signature so all existing call sites are untouched. Drop the unused hasLOS Bresenham helper. Export TORCH_RADIUS for parity.
---

# Port silly-game FOV

## Goal

The engine's `src/runtime/fov.js` claims to implement "Albert Ford's
symmetric variant" of recursive shadowcasting, but its slope formulas
and wall-handling diverge from the implementation in
`andlima/silly-game` `src/fov.js`. The two algorithms produce
visibility differences in some corner/pillar geometries.

silly-game is the canonical reference for this engine's behavior (the
silly YAML is the parity-test target, see
`test/fixtures/silly-ref/SOURCE.md`). Bring `src/runtime/fov.js`
in line with silly-game's current FOV: same algorithm, same slope
math, same wall-recursion shape. The exported `computeFOV(map, ox,
oy, radius)` signature stays identical so `cli.js`, `index.html`, and
`src/runtime/view.js` are not touched. The unused `hasLOS` Bresenham
helper is removed (the `los` / `line_of_sight` expression builtins in
`src/expressions/evaluator.js` already have their own Bresenham
implementation).

## Acceptance Criteria

1. **Algorithm replaced.** `src/runtime/fov.js`'s `computeFOV`
   implementation matches silly-game's `src/fov.js` (commit on
   `main` at the time of this task) line-for-line modulo the two
   adaptations in (2) and (3) below. Specifically:

   - True recursive `castOctant(map, ox, oy, radius, octant, row,
     startSlope, endSlope, visible)` — not the iterative
     stack-based form currently in the file.
   - Per-row column bounds derived from the slopes:
     `maxCol = Math.floor(r * nextStartSlope + 0.5)` and
     `minCol = Math.max(0, Math.ceil(r * endSlope - 0.5))`. The
     column loop runs `for (let col = maxCol; col >= minCol; col--)`.
   - Slope formulas at the cell's row (no `r ± 0.5` edge offsets):
     when entering a wall, recurse with `endSlope = (col + 0.5) / r`;
     after a wall, set `nextStartSlope = (col - 0.5) / r`.
   - On hitting the first wall in a row, immediately recurse for
     the open region above (the `foundWall` flag pattern in silly).
   - If the last cell scanned in a row is a wall, the remaining arc
     past this row is fully blocked — `return` from the function
     (silly's `if (foundWall) return;` after the column loop).
   - Distance computation is `Math.sqrt((x - ox)² + (y - oy)²)`
     using the transformed map coordinates (mathematically identical
     to silly's form; this is just a notation mirror — the iterative
     version's `Math.sqrt(col² + r²)` is equivalent in octant
     space).
   - The 8-octant transform table is the silly form
     (`{ x, y }` object return, eight `case` arms identical to
     silly's `transformOctant`). Renaming the helper to match
     silly's `transformOctant` is fine and preferred.

2. **Wall tile literal stays as `'#'`.** silly-game imports
   `WALL` from `./map.js`; rogue-engine has no equivalent map module
   and uses `'#'` directly across the codebase (see
   `src/runtime/view.js:96-101`, `src/expressions/evaluator.js:107`).
   The ported `isOpaque` reads
   `map.tiles[y][x] === '#'` — same as today's file. No `WALL`
   import is added.

3. **`TORCH_RADIUS` is exported.** Add
   `export const TORCH_RADIUS = 6;` near the top of the file and
   use it as the default value for `computeFOV`'s `radius`
   parameter. silly-game exports the same constant. No call site is
   updated to reference it (the default keeps the existing
   no-argument calls in `cli.js:46` and `index.html:593,616`
   working unchanged).

4. **`hasLOS` is removed.** The current export
   (`src/runtime/fov.js:32-51`) is deleted along with its docstring.
   `grep -rn "hasLOS" src/ cli.js index.html test/` returns no
   matches after this change. The Bresenham `los` /
   `line_of_sight` evaluator builtins
   (`src/expressions/evaluator.js:90-112,153-174`) are not touched
   — they have their own self-contained Bresenham loop and are
   used by YAML expressions.

5. **Origin is always full brightness.** Before the octant loop,
   `visible.set(\`${ox},${oy}\`, 1.0)` matches today's behavior
   (and silly's). Brightness formula
   (`b = 1.0 - (distance / radius) * 0.55`, clamped to
   `[0.45, 1.0]`) is unchanged.

6. **No call sites change.** `cli.js`, `index.html`, and
   `src/runtime/view.js` are byte-identical to before this task
   (other than maybe whitespace if any). `git diff --stat` shows
   only `src/runtime/fov.js` modified.

7. **`npm test` is green.** All existing tests pass without
   modification. `silly-parity.test.js`, `e2e.test.js`,
   `browser-interface.test.js`, and the rest do not assert on FOV
   state (FOV affects rendering, not engine state transitions),
   so the algorithm swap is invisible to them. No new FOV test
   is added — the surface area is small, the algorithm is the
   well-known recursive shadowcasting form, and the user has
   declined further regression coverage for this task.

## Out of Scope

- **Adding FOV unit tests.** The user has explicitly declined
  further regression coverage for this change; existing tests
  carry the safety net.
- **Touching the `los` / `line_of_sight` evaluator builtins.**
  Their Bresenham implementation in
  `src/expressions/evaluator.js:90-112,153-174` is independent
  of the FOV module and is used by YAML expressions. Not part
  of this task.
- **Renaming `computeFOV` or changing its signature.** Callers
  depend on `computeFOV(map, ox, oy)` and
  `computeFOV(map, ox, oy, radius)`. Both call shapes must keep
  working.
- **Changing rendering / brightness rendering.** `getVisibleTiles`
  in `src/runtime/view.js` ignores the brightness value today
  (it only checks `fovMap.has(key)` for visibility — see line
  77). The brightness payload is preserved in case future
  rendering uses it, but no rendering change is in scope.
- **Updating `test/fixtures/silly-ref/SOURCE.md`.** That file
  documents transcribed constants; the torch radius (6) and
  brightness formula are unchanged.
- **CLI / browser launcher / mobile UI changes.** None.

## Design Notes

**Why silly-game's variant.** The silly-game implementation is the
direct ancestor of the engine's silly port and is the parity
reference for combat, AI, and dungeon generation already
(`test/fixtures/silly-ref/SOURCE.md`). Aligning FOV closes the last
algorithmic gap and makes "play silly in rogue-engine" indistinguishable
from "play silly upstream" in the only remaining observable behavior
that diverges (visibility cones around pillars and corner geometry).

**Why drop `hasLOS`.** It is a Bresenham raycaster that no caller
imports — `grep -rn hasLOS` shows the export is referenced only by
its own definition. The `los` / `line_of_sight` expression builtins
that YAML uses for AI awareness checks have their own embedded
Bresenham loop in `src/expressions/evaluator.js` and don't import
from `fov.js`. Carrying `hasLOS` forward would be dead code.

**Why preserve `'#'` literal.** The engine has no `WALL` constant
module today; wall checks across the codebase compare `tile === '#'`
inline (renderer, view, evaluator, loader). Introducing a `WALL`
constant just for the FOV port would either require a new shared
module or duplicate the constant in `fov.js` — both more churn
than the port itself. Match the existing convention.

**Why export `TORCH_RADIUS`.** silly-game exports it; the rogue-engine
port doesn't currently. Exporting it keeps the parity tight and lets
future engine code (or per-game overrides) reference the canonical
value rather than re-declaring `6`. No call site is changed in this
task — the default-parameter value keeps existing zero-arg
`computeFOV(map, x, y)` calls working.

**Recursion depth.** silly-game's FOV uses true recursion. With a
torch radius of 6, recursion depth is bounded by the radius (each
recurse advances `row` by one), so worst-case stack depth is ~6
frames per octant × 8 octants = 48 — well within JS stack limits.
The current iterative form was likely written defensively against
deep recursion concerns that don't apply here. No need to keep the
iterative shape.

## Touch List

- `src/runtime/fov.js` — replace `castOctant` body with the recursive
  silly form; rename internal `transform` helper to `transformOctant`
  if convenient; export `TORCH_RADIUS`; remove `hasLOS`.
- No other files. No tests added or modified.

## Agent Notes

- The exact silly-game source is at
  `https://raw.githubusercontent.com/andlima/silly-game/main/src/fov.js`.
  Fetch it and port verbatim — only the two adaptations (literal
  `'#'` instead of `WALL` import, no `./map.js` import line) and the
  removal of `hasLOS` are deliberate divergences.
- Keep the file's existing JSDoc header tone (the engine codebase
  has slightly more verbose headers than silly-game). The comment
  block above `computeFOV` should still describe the function
  signature (`map`, `ox`, `oy`, `radius`) and the return shape
  (`Map<"x,y", brightness>`). The "Albert Ford's symmetric variant"
  attribution can stay or be replaced with the silly form's comment
  ("Symmetric shadowcasting (Albert Ford's variant). Guarantees: if
  tile A sees B then B sees A...") — implementer's choice; both are
  acceptable.
- After the change, run `npm test` once and confirm green. No
  manual browser verification is required — the parity tests cover
  the engine state transitions, and FOV's only consumer
  (`getVisibleTiles`) just reads `fovMap.has(key)` so swapping the
  algorithm cannot break anything that the existing tests aren't
  already exercising.
- `git diff --stat` should show exactly one file modified
  (`src/runtime/fov.js`). If anything else changes, you're out of
  scope.
