---
id: add-pirate-ninja-games
status: not-started
area: games
priority: 50
depends_on: []
description: Add the pirate and ninja YAML games to games/ and register them in the launcher manifest
---

# Add Pirate and Ninja Games

## Goal

Two externally-authored YAML games — a pirate-themed island raid and a
ninja-themed castle infiltration — exist outside the repo at
`~/pirate-game/pirate.yaml` and `~/ninja-game/ninja.yaml`. Bring both
into `games/` so they ship with the engine and add them to the
hand-maintained `games/index.json` so the browser launcher (see
`browser-game-launcher`) lists them alongside the four existing games.

## Acceptance Criteria

1. **Copy `~/pirate-game/pirate.yaml` to `games/pirate.yaml`** verbatim,
   then apply only the minimum edits required to pass the engine's
   loader/validator (see criterion 4). Do not reformat, re-comment, or
   restructure the file.

2. **Copy `~/ninja-game/ninja.yaml` to `games/ninja.yaml`** under the
   same rule.

3. **Append two entries to `games/index.json`** (after the four
   existing entries, in this order):
   ```json
   { "id": "pirate", "title": "Treasure of the Cursed Cove",      "description": "A single-island raid: cleave through the cursed crew, unlock the captain's vault, and seize the doubloon hoard before the Kraken stirs." },
   { "id": "ninja",  "title": "Shadow of the Moonless Castle",    "description": "A single-night infiltration: slip past patrol dogs and samurai spirits, raid the daimyo's vault, then face the Oni in his cistern." }
   ```
   - The `id` must satisfy `isValidGameId` and resolve via
     `getCandidatePaths(id)` against `games/<id>.yaml` — that's why the
     manifest slugs are `pirate` / `ninja` (short, URL-friendly) even
     though the YAMLs' internal `meta.id` is `cursed-cove` /
     `moonless-castle`. This mirrors silly (manifest `silly` →
     `meta.id: silly-game`).
   - `title` mirrors each game's `meta.name`.
   - `description` is a one-line summary derived from the YAML's
     `meta.description`, ≤ ~150 chars to fit a launcher button
     subtitle. Trim the multi-line block scalar to a single sentence
     pair if needed.

4. **Both games load and run** in both the browser launcher and the
   CLI. Verify:
   - `npm run serve`, then click the "Treasure of the Cursed Cove"
     button on `http://localhost:8000/` → game boots, URL becomes
     `?game=pirate`, the player glyph (`@` / 🥸) appears on the south
     beach, arrow keys move, bump-attack on an adjacent crab works,
     `?` opens the help panel showing the configured bindings.
   - Same drill for "Shadow of the Moonless Castle" → URL `?game=ninja`,
     player on the dojo floor, movement and bump-attack work, help
     panel renders.
   - Direct deep-link `http://localhost:8000/?game=pirate` and
     `?game=ninja` both bypass the launcher and boot directly.
   - `node cli.js --game games/pirate.yaml` and
     `node cli.js --game games/ninja.yaml` both render the initial
     view without throwing. A few keypresses (move, then `q` to quit)
     confirm the input loop works.

5. **All schema/validator errors are fixed in the YAML, not the engine.**
   If `loadFromFile` or `loadFromString` throws on either game, edit
   the YAML to conform — rename a misnamed field, remove an unsupported
   one, fix a typo'd reference. **Do not modify** `src/config/loader.js`,
   `src/config/schema.js`, `src/runtime/session.js`, the renderer, or
   any other engine code to accommodate these games. If a fix would
   require an engine change, stop and report it as blocked rather than
   editing engine code.

6. **Existing tests pass unchanged.** `node --test` continues to
   succeed. The launcher manifest tests in
   `test/browser-interface.test.js` already exercise
   `parseManifest` against arbitrary entries, so adding two valid
   entries does not require new test code.

7. **No new tests required.** These games are standalone catalog
   entries verified by the manual run in criterion 4. Do not add them
   to any cross-game test fixture or smoke-test harness.

## Out of Scope

- **No engine changes.** Loader, schema, runtime, renderer, input
  layer, FOV, view — all untouched. See criterion 5.
- **No changes to existing games** under `games/` (silly, minimal,
  interact-demo, toy-hit-and-heal).
- **No changes to the launcher UI or `src/browser/manifest.js`.** The
  launcher already reads `games/index.json` and renders one button
  per entry; adding entries is enough.
- **No subdirectory layout for these games.** They ship as single
  `.yaml` files (matching minimal / interact-demo / toy-hit-and-heal),
  not as `games/<id>/game.yaml` directories like silly. If either
  game later grows ancillary assets, splitting it into a directory is
  a follow-up.
