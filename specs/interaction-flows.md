---
id: interaction-flows
status: not-started
area: engine
priority: 50
depends_on: [dsl-actions-world-rendering]
description: DSL for multi-step player input flows, context-sensitive tile interactions, and declarative UI panels
---

# Interaction Flows

## Goal

Close the gap between "the game has an `attack` effect" and "the player
pressed `z`, picked *fireball* from a menu, aimed at a tile, and the
effect fired." The current action DSL binds a trigger to a flat list of
effects — fine for `move_n` or `wait`, but not enough to describe
quaffing a potion, casting a spell, descending stairs, opening a
container, or any other interaction that needs the player to *choose*
something (an item, a direction, a target tile, a menu option) before
the effects run. This spec adds **interaction flows**, **tile
interaction hooks**, and a small **UI panel DSL** so those interactions
are declarable in YAML with no engine-code changes.

## Acceptance Criteria

1. **Interaction flows** — `actions.player.<id>` gains an optional
   ordered `flow` list whose entries are *step descriptors*. If `flow`
   is omitted, the action fires immediately (current behavior). The
   step types supported in this spec, each with documented schema in
   `docs/interaction-flows.md`:
   - `pick_item` — prompt the player to choose an item from an
     inventory source (default: `actor.inventory`), filtered by a
     predicate expression (e.g. `item.kind == "consumable"`). Binds the
     chosen item to a name (`bind: chosen_item`).
   - `pick_direction` — cardinal or 8-way (author picks via
     `set: "cardinal" | "octal"`). Binds `$dir`.
   - `pick_tile` — targeting reticle constrained by an optional
     `range` (integer) and an optional predicate expression (e.g.
     `line_of_sight($origin, tile) and not tile.has_being`). Binds
     `$target_tile`.
   - `pick_being` — `pick_tile` restricted to tiles containing a being
     matching a predicate. Binds `$target_being`.
   - `pick_option` — menu of labeled options declared inline or
     referenced by id (e.g. a spell list). Each option carries a label,
     optional `requires` expression, and a payload object. Binds
     `$chosen_option`.
   - `confirm` — yes/no prompt with a templated message. Binds nothing;
     cancelling aborts the flow (see criterion 6).

2. **Context-sensitive triggers** — `actions.player.<id>` gains an
   optional `when` expression evaluated **before** the flow begins.
   Multiple actions may bind to the same key; the engine selects the
   first whose `when` evaluates true (or has no `when`). Example:
   `>` bound first to `descend_stairs` (`when: actor.tile.kind ==
   "stairs_down"`) and then to a fallback action that prints
   "There are no stairs here.". Document the first-match rule in
   `docs/interaction-flows.md` and mirror it in diagnostics —
   duplicate-trigger ambiguity (two actions share a key and neither has
   a `when`, or both would always match) is a load-time warning.

3. **Tile interaction hooks** — `tiles.<id>` (the per-tile-symbol
   rendering config from `dsl-actions-world-rendering`) gains:
   - `on_enter` — effect list dispatched after a being moves onto the
     tile
   - `on_stand` — effect list dispatched at end-of-turn while a being
     stands on the tile (fires once per turn, not every sub-step)
   - `on_interact` — effect list dispatched when the built-in
     `interact` player action targets this tile
   All three are lists of standard effects from
   `dsl-actions-world-rendering`; they run in the same effect scope
   with `self` bound to the being on the tile. The built-in `interact`
   action is bound to a documented default key (`SPACE`, override via
   `keymap`) and desugars to "dispatch `actor.tile.on_interact` if
   present, else do nothing and emit a message".

4. **UI surface DSL** — a new top-level `ui` section in the YAML:
   - `ui.panels` — declarative panel definitions keyed by id. Each
     panel has:
     - `open_on` — a key or a list of keys; opening a panel is *not* a
       turn-consuming action
     - `title` — templated string
     - `data` — an expression returning a list (e.g.
       `actor.inventory where item.kind == "consumable"`)
     - `columns` — list of `{ header, field }` where `field` is an
       expression over the row binding (`row.name`, `row.glyph`)
     - `on_select` — optional: an effect list (or an action id) to run
       with `$selected_row` bound when the player picks a row
   - `ui.prompts` — reusable named prompt configs for flow steps.
     Flow steps may reference a prompt by id instead of inlining one.
   - `ui.hud` — augments (does not replace) `rendering.hud` from the
     previous spec; this spec only adds support for a **target
     indicator** surface (a glyph overlay while `pick_tile` /
     `pick_being` is active) and a **prompt banner** (top- or
     bottom-line string while any flow step is active).

