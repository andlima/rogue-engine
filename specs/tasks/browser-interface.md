---
id: browser-interface
status: not-started
area: rendering
priority: 50
depends_on: []
description: Add a browser play surface driven by a canvas renderer, alongside the existing CLI
---

# Browser Interface

## Goal

Today the engine is CLI-only: `cli.js` hardcodes `renderToString` and
friends from `src/renderer/ascii.js`, and `src/renderer/canvas.js` is a
66-line stub that throws on every method. The reference
implementation at `~/code/silly-game/` (and
[andlima/silly-game](https://github.com/andlima/silly-game) on GitHub)
ships a single `index.html` that loads the same core game module as
its CLI and plays the game in the browser with a canvas map + DOM HUD.
This task ports that shape to rogue-engine: a static `index.html` at
the repo root that boots the silly-game YAML, renders the map on a
`<canvas>`, exposes the same HUD / messages / help / key-hint surfaces
as the CLI via DOM elements, and drives input from `keydown` events
translated into the engine's existing `NAMED_KEYS` vocabulary. The
previously-stub `CanvasRenderer` becomes a real implementation; the
CLI's per-frame plumbing (flow-step input, reticle, intrinsic hints,
binding dispatch) is extracted into a shared module so both surfaces
consume it. No sprites, no mobile controls, no bundler.

## Acceptance Criteria

### Entry point & file layout

1. **`index.html` at repo root** — a single static HTML file. It loads
   via `<script type="module">` with no bundler. The inline script
   imports directly from `./src/...` using the same module graph as
   `cli.js` (e.g. `./src/config/loader.js`, `./src/runtime/state.js`).
   Open `~/code/silly-game/index.html` for the reference shape; this
   file should feel structurally similar (canvas + HUD + messages +
   help overlay, dark theme, monospace font) but must not copy game
   content — the game is driven by `games/silly/game.yaml`.
2. **Import map for the `yaml` npm package.** `src/config/loader.js:2`
   does `import YAML from 'yaml'`, a bare specifier the browser can't
   resolve. Add an `<script type="importmap">` block to `index.html`
   mapping `"yaml"` to the matching version on `esm.sh` (e.g.
   `https://esm.sh/yaml@2.7.0`). No change to `loader.js`; no new npm
   dependency. Pin the version to the `package.json` entry so a
   dependency bump only requires updating the import map, and add a
   one-line test (criterion 17) that asserts the two stay in sync.
3. **DOM layout in `index.html`** consists of, at minimum:
   - a `<canvas id="game">` that holds the map grid,
   - a status element (`<div id="status">`) for the HUD line,
   - a message log (`<div id="messages">`) — scrollable, fixed
     max-height (≈6em, matching silly-game),
   - a key-hint line (`<div id="key-hint">`) beneath the canvas,
   - a help overlay (`<div id="help">`, hidden by default) that
     displays the generated help panel.
   Use inline `<style>` for all CSS; no external stylesheet. Dark
   background (`#0a0a0a` or similar), monospace font, layout
   vertically centered. Skip the panel / prompt surfaces for now
   (see criterion 16 for their deferred status).

### CanvasRenderer becomes real

4. **`src/renderer/canvas.js` — replace the stub.** The exported
   `CanvasRenderer` class gets a real implementation. The constructor
   accepts `(canvasEl, renderingConfig)` — the canvas element is
   injected, not discovered via `document.getElementById` — so the
   module remains importable in Node for unit tests. It exposes these
   instance methods matching the surfaces listed in `docs/rendering.md`:
   - `drawGrid(grid, stateOrMode)` — paints the 2D `{ch, color}` grid
     to the canvas. Uses `ctx.fillText` per cell with a monospace
     font; uniform cell size (tile width/height computed from the
     largest glyph at a chosen font size, e.g. 24px). Honors
     `renderingConfig.tiles` overrides and `state.displayMode` the
     same way `renderToString` in `ascii.js` does (emoji mode prefers
     the `emoji` field on tile overrides; otherwise falls back to the
     ASCII `ch`). Colors resolve from a small `{ colorName → CSS }`
     map inside the module (same names as `ANSI_COLORS` in `ascii.js`,
     mapped to canvas-friendly CSS colors — the implementer picks
     reasonable CSS values; e.g. `gray: '#7a7a7a'`, `red: '#d24f4f'`,
     `bright_white: '#ffffff'`).
   - `drawReticle(grid, viewOrigin, target, indicator)` — matches the
     ASCII `drawReticle` contract. Overlays the indicator glyph on
     the canvas at the target's on-grid position; the base grid has
     already been painted by `drawGrid`, so this draws a single cell
     over the top.
   - `clear()` — clears the canvas (used between frames).
   - The previously-defined stub methods `draw`, `drawPanel`,
     `drawPrompt`, `drawHelpPanel`, `drawKeyHint` are **removed** —
     panels / prompts are out of scope (criterion 16), and
     help / key-hint / status / messages are DOM responsibilities
     handled by the browser entry (criterion 7). `drawGrid` replaces
     `draw` because `ascii.js`'s equivalent export is named
     `renderToString`; keeping the two shapes aligned per-surface
     (string output vs. canvas output) is clearer than a shared
     `draw` name that means different things.
5. **Font & sizing.** Pick a canvas tile size that comfortably holds
   a 2-column emoji (e.g. 28px cell, 20px font). The canvas intrinsic
   size is `tileSize * VIEW_W` by `tileSize * VIEW_H` where `VIEW_W`
   and `VIEW_H` match `cli.js:35–36` (21 × 15). Scale via CSS if
   necessary for HiDPI, but fidelity is not a gate here — readable is
   enough.
6. **No regression in existing renderer tests.** `test/renderer.test.js`
   currently constructs a `CanvasRenderer` and asserts `draw()` throws
   "not implemented". Update that test block: construct with a
   lightweight stub canvas (`{ getContext: () => ({ … }) }`) and
   assert the class exposes `drawGrid`, `drawReticle`, and `clear`.
   Keep the `ANSI renderer` test block untouched.

### Session plumbing extracted

7. **Extract shared game-loop logic** out of `cli.js` into a new
   module under `src/runtime/` (suggested name `session.js`; the
   implementer may choose a better name if it fits the existing
   module shape). It exports a `createSession(definition)` factory
   returning an object whose surface is, at minimum:
   - `getState()` → current `state`
   - `getHelpOpen()` → boolean
   - `getQuitPending()` → boolean
   - `getReticle()` → `{ x, y } | null`
   - `getIntrinsicHints()` → same shape as the existing
     `intrinsicHints()` in `cli.js:167`
   - `handleKey(key)` → applies one normalized `NAMED_KEYS` keypress
     to the session, mutating internal state; returns a small object
     like `{ changed: boolean, terminal: state.terminal | null }` so
     the surface knows whether to redraw and whether to wind down.
   Internally the module owns `state`, `helpOpen`, `quitPending`,
   `reticle`, and `inputState`, and folds in the logic currently at
   `cli.js:62–228, 245–299` (`ensureReticleFor`, `tryFlowStepInput`,
   `isLowerAlpha`, `actOnBinding`, the flow-runner/resolver fall-
   through, the quit-confirm and help branches, and the game-over
   short-circuit from the `cli-game-over-exit` task). Direction and
   reticle delta tables (`cli.js:44–60`) move with it.
8. **`cli.js` consumes the session.** Replace the duplicated logic
   with calls into `createSession` — the `data` listener becomes
   `session.handleKey(normalizeTerminalInput(raw))` plus a redraw. The
   CLI keeps ownership of `draw()` (TTY-specific: `\x1b[2J\x1b[H`
   clear, `console.log` output, the game-over exit via
   `exitAfterRestore` etc.). No behavior change: every existing
   `test/cli.test.js` subprocess test, `test/silly-parity.test.js`
   trace, and other integration test passes unchanged.
9. **Browser entry consumes the session** identically. The inline
   script in `index.html` wires `document.addEventListener('keydown')`
   → `domKeyToNamed(event)` → `session.handleKey(key)` → redraw, and
   calls `redraw()` once on boot. No duplication of
   `tryFlowStepInput` or `actOnBinding` logic in the browser entry —
   everything goes through `createSession`.

### Browser input

10. **DOM key → NAMED_KEYS translation.** The browser entry has a
    `domKeyToNamed(event)` helper that returns a key string the
    resolver understands. Required mappings:
    - `ArrowUp/Down/Left/Right` → `UP/DOWN/LEFT/RIGHT`
    - `Enter` → `ENTER`
    - `Escape` → `ESC`
    - `Tab` → `TAB` (and `event.preventDefault()` so the browser
      doesn't shift focus)
    - `' '` (space) → `SPACE`
    - `Backspace` → `BACKSPACE`
    - `Delete` → `DELETE`
    - Single printable characters → themselves (`event.key` when
      `.length === 1`)
    - `event.ctrlKey` / `event.shiftKey` / `event.altKey` produce
      `CTRL+<key>` etc. per the `parseKey` canonical form in
      `src/input/keys.js:149`. At minimum, `CTRL+c` and `CTRL+d` are
      mappable so the `quit` built-in binding works in the browser.
    - Returns `null` for unmappable events (modifier-only presses,
      function keys the engine doesn't use, etc.); the listener
      ignores `null` and falls through to the default browser
      behavior. Matches `normalizeTerminalInput`'s null-on-unknown
      contract (`src/input/keys.js:175–203`).
11. **No auto-repeat beyond what the browser provides.** `keydown`
    handler fires once per press, plus whatever the OS repeat rate
    yields while the key is held. No synthetic hold-to-repeat timer
    (silly-game has one; rogue-engine v1 doesn't — criterion 16).
12. **Focus handling.** The keydown listener is on `document` (or
    `window`), not the canvas, so the player does not need to click
    first. `event.preventDefault()` is called after a successful key
    translation so Space doesn't scroll the page and arrow keys
    don't navigate.

### Browser redraw

13. **Single redraw pass.** The browser entry exposes a `redraw()`
    function that:
    - clears the canvas,
    - if `session.getState().terminal`: writes the game-over line to
      `#status` (`Game over — <terminal> (<reason>).`), clears the
      message log, hides the help overlay, and stops. (No "press any
      key to exit" equivalent for the browser — closing the tab is
      the exit.)
    - else if `session.getHelpOpen()`: shows the help overlay with
      `drawHelpPanel(getHelpRows(definition, state))` rendered into
      `#help` as text (`<pre>`), and keeps the last map + HUD
      underneath (no need to re-paint the canvas in this frame).
    - else if `session.getQuitPending()`: writes `Quit? (y/n)` to
      `#status`. Canvas stays as last frame.
    - else: computes `fovMap` via `computeFOV`, gets the grid via
      `getVisibleTiles`, calls `canvasRenderer.drawGrid(grid, state)`.
      If a reticle is active, calls `drawReticle` over the canvas
      with the same indicator used by the CLI.
      Writes `renderStatus(state)` to `#status`. Writes the most
      recent messages via `renderMessages(state)` to `#messages` (one
      per line, most recent at the bottom). Computes the key hint
      via `getKeyHint(definition, state, session.getIntrinsicHints())`
      and writes it to `#key-hint`.
14. **Hardcoded game for v1.** The browser entry fetches
    `./games/silly/game.yaml`, passes the text to `loadFromString`,
    and calls `createSession(definition)`. No URL parameter, no game
    picker, no fallback. If the fetch fails the entry writes the
    error message to `#status` and logs to the console — no crash
    overlay needed.
15. **TAB toggles display mode in the browser** — because it's
    already wired in `games/silly/game.yaml` and the resolver
    handles it, the browser inherits this for free once criteria
    7–10 are in place. Criterion 10 explicitly calls out
    `preventDefault` on TAB so this works; no additional code needed
    beyond the session.

### Out-of-scope surfaces explicitly deferred

16. **Panels and prompt banners are not drawn in the browser v1.**
    `drawPanel` / `drawPrompt` from `ascii.js` are CLI-only surfaces
    used by interaction flows. If a flow step reaches a panel (e.g.
    `pick_item`) during browser play, the v1 browser does **not**
    crash — `redraw()` falls through to the default grid path and
    the player can still step/cancel via keyboard — but the panel
    contents won't be visible. Document this in the `docs/rendering.md`
    addition (criterion 19). Silly-game.yaml does not currently
    invoke panels from its default gameplay loop, so this is a
    cosmetic limitation, not a playability blocker. A follow-up
    spec can flesh these out.

### Serving & tests

17. **`npm run serve` script.** Add a script in `package.json`:
    `"serve": "node scripts/serve.js"`. Create
    `scripts/serve.js` — a tiny static server using only `node:http`
    and `node:fs/promises` that serves the repo root on a fixed port
    (8000), with correct MIME types for `.html`, `.js`, `.mjs`,
    `.yaml`, and `.png`. No dependency adds. 50 LoC or under; the
    goal is "open http://localhost:8000 and play", not a full dev
    server (no live reload, no transforms).
18. **Import-map pinning test.** Add a test in
    `test/browser-interface.test.js` (new file) that:
    - reads `package.json` and extracts `dependencies.yaml`,
    - reads `index.html`, extracts the `yaml` mapping from the
      `<script type="importmap">` block via regex,
    - asserts the version in the import map matches the `package.json`
      version (ignoring the `^` / `~` caret).
19. **Module-level smoke test.** In the same
    `test/browser-interface.test.js`, import `src/renderer/canvas.js`,
    construct a `CanvasRenderer` with a stub canvas whose
    `getContext('2d')` returns a recording object (captures
    `fillText`, `fillRect`, `clearRect` calls), call `drawGrid` with
    a 2×2 fixture grid, and assert:
    - `clearRect` was called once,
    - `fillText` was called at least 4 times (one per cell),
    - at least one `fillText` call used an override-resolved glyph
      when the fixture's `renderingConfig.tiles` maps a char to a
      different glyph.
    This is a correctness check that doesn't require a real canvas.
20. **`index.html` structural test.** In the same file, parse
    `index.html` as text and assert the presence of:
    - a `<canvas id="game">` element,
    - `<div id="status">`, `<div id="messages">`, `<div id="key-hint">`,
      `<div id="help">` elements,
    - `<script type="importmap">` block,
    - `<script type="module">` block that references
      `./src/config/loader.js` and `./src/runtime/state.js`.
    Keep the assertions substring-based (no DOM parser dependency).
21. **All existing `test/*.test.js` pass unchanged.** Criterion 8
    (session extraction) is the only change touching CLI behavior;
    its guarantee is behavior-preserving.

### Docs

22. **`docs/rendering.md` — add a "Browser renderer" subsection**
    after the "ANSI renderer" section (after current line 60). List
    the new `CanvasRenderer` surface (`drawGrid`, `drawReticle`,
    `clear`), note that HUD / messages / help / key-hint are
    rendered into DOM elements by the browser entry rather than
    through renderer methods, and call out the v1 deferrals
    (panels, prompts, sprites, hold-to-repeat, mobile controls).
23. **`README.md` — add a "Playing in the browser" subsection**
    after the existing CLI usage section. Three lines: `npm run
    serve`, then open `http://localhost:8000`, then "arrow keys to
    move, TAB to toggle emoji mode, ? for help".

## Out of Scope

- Sprite rendering. Silly-game ships `assets/roguelike-sprites.png`
  and a sprite-mode renderer; rogue-engine v1 renders glyph text on
  canvas only. No assets directory, no sprite sheet. A later task can
  add sprite mode behind a render-mode toggle.
- Hold-to-repeat, key-repeat timers, chord bindings with timeouts.
  Browser OS auto-repeat on held keys is the only repeat; the
  engine's existing chord input (if any) works the same as in the
  CLI.
- Touch controls, mobile action bar, on-screen buttons. The v1
  target is desktop keyboard play.
- Audio. Silly-game has `playAudioForDiff`; rogue-engine has no
  audio primitives and this task doesn't add them.
- Minimap overlay.
- A bundler (esbuild/vite/webpack). The whole point of the import-
  map approach is no build step. If the `yaml` package were to
  change shape in a future major bump such that esm.sh can't serve
  it, the follow-up is an import-map version pin — not a bundler.
- `drawPanel` / `drawPrompt` implementations in the browser (see
  criterion 16).
- A game picker or loader UI. The entry is hardcoded to silly-game.
- Canvas render-mode toggle (emoji vs ASCII is handled via
  `state.displayMode` and TAB; there is no separate "render mode"
  like silly-game's emoji/sprite/ASCII picker because there are no
  sprites).
- Reshaping `src/renderer/ascii.js` into a class to match the new
  `CanvasRenderer` class. ASCII stays as free-function module
  exports; that's how `cli.js` consumes it today and changing it is
  churn outside this task's scope. The "contract" in
  `docs/rendering.md` is a set of responsibilities, not a literal
  interface.

## Design Notes

**Why canvas for the map and DOM for everything else.** Silly-game
does exactly this, and the reasoning holds: a monospace grid of text
is cheaper to redraw on canvas than to mutate as N DOM nodes (every
viewport cell is a node otherwise), while the HUD / messages / help
are structurally DOM-shaped (variable-width text, scrollable,
overlayable) and trivial to update as `textContent`. Keeping the
existing `ascii.js` functions (`renderStatus`, `renderMessages`,
`drawHelpPanel`, `drawKeyHint`) in play for the DOM surfaces avoids
reimplementing layout; they produce strings, which set directly onto
element `textContent`. The CLI pastes those strings to stdout; the
browser pastes them to the DOM. Same source of truth.

**Why import-map + esm.sh.** The alternative — a bundler — introduces
a build step, a `dist/` output, and two classes of "am I running the
built or the source?" bugs. The alternative — vendoring `yaml` — adds
~60KB of committed third-party code and breaks `npm update`. The
alternative — rewriting the loader to `import('https://...')`
directly — couples source files to the browser environment. An import
map is the minimum surface that matches the reference (silly-game has
no bundler) and keeps `src/config/loader.js` unchanged.

**Why extract session plumbing now.** Duplicating `tryFlowStepInput`,
`actOnBinding`, and the quit/help state machine between CLI and
browser would guarantee drift the moment either surface added a
feature. The extraction is mechanical — the existing code is already
mostly pure, and the stateful bits (`helpOpen`, `quitPending`,
`reticle`) collapse neatly into a session object. This is the only
non-trivial refactor in the task and it pays for itself the first
time a new input binding or flow step needs adding.

**Why not a headless-browser test.** Criteria 19 / 20 verify the
important invariants (canvas renderer paints the right primitives,
`index.html` has the expected structure, import map is pinned)
without a puppeteer/playwright dependency, which would be heavy for
one test. The session extraction (criterion 7–8) inherits full CLI
test coverage because the CLI continues to drive `createSession` —
so the shared logic is exercised by every existing integration test.

**Touch list:**
- `index.html` (new) — browser entry + inline script.
- `src/renderer/canvas.js` — replace stub with real implementation.
- `src/runtime/session.js` (new, name flexible) — extracted session
  plumbing.
- `cli.js` — consume `createSession`; drop duplicated helpers.
- `scripts/serve.js` (new) — minimal static server.
- `package.json` — add `serve` script.
- `test/browser-interface.test.js` (new) — the three tests in
  criteria 18–20.
- `test/renderer.test.js` — update the CanvasRenderer block.
- `docs/rendering.md`, `README.md` — the additions in 22–23.

## Agent Notes

- **Open `~/code/silly-game/index.html` before writing**. It's the
  reference shape. Note how it uses inline `<script type="module">`,
  how it sizes the canvas from viewport dimensions, how the HUD
  elements are laid out, and how `document.addEventListener('keydown')`
  is wired. Don't copy game content (silly-game has its own state
  engine, not rogue-engine's) — copy the structure.
- **`cli.js:245–299` is the code that needs to move** into
  `createSession`. Read it end-to-end; the control flow has five
  short-circuit paths (game-over, quit-confirm, help, flow-runner,
  resolver-fall-through). All five belong in the session.
- **Verify the session extraction with `test/cli.test.js` first.**
  Run the existing subprocess test after extraction — if it still
  passes, the behavior is preserved. Only then wire up the browser.
- **`Intl.Segmenter` / emoji handling** is already correct in
  `ascii.js` via `state.displayMode` — the canvas renderer doesn't
  need its own emoji logic. Reuse the same `renderingConfig.tiles`
  / `renderingConfig.beings` override walks; the override shape is
  the same across renderers per `docs/rendering.md`.
- **Font rendering on canvas**: `ctx.font = '20px monospace'` plus
  `ctx.textBaseline = 'top'` and `ctx.fillText(ch, x, y)` is the
  simplest path. Measure once with `ctx.measureText('M')` to pick
  cell width if you want precise alignment; for emoji, a cell width
  of `fontSize * 1.2` is usually fine. Don't over-engineer — this is
  the text-rendering path, not the sprite path.
- **The `yaml` version pin** in the import map (criterion 2) should
  match the current `package.json` exactly (`^2.7.0` → `2.7.0` in
  the URL). Criterion 18's test catches drift.
- **`scripts/serve.js`**: one file, no deps. Example structure —
  `http.createServer` → read the URL path, resolve to a file under
  repo root, stream back with MIME type. Reject `..` in paths. 404
  on missing. Don't add logging, config, CLI flags, or hot reload.
- **Don't touch `src/renderer/ascii.js`**. Every existing test and
  the CLI depend on its named exports; changes here cascade. The
  browser renderer is its own module.
- **Don't reshape the `canvas.js` class into a module-level
  exports file** — `CanvasRenderer` is a class because it owns
  per-canvas state (the element reference, the 2d context, cached
  metrics). Stateless function exports like `ascii.js` would force
  the caller to thread that state through every call; the class
  form is correct for the browser.
