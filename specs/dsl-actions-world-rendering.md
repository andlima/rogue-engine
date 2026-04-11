---
id: dsl-actions-world-rendering
status: not-started
area: engine
priority: 50
depends_on: [engine-bootstrap]
description: Extend the YAML DSL with actions, effect expressions, world rules, and rendering config
---

# Actions, World Rules, and Rendering DSL

## Goal

Extend the rogue-engine YAML schema so that the *verbs* of a game (actions
and their effects), the *world rules* (dungeon generation, level
progression, win/loss conditions), and the *rendering* (glyphs, colors,
visual hints) are all expressible as data. After this spec, almost every
hard-coded rule in a silly-game-style roguelike should be describable in
YAML with no JavaScript changes — setting up `silly-game-port` to reproduce
full silly-game behavior purely from config.

## Acceptance Criteria

1. **Actions section** in YAML, loaded and validated by the loader:
   - `actions.player` — keyed actions the player can issue
     (`id`, `trigger` — a key or logical input like `"move_n"` or `"use"`,
     optional `requires` — list of precondition expressions,
     `effects` — ordered list of effect objects)
   - `actions.ai` — actions monsters can take, keyed by id, each with a
     `condition` expression (when to pick it) and an ordered `effects` list.
     The engine's monster turn selects one matching action per monster per
     turn using a priority/first-match rule — document which.
   - Effects are tagged objects of the form
     `{ type: "<effect>", ... }`. The DSL never lets YAML define a brand new
     effect *type*; it composes ones built into the engine.

2. **Expression language** — a small pure-functional expression language
   used in `requires`, `condition`, effect fields, measurement `max`, and
   win/loss conditions. Document the grammar in `docs/expressions.md`.
   Minimum features:
   - Numeric literals, string literals, booleans
   - Arithmetic (`+ - * /`, integer division, `%`), comparisons
     (`== != < <= > >=`), boolean ops (`and or not`)
   - Built-in functions: `min`, `max`, `clamp`, `abs`, `random(lo, hi)`,
     `roll(n, sides)`
   - Measurement / attribute references via dotted paths:
     `actor.hp`, `target.defense`, `actor.equipped.weapon.bonus`,
     `state.level`, `player.inventory.gold`
   - Tag predicates: `actor.has_tag("undead")`, `target.kind == "consumable"`
   - Errors on unknown references caught at **load time** (after the full
     definition is known) — not at turn time. Runtime-only errors (e.g.
     divide by zero) return `0` and push a warning, rather than crashing.
   - Expressions are pure: no side effects, no mutation. All state changes
     happen in effects.

