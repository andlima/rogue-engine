---
id: input-bindings
status: not-started
area: engine
priority: 50
depends_on: [interaction-flows]
description: First-class YAML keymap — explicit per-action bindings, context layers, and a generated help screen
---

# Input Bindings

## Goal

Give every rogue-engine game a single, readable place to declare which
keys do which things. The existing specs leave bindings implied by
each action's `trigger` field, with a `keymap:` block mentioned only
in `interaction-flows`'s Design Notes and never formalized — so a
reader opening a game's YAML cannot answer "what does `q` do?"
without grepping every action. This spec makes input bindings
first-class: a top-level `input` section enumerates every key →
action mapping, supports context layers (map, panel, flow, custom),
and feeds a generated help screen both renderers consume. After this
spec, every key the player can press lives in one place, documented
with one line, rebindable without touching JS.

## Acceptance Criteria

1. **Top-level `input` section** in YAML, loaded and validated:
   - `input.bindings` — ordered list of entries mapping physical
     input events to action ids. Each entry:
     - `key` — a single key name, *or* `keys` — a list of aliases for
       the same binding (e.g. `[LEFT, h]`), *or* `sequence` — an
       ordered list (see criterion 4). Exactly one of the three is
       required per entry.
     - `action` — id referencing an entry under `actions.player`
     - optional `context` — one of the built-in contexts
       (`map`, `panel`, `flow`, `targeting`) or a custom context id
       declared under `input.contexts`. Defaults to `map`.
     - optional `when` — expression evaluated at resolution time; the
       binding applies only when true (e.g. debug-only bindings gated
       on `state.debug`)
     - optional `label` — short phrase that overrides the bound
       action's `label` in the help screen (e.g. a binding on `.`
       labeled "wait" where the action is a more generic `pass_turn`)
   - `input.contexts` — optional list of custom context ids and their
     activation expressions. The built-in contexts
     (`map`, `panel`, `flow`, `targeting`) are always available and
     may not be redefined.
   - `input.help` — optional metadata for the help screen:
     `title`, `sections` (each `{ header, actions: [<action-id>] }`),
     and `hide` (list of action ids omitted from help — debug keys).
   - `input.sequence_timeout_ms` — default `750`, override per game.

2. **Key name vocabulary** — documented in
   `docs/input-bindings.md`. Non-printable keys are referenced by
   symbolic name; raw codes are not accepted.
   - Printable characters: the literal character
     (`"q"`, `"?"`, `"."`, `">"`) — case-sensitive.
   - Named keys: `UP`, `DOWN`, `LEFT`, `RIGHT`, `SPACE`, `ENTER`,
     `ESC`, `TAB`, `BACKSPACE`, `DELETE`, `HOME`, `END`, `PAGEUP`,
     `PAGEDOWN`, `INSERT`, `F1`–`F12`.
   - Modifier combos: `CTRL+<c>`, `SHIFT+<c>`, `ALT+<c>`, and
     combinations in that canonical order (`CTRL+SHIFT+x`).
     `SHIFT` combined with a printable character whose shifted form
     is another printable character (e.g. `SHIFT+2` producing `@`)
     is written as the shifted form (`"@"`), not the combo.
   - Modifier-only keys (`CTRL` alone) and empty strings are
     load-time errors.

3. **Binding resolution** — a pure function
   `resolve(state, event) → { actionId, binding } | null`:
   - The engine maintains a context stack. Top of stack is determined
     by `GameState`: if `flowState != null` → `flow`; else if a panel
     is open → `panel`; else `map`. Custom contexts declared in
     `input.contexts` are pushed when their activation expression is
     true, in declaration order, atop the built-in layer.
   - Resolution walks `input.bindings` in declaration order,
     considering only entries whose `context` equals the current top
     of stack. First entry whose `key` / `keys` / `sequence` matches
     the event *and* whose `when` is true (or absent) wins.
   - If no match, resolution falls through to the next context below
     (the `map` layer is always the floor). Document the escalation
     rule explicitly in `docs/input-bindings.md`.
   - A binding in a higher layer may deliberately "swallow" a key
     (e.g. `ESC` in `flow` → cancel) so it never escalates to `map`.
     Authors express this by simply declaring the binding in the
     higher context; there is no separate "block" primitive.

