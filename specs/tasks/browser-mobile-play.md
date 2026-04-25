---
id: browser-mobile-play
status: not-started
area: browser
priority: 50
depends_on: []
description: Make the browser surface playable on touch devices — tap-quadrant + hold-to-repeat movement on the canvas, an action bar derived from the game's YAML actions, and Confirm/Cancel buttons during targeting flows. Modeled on github.com/andlima/silly-game's mobile UI, adapted to the engine's data-driven action model.
---

# Browser Mobile Play

## Goal

Today the browser surface is keyboard-only. On a phone or tablet, you can
load a game (the launcher works, deep links work, the canvas renders),
but you cannot move, interact, descend, or do anything else — there is
nothing to tap. The CLI's keyboard model is hard-coded into the browser
entry: every input goes through a `keydown` listener that calls
`session.handleKey(...)`.

The `silly-game` repo (github.com/andlima/silly-game, a single-game
ancestor of this engine) solves this for one specific game by:

1. Detecting touch devices via `(pointer: coarse)`.
2. Mapping canvas taps to one of four cardinal directions, computed
   from the tap position relative to the canvas center.
3. Auto-walking when the touch is held (300ms delay, then 180ms
   between repeats), stopping on terminal state, blocked move, or
   adjacent monster.
4. Showing a fixed `#action-bar` of buttons (Food, Cast, Throw, Use,
   Wait + Map / Mode / Mute / Help) wired directly to that game's
   actions.
5. Killing iOS double-tap zoom via `<meta viewport>` and
   `canvas { touch-action: none }`.

This task ports (1)(2)(3)(5) verbatim to rogue-engine, and replaces (4)
with a bar **derived from each game's YAML actions** — because
rogue-engine is engine-agnostic and any hard-coded button list would
either break for new games (silly's "Cast" doesn't exist in pirate) or
sprawl out as games are added. The engine already exposes the
data needed: `getHelpRows(definition, state)` returns a list of
`{ actionId, keys, label, summary }` rows that we can render as
buttons, click-dispatching the first key.

The browser becomes mobile-playable for every shipped YAML (silly,
pirate, ninja) and any future game that follows the same schema, with
no per-game config and no engine schema changes.

## Acceptance Criteria

### Detection and viewport

1. **Coarse-pointer detection.** `index.html`'s module script reads
   `const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches`
   once at boot. The action bar, HUD repositioning, and canvas touch
   handlers described below only activate when `isCoarsePointer` is
   true. On desktop (fine-pointer), nothing about the existing
   keyboard / mouse experience changes.

2. **Viewport meta tag.** The existing
   `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
   is replaced with
   `<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1">`
   so iOS Safari does not double-tap-zoom the canvas.

3. **Canvas suppresses default touch gestures.** The `#game` canvas
   gets `touch-action: none` (in CSS, applied unconditionally — the
   property is harmless on desktop and prevents touch scroll/zoom
   from racing the tap handlers).

### Tap-quadrant movement

4. **Single tap → single move in cardinal direction.** While
   `isCoarsePointer` is true and the session is in normal play
   (`!state.terminal`, `!session.getHelpOpen()`, `!session.getQuitPending()`,
   `!state.flowState`), a `touchend` on the canvas with movement
   ≤ 15px from `touchstart` and duration shorter than the hold
   threshold dispatches **one** named-key keypress through
   `session.handleKey(key)`:
   - tap in the top quadrant → `'UP'`
   - tap in the bottom quadrant → `'DOWN'`
   - tap in the left quadrant → `'LEFT'`
   - tap in the right quadrant → `'RIGHT'`

   The quadrant is computed by a pure helper
   `computeTouchDir(clientX, clientY, rect) → 'UP'|'DOWN'|'LEFT'|'RIGHT'`,
   where `rect` is the canvas's `getBoundingClientRect()`. The rule
   matches silly-game's `computeTouchDir`: take `dx = clientX - cx`,
   `dy = clientY - cy` from the canvas center; if `|dy| > |dx|`
   return `'UP'` when `dy < 0` else `'DOWN'`; otherwise return
   `'LEFT'` when `dx < 0` else `'RIGHT'`.

   Drags larger than 15px on either axis are ignored (no swipe
   gestures in v1). After dispatching, the surface calls `redraw()`
   the same way the keyboard handler does.