5. **Expression-language additions** — new built-ins available
   anywhere expressions are evaluated, each documented in
   `docs/expressions.md`:
   - `line_of_sight(from_tile, to_tile)` — boolean, piggybacks on
     whichever FOV algorithm the prior specs established (or
     introduces the simplest working one — symmetric shadowcasting is
     fine)
   - `chebyshev(a, b)`, `manhattan(a, b)`, `euclidean(a, b)` —
     integer/float tile distances
   - `in_range(from_tile, to_tile, r, metric = "chebyshev")` — sugar
     over the distance built-ins
   - `where` — a list comprehension operator: `xs where <expr>` evaluates
     `<expr>` per element with the element bound as `item` and returns
     a filtered list. Only used in `data` / filter positions, not in
     general arithmetic.
   - Binding references: `$chosen_item`, `$target_tile`, `$dir`,
     `$target_being`, `$chosen_option`, `$selected_row`, plus any
     author-declared `bind:` name. `$name` resolves inside the current
     flow scope only; referencing it outside a flow or before it is
     bound is a load-time error.

6. **Cancellation and turn cost contract** — documented explicitly in
   `docs/interaction-flows.md`:
   - Any flow step can be cancelled (ESC in the ANSI renderer).
     Cancelling aborts the entire flow; **no effects run**, **no turn
     is consumed**, no partial bindings persist.
   - Effects fire only after **all** steps resolve successfully. The
     action's `requires` is re-checked immediately before effects fire
     (not just at flow start), so a condition that became false during
     targeting (e.g. the last arrow was used) blocks the commit.
   - Opening a `ui.panel` is always free (not a turn). Selecting a row
     via `on_select` follows the action it triggers, which may or may
     not be a turn.

7. **FlowState in GameState** — the engine introduces a `flowState`
   field on `GameState` holding `{ actionId, stepIndex, bindings }`
   when a flow is mid-execution; `null` otherwise. `dispatch` remains
   the sole mutator — it accepts both immediate actions and flow-step
   inputs as tagged action objects (`{ type: "flow_input", ... }`).
   Effects never see the flow machinery; by the time they run, flows
   have collapsed into a normal effect pipeline.

8. **Loader validation** — new load-time errors:
   - Flow step references an unknown prompt id
   - `bind:` names collide within a single flow
   - Effects reference `$names` that the flow's steps do not produce
   - `on_interact` tiles referenced by no keymap entry (warning, not
     error — authors may want invisible hooks)
   - `ui.panels.<id>.on_select` references an unknown action id
   - Multiple actions sharing a trigger where none can be proven
     mutually exclusive (warning; suggest adding `when` expressions)
   - `pick_tile` with an unreachable `range` (≤ 0 or non-integer)

9. **Tests**:
   - Unit tests for each step type: happy path, cancellation, binding
     propagation, predicate filtering
   - Unit tests for the new expression built-ins
   (`line_of_sight`, `in_range`, `where`)
   - A `games/interact-demo.yaml` exercising the four motivating
     interactions:
     - Quaff potion: `q` → `pick_item` filtered to
       `kind == "consumable"` → `apply` heal effect
     - Descend: `>` → `when: actor.tile.kind == "stairs_down"` →
       `transition_level` (no flow steps); fallback action for
       "no stairs here"
     - Cast fireball: `z` → `pick_option` (spell list) →
       `pick_tile` with `range: 5` and LOS predicate →
       `apply` damage in a 1-tile radius via `spawn`/iteration
     - Unlock door: standing on a locked-door tile, press interact →
       `on_interact` with `requires: actor.inventory.has("key")` →
       change tile kind to `door_open`
   - A scripted integration test: driving a fixed input sequence
     (`[z, f, RIGHT, RIGHT, ENTER]`) through `dispatch` produces the
     asserted end state. Cancelling at any point leaves state
     unchanged modulo the `flowState` reset.
   - Loader-validation tests covering each failure class in
     criterion 8.

10. **Renderer contract** — both renderers declared in the previous
    spec must consume the new surfaces:
    - The ANSI renderer gains: prompt banner rendering, inventory /
      menu panels (bordered box with a cursor), target reticle overlay
      on the map while `pick_tile` / `pick_being` is active.
    - The canvas renderer stub gains stub methods
      (`drawPanel`, `drawPrompt`, `drawReticle`) that accept the same
      semantic descriptors the ANSI renderer consumes and throw
      `"not implemented"`. The shared contract is documented in
      `docs/rendering.md` (extended from the previous spec).

## Out of Scope