4. **Sequences and combos**:
   - `sequence` — ordered list of key names. Matches when the player
     presses the keys in order within `input.sequence_timeout_ms`
     without any non-sequence input interleaved. Sequences and
     single-key bindings may share a prefix (`g` and `[g, g]`); the
     engine waits for the sequence timeout or a disambiguating key
     press before committing. Document the disambiguation rule.
   - Modifier combos (`CTRL+x`) are atomic single-key events and do
     **not** appear inside sequences. An empty sequence or a
     one-element sequence is a load-time error (use `key:` for the
     latter).

5. **Flow- and panel-step inputs** — clarify the boundary between
   `input.bindings` and the flow runner:
   - The flow runner's *step-intrinsic* inputs (directional keys for
     `pick_direction`, letter keys for `pick_item` row selection,
     reticle movement for `pick_tile`) are **not** `input.bindings`.
     They are allocated by the runner and documented in
     `docs/interaction-flows.md`.
   - `input.bindings` with `context: flow` are meta-commands that
     remain active *during* a flow (e.g. `?` → help, `ESC` →
     cancel-flow, `CTRL+z` → rewind one step if supported).
   - A key event is first offered to the flow runner (if active). If
     the runner declines it (not an expected step input), resolution
     falls through to `input.bindings` in the `flow` context, then to
     `map`. Document this precedence.

6. **Built-in actions and bindings** shipped with the engine (every
   game inherits these unless it overrides or hides them):
   - `open_help` → `?` (context: any) — opens the help panel
   - `cancel` → `ESC` (context: `flow`, `panel`) — cancels flow /
     closes panel; cancels consume no turn (carried from
     `interaction-flows`)
   - `quit` → `CTRL+c` (context: any) — exits the run with
     `lose { reason: "quit" }` after a `confirm` prompt
   - Games override a built-in by declaring a binding for the same
     action (or by listing the action in `input.help.hide` to remove
     it from help). Games disable a built-in by binding it to a
     no-op action or by setting its entry to `disabled: true`.
   - The built-in bindings are loaded from
     `src/input/builtin-bindings.js` (or equivalent) and merged
     **before** the game's `input.bindings`, so game entries take
     precedence on the first-match rule.

7. **Help screen** — generated, never hand-authored:
   - Opening `open_help` renders a `ui.panel` (reusing the panel
     machinery from `interaction-flows`) listing every bound action
     grouped by `input.help.sections`, defaulting to a single
     "Commands" group sorted by declaration order.
   - Each row shows: key(s), the binding's `label` (fallback:
     action's `label`), and the action's optional `summary` field
     (this spec formalizes `summary` on `actions.player.<id>` as a
     short one-line description; the field is optional).
   - Bindings listed in `input.help.hide` or with
     `when: state.debug` (or similar guarded `when`) may be filtered
     out — document the filter rule.
   - Help rendering goes through a shared
     `getHelpRows(definition, state)` helper so both renderers
     produce identical content.

8. **Validation** — loader rejects at load time:
   - A binding references an unknown action id
   - A binding references an unknown context id
   - Two bindings in the same context with identical `key` /
     `sequence` and no distinguishing `when` (load-time **error**)
   - Two bindings in the same context with identical `key` and
     non-trivial `when` expressions the validator cannot prove
     mutually exclusive (load-time **warning** — authors can
     suppress with a documented `overlaps_with:` acknowledgement on
     the later entry)
   - Non-vocabulary key names (typos like `ESCP`, `UPARROW`,
     `CRTL+x`) — include a Levenshtein-≤2 suggestion where one
     exists
   - Modifier-only keys (`CTRL` alone)
   - `sequence` with fewer than two elements or containing
     modifier-only entries
   - `input.help.sections` referencing an unknown action id
   - `input.help.hide` entries that name an action with no binding