5. **Hold-to-repeat auto-walk.** When a touch on the canvas remains
   active for `HOLD_INITIAL_DELAY = 300` ms without ending, the
   surface dispatches a movement in the quadrant direction (computed
   from the *initial* touch position, not the current one — once
   started, the direction is locked) and then continues to dispatch
   that same movement every `HOLD_REPEAT_INTERVAL = 180` ms until a
   stop condition is met:

   a. The touch ends (`touchend`) or is cancelled (`touchcancel`).
   b. The session reaches terminal state (`state.terminal != null`).
   c. The session enters a flow (`state.flowState != null`) — i.e.
      a tile-pick / item-pick / option-pick / confirm step opens.
   d. The help panel opens (`session.getHelpOpen()` becomes true) or
      the quit prompt opens (`session.getQuitPending()` becomes
      true). Neither of these is normally reachable from touch — but
      a future `?` action in YAML could be, so the stop rule must be
      defensive.
   e. The dispatched move was a no-op: the player did not move *and*
      did not attack. Detected by comparing pre- and post-state
      `state.player.x`/`state.player.y` and observing whether any
      `being` entity present at the would-be target tile in the
      pre-state was changed/removed in the post-state. (See helper
      below for a precise formulation.)
   f. After the move, a non-player `being` entity is at Chebyshev
      distance 1 from `state.player`. (This is the engine-agnostic
      analogue of silly-game's "adjacent monster" rule. Items don't
      trigger a stop — players can walk over them.)

   The stop logic is encapsulated in a pure helper
   `shouldStopRepeating(prevState, nextState, dir) → boolean` that
   takes the engine's state shape (`player: {x,y}`,
   `entities: [{kind, x, y, ...}]`, `terminal`, `flowState`) and
   returns true when any of the conditions in (b), (c), (e), (f)
   hold. Conditions (a) and (d) are checked at the surface level
   (the helper has no access to touchend events or
   `session.getHelpOpen()`).

6. **Hold cleanup is bulletproof.** A helper `stopTouchHoldRepeat()`
   clears both timers (`clearTimeout(touchHoldDelayTimer);
   clearInterval(touchHoldRepeatTimer);`) and resets the
   `touchHoldActive` flag. It is called from every exit point
   (touchend, touchcancel, tap committed, hold-stop fired,
   teardownSession, returnToMenu, playAgain, game-over overlay
   shown). Two simultaneous touches do not start two repeat timers —
   a fresh `touchstart` calls `stopTouchHoldRepeat()` first, matching
   silly-game.

7. **Tap vs. hold disambiguation.** If `touchHoldActive` was true at
   the moment of `touchend`, the touch is treated as a hold and the
   tap-commit branch (criterion 4) is skipped. If `touchHoldActive`
   was false (the user lifted their finger before the 300ms delay
   elapsed), the tap branch fires, regardless of how long the timer
   had been running.

### Action bar (derived from YAML)

8. **Action bar mounts on coarse pointer only.** A new `<div id="action-bar">`
   sits at the bottom of the document (sibling of `#help` and
   `#game-over`). It is hidden by default; CSS `@media (pointer: coarse)`
   reveals it as `display: flex` with `flex-wrap: wrap`,
   `position: fixed; bottom: 0; left: 0; right: 0;`, dark
   background, and `z-index` below `#help` and `#game-over` so
   modal overlays still cover it.

9. **Bar contents derived from `getHelpRows(definition, state)`.**
   On every `redraw()`, the surface calls `getHelpRows(definition, state)`
   and re-renders the bar from a pure helper
   `deriveActionBarItems(helpRows) → Array<{label, key}>`. Rules:
   - Iterate every row across every section.
   - Drop rows with `actionId` in the **excluded set**:
     `move_n`, `move_s`, `move_e`, `move_w` (handled by tap-quadrant),
     `open_help`, `quit`, `cancel`, `interact` (covered by dedicated
     buttons or modal flow handling — see criterion 11). The
     excluded set is exported as a named constant for testing.
   - For each remaining row, emit
     `{ label: row.label, key: row.keys[0] }` (the first bound key
     is dispatched on click).
   - Deduplicate by `actionId` (some games bind the same action to
     multiple keys; only one button per action).
   - Preserve the row order returned by `getHelpRows` (already in
     YAML declaration order — see `src/input/help.js:131-141`).

   The surface renders one `<button>` per item with text content
   `item.label`. Click handler dispatches `session.handleKey(item.key)`
   then calls `redraw()`.

