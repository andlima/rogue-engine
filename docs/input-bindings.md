# Input Bindings

Input bindings are the authoritative, data-first keymap for a rogue-engine
game. The top-level `input:` section declares every key the player can
press, in one place, with one line per binding. Both renderers consume
the same generated help screen; rebinding a key never requires touching
JS.

## Minimum viable example

Copy this into a new game YAML to get a working control scheme:

```yaml
input:
  bindings:
    # movement
    - { keys: [UP,    k], action: move_n }
    - { keys: [DOWN,  j], action: move_s }
    - { keys: [LEFT,  h], action: move_w }
    - { keys: [RIGHT, l], action: move_e }
    # actions
    - { key: "q",     action: quaff }
    - { key: "z",     action: cast }
    - { key: ">",     action: descend_stairs }
    - { key: "SPACE", action: interact }
    - { key: ".",     action: pass_turn,   label: "wait" }
    # sequences and modifiers
    - { sequence: [g, g], action: rest_until_full }
    - { key: "CTRL+d",    action: debug_dump,  when: state.debug }
    # flow-context meta-commands
    - { key: "?",   action: open_help, context: flow }
    - { key: "ESC", action: cancel,    context: flow }
  help:
    title: "Commands"
    sections:
      - { header: "Move",    actions: [move_n, move_s, move_e, move_w] }
      - { header: "Actions", actions: [quaff, cast, descend_stairs, interact, pass_turn] }
      - { header: "System",  actions: [open_help] }
```

## The `input` section

### `input.bindings`

Ordered list of bindings. Each entry declares **exactly one** of
`key`, `keys`, or `sequence`:

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | A single key name (see vocabulary below) |
| `keys` | string[] | Aliases — multiple keys for the same binding |
| `sequence` | string[] | Ordered chord (minimum two elements) |
| `action` | string | Target action id — must exist under `actions.player` or be a built-in |
| `context` | string | One of `map` (default), `panel`, `flow`, `targeting`, or a custom id |
| `when` | string | Expression — binding applies only when truthy |
| `label` | string | Overrides the action's `label` in the help screen |
| `disabled` | bool | Match the key but fire nothing — swallows the event |

Bindings are walked in declaration order inside a context, and the first
matching entry wins. This matches the first-match convention used by
`actions.player` and AI `conditions` elsewhere in the engine — stay
consistent.

### `input.contexts`

Custom contexts are optional. Each declares an `id` and an activation
`when` expression. A context is pushed on top of the built-in stack
whenever its expression evaluates truthy.

```yaml
input:
  contexts:
    - id: shopping
      when: "player.tile.kind == 'shop'"
```

The built-in contexts `map`, `panel`, `flow`, and `targeting` are always
available and may not be redefined.

### `input.help`

Drives the generated help screen:

```yaml
input:
  help:
    title: "Commands"
    sections:
      - { header: "Move",   actions: [move_n, move_s, move_e, move_w] }
      - { header: "System", actions: [open_help] }
    hide: [debug_dump]  # actions never shown in help
```

The help screen is **never hand-authored**. `getHelpRows(definition, state)`
reads `input.bindings` + each action's `label` / `summary` and both
renderers consume the result.

### `input.sequence_timeout_ms`

Default: `750`. After a sequence-prefix key press, the engine waits this
many milliseconds for a disambiguating key before committing the prefix
as a single-key binding.

## Key-name vocabulary

| Category | Examples | Notes |
|----------|----------|-------|
| Printable | `"q"`, `"?"`, `"."`, `">"`, `"A"` | Case-sensitive. Use the shifted form (`"A"`), not `"SHIFT+a"` |
| Named     | `UP`, `DOWN`, `LEFT`, `RIGHT`, `SPACE`, `ENTER`, `ESC`, `TAB`, `BACKSPACE`, `DELETE`, `HOME`, `END`, `PAGEUP`, `PAGEDOWN`, `INSERT`, `F1`…`F12` | Uppercase, symbolic |
| Modifier combos | `CTRL+c`, `ALT+x`, `CTRL+SHIFT+d` | Canonical order: `CTRL`, `SHIFT`, `ALT` |

Raw escape sequences, keycodes, and terminfo strings are **not** accepted.
Renderers translate native events into vocabulary names before calling
`resolve`.

### Rejected key forms (load-time errors)

- Empty strings — `""`
- Modifier-only keys — `"CTRL"`, `"SHIFT+ALT"`
- `SHIFT+<printable>` where the shifted form is another printable —
  write `"@"` instead of `"SHIFT+2"`, `"A"` instead of `"SHIFT+a"`
- Unknown names — `"ESCP"`, `"UPARROW"`, `"CRTL+x"` — the loader
  suggests a near-miss where one exists
  (`unknown key name 'CRTL+x' (did you mean 'CTRL+x'?)`)

## Binding resolution

`resolve(state, event)` is a pure function that maps an input event to
zero or more `{ actionId, binding }` results. It never reads wall-clock
time, the filesystem, or DOM events — sequence timeouts are injected by
the caller via `{ type: 'timeout' }` events.

### Context stack

