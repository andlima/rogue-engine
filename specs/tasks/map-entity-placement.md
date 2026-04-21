---
id: map-entity-placement
status: not-started
area: engine
priority: 50
depends_on: []
description: Let static maps pre-place beings/items by embedding their glyphs in map.tiles
---

# Map Entity Placement

## Goal

Today the engine lets authors paint a static map as ASCII art, but the
tile alphabet is strictly terrain (`#`, `.`, `>`, `<`, plus any custom
chars declared in the top-level `tiles:` block) with a single `@`
marker for the player spawn. There is no way to place a specific crab
at `(11, 10)` on a hand-authored island — the only option is procedural
`world.spawn_tables` wired to dungeon generation, which replaces the
map entirely.

This task extends `map.tiles` to also accept being and item glyphs as
placement markers: the loader resolves each such glyph against the
beings/items registries, records a placement, and rewrites the cell to
floor; `createState` then seeds the entity at that coordinate. A map
like the one in `~/pirate-game/pirate.yaml` (crabs, a kraken, a shark,
doubloons, grog bottles sprinkled across a hand-drawn island) loads
directly, with no sidecar `initial_entities` list to maintain.

## Acceptance Criteria

1. **Entity-glyph index.** In `loadFromString`
   (`src/config/loader.js:1621`), after `validateBeings`
   (line 1630) and `validateItems` (line 1631), build a single
   `entityGlyphs` map keyed by `glyph` → `{ kind: 'being' | 'item', id }`.
   When two or more beings/items share the same glyph, store the
   collision (e.g. `{ collisions: [{ kind, id }, …] }`) rather than
   throwing — the collision only matters if the glyph is actually used
   in a map (criterion 4). Pass this index into `validateMap` at
   `src/config/loader.js:1654`.

2. **`validateMap` signature.** Extend
   `validateMap(raw, extraTileChars)` (currently at
   `src/config/loader.js:230`) to
   `validateMap(raw, extraTileChars, entityGlyphs)`. When
   `entityGlyphs` is `null`/`undefined`, behaviour is unchanged.
   Tile-char precedence: if a char is in `['#','.','>','<']` or
   `extraTileChars`, it is a tile and is **not** looked up in
   `entityGlyphs`, even if a being/item declares the same glyph.

3. **Map lookup order per cell.** For each `ch` in `map.tiles[y][x]`:
   1. `ch === '@'` → existing behaviour (record spawn, write `.`).
   2. `ch` is an allowed tile char → keep as-is (existing behaviour).
   3. `ch` matches an unambiguous entry in `entityGlyphs` → record
      placement `{ kind, id, x, y }`, write `.` into the tile grid.
   4. `ch` matches a collision entry in `entityGlyphs` → `SchemaError`
      naming the colliding ids (e.g.
      `map.tiles[3][12]: glyph 'r' matches multiple entities (being:rat, being:roach)`).
   5. Otherwise → existing `unknown tile character` `SchemaError`.

4. **`validateMap` return shape.** Returns
   `{ width, height, tiles, spawn, placements }`. `placements` is an
   array ordered by map scan order (row-major: top-to-bottom,
   left-to-right) — stable so that repeated loads yield the same
   initial `state.entities` order. For maps with no entity glyphs,
   `placements` is `[]`.

5. **`createState` seeds placements.** In the static-map branch of
   `createState` (`src/runtime/state.js:64-67`), after `spawnX/spawnY`
   are set and before returning, iterate `map.placements` and call
   `createEntity(placement.id, placement.x, placement.y, definition)`
   (already defined at `src/runtime/state.js:194`). Push the returned
   entity into `entities`. The loader has already proven each id
   resolves, so a `null` from `createEntity` is a bug and should throw.

6. **Procedural mode unchanged.** The branch `!map && world.dungeon`
   (`src/runtime/state.js:55-62`) is not touched. `spawn_rules` /
   `spawn_tables` continue to apply only when there is no static map.
   When a static `map:` *and* `world.spawn_tables` are both present,
   `spawn_tables` stay a no-op (the current behaviour). This keeps
   hand-placed and procedural modes mutually exclusive for v1.

