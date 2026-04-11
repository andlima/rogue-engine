---
id: silly-game-port
status: not-started
area: engine
priority: 50
depends_on: [dsl-actions-world-rendering]
description: Port silly-game's full behavior to pure YAML and assert parity via a scripted trace
---

# Silly-Game Port

## Goal

Prove that rogue-engine's data-driven DSL (delivered by `engine-bootstrap`
and `dsl-actions-world-rendering`) is expressive enough to reproduce the
entire gameplay of `andlima/silly-game` — monsters, items, combat, FOV,
dungeon layout, idol, five-level descent, win/loss — as a *pure YAML*
game definition with **no code changes** to the engine core. A parity
test suite asserts that a scripted playthrough produces the same
observable state transitions as silly-game, turning the DSL's
expressiveness claim into something continuously verified.

Secondary goal: the port doubles as the engine's showcase and
remixability demo. A user should be able to read `games/silly/game.yaml`,
change ten lines, and end up with a meaningfully different game.

## Acceptance Criteria

1. **Game definition** under `games/silly/`:
   - One or more YAML files forming the silly-game definition. If split,
     the loader must support a documented "include" or "merge" mechanism;
     otherwise a single `game.yaml` is fine.
   - Every one of silly-game's hard-coded constants and rules is
     represented as data. See criterion 2 for the enumerated checklist.
   - No JavaScript changes to the engine core are permitted to land the
     content. Engine bug fixes uncovered during the port are allowed, as
     are new generic effect types or expression built-ins — but every
     such change must be justified in the PR as "generic, not
     silly-specific".

2. **Parity checklist** — each item encoded as data, verified by the
   parity test:
   - 4 monster types (`rat`, `skeleton`, `bear`, `dragon`) with the exact
     hp / attack / defense / awareness / min-gold / max-gold numbers from
     `src/game.js`
   - 4 equipment types (`dagger`, `sword`, `helmet`, `shield`) with the
     correct slots, stat bonuses, and glyphs/colors
   - Food item (+10 hp on use, consumable)
   - Gold item (pickup-as-currency, value scales with level)
   - Idol item (costs `player.max_hp` gold, grants `+5` max hp and full
     heal, only spawns on levels 2–4)
   - Five-level descent with per-level monster-bias roll matching
     silly-game's `pickMonsterType` (dragon from L4, bear from L3, else
     rat/skeleton)
   - Dungeon generator parameters matching silly-game's room-count,
     room-size, and corridor behavior closely enough for the parity
     trace to hold
   - Combat formula: `max(0, attacker.attack + attacker.equip_bonus
     - defender.defense + variance(-1, +1))`
   - Awareness-based monster AI with line-of-sight via FOV, Manhattan
     distance for threat range, cardinal-only greedy move, "staggered"
     one-turn attack cooldown
   - Recursive shadowcasting FOV with silly-game's torch radius
   - Win condition: descending the stair on level 5
   - Loss condition: `player.hp <= 0`, tracking cause of death
   - Stat tracking: monsters killed, damage dealt/taken, food used,
     steps taken, gold collected, idol offerings
   - Message log with the same phrasing silly-game uses (strings are
     data, so they live in the YAML, not the engine)
   - Equipment upgrade rule: new equipment is only equipped if its bonus
     exceeds the current slot's bonus — if any piece of the DSL cannot
     express this cleanly, propose an extension in the
     `dsl-actions-world-rendering` spec layer instead of hard-coding it

3. **Deterministic playthrough** (`test/silly-parity.test.js`):
   - Runs the engine with `games/silly/game.yaml` under a fixed seed
   - Executes a scripted action sequence that exercises, at minimum:
     move on open floor, bump a wall, attack and kill a rat, pick up a
     dagger, pick up food, use food, swap to a sword upgrade, descend a
     stair, attack and be killed by a bear or dragon
   - Asserts the observable game-state transitions (player position, hp,
     inventory, equipment, level, message log, game-over flags) against
     a reference trace checked in at `test/fixtures/silly-parity.trace.json`
   - The reference trace is generated from silly-game's own source with
     the same seed (vendor silly-game into `test/fixtures/silly-ref/` if
     needed for the generator; the vendored copy does not ship with the
     engine runtime) OR is hand-authored from a close reading of
     `src/game.js` and a matching silly-game run