- **No rewriting of `meta.id`.** The internal `cursed-cove` /
  `moonless-castle` ids stay as the YAML authors wrote them; the
  manifest slug is the only externally-visible id.
- **No content edits beyond schema fixes.** Don't rebalance HP,
  rewrite flavor text, retune drop rates, or redesign maps. The
  games ship as-authored. If gameplay is broken (e.g. unwinnable),
  flag it in the completion report rather than patching.
- **No new manifest fields.** Stick to `id`, `title`, `description` —
  the launcher spec freezes the schema at exactly those three.

## Design Notes

**Why `pirate` / `ninja` as manifest slugs instead of `cursed-cove`
/ `moonless-castle`.** The slug is the URL parameter and the file
basename — both benefit from being short. The internal `meta.id` is
the engine's notion of game identity and reasonably differs from the
manifest entry's casual handle. Silly already establishes the pattern
(manifest `silly` → `meta.id: silly-game`), so this isn't a new
divergence.

**Why expect schema fixes.** Both YAMLs were authored against an
external mental model of the engine, not against this repo's
validator. Likely points of friction:
- Field name typos (e.g. `kind: container` vs. whatever the schema
  expects on items).
- `meta.player_archetype` — the loader may or may not accept
  free-form fields under `meta`.
- Action `flow` blocks with `pick_tile` — silly and interact-demo
  exercise this path; comparing should reveal any schema drift.
- Helper functions referenced in expressions (`slot_bonus`,
  `dir_toward`, `los`, `manhattan`, `line_of_sight`, `random`,
  `walkable`, `tile_at`, `has_item`, `equip_attack`, `equip_defense`)
  — most should already exist; any missing one is a blocker per
  criterion 5.

The fix surface is: rename or delete fields in the YAML, never
patch the engine. If the engine genuinely lacks a referenced helper
and there's no equivalent, that's a blocked report — not an
opportunity to land an engine change inside this task.

**Why the description is shortened from the YAML's `meta.description`.**
The YAMLs' descriptions are multi-line block scalars styled as
in-game flavor ("Yer marooned on a haunted isle..."). The launcher
button shows one line under the title; a 150-char summary reads
better there. The full flavor text remains in the YAML's
`meta.description` for the in-game intro / about screen.

**Touch list:**
- `games/pirate.yaml` — **new file**, copy of
  `~/pirate-game/pirate.yaml` with any minimal schema fixes applied.
- `games/ninja.yaml` — **new file**, same pattern from
  `~/ninja-game/ninja.yaml`.
- `games/index.json` — append two entries; preserve existing entries
  and trailing newline.

## Agent Notes

- **The source files live outside the worktree** at
  `~/pirate-game/pirate.yaml` and `~/ninja-game/ninja.yaml`. Read
  them with the `Read` tool using their absolute paths and write
  the contents into `games/pirate.yaml` / `games/ninja.yaml` via
  `Write`. Do not `cp` them; the worktree is self-contained.
- **Read `specs/tasks/browser-game-launcher.md` first** — it defines
  the manifest contract (entries are exactly `{id, title,
  description}`, all strings; `id` must satisfy `isValidGameId` and
  resolve via `getCandidatePaths`). Don't drift the schema.
- **Compare to `games/silly/game.yaml` and `games/interact-demo.yaml`**
  if a schema validation error is unclear — those files exercise the
  same DSL features (action flows, `pick_tile`, `apply_area`, tile
  `on_interact` hooks, AI conditions, status_rules, hud).
- **Validation workflow:**
  1. Copy each YAML in.
  2. Run `node cli.js --game games/pirate.yaml` and
     `node cli.js --game games/ninja.yaml` — the loader runs first,
     so any schema error surfaces immediately as a stack trace.
  3. Edit the YAML to fix the reported error. Repeat until each
     game renders an initial frame.
  4. Move to the browser launcher (`npm run serve`) and run the
     full criterion-4 checklist.
- **If the validator complains about something that looks
  legitimate but isn't supported** (e.g. `meta.player_archetype`),
  delete the field from the YAML rather than adding it to the
  schema. The schema is load-bearing for other games and its
  contract is not part of this task.
- **`node --test` after the YAML is in place** — confirms no
  existing test regressed (manifest parser, game-select helpers,
  loader smoke tests, etc.).
- **Don't update `README.md`, `AGENTS.md`, or any other docs.** The
  launcher catalog is self-documenting; the manifest entry's
  `description` is where users learn what each game is.
- **Final report should explicitly list any schema fixes** applied
  to the YAMLs (e.g. "removed `meta.player_archetype`", "renamed
  `kind: currency` → `kind: gold`") so the diff is reviewable
  without re-running the loader.