7. **Player glyph unchanged.** `@` is still the player-spawn marker
   and is handled **before** the `entityGlyphs` lookup. Even though
   `meta.player_archetype` beings typically also declare `glyph: "@"`
   (e.g. `captain` in `~/pirate-game/pirate.yaml:57-68`), the engine
   does not attempt to place them as a second entity at the `@` cell.

8. **Tests — loader.** In `test/loader.test.js`, add cases covering:
   - Happy path: a small YAML with two beings (e.g. `crab` glyph `c`,
     `shark` glyph `S`) and one item (e.g. `coin` glyph `$`) placed
     in `map.tiles`. Assert `map.placements.length === 3`, each entry
     has the expected `{ kind, id, x, y }`, and each source cell is
     rewritten to `'.'` in `map.tiles`.
   - Unknown glyph: a cell that is neither tile nor being/item glyph
     throws `SchemaError` with the existing `unknown tile character`
     message (back-compat).
   - Glyph collision used in map: two beings with glyph `r`, map
     contains `r` → `SchemaError` listing both ids. A test where the
     same two-being collision exists but `r` is *not* in the map must
     load successfully.
   - Tile-wins precedence: custom tile `{ "x": { kind: "lava" } }`
     **and** an item with glyph `"x"`. Map cell `x` stays a tile;
     `placements` does not include the item.
   - `@`-wins precedence: a being declares `glyph: "@"` and the map
     has one `@`. `placements` does not include that being; spawn
     is set normally.

9. **Tests — runtime.** In `test/runtime.test.js`, add:
   - `createState` from a static map with placements produces
     `state.entities` of the expected length, with each entity at
     the right `(x, y)` and carrying being-default measurements
     (e.g. the crab entity's `hp` equals the `crab` being's `hp`).
     Player is at the `@` cell and *not* duplicated in `entities`.
   - `state.entities` order matches `map.placements` scan order
     (row-major), for determinism.

10. **Fixture.** Place a compact fixture under `test/fixtures/` (e.g.
    `test/fixtures/placement-map.yaml`, <40 lines) used by both test
    suites above. Keep to ~10x6 tiles, 2 beings, 1 item — enough to
    cover the criteria without becoming a second silly-game.

11. **No regressions.** All existing `test/*.test.js` pass unchanged.
    `games/silly/game.yaml` and `games/*.yaml` load with identical
    state (they use no entity glyphs in their `map.tiles`, or no map
    at all).

## Out of Scope

- **Sidecar `initial_entities: [{ being|item, x, y }]` syntax.** Only
  in-map glyph placement in this spec. A sidecar can be added later
  as an additive option if users want placements decoupled from the
  ASCII art (e.g. for per-instance measurement overrides).
- **Per-placement overrides.** No way to say "this crab has `hp: 20`"
  at placement time. All instances use the being definition's
  default measurements, same as procedurally-spawned entities do
  today via `createEntity`. (`src/runtime/state.js:194-206`.)
- **Mixed procedural + pre-placed.** If a static `map:` is present,
  `world.spawn_tables` remains a no-op. A future spec can add a
  "sprinkle" mode that lets procedural rules layer extra spawns on
  top of hand-placed ones.
- **Multiple entities per cell.** One char per cell means one
  placement per cell by construction; this spec does not introduce a
  multi-entity encoding.
- **Treating `=` as both item and tile.**
  `~/pirate-game/pirate.yaml` declares `chest` as an item with
  glyph `=` and the `open_chest` action uses
  `tile_at(actor.x, actor.y) == '='`. Under the precedence rules in
  criterion 3, `=` is interpreted as an **item** (no `"="` under
  `tiles:`), so the item is placed and the cell becomes `.` —
  `open_chest` will not see `=` at runtime. This is a pre-existing
  authoring ambiguity in that game; resolving it (make chest a tile
  or rewrite the action to find an item) is a game-yaml fix, not an
  engine change.
