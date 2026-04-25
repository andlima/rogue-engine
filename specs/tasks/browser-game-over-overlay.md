---
id: browser-game-over-overlay
status: not-started
area: browser
priority: 50
depends_on: []
description: Replace the abrupt status-line freeze on game-over in the browser with a centered overlay (Victory / Defeated + reason) and Play-again / Menu actions
---

# Browser Game-Over Overlay

## Goal

Today, when `state.terminal` becomes truthy in the browser, `index.html`
clears the canvas and writes a single line into `#status`:

```
Game over — win (Escaped the dungeon!).
```

…and that's it. The game is dead, the player has no hint that anything
else is reachable, and the only way back is to click the floating
`← Menu` button (or refresh the page).

This task replaces that frozen state with a real end-of-run UI. Because
the engine already exposes `state.terminal` (`'win' | 'lose'`) and a
free-form `state.terminalReason` (e.g. *"Escaped the dungeon!"*,
*"You died."*) on every game, the overlay is built once at the browser
surface and works for every YAML game with no per-game schema changes.

It must offer two actions: **Play again** (rebuilds the session from
the same definition with a fresh RNG seed) and **Menu** (returns to the
launcher, same flow as the existing `← Menu` button). Keyboard
shortcuts are supported alongside mouse clicks.

## Acceptance Criteria

1. **Overlay appears on terminal state.** When `session.getState().terminal`
   becomes truthy in `index.html`, the inline script renders an overlay
   element on top of the canvas instead of overwriting `#status` with the
   one-liner. The overlay contains, in order:
   - A heading: `Victory` when `state.terminal === 'win'`,
     `Defeated` when `state.terminal === 'lose'`. Heading is in a
     larger font (≥ 22px) than body text and uses a distinct color
     (e.g. `#7fbf7f` win / `#cc6666` lose — exact hex up to the
     implementer but the two outcomes must be visually distinguishable).
   - A reason line: the value of `state.terminalReason ?? 'Game over.'`
     rendered verbatim. Line wraps if longer than the overlay width.
   - Two buttons in this left-to-right order: **Play again** and
     **Menu**. Buttons are visually distinct (the existing
     `.launcher-game` styling is fine as a reference for the look).
   - A small key-hint line beneath the buttons:
     `R play again  ·  ESC menu`.

