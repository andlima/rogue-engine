# Interaction Flows

Interaction flows close the gap between "the game has an `attack` effect"
and "the player pressed `z`, picked *fireball* from a menu, aimed at a
tile, and the effect fired." A flow is a small state machine that an
action opts into by adding a `flow` list; each step asks the player for
one piece of input before the action's effects commit.

## Anatomy of a flow-bearing action

```yaml
actions:
  player:
    - id: cast_fireball
      requires:
        - "actor.mp >= 5"
      flow:
        - type: pick_option
          bind: chosen_option
          options:
            - id: fireball
              label: Fireball (5 MP)
              payload: { spell: fireball, radius: 1 }
        - type: pick_tile
          range: 5
          filter: "line_of_sight($origin, tile) and not tile.has_being"
          bind: target_tile
      effects:
        - type: apply
          target: actor
          measurement: mp
          delta: "-5"
```

- **`requires`** is checked twice: once before the flow begins, and
  again immediately before the effects fire. A condition that flipped
  false during targeting (e.g. the last arrow was spent) aborts the
  commit with no effects and no turn consumed.
- **`flow`** is an ordered list of step descriptors. Omitting `flow`
  fires the effects immediately, matching pre-spec behaviour.
- **`effects`** runs only after all steps resolve successfully. Each
  effect sees the full `bindings` map via the `$name` expression sugar.

## Step types

| Type             | Binds (default)   | Payload fields |
|------------------|-------------------|----------------|
| `pick_direction` | `$dir`            | `set: cardinal \| octal` |
| `pick_item`      | `$chosen_item`    | `source` (default `actor.inventory`), `filter` expr |
| `pick_tile`      | `$target_tile`    | `range` (positive integer), `filter` expr |
| `pick_being`     | `$target_being`   | `range`, `filter` expr |
| `pick_option`    | `$chosen_option`  | `options: [{ id, label, requires?, payload? }]` |
| `confirm`        | (no bind)         | `message` — declining cancels the flow |

Steps may set `bind:` to override the default binding name. All binding
names must be unique within a flow (load-time error).

## Implicit bindings

These are available inside any flow predicate or effect expression:

| Name       | Description                                           |
|------------|-------------------------------------------------------|
| `$origin`  | The actor's tile at the moment the flow began         |
| `$actor`   | The actor entity                                      |
| `$self`, `$player` | Aliases for `$actor`                          |

## Context-sensitive triggers

Multiple actions can bind the same trigger; the engine picks the first
whose `when` expression evaluates truthy.

```yaml
keymap:
  ">": descend_stairs
actions:
  player:
    - id: descend_stairs
      when: 'actor.tile.kind == "stairs_down"'
      effects: [{ type: transition_level, delta: 1 }]
    - id: no_stairs_here
      when: 'actor.tile.kind != "stairs_down"'
      effects: [{ type: message, text: "There are no stairs here." }]
```

- Order in `actions.player` is the tie-breaker — first match wins.
- Two actions sharing a trigger with no disambiguating `when` emit a
  load-time warning (they still load).
- An action with no `when` always matches.

## Cancellation and turn cost

- Any flow step can be cancelled (ESC in the ANSI renderer) by
  dispatching `{ type: 'flow_cancel' }`.
- Cancelling aborts the entire flow; **no effects run**, **no turn is
  consumed**, no partial bindings persist.
- Starting a flow is free — the turn is only consumed when the final
  step commits and effects fire.
- Opening a `ui.panel` is always free; selecting a row may be a turn,
  but only because the action triggered by `on_select` is a turn.

## Tile interaction hooks

Each entry in the top-level `tiles:` section may declare three hooks,
each a standard effect list:

- **`on_enter`** — fires after a being moves onto the tile.
- **`on_stand`** — fires once per turn while a being stands on the tile.
- **`on_interact`** — fires when the player issues the built-in
  `interact` action (default key `SPACE`, override via `keymap`).

Hooks run in a standard effect scope with `self` bound to the being on
the tile. `on_interact` desugars to an auto-registered `interact`
player action that dispatches `actor.tile.on_interact` if present, or
emits *"Nothing to interact with here."* otherwise. The latter does
not consume a turn.

Two effect types pair well with hooks and targeted flows:

- **`apply_area`** — apply a measurement delta to every being within a
  chebyshev radius of an origin tile. Useful for area-of-effect spells
  like fireball. Fields: `origin` (tile expression, default = caster
  tile), `radius` (positive integer), `measurement`, `delta`, and
  optional `exclude_actor: true` to skip the caster.
- **`transform_tile`** — mutate the map character at a tile. Fields:
  `char` (the new character; its tile config carries kind/glyph/color),
  optional `at` (tile expression; default = actor's tile). Use this to
  swap a locked door for an open one, reveal secret passages, etc.

Both effects honor per-effect `when:` gates, so authors can keep the
hook schema as a flat effect list while still gating on predicates like
`has_item("key")`.

## Flow state on GameState

`GameState.flowState` is `null` when no flow is active, otherwise:

```js
{
  actionId: string,         // id of the originating player action
  stepIndex: number,        // 0-based index into action.flow
  bindings: { [name]: val}, // bindings accumulated so far
  origin: { x, y },         // actor tile at flow start
}
```

`dispatch` is the sole mutator. Three action tags drive flows:

| Dispatch                                    | Effect |
|--------------------------------------------|--------|
| `{ type: 'action', trigger: 'z' }`         | Resolves a flow-bearing action; enters `flowState` |
| `{ type: 'flow_input', kind: ..., ... }`   | Advances the current flow step |
| `{ type: 'flow_cancel' }`                  | Aborts the flow without effects or turn cost |

Effects never see the flow machinery; by the time they run, flows have
collapsed into a normal effect pipeline.

## Input bindings

Key bindings live in the top-level `input:` section — see
`docs/input-bindings.md` for the full schema, vocabulary, context stack,
sequences, and validation rules. The legacy `keymap:` block is still
accepted for back-compat and the legacy `trigger:` field on player
actions continues to parse, but new games should use `input.bindings`.

Flow-context meta-commands (bindings declared with `context: flow`)
remain active while a flow is running. A key event is first offered
to the flow runner; if the runner declines it (not an expected step
input), resolution falls through to `input.bindings` in the `flow`
context, then escalates to `map`.

## Loader validation

The loader rejects (with file-line-ish path prefixes):

- Flow step referencing an unknown prompt id (`ui.prompts.<id>`)
- Duplicate `bind` names within a single flow
- Effects referencing `$names` the flow does not produce
- `ui.panels.<id>.on_select` referencing an unknown action id
- `pick_tile` / `pick_being` with a non-positive or non-integer `range`
- `$name` binding refs outside a flow-enabled action

And warns on:

- Multiple actions sharing a trigger with no disambiguating `when`
- `on_interact` hooks defined with no keymap entry bound to `interact`