Top to bottom:

1. Custom contexts (in declaration order, each active iff its `when` is true)
2. `targeting` — active during `pick_tile` / `pick_being` steps
3. `flow` — active iff `state.flowState != null`
4. `panel` — active iff a `ui.panel` is open
5. `map` — always the floor

Resolution walks the active stack **top-first**. For each context, it
scans `input.bindings` in declaration order and fires the first matching
entry whose `when` is truthy (or absent). If no match in the current
context, resolution **escalates** to the next lower context — the `map`
layer is always the floor.

A binding in a higher layer may deliberately "swallow" a key (e.g.
`ESC` in `flow` → cancel) so it never escalates to `map`. Authors
express this by simply declaring the binding in the higher context —
there is no separate "block" primitive.

### Sequences and disambiguation

Sequences and single-key bindings may share a prefix:

```yaml
- { key: "g",      action: examine }
- { sequence: [g, g], action: rest_until_full }
```

When the player presses `g`, the engine **buffers** the key (neither
action fires yet) because `g` is a prefix of a longer sequence. It then
commits when:

- the sequence completes (`g g` → `rest_until_full`), or
- the sequence timeout expires (`g` alone → `examine`), or
- a disambiguating key is pressed (`g x` → `examine` first, then `x`).

Modifier combos (`CTRL+x`) are atomic single-key events and do **not**
appear inside sequences. An empty sequence or a one-element sequence
is a load-time error — use `key:` for the latter.

### Flow vs. binding precedence

Step-intrinsic inputs (directional keys for `pick_direction`, letter
keys for `pick_item` inventory rows, reticle movement for `pick_tile`)
are **not** `input.bindings`. They are allocated by the flow runner and
documented in `docs/interaction-flows.md`.

`input.bindings` with `context: flow` are meta-commands that remain
active *during* a flow — e.g. `?` for help, `ESC` to cancel, `CTRL+z`
to rewind. A key event is first offered to the flow runner; if it
declines, resolution falls through to `input.bindings` in the `flow`
context, then to `map`.

**Item-menu letters are not bindings.** When `pick_item` assigns
`a`/`b`/`c` to inventory rows, that mapping lives in the flow runner,
not `input.bindings`. Do not try to "bind" individual inventory slots.

## Built-in bindings

Every game inherits these unless it overrides or hides them:

| Action | Key | Contexts |
|--------|-----|----------|
| `open_help` | `?` | any |
| `cancel` | `ESC` | `flow`, `panel` (cancels consume no turn) |
| `quit` | `CTRL+c` | any (exits the run with `lose { reason: "quit" }`) |

Games override a built-in by declaring a binding for the same action id
(or by listing the action in `input.help.hide` to remove it from help).
Games disable a built-in by setting `disabled: true` on a game binding
for the same key — the resolver swallows the input without firing.

Built-in bindings are loaded from `src/input/builtin-bindings.js` and
merged **after** a game's `input.bindings` in the resolution walk, so
game entries always take precedence on the first-match rule.

## Validation

The loader rejects at load time with a keyed path and line-ish context:

- Unknown action id — `input.bindings[3].action: unknown action id 'blort'`
- Unknown context id — `input.bindings[3].context: unknown context id ...`
- Duplicate bindings — two entries in the same context with identical
  `key` / `sequence` and no distinguishing `when` (**error**; both
  paths cited)
- Overlap warning — two entries with `when` expressions the validator
  cannot prove mutually exclusive (**warning**; suppress by adding
  `overlaps_with: <sibling-path>` on the later entry)
- Non-vocabulary keys — typos get a Levenshtein-≤2 suggestion:
  `input.bindings[0].key: unknown key name 'UPARROW' (did you mean 'UP'?)`
- Modifier-only keys — `"CTRL"`, `"SHIFT+ALT"`
- Bad sequences — empty, single-element, or containing modifier combos
- `input.help.sections[*].actions` referencing an unknown action id
- `input.help.hide` entries naming an action with no binding

## Migrating from `trigger:`

The legacy `trigger:` field on `actions.player.<id>` continues to parse;
the loader normalizes each `trigger:` whose value is a valid key-name
into an `input.bindings` entry at load time (context `map`, no `when`,
action id equal to the action id). If a game has **both** a `trigger:`
and an explicit `input.bindings` entry targeting the same action, the
explicit entry wins and the `trigger:` is ignored with a warning.

`trigger:` values that don't parse as keys (e.g. `trigger: move` in
silly-game, used as a dispatch tag) are left alone — they remain valid
dispatch triggers but no longer create a physical key binding.

The legacy `keymap:` block is accepted for back-compat, with the same
rules: each entry is normalized into an `input.bindings` entry unless
`input.bindings` already targets that action. Prefer the `input:`
section for new games.

## Determinism

`getHelpRows` and `resolve` are pure functions of their arguments. No
`Date.now()`, no platform sniffing, no renderer capability probes
inside the resolver. The sequence timeout is a logical event
(`{ type: 'timeout' }`) injected by the caller, not a real wall-clock
timer — this keeps tests deterministic and snapshots stable.