10. **Built-in chrome buttons.** In addition to the derived items,
    the bar contains two always-present buttons appended after the
    derived list:
    - **`?`** (Help) — calls `session.handleKey('?')` then `redraw()`.
      Uses the existing builtin `open_help` binding; on second tap,
      the help panel closes the same way the keyboard `?` toggle
      works (any keypress dismisses help — see
      `src/runtime/session.js:195-198`).
    - **Menu** — same handler as the existing `backToMenuEl` click
      (i.e., `returnToMenu()`). On `isCoarsePointer`, the floating
      `#back-to-menu` button is hidden via CSS (`@media (pointer: coarse)`)
      and the bar's Menu button replaces it.

11. **Targeting-flow mode (pick_tile / pick_being).** When
    `session.getReticle()` is non-null, the action bar replaces its
    contents with two buttons:
    - **✓ Confirm** — `session.handleKey('ENTER')` then `redraw()`
      (commits the reticle position; engine handles the
      `flow_input`).
    - **✗ Cancel** — `session.handleKey('ESC')` then `redraw()`
      (cancels the flow via the builtin `cancel` binding).

    Tap-quadrant on the canvas still works in this mode, but each
    tap nudges the reticle by one tile (the engine's `RETICLE_DELTA`
    table — `src/runtime/session.js:32-41` — already maps `'UP'` /
    `'DOWN'` / `'LEFT'` / `'RIGHT'` to single-tile reticle moves
    inside `pick_tile`/`pick_being` flow steps). Hold-to-repeat is
    **disabled** during reticle mode — repeated movement past the
    intended target would be a frustrating UX. The 300ms hold timer
    is not started while `state.flowState != null`.

12. **Other flow steps (pick_item / pick_option / pick_direction /
    confirm).** When `state.flowState != null` but
    `session.getReticle()` is null, the bar shows a single
    **✗ Cancel** button (same handler as above). The player must
    use a physical keyboard to commit a choice (a-z for items /
    options, arrows for direction, y/n for confirm). Mobile-first
    UI for these flow types is out of scope for v1 — none of the
    launcher-visible games (silly, pirate, ninja) use them today;
    only the demo YAML `interact-demo.yaml` does, and demos are
    hidden from the launcher (see
    `specs/tasks/hide-demo-games-from-launcher.md`). Document the
    limitation in the spec only — no in-app messaging is required.

### Layout and chrome

13. **HUD repositions above the action bar.** When the bar is
    visible, `#status`, `#messages`, and `#key-hint` must remain
    visible (not occluded by the bar). The simplest implementation:
    add bottom padding to `body` equal to the action bar's
    `offsetHeight` while `isCoarsePointer` is true, recomputed on
    `window.resize` and after the bar's contents change (since
    flex-wrap may change the bar height). Implementer's call on
    exact mechanism — the criterion is "no element is hidden behind
    the bar".

14. **Floating `← Menu` is hidden on coarse pointer.** Existing CSS
    rules around `body.in-launcher #back-to-menu { display: none }`
    are preserved. A new rule under `@media (pointer: coarse)` sets
    `#back-to-menu { display: none; }` unconditionally — its job is
    taken over by the Menu button in the action bar.

15. **Game-over overlay still works on mobile.** The overlay's
    Play-again / Menu buttons (already implemented per
    `specs/tasks/browser-game-over-overlay.md`) remain tappable. The
    action bar must not occlude the overlay (the overlay's
    `z-index: 20` is already above the bar's z-index per
    criterion 8). When the game-over overlay is mounted, the
    action bar's contents do not need to update — the overlay's
    backdrop covers it.

### Inputs not affected

16. **CLI is untouched.** `cli.js`, `src/runtime/session.js`,
    `src/runtime/dispatch.js`, and the engine input modules
    (`src/input/*.js`) are not modified. All touch logic lives in
    `index.html` plus a new pure-helpers module under `src/browser/`.

17. **Desktop (fine pointer) is untouched.** `npm run serve` on a
    desktop browser shows the launcher and game exactly as today.
    No action bar appears, no canvas touch handlers fire (they're
    not registered), `← Menu` is in the corner. Only the `<meta
    viewport>` tag changes are visible, and they are inert on
    desktop.