9. **Migration of `trigger:`** — the old `trigger` field on
   `actions.player.<id>` continues to parse, but the loader
   normalizes it into an `input.bindings` entry at load time (context
   `map`, no `when`, action id equal to the action id). If both
   `trigger:` and an explicit `input.bindings` entry target the same
   action, the explicit entry wins and the `trigger` is ignored with
   a warning. The `keymap:` block mentioned in
   `interaction-flows`'s Design Notes is removed — only `input` is
   canonical. Document the migration path in a short "Migrating from
   `trigger`" section in `docs/input-bindings.md`.

10. **Renderer contract**:
    - ANSI renderer gains: help panel rendering via the shared
      `getHelpRows` helper, and a one-line **key hint** surface at
      the bottom of the viewport populated by the active flow step
      or panel (e.g. "↑/↓ select · ENTER confirm · ESC cancel" while
      `pick_item` is active). Key-hint strings are derived from the
      current context's bindings plus the step's intrinsic inputs,
      not hand-authored.
    - Canvas renderer stub gains `drawHelpPanel(rows)` and
      `drawKeyHint(hint)` stub methods accepting the same semantic
      descriptors the ANSI renderer consumes and throwing
      `"not implemented"` with a TODO link. The shared contract is
      documented in `docs/rendering.md` (extended from prior specs).

11. **Worked examples** — the bindings in these games are migrated to
    the new form as part of this spec:
    - `games/minimal.yaml` (from `engine-bootstrap`) declares its
      four move bindings explicitly under `input.bindings`. The
      previous `trigger:` form is removed.
    - `games/silly/game.yaml` (from `silly-game-port`) declares its
      full keymap under `input.bindings` with a populated
      `input.help.sections`. The binding list in the PR description
      doubles as the silly-game player's cheat sheet.
    - `games/interact-demo.yaml` (from `interaction-flows`) declares
      its quaff/cast/descend/interact bindings plus a `flow`-context
      binding for `?` help while targeting.

12. **Tests**:
    - Unit tests for the resolver covering: first-match within a
      context, fallback escalation through layers, modifier parsing,
      sequence matching with and without prefix ambiguity, sequence
      timeout expiry, `when`-gated bindings, built-in vs game
      precedence
    - Loader-validation tests: one failing fixture per error class
      in criterion 8, plus one passing fixture that uses
      `overlaps_with:` to acknowledge an intentional overlap
    - Help-screen snapshot test asserting the generated layout for
      `games/silly/game.yaml`
    - A remixability integration test: rebinding `move_e` from `l`
      to `d` in YAML produces the expected resolver output for a
      fixed input event, with zero JS changes
    - A migration test: a minimal YAML using only the legacy
      `trigger:` form loads and produces the same resolver behavior
      as an equivalent `input.bindings` form

## Out of Scope

- In-game rebinding UI (a "Settings → Controls" screen where the
  player rebinds keys at runtime) — rebinding in this spec means
  editing YAML; the runtime UI is a later spec
- Mouse and touch input (carried forward from `interaction-flows`)
- Gamepad / controller support
- Keyboard-layout translation (AZERTY ↔ QWERTY auto-remap, Dvorak
  awareness) — a later spec if needed
- IME and composition events
- Multi-player input routing
- Key macros (one key expanding into a recorded input sequence)
- Defining new input *event types* from YAML — event types remain
  an engine-code registry, same pattern as effects and flow steps
- Accessibility features for input (sticky keys, dwell-activation)
  — worth a dedicated spec alongside the renderer accessibility
  pass

## Design Notes