- **Shipping `pirate.yaml` / any new game.** Engine-only change. The
  user can point `node cli.js --game ~/pirate-game/pirate.yaml`
  once this lands; the YAML stays outside the repo.
- **Canvas renderer.** `src/renderer/canvas.js` is still a stub and
  is untouched.
- **AI behaviour / uniqueness for pre-placed monsters.** Placed
  monsters use the same AI rules (`actions.ai`) and entity shape as
  procedurally-spawned ones. No "named NPC" / uniqueness constraint
  is introduced.

## Design Notes

**Where the glyph index lives.** Build once in `loadFromString`
between `validateItems` (line 1631) and the `validateTiles` call at
line 1652, then pass into `validateMap` at line 1654. A small helper
like `buildEntityGlyphIndex(beings, items)` co-located near
`validateMap` keeps the loader's existing structure.

**Collision policy.** Eager rejection (error on collision regardless
of use) would break any existing game that happens to have an unused
duplicate glyph across beings/items. Lazy rejection (only when the
glyph is actually used in a map) is back-compat-safe and still
produces a clear error for users who trip into it. Store collisions
in the index as first-class entries so `validateMap` can decide.

**Scan order = placement order.** Iterating the tile grid row-major
and pushing placements as encountered gives a deterministic order
that mirrors reading the map top-down. Runtime tests should depend
on this order; changing it later would be a behaviour change.

**`createEntity` already does the right thing.** It accepts a plain
id and resolves being-vs-item via `_index.beings`/`_index.items`
(`src/runtime/state.js:194-217`). The loader could pre-classify
`kind` into the placement record (useful for error messages) but
`createEntity` doesn't need it — pass the id.

**Existing static maps still work.** `games/minimal.yaml`,
`games/toy-hit-and-heal.yaml`, and `games/interact-demo.yaml` have
static maps with no entity glyphs; `placements` is `[]` and nothing
else changes in `createState`.

**Touch list:**
- `src/config/loader.js` — add `buildEntityGlyphIndex`; extend
  `validateMap` signature and body; update the call site at 1654.
- `src/runtime/state.js` — seed `entities` from `map.placements`
  in the static-map branch (around lines 64-67).
- `test/loader.test.js` — five new cases (criterion 8).
- `test/runtime.test.js` — two new cases (criterion 9).
- `test/fixtures/placement-map.yaml` (new) — shared fixture.

## Agent Notes

- Read `src/config/loader.js:230-275` (`validateMap`) and
  `src/runtime/state.js:1-217` end-to-end before editing. The
  `createState` branch structure matters for where the seed loop
  goes.
- Don't refactor `spawnLevelEntities` (lines 102-169). It is only
  called in the procedural branch and the two code paths should
  remain independent.
- `validateMap`'s third arg must be optional — other call sites
  (if any) and hypothetical test harnesses that synthesize maps
  should keep working. `entityGlyphs ?? null` at the top is enough.
- Preserve the exact text of the existing
  `unknown tile character '<ch>'` error. Tests in
  `test/loader.test.js` already pattern-match on it.
- For the collision error, include both kind and id in the message
  so an author can fix whichever definition is wrong:
  `glyph 'r' at map.tiles[3][12] matches multiple entities: being:rat, being:roach`.
- When writing the fixture, pick glyphs that do **not** collide with
  default tile chars (`#`, `.`, `>`, `<`) or `@`. Letters like `c`,
  `s`, and symbols like `$`, `!` are safe and mirror `pirate.yaml`.
- Do not add `pirate.yaml` itself to this repo — it lives outside
  the worktree, and this spec is engine-only. Test fixtures go
  under `test/fixtures/`.
- Run `npm test` locally before `spec report`. The pre-existing
  loader / runtime suites cover enough of the ambient surface that
  a regression will surface there.