18. **No engine schema changes.** No new YAML field is read; no
    `actions.player[]` entry needs to be edited. silly, pirate, and
    ninja work on mobile out of the box.

### Tests

19. **Unit tests for pure helpers.** Add a new test file
    `test/browser-mobile.test.js` (Node test runner, like the rest
    of the suite). It imports the new helper module from
    `src/browser/` and asserts:

    a. `computeTouchDir(clientX, clientY, rect)` returns `'UP'`,
       `'DOWN'`, `'LEFT'`, `'RIGHT'` for taps in each quadrant of a
       reference rect. Edge case: a tap exactly on a diagonal
       (`|dx| === |dy|`) is acceptable as either of the two adjacent
       directions — the helper just must not throw.

    b. `shouldStopRepeating(prev, next, dir)` returns true for each
       documented stop condition (terminal, flow opened, no-op move,
       adjacent being) and false for a clean continuation (player
       moved one tile in `dir`, no adjacent beings).

    c. `deriveActionBarItems(helpRows)` filters out the documented
       excluded action ids (`move_n`/`s`/`e`/`w`, `open_help`,
       `quit`, `cancel`, `interact`), deduplicates by `actionId`,
       and returns `{label, key}` pairs preserving help-row order.
       Use a synthetic `helpRows` fixture (do not depend on a real
       YAML).

    d. End-to-end-ish: load `games/silly/game.yaml` and
       `games/pirate.yaml` via `loadFromFile` (matching the pattern
       in `test/browser-interface.test.js:14-20`), build a session,
       call `getHelpRows(definition, state)`, run
       `deriveActionBarItems` on it, assert that for silly the
       resulting bar contains buttons for *Use food*, *Idol*,
       *Descend*, *Wait*, *Toggle display* (or whatever labels the
       YAML declares — read them from the definition, don't
       hard-code), and for pirate it contains *Quaff grog*,
       *Hardtack*, *Fire pistol*, *Open chest*, *Wait*,
       *Toggle display*. The exact label set should be read from
       `definition._index.playerActions[id].label`, not asserted as
       a literal string list — the test's job is to confirm the
       derivation logic, not to lock in YAML wording.

20. **Existing tests pass unchanged.** `npm test` is green. No
    existing test imports `index.html`, so the surface-only edits
    cannot break the suite directly; the new helpers must be
    exported in a tree-shake-friendly way (named ESM exports, no
    side effects at module load time — same pattern as
    `src/browser/game-select.js`).

### Manual verification (done by implementer before reporting)

21. Run `npm run serve`. Open
    `http://localhost:8000/?game=silly` in Chrome devtools mobile
    emulation (Pixel-class viewport, "Mobile" device-type so
    `pointer: coarse` matches). Verify:
    - Action bar appears at the bottom with buttons matching the
      game's actions.
    - Tapping each canvas quadrant moves the player one tile in
      the corresponding direction.
    - Press-and-hold on the canvas auto-walks; releasing stops;
      stepping next to a monster stops automatically.
    - Tapping a game-action button executes it (e.g., *Wait*
      passes a turn, *Use food* eats food).
    - The Menu button returns to the launcher.
    - The `?` button opens the help panel; tapping the canvas or
      `?` again closes it.

22. Same flow for `?game=pirate` and verify *Fire pistol* opens
    targeting mode: action bar swaps to **Confirm / Cancel**;
    tap-quadrant nudges the reticle; **Confirm** fires; **Cancel**
    aborts.

23. Toggle out of mobile emulation and reload — the desktop UI is
    visually identical to today, no action bar, `← Menu` floats in
    the corner.

## Out of Scope

- **Mobile-first UI for non-targeting flows.** `pick_item`,
  `pick_option`, `pick_direction`, and `confirm` flow steps are not
  given dedicated mobile UI. The bar shows only Cancel; the player
  needs a physical keyboard for those flows. None of the
  launcher-visible games use them. Adding swipeable item lists or
  option grids is a separate task.

- **Swipe gestures.** Drags >15px are ignored. No swipe-to-move,
  no swipe-to-cancel, no pinch-to-zoom-the-map. Tap-quadrant +
  hold-to-repeat is the entire input surface for movement.
  silly-game also doesn't have swipes.