- Mouse / touch input — keyboard only in this spec
- Animation, tweening, particle effects
- Drag-and-drop inventory, hotbars, quick-slots
- Accessibility features (screen reader output, high-contrast modes) —
  worth a dedicated spec later
- YAML-authored custom step types — step types remain an engine-code
  registry; flows compose existing ones (same pattern as effects)
- AI using flows — monsters pick targets in their action `condition`
  and effects, never through prompts
- Full canvas renderer implementation (still a stub, per the previous
  spec)
- Save/load of an in-progress flow across sessions — cancel-on-resume
  is the intended behavior for this spec; revisit if save/load lands
- Multi-select or quantity prompts (`pick_items` plural) — add when a
  concrete game needs them
- Networking, shared UI state, spectator mode

## Design Notes

- **Flows are data, not callbacks.** A flow is an array of step
  descriptors parsed at load time. The engine's flow runner interprets
  them. Never accept inline JS, template strings that eval, or anything
  that breaks the pure-YAML-in, pure-data-out contract.
- **The flow runner is a small state machine.** One `FlowState`
  attached to `GameState`; each `flow_input` action advances it; when
  the last step resolves the runner emits the action's effects via the
  same `dispatch` path a flow-less action uses. This keeps effect
  handlers ignorant of flows.
- **Player-only.** Do not introduce a parallel flow system for AI.
  Monster targeting lives in expressions over the current state. If an
  AI wants to "pick the closest wounded ally", that's a `pick_being`-
  shaped expression, not a flow.
- **`on_interact` is sugar.** It desugars to an auto-registered
  interact player action with `when: actor.tile.kind == "<tile>"` and
  `effects: <tile>.on_interact`. Document the desugaring so the schema
  stays small and there's no "two ways to do the same thing" trap.
- **Cancellation semantics are load-bearing.** Get them wrong and
  spellcasting feels like a commitment trap. The rule is: cancelling
  leaves state identical (modulo `flowState` reset) and does not
  consume a turn. State that time-based effects want to observe (e.g.
  "player is aiming") should read `flowState`, not a side-effect flag.
- **Binding resolution shares machinery with expressions.** `$name` is
  just another path root, same as `actor.` or `state.`. Implement it
  in the existing resolver rather than a parallel substitution pass.
- **Error quality again.** If a flow effect references `$chosen_weapon`
  but the flow only binds `chosen_item`, the error should be
  `actions.player.cast.effects[0]: unknown binding '$chosen_weapon'
  (bound in this flow: $chosen_item)`.
- **Keymap layer.** Introduce a small `keymap:` section at the top
  level (`{ "q": "quaff", ">": "descend_stairs", ... }`) so key
  bindings live in one place instead of scattered across each action's
  `trigger`. Existing `trigger:` values continue to work and resolve
  through the same machinery; the keymap is the preferred form for new
  games. Document the precedence.

## Agent Notes

- Read `AGENTS.md`, `CLAUDE.md`, `engine-bootstrap.md`, and
  `dsl-actions-world-rendering.md` before editing. This spec
  explicitly builds on the action, effect, and expression primitives
  from the previous spec — duplicating them here was avoided on
  purpose.
- Implementation order that keeps each step testable:
  1. Expression-language additions (`line_of_sight`, distance helpers,
     `where`, `$binding` resolution) + unit tests
  2. `FlowState` model on `GameState` + the flow-runner state machine
     + unit tests driven by synthetic input streams
  3. Each step type one at a time — start with `pick_direction` (no
     filter, no UI) as the cheapest end-to-end proof, then
     `pick_item`, `pick_tile`, `pick_being`, `pick_option`, `confirm`
  4. Loader validation for flows, bindings, and panel references
  5. Tile `on_enter` / `on_stand` / `on_interact` hooks and the
     interact-key desugaring
  6. `ui.panels` / `ui.prompts` schema and ANSI renderer consumption
  7. `games/interact-demo.yaml` and the scripted integration test
- Common pitfalls to avoid:
  - Letting a step mutate state (e.g. `pick_item` immediately consumes
    the item). Steps *only bind*. Effects mutate.
  - Running effects before the final step resolves. The commit point
    is "last step resolved AND `requires` still true".
  - Re-implementing FOV. Reuse whatever the prior specs settled on; if
    none exists, add the smallest working algorithm and note it in the
    PR as generic engine work.
  - Adding an AI flow system. Don't.
  - Forgetting that opening a panel is free and selecting a row may
    not be — the turn cost lives with the action, not the panel.
- If you discover that a motivating interaction (quaff / descend /
  cast / unlock) can't be expressed cleanly with the step types in
  criterion 1, flag it in the PR description rather than quietly
  bolting on a new step type. The set is deliberately small.