4. **ANSI renderer reproducing silly-game's CLI look**:
   - Grid display with FOV shading, hp bar, inventory line, recent
     message log
   - Optional emoji toggle like silly-game's `t` key — nice-to-have
   - The renderer consumes only `rendering` section + `GameState`; it
     has no silly-specific code paths

5. **Remixability doc** — `games/silly/README.md` with at least three
   worked examples of YAML tweaks and what they change:
   - "Triple the dragons on level 5"
   - "Rename `gold` to `souls` and double food healing"
   - "Add a 5th level with a custom boss monster"
   - Each example shows the exact YAML diff and describes the observed
     in-game change

## Out of Scope

- Browser / canvas renderer (CLI only in this spec)
- Web Audio procedural sound
- New content beyond silly-game's scope — no new monsters, items, or
  mechanics unless they serve a remixability example in `games/silly/README.md`
- Editor/authoring tooling
- Save / load game state
- Multiplayer
- Extending the DSL beyond what `dsl-actions-world-rendering` provides,
  *unless* the extension is strictly generic and gets called out in the
  PR description for future inclusion in the DSL spec

## Design Notes

- **Parity fidelity bar**: the reference trace is the contract. If the
  parity test passes on a representative scripted playthrough, the port
  is accepted — we are not asserting bit-identical dungeon layouts across
  every seed, only that, given a seed, the engine's state transitions
  match. Pick one or two seeds, make them canonical.
- **When parity is blocked by a DSL gap**: extend the `dsl-actions-world-
  rendering` spec layer with a *generic* mechanism (new effect type,
  new expression built-in, new world rule knob) rather than hard-coding
  silly-specific logic. Log the gap + the generic fix in the PR. A
  handful of such extensions is expected — that is exactly what a port
  exercise is for.
- **Strings are data**: the message log phrasing ("You hit the Rat for 3
  damage.") lives in the YAML via the `message` effect's template. The
  engine must not hard-code any silly-game strings.
- **Seeded RNG**: both the parity test and the reference trace generator
  depend on a deterministic, seeded RNG threaded through `GameState`.
  If that thread was not in place after spec 2, fixing it is the first
  task here.
- **Vendoring silly-game for reference generation**: copy the minimum
  source needed to run a scripted trace into `test/fixtures/silly-ref/`
  with an upstream commit hash captured in a `SOURCE.md`. This is a
  test-time dependency only; it does not ship in the engine runtime.

## Agent Notes

- Read `AGENTS.md`, `CLAUDE.md`, and both earlier specs
  (`engine-bootstrap`, `dsl-actions-world-rendering`) before starting.
- Read silly-game source thoroughly — especially `src/game.js`,
  `src/dungeon.js`, and `src/fov.js`. Transcribe the constants into YAML
  *exactly*; do not re-derive or "improve" them.
- Suggested order:
  1. Get a minimal `games/silly/game.yaml` loading without validation
     errors — measurements, beings, items only
  2. Add actions (move, attack, use food, descend, interact-with-idol)
  3. Add world rules (levels, spawn tables, win/loss)
  4. Add rendering section; manually smoke-test the ANSI renderer
  5. Vendor silly-game reference, generate or hand-author the trace
  6. Wire up the parity test; iterate until green
  7. Write `games/silly/README.md` with the three remixability examples
- **Common pitfall**: hard-coding any silly-specific logic in JS. If you
  are tempted, stop and ask whether a generic DSL extension would solve
  it. The whole point of this spec is to *prove* you never need to.
- If the reference trace is brittle against RNG changes, prefer
  asserting on coarser invariants (cumulative damage, monsters killed,
  inventory contents) over exact-position frame-by-frame equality.