- **On-screen virtual D-pad.** The directional input is canvas-tap,
  not a separate D-pad widget. If the canvas is too small to be
  tapped accurately on a phone, that is a CSS sizing issue (the
  canvas is currently `588x420` and the engine's tile size is
  configurable per-game); resizing the canvas for mobile is a
  separate concern.

- **Re-rendering the help panel for mobile.** The help panel is
  text-only and already scrollable; it works on mobile as-is. No
  responsive font-size or layout changes for `#help`.

- **Animations / haptics / sound.** No vibration on tap, no
  press-down button states beyond the browser default, no transition
  animations.

- **Per-game custom mobile UI.** No YAML field like
  `mobile: { hide_actions: [...] }` or `mobile: { layout: ... }`.
  The derivation is fixed.

- **Landscape vs. portrait detection.** The bar is the same in both
  orientations.

- **Saving touch preferences.** No localStorage flag to force the
  bar on or off independent of `pointer: coarse`. If you load the
  page in mobile emulation, the bar appears; if you reload outside
  emulation, it doesn't.

- **CLI changes.** `cli.js` is untouched. The `Press any key to
  exit` flow on the CLI (per `specs/tasks/cli-game-over-exit.md`)
  is unrelated.

## Design Notes

**Why derive from `getHelpRows` instead of hard-coding.** silly-game
hard-codes Food / Cast / Throw / Use / Wait because it ships exactly
one game and those are its actions. rogue-engine ships three (silly,
pirate, ninja) with different action sets, plus support for arbitrary
uploaded YAML. Hard-coding here would either pick a lowest-common
subset (just Wait) or grow each time a game is added. `getHelpRows`
already returns the canonical, contextually-filtered list of player
actions with display labels and bound keys — the exact data a button
bar wants. Reusing it means new games are mobile-playable on day one.

**Why `getHelpRows` and not iterating `definition.input.bindings`
directly.** `getHelpRows` already handles the `input.help.hide`
filter, debug-flag filter, and section ordering. It also collapses
duplicate `(action, keys)` rows (e.g. the `*`-context built-ins).
Re-implementing that filter logic in a mobile module would be
duplicate code to maintain.

**Why tap-quadrant and not virtual D-pad.** The four-quadrant model
makes the entire visible map a movement surface. Players can keep
their thumb in one place and tap a direction relative to the canvas
center; they don't have to look down at a D-pad. silly-game's user
testing settled on this. A D-pad would also crowd the action bar
or eat valuable canvas vertical space.

**Why hold-to-repeat with a 300ms delay.** Single-tap-per-step is
fine in safe corridors but tedious for long traversals; auto-walk is
the standard roguelike convenience input ("travel" or "run"). The
300ms delay is long enough that single moves don't accidentally
trigger a repeat, short enough that holding feels responsive.
silly-game tuned these values; we copy them.

**Why stop on adjacent being.** In every shipped game, beings are
hostile or interactive (monsters, idols, NPCs) — auto-walking past
them strips the player of agency. silly-game's "adjacent monster"
rule is engine-agnostic if we generalize it to "non-player being at
Chebyshev distance 1". Items don't trigger a stop because walking
over an item is the canonical pickup gesture in roguelikes
(rogue-engine games use `interact` to pick up, but the auto-walker
should not stop on items because then auto-traversing a corridor
with scattered loot would constantly pause). If a future game wants
auto-stop on items too, that's a separate concern.

**Why disable hold-to-repeat in reticle mode.** `pick_tile` /
`pick_being` move the reticle one tile per arrow key. If the user
holds, they overshoot the target. Single-tap nudge is the right
mechanic — it gives the player a clear visual relationship between
each tap and the new reticle position.

**Where the helpers live.** A new module
`src/browser/touch-controls.js` (or `mobile.js` — implementer's
choice; "touch-controls" is more descriptive) exports three pure
functions: `computeTouchDir`, `shouldStopRepeating`,
`deriveActionBarItems`, plus the constants `HOLD_INITIAL_DELAY`,
`HOLD_REPEAT_INTERVAL`, `TAP_DRAG_THRESHOLD = 15`, and the excluded
action-id set. The DOM wiring (event listeners, button mounting,
HUD repositioning) stays inline in `index.html` — same shape as
`computeFOV`/`getVisibleTiles` (pure helpers in `src/`) feeding
inline `redraw()` (DOM in `index.html`).