- **Minimum viable example** — include this in
  `docs/input-bindings.md` verbatim so new authors can copy it:

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

- **Keymap is data, help is generated.** Do not hand-author the
  help screen; do not scatter "press X to Y" hint strings across
  action definitions. The one authoritative source is
  `input.bindings` plus each action's `label` / `summary`.
- **Ordering matters.** Declaration order in `input.bindings` is
  the conflict-resolution rule within a context, matching the
  first-match convention used by `actions` and AI `conditions` in
  prior specs. Stay consistent.
- **Contexts are layers, not exclusive zones.** The `panel`
  context does not *replace* `map`; it is pushed on top. Meta
  bindings (`?` for help, `CTRL+c` for quit) declared in `map`
  remain reachable from inside panels and flows via escalation.
  Authors opt out of escalation by redeclaring a binding in a
  higher context that swallows the key.
- **Vocabulary, not codes.** `"ESC"`, `"ENTER"`, `"UP"` are the
  only way to reference non-printables. No `"\x1b"`,
  `"\u001b"`, `{ code: 27 }`, or terminfo-specific escape
  sequences. Renderers translate their native events into
  vocabulary names before calling `resolve`.
- **Item-menu letters are not bindings.** When a `pick_item` step
  assigns `a`/`b`/`c`/… to inventory rows, that mapping lives in
  the flow runner, not `input.bindings`. Conflating the two would
  force authors to re-declare inventory letters for every game.
  Document this crisply in `docs/input-bindings.md` so authors do
  not try to "bind" individual inventory slots.
- **Determinism.** `getHelpRows` and `resolve` are pure functions
  of `(definition, state[, event])`. No `Date.now()`, no platform
  sniffing, no renderer capability probes inside the resolver.
- **Validation error quality** (carrying the bar from prior
  specs). If a binding names `"UPARROW"`, the error should read
  `input.bindings[3].key: unknown key name 'UPARROW' (did you
  mean 'UP'?)`. If two bindings collide, cite both line numbers.

## Agent Notes

- Read `interaction-flows.md` end-to-end before starting. The
  `keymap:` block mentioned in its Design Notes is this spec's
  starting point; reconcile the two.
- Implementation order that keeps each step testable:
  1. Key-name vocabulary parser + unit tests (no YAML yet — just
     "is this string a valid key name")
  2. Schema + loader validation for `input.bindings` /
     `input.contexts` / `input.help` + tests for each error class
  3. Resolver as a pure function + unit tests over synthetic
     event streams
  4. Built-in bindings module and merge-with-game rule
  5. Migration layer for the legacy `trigger:` field + test
  6. Flow / panel precedence: wire the resolver into the
     `dispatch` path at the CLI boundary
  7. Help-panel rendering via `ui.panel` from
     `interaction-flows`; snapshot test
  8. Sequences + the disambiguation timeout last — finickiest
     piece, and everything else should be green before it lands
  9. Migrate `games/minimal.yaml`, `games/silly/game.yaml`,
     `games/interact-demo.yaml` to the new form
- Common pitfalls:
  - Accepting two bindings for the same key in the same context
    without a `when` guard and letting the later one silently
    win. That debugging experience is awful; prefer a load-time
    error with both line numbers cited.
  - Treating `SHIFT+a` and `A` as distinct events. They are the
    same event. Normalize at the event layer, not the binding
    layer.
  - Hand-authoring the "press ↑/↓ to move, ENTER to select" hint
    strings the ANSI renderer shows beneath a panel. Derive them.
  - Extending the action schema with binding-shaped fields
    (`hotkey:`, `shortcut:`) in parallel to `input.bindings`.
    One canonical place.
- If migrating the silly-game port uncovers a key it wants to
  bind that the vocabulary does not cover (unlikely — silly-game
  is ASCII), flag the missing vocabulary entry in the PR rather
  than inventing game-specific names.