2. **Final game frame stays visible underneath the overlay, dimmed.**
   The canvas is *not* cleared when the overlay opens (the existing
   `renderer.clear()` call in the terminal branch must be removed).
   The overlay sits above the canvas with a semi-transparent dark
   backdrop (e.g. `rgba(0, 0, 0, 0.7)` over the canvas region or full
   viewport) so the last frame — the player's death tile, the gold
   they collected, the staircase they reached — is still readable
   through the dim. The status / messages / key-hint elements may
   stay populated underneath but **must not** be visible above the
   overlay (z-index or hidden — implementer's choice).

3. **Play again rebuilds the session with a fresh seed.** Clicking
   **Play again** (or pressing `R`) tears down the current session and
   re-creates it from the same parsed `definition` with a freshly
   generated seed. Mechanism:
   - Extend `createSession(definition, opts?)` in
     `src/runtime/session.js` to accept an optional second argument
     `{ seed?: number }` and forward it to `createState(definition, opts.seed)`.
     When `opts` is omitted or `opts.seed` is `undefined`, behavior is
     identical to today (so `cli.js` and existing tests are unchanged).
   - In `index.html`, cache the parsed `definition` (and the launch
     metadata: registered game id *or* uploaded YAML's filename) when
     a session starts. On Play-again, call
     `createSession(cachedDefinition, { seed: Date.now() })` — do **not**
     re-fetch the YAML or re-parse it, since `loadFromString` is the
     expensive step and the parsed definition is immutable.
   - The new game starts in the same way as the original: launcher is
     not shown, URL is preserved, the first frame is drawn, the player
     starts at full HP / level 1 / etc. (whatever `createState` produces
     for that definition under a different seed).

4. **Menu action returns to the launcher.** Clicking **Menu** (or
   pressing `ESC` or `M`) tears down the session, clears the URL's
   `?game=` query param via `history.pushState`, and shows the
   launcher view. This is exactly the existing `backToMenuEl` click
   handler — reuse it, do not duplicate the logic.

5. **Keyboard shortcuts only fire while the overlay is open.** While
   `state.terminal` is truthy and the overlay is mounted, the
   `keydown` handler installed by `startSession` must:
   - Treat `r` / `R` as Play-again.
   - Treat `Escape` and `m` / `M` as Menu.
   - Swallow (event.preventDefault) all other keys — no movement,
     no help-panel toggle, no quit-confirm dialog can be triggered.
     The existing `session.handleKey` early-return for terminal state
     already prevents game-state changes; this criterion is about not
     opening UI like the help panel either.

6. **Click outside the overlay does not dismiss it.** There is no
   "click backdrop to close" behavior — the player must explicitly
   choose Play-again or Menu. Rationale: the action set is small and
   accidental dismissal would drop them into an ambiguous "game over,
   no overlay" state.

7. **Uploaded YAML can also be replayed.** When a session was started
   from `launcher-upload` (no `?game=` param), Play-again still works
   because the cached `definition` is in memory. Menu still returns to
   the launcher in the normal way. The uploaded file's `<input>` value
   may be left as-is — re-uploading the same file is not required.

8. **Manifest deep-link round-trip.** When the original session was
   loaded from `?game=<id>` (registered game), the URL still reads
   `?game=<id>` after Play-again (no change to the address bar).
   After Menu, the URL is reset to `window.location.pathname` (no
   query string), matching today's `← Menu` behavior.

9. **CLI is untouched.** `cli.js` continues to call
   `createSession(definition)` with one argument; no overlay or
   restart UI is added to the CLI. The CLI game-over path
   (`Press any key to exit`, defined in
   `specs/tasks/cli-game-over-exit.md`) is independent and unaffected.

10. **Tests.**
    a. Add a unit test for the new `createSession` signature in
       `test/runtime.test.js` (or a new `test/session.test.js` if the
       former is the wrong home — implementer's call): construct two
       sessions from the same definition with different seeds, assert
       that at least one of `state.map`, `state.entities`, or any
       observable RNG-driven field differs between them. Use a
       fixture under `test/fixtures/` that has procedural dungeon
       generation (or reuse `games/silly/game.yaml` if convenient).
    b. Add a smoke test in `test/browser-interface.test.js` that
       imports `createSession` and verifies the new opts argument is
       forwarded to `createState` (mock or spy approach is fine; the
       point is to lock in the public signature, not re-test
       `createState`).
    c. Existing tests pass unchanged: `npm test` is green.

11. **No regressions in the launcher / deep-link flows.** With
    `npm run serve` running:
    - `http://localhost:8000/` shows the launcher as before.
    - `http://localhost:8000/?game=silly` boots silly directly as before.
    - The `← Menu` button still works mid-game.

## Out of Scope

- Per-game custom end screens, custom recap text, score boards, "best
  run" tracking, or final-stats lines beyond the existing
  `terminalReason` string. If a future game wants a death recap, that
  will be a separate task that extends the engine schema (e.g. a
  `endings:` block per outcome). This task only consumes what the
  engine already exposes.
- Animations / transitions for the overlay (fade-in, etc.). A static
  overlay is sufficient.
- Sound effects.
- Saving the run / sharing / replay export.
- Changing `cli.js` or the CLI game-over flow.
- Changing the engine's behavior under no-seed (initial loads still
  use whatever `createState` produces today — typically the engine
  fallback `42` when the YAML doesn't set `world.dungeon.seed`). A
  fresh seed is only used on the explicit **Play again** action;
  initial page loads remain deterministic, so silly-parity tests and
  any other determinism guarantees stay intact.
- Changing the manifest, the upload flow, or the launcher's empty
  state.

## Design Notes

**Why surface-level (not engine-level).** The engine already gives us
`{ terminal, terminalReason }` for every game. Routing those into a
nicer UI is a presentation concern — extending the YAML schema with
per-game endings would force every game to opt in for a feature that
is purely about how the browser renders an existing signal. If a game
later wants custom art or per-outcome variations, the right move is to
extend the engine *then*; we should not pre-build that surface today.

**Why a fresh seed on restart.** Without a seed override, restarting
through `createSession(definition)` would produce an identical run —
none of the three real games (`silly`, `pirate`, `ninja`) set
`world.dungeon.seed`, so they all fall through to the engine default
(`42`, see `src/runtime/state.js:46`). "Play again" feels broken if
the dungeon, monsters, and loot are bit-for-bit identical. A fresh
seed (`Date.now()` is fine — no need for crypto-quality randomness
here) makes each replay actually different. We keep the no-arg form
deterministic so existing CLI / parity tests that depend on the
default seed continue to work.

**Where to put the overlay markup.** The overlay can live as a
sibling of `#help` in `index.html` — a fixed-position element with
its own CSS that toggles a `.visible` class, matching the existing
help-panel pattern (see `#help` styles around `index.html:57–79`).
Reusing the same z-index/backdrop conventions keeps the visual
language consistent.

**Where to put the JS logic.** Two reasonable shapes:
- (a) Inline in `index.html`'s module script, alongside the existing
  `redraw` / `teardownSession` / `loadRegisteredGame` helpers. This
  is the lower-friction option and matches the current code's style.
- (b) Extract a small module `src/browser/game-over.js` with pure
  helpers (e.g. `getOverlayContent(state)` returning
  `{ heading, reason }`), and unit-test it independently. This is
  cleaner for testing.

Implementer's call. If going with (a), the
`test/browser-interface.test.js` smoke test in criterion 10b can
focus solely on the `createSession` signature change; criterion 10b
does not require the overlay logic itself to be unit-tested if it
lives inline (the regression risk is low — the engine signal is
already well-tested).

**State machine for the overlay.** There are exactly three live UI
states for a session:

```
playing           (state.terminal == null)
overlay-visible   (state.terminal != null, overlay mounted)
gone              (Menu pressed → session torn down → launcher)
```

Help-panel and quit-confirm only exist inside `playing`. The
overlay does not coexist with them.

**Touch list:**
- `index.html` — overlay markup (sibling of `#help`), CSS, and JS
  glue: cache definition on session start, swap the existing
  `state.terminal` branch in `redraw` to mount the overlay instead
  of writing to `#status`, install Play-again / Menu handlers,
  filter keys while overlay is up.
- `src/runtime/session.js` — extend `createSession(definition, opts?)`
  signature; forward `opts.seed` to `createState`. No behavior
  change when called with one arg.
- `test/runtime.test.js` (or new `test/session.test.js`) — unit
  test for the seed pass-through (criterion 10a).
- `test/browser-interface.test.js` — smoke test for the
  `createSession` signature (criterion 10b).

## Agent Notes

- The existing `state.terminal` early-return inside `redraw()`
  (around `index.html:365`) currently calls `renderer.clear()` and
  writes to `#status`. Replacing this branch is the main edit
  point — do **not** also remove the clear/status logic that runs
  in `teardownSession()`, which serves a different purpose
  (cleanup when leaving to the launcher).
- `session.handleKey` already short-circuits on terminal state
  (`src/runtime/session.js:180`) so dispatching keys to the session
  while the overlay is up is harmless. The reason criterion 5 still
  exists is that the surface-level `keyHandler` also opens the help
  panel and toggles other UI before the session sees anything —
  so the overlay must intercept those keys at the surface level.
- Don't add any backwards-compat shim for `createSession`. The
  intended call shape is `createSession(definition, opts?)` — a
  plain optional second argument is enough; no need for "old name
  vs new name" or any feature-flag.
- `Date.now()` is acceptable for the restart seed. Don't pull in
  `crypto.getRandomValues` — overkill for a roguelike replay seed.
- The `← Menu` button (`#back-to-menu`) is currently hidden via
  `body.in-launcher #back-to-menu { display: none; }`. The new
  overlay's Menu button is a separate element and must work
  independently — do not try to click `#back-to-menu`
  programmatically. Do, however, reuse the same teardown +
  history-reset + `showLauncherView()` sequence; extract a small
  helper if it improves readability.
- Verify in a real browser (`npm run serve`, then play a game to
  death or to the win condition) before marking done. The
  game-over path is not exercised by the existing test suite at
  the surface level.