3. **Effect library** — at minimum these effect types, each with unit tests:
   - `apply` — change a measurement on a target:
     `{ type: apply, target: self|actor|target|tile|player, measurement: hp, delta: "<expr>" }`
     where `delta` is evaluated as an expression and added (clamped by the
     measurement's declared min/max)
   - `set` — set a measurement to an absolute value
   - `move` — cardinal move: `{ type: move, dir: <expr|literal> }`
   - `spawn` — add an entity (being or item) at a tile
   - `remove` — delete an entity
   - `equip` — install an item into a being's equipment slot
   - `pickup` — move an item from the tile into a being's inventory
   - `message` — push a templated string into the message log; the
     template uses `{actor.name}`, `{target.name}`, `{damage}` style
     placeholders bound from the current effect scope
   - `transition_level` — descend or ascend (parameter: `delta`, default 1)
   - `win` / `lose` — terminal states, each taking an optional `reason`

4. **World section** in YAML:
   - `world.levels` — either an explicit list of levels or a template:
     `count`, plus per-level overrides indexed by level number (`{ "3":
     { spawn_bonus: ... } }`)
   - `world.dungeon` — generator params: `width`, `height`, room count
     range, room size range, corridor style (`straight` | `l_shaped`),
     seed handling. Generator must be capable of producing silly-game-
     compatible layouts in the next spec.
   - `world.spawn_tables` — per-level weighted tables for beings and items,
     with optional `requires` expressions (e.g. `state.level >= 4`)
   - `world.win_conditions` / `world.loss_conditions` — lists of
     expressions; if any is true at the end of a turn, the run terminates
     with the corresponding effect
   - `world.starting_state` — player archetype, starting inventory and
     measurements, starting level number

5. **Rendering section** in YAML (renderer-agnostic):
   - `rendering.tiles` — per-tile-symbol glyph and color override
   - `rendering.beings` — per-being glyph and color override (falling back
     to `beings.<id>.glyph`/`color` from the core schema)
   - `rendering.items` — per-item glyph and color override
   - `rendering.status_rules` — optional conditional rules like
     `{ when: "actor.hp < actor.max_hp / 4", glyph_color: "red" }`
   - `rendering.hud` — declarative HUD description: which measurements to
     show, how, and the message-log size
   - Both an ANSI renderer (required) and a placeholder canvas renderer
     stub (required, to prove the contract is renderer-agnostic — it can
     be a class that accepts rendering config and exposes a `draw(state)`
     method that throws `"not implemented"` with a TODO link) consume the
     same `rendering` section from the loaded definition.

6. **Validation** — the loader rejects at load time:
   - Expressions that reference unknown measurement ids, being ids, or
     item ids
   - Actions that reference undefined effect types
   - Spawn tables referencing unknown being/item ids
   - Win/loss conditions that fail to parse
   - `rendering` overrides that reference unknown ids

7. **Tests**:
   - Expression evaluator has a focused unit test suite covering each
     built-in, each operator, measurement refs, tag checks, and each error
     mode
   - Effect handlers each have a unit test demonstrating the state
     transition they produce
   - End-to-end: a small `games/toy-hit-and-heal.yaml` describing two
     beings (a puncher and a healer) and three actions (attack, heal,
     wait) can be loaded and run for 10 scripted turns with
     deterministic, asserted state transitions
   - Loader validation rejects at least one bad example per failure mode
     in criterion 6

## Out of Scope

- Porting silly-game's full content — lives in `silly-game-port`
- Canvas renderer implementation (only the stub + contract is required)
- Procedural audio
- Saving and loading game state
- Authoring tooling (YAML schema autocomplete, editor plugins)
- Networking or multiplayer
- Scripted cutscenes, dialogue trees, quest logs
- Defining new effect *types* from YAML (games compose existing ones)

## Design Notes

- **Parser**: hand-written recursive-descent is fine for the expression
  language. Do not pull in a parser generator — the grammar is small and
  the zero-dep bar from `engine-bootstrap` still applies.
- **Scope object**: each effect runs against a scope that binds `self`,
  `actor`, `target`, `tile`, `state`, `player`. Define this scope shape
  once in code and document it once in `docs/expressions.md`.
- **Determinism**: all randomness (in `random`, `roll`, and the spawn
  tables) must flow through a seeded RNG threaded through `GameState`, so
  the next spec's parity tests can assert deterministic traces. If
  `engine-bootstrap` did not already thread an RNG, introduce one here.
- **Immutability**: effects return a new state; they do not mutate.
  Chaining effects in an action means folding over `(state, effect) →
  state'`.
- **Effects are the extensibility boundary**. New mechanics come as new
  effect types registered in JS, not as YAML schema changes. Keep the
  registry small and obvious.
- **Validation error quality**: if an expression references
  `actor.defence` (typo), the error should be
  `actions.player.attack.effects[0].delta: unknown path 'actor.defence' (did you mean 'actor.defense'?)`.
  Near-miss suggestions using Levenshtein ≤ 2 are a nice-to-have; exact-
  match errors are mandatory.
- **AI action selection**: prefer "first matching action in list order" for
  determinism. Priority fields can come later if needed.

## Agent Notes

- Build the expression evaluator and its tests **first**. Everything else
  depends on it — the loader can't validate expressions that it can't
  parse, and effects can't use expressions that can't evaluate.
- Implementation order that keeps each step testable:
  1. Expression parser + AST + evaluator + tests
  2. Loader-time validator that walks expressions and checks refs
  3. Effect handlers one at a time (each with a unit test)
  4. Action dispatcher (player + AI) wired into `dispatch`
  5. World rules (dungeon gen params + spawn tables + win/loss)
  6. Rendering section consumption in the ANSI renderer
  7. The `toy-hit-and-heal.yaml` end-to-end test
- Preserve the functional-immutable style from `engine-bootstrap`. No
  mutating `state.player.hp = ...`; always build and return a new state.
- The canvas renderer stub exists only to *prove* the data contract. Do
  not over-invest — it can be 20 lines. It just needs to accept the
  rendering config and a `GameState` without knowing the specific game.
- If you discover a piece of silly-game behavior that can't be expressed
  with the effects in this spec (e.g. the idol's "cost = current maxHp"
  mechanic, the equipment-upgrade "only if better" rule), flag it in the
  PR description so `silly-game-port` can either extend the DSL here or
  negotiate a workaround.