**Why not a separate browser entry file.** `index.html`'s inline
script is already the orchestration layer for the surface — moving
it to `src/browser/main.js` is a bigger refactor and not required
for this task. The pure helpers being importable is the only
testability we need.

## Touch List

- `index.html` — viewport meta, canvas `touch-action`, action bar
  markup, action bar CSS (under `@media (pointer: coarse)`),
  `#back-to-menu` hide rule under `@media (pointer: coarse)`,
  module-script wiring: import touch helpers, register
  touchstart/touchmove/touchend/touchcancel on canvas, mount /
  re-render action bar from each `redraw()`, swap bar contents
  during reticle mode, recompute body padding for HUD
  repositioning.
- `src/browser/touch-controls.js` (new) — pure helpers
  (`computeTouchDir`, `shouldStopRepeating`,
  `deriveActionBarItems`) and constants
  (`HOLD_INITIAL_DELAY = 300`, `HOLD_REPEAT_INTERVAL = 180`,
  `TAP_DRAG_THRESHOLD = 15`,
  `EXCLUDED_ACTION_IDS = new Set(['move_n','move_s','move_e','move_w','open_help','quit','cancel','interact'])`).
  No DOM access, no side effects at module load.
- `test/browser-mobile.test.js` (new) — unit tests for the helpers
  per criterion 19.

## Agent Notes

- The engine's reticle key map (`RETICLE_DELTA` in
  `src/runtime/session.js:32-41`) already routes `'UP'` / `'DOWN'`
  / `'LEFT'` / `'RIGHT'` to one-tile reticle nudges — you don't
  need to special-case targeting in the tap-commit branch. Just
  send the same named keys; the session does the right thing.
  The hold-to-repeat suppression in reticle mode (criterion 11)
  is a separate UX choice — implement it at the surface, not in
  the engine.
- Don't add a `body.in-mobile` class or any other persistent
  class to track touch state. `isCoarsePointer` is a constant for
  the page's lifetime; conditional logic in JS reads it directly,
  and CSS uses `@media (pointer: coarse)`. Keeping these two
  channels separate avoids "the body class disagrees with the
  media query" bugs.
- Don't try to detect the touch event vs. mouse event source — on
  hybrid devices (touchscreen laptops), `(pointer: coarse)`
  intentionally returns false, and the existing keyboard / mouse
  paths handle that case. We deliberately do not have a
  fine-grained "this specific input was a touch" branch.
- The existing keydown handler in `startSessionFromDefinition`
  already filters keys when the game-over overlay is mounted (per
  `browser-game-over-overlay.md` criterion 5). The new touch
  handlers must respect the same gate — no auto-walk firing while
  the game-over overlay is up. Easiest: check
  `state.terminal != null` at the top of the touchstart handler
  and bail out.
- When you mount the action bar in `boot()`, do it before any
  YAML loads — the empty bar is invisible until `isCoarsePointer`
  triggers the media query. The bar's contents update on each
  `redraw()` (cheap DOM rebuild — under 10 buttons even for
  pirate). Don't worry about diff-rendering; the overhead is
  negligible.
- `Date.now()` is already used as the play-again seed (per
  browser-game-over-overlay). Reuse the same overlay-rendering
  hooks; don't re-derive the action bar from inside the overlay
  branch in `redraw()` (the overlay covers the bar visually).
- Keep `computeTouchDir`'s rule consistent with silly-game: when
  `|dy| > |dx|`, the vertical axis wins. The diagonal tie
  (`|dy| === |dx|`) goes to the horizontal axis under the
  silly-game rule (`else` branch fires). Either tie-break is
  acceptable for the test in 19a, but the implementation should
  be deterministic.
- `getHelpRows` returns sections; flatten across sections in
  `deriveActionBarItems`. Section headers are not rendered on the
  mobile bar.
- The pirate game's `interact` action is bound to `SPACE` and
  used to interact with tiles (e.g. open a chest is its own
  `open_chest` action with key `o`). `interact` is in the excluded
  list — players who want to interact with a tile use the specific
  game-defined action (`open_chest`, etc.) which appears in the
  bar. If a future game makes generic `interact` central, it can
  be removed from the exclusion set in a follow-up.
