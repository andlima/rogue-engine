---
id: browser-game-param
status: not-started
area: browser
priority: 50
depends_on: []
description: Let the browser entry pick which game to run via a `?game=<id>` URL param, defaulting to silly-game
---

# Browser Game Parameter

## Goal

`index.html:150` hardcodes `fetch('./games/silly/game.yaml')`, so the browser
can only run one game. The CLI already accepts `--game <path>`; this task
gives the browser an equivalent dial. A user typing
`http://localhost:8000/?game=minimal` should boot the minimal game;
`http://localhost:8000/` with no param continues to boot silly-game so
existing bookmarks keep working.

Game IDs in the URL use the **directory or file basename** under `games/`
(`silly`, `minimal`, `interact-demo`, `toy-hit-and-heal`) — not the
`meta.id` field inside the YAML (which is a different string, e.g.
`silly-game`). The directory/basename is what a user would guess after
`ls games/`.

The current `games/` layout mixes nested (`games/silly/game.yaml`) and
flat (`games/minimal.yaml`) shapes. Rather than introduce a manifest or
migrate files, the resolver probes both shapes in a fixed order.

## Acceptance Criteria

1. **New helper module `src/browser/game-select.js`.** Create a tiny
   pure-JS module (no Node-only imports; browser-safe) that exports:
   - `DEFAULT_GAME_ID` — the literal string `'silly'`.
   - `isValidGameId(id)` — returns `true` iff `id` is a string matching
     `/^[a-z0-9][a-z0-9-]*$/`. This guards against path traversal
     (`../`, `/`, `\`) and funny characters in the URL param.
   - `resolveGameId(searchParams)` — takes a `URLSearchParams`
     instance, reads the `game` key. Returns the value if
     `isValidGameId` accepts it; otherwise returns `DEFAULT_GAME_ID`.
     (An explicit invalid value falls back to the default rather than
     throwing — the browser surface shows a clear error at fetch time
     instead, see criterion 4.)
   - `getCandidatePaths(id)` — returns the array
     `[`./games/${id}/game.yaml`, `./games/${id}.yaml`]` (nested first,
     flat second). Order matters: `games/silly/` must resolve via the
     nested candidate, `games/minimal.yaml` via the flat one.

   The module has no side effects on import, does not reference
   `window`/`document`, and does not import from anywhere else in the
   repo. Small enough to be a single file (~30 lines).

2. **Wire the helper into `index.html`'s `boot()` function.** Replace
   the single hardcoded `fetch('./games/silly/game.yaml')` call
   (currently `index.html:150`) with:
   - Read `window.location.search` into `URLSearchParams`.
   - Call `resolveGameId(...)` to get the ID.
   - Call `getCandidatePaths(id)` to get the candidates.
   - Try each candidate with `fetch(path)` in order; use the first
     response where `res.ok` is true. Read `.text()` into `yamlText`.
   - If none succeed (all 404 or network errors), fall through to the
     existing error branch (criterion 4).

   The rest of `boot()` — `loadFromString`, `createSession`,
   `CanvasRenderer`, the keydown handler, `redraw` — is unchanged.

3. **Import map / script block updates.** Add the new module import
   alongside the existing imports at the top of the `<script
   type="module">` block:
   ```js
   import { resolveGameId, getCandidatePaths } from './src/browser/game-select.js';
   ```
   No change to the `<script type="importmap">` block (the helper has
   no external deps).

4. **Clear error message on failure.** When no candidate path
   resolves, the existing `#status` error branch
   (`index.html:153–157`) must show a message that names the game ID
   the user asked for, e.g.
   `Failed to load game "minimal-typo": not found.`
   — not just `fetch failed: 404`. Log the full error (including the
   last attempted path) to `console.error` so DevTools still shows
   detail. The criterion is that the on-page message includes the
   game ID as a double-quoted string so a user seeing a typo can spot
   it without opening DevTools.

5. **Default behavior preserved.** Opening `http://localhost:8000/`
   (no query string, or `?game=` empty, or `?game=` with an invalid
   ID) boots silly-game exactly as today: the canvas paints the
   silly-game map, `#status` shows the HUD, arrow keys move the
   player. This is a manual verification step; the module-level
   regression is covered by criterion 6.

6. **Unit tests in `test/browser-interface.test.js`.** Add a new
   `describe('browser-interface: game selection', ...)` block with
   `it(...)` cases covering:
   - `resolveGameId` with an empty `URLSearchParams` returns
     `'silly'`.
   - `resolveGameId` with `game=minimal` returns `'minimal'`.
   - `resolveGameId` with `game=../etc/passwd` returns `'silly'`
     (invalid → default).
   - `resolveGameId` with `game=Minimal` (uppercase) returns
     `'silly'` (invalid → default; IDs are lowercase).
   - `resolveGameId` with `game=` (empty value) returns `'silly'`.
   - `isValidGameId` accepts `'silly'`, `'minimal'`,
     `'interact-demo'`, `'toy-hit-and-heal'`; rejects `''`,
     `'../x'`, `'a/b'`, `'A'`, `'-leading-dash'`, `null`, `undefined`.
   - `getCandidatePaths('silly')` returns
     `['./games/silly/game.yaml', './games/silly.yaml']` in that
     exact order.
   - `getCandidatePaths('minimal')` returns
     `['./games/minimal/game.yaml', './games/minimal.yaml']`.

   Import the helpers directly from `src/browser/game-select.js`.
   The module is browser-safe but has no DOM references, so it
   imports cleanly under `node --test`.

7. **All existing tests pass unchanged.** `node --test` continues to
   succeed — `test/browser-interface.test.js`'s existing blocks
   (import-map pinning, CanvasRenderer smoke, browser-safe imports,
   index.html structure) all still pass.

## Out of Scope

- **No game picker UI.** Users type the ID into the URL bar (or
  follow a link). A dropdown/list that reads a manifest is a
  reasonable follow-up but doubles the scope and needs design
  decisions about layout; URL-only is the lean v1 the CLI's
  `--game <path>` mirrors.
- **No `games/manifest.json`.** The candidate-probing resolver makes
  a manifest unnecessary for v1. If the catalog grows past ~10
  games or we want to list them anywhere, a manifest can be added
  separately.
- **No migration of flat game files into nested directories.** The
  path inconsistency between `games/silly/game.yaml` and
  `games/minimal.yaml` is handled at lookup time, not by moving
  files. Standardizing the layout is a separate cleanup.
- **No CLI changes.** `cli.js --game <path>` continues to take a
  file path, not an ID. Teaching the CLI to accept bare IDs
  (so `cli --game minimal` works symmetrically) is a follow-up
  task; it touches arg parsing and error messages and is worth
  scoping on its own.
- **No changes to `scripts/serve.js`.** The dev server already
  serves YAML with the right MIME type; the parameterization is
  purely client-side.
- **No new games, no changes to existing game YAML.** Only the
  browser's game-selection path changes.
- **No `meta.id` surfacing.** The browser looks up games by
  directory/file basename, not by the `meta.id` field inside the
  YAML. The two happen to differ for silly (`silly` vs
  `silly-game`) and aligning them is out of scope.

## Design Notes

**Why probe both paths instead of requiring a manifest.** With four
games today, the probing cost (one extra 404 for flat games on cold
load, zero extra requests for nested games since we try nested
first) is invisible to the user. A manifest adds a file to maintain
and a load-order dependency (fetch manifest → resolve → fetch game)
that doubles the critical-path round trips. If/when the catalog
grows, a manifest becomes worthwhile — but not today.

**Why validate IDs server-path-style even though the server is
static.** `fetch('./games/<id>/...')` with an unvalidated `<id>`
from URL params is a path-traversal vector (`?game=../secrets`).
The dev server is local and the attack surface is tiny, but
validating at the helper is both cheap and the right layer — it
keeps `getCandidatePaths` pure and the concern localized. The
regex `/^[a-z0-9][a-z0-9-]*$/` is tight enough to cover all four
current games and reject anything odd; if a future game ID needs
underscores or uppercase, expanding the regex is a one-line edit.

**Why invalid IDs fall back to default rather than surfacing an
error.** Two reasons: (a) it mirrors how `?foo=bar` on most sites
silently ignores unknown params rather than halting, and (b) the
existing error branch at `index.html:154` already shows the user
the ID-in-quotes message when the default game can't be fetched
either. If someone types `?game=../etc/passwd`, they get silly-game;
if they type `?game=typo`, they get the "Failed to load game
\"typo\": not found." message. The distinction between "invalid
format" and "not found" isn't worth surfacing separately — both
mean "that's not a game".

**Why nested candidate first.** `games/silly/` is the only nested
game today and is also the default. Checking nested first means the
default path hits on the first fetch (no extra 404). The flat
fallback exists for `minimal.yaml`, `interact-demo.yaml`, and
`toy-hit-and-heal.yaml`. Reversing the order would cost a 404 on
every silly-game load, which is the majority case.

**Touch list:**
- `src/browser/game-select.js` — **new file**, ~30 lines, pure JS,
  exports `DEFAULT_GAME_ID`, `isValidGameId`, `resolveGameId`,
  `getCandidatePaths`.
- `index.html` — import the helpers; replace the single
  `fetch('./games/silly/game.yaml')` block with a probe loop;
  update the error message to include the game ID in quotes.
- `test/browser-interface.test.js` — add one `describe(...)` block
  with unit tests for the four helpers.

## Agent Notes

- **Verify manually in the browser after the edit.** Start
  `npm run serve` and open at minimum these three URLs:
  1. `http://localhost:8000/` — should boot silly-game.
  2. `http://localhost:8000/?game=minimal` — should boot minimal.
  3. `http://localhost:8000/?game=nope` — should show
     `Failed to load game "nope": not found.` in the `#status`
     line; DevTools console should have a matching error with the
     last attempted path.
  If all three behave as specified, the feature works. Don't ship
  without doing this — the unit tests cover the helpers but not
  the integration with `fetch` / the DOM.
- **Keep `src/browser/` browser-safe.** The new helper must not
  import anything from `node:`, and must not touch `window`/
  `document`. It's a pure-JS module by design so the tests can
  import it under `node --test` without a DOM shim.
- **Don't restructure `boot()`.** The probe loop can be a plain
  `for (const path of candidates) { ... }` inside the existing
  `try` block — no new helper function needed in the inline script,
  and nothing else in `boot()` should change.
- **`getCandidatePaths` returns relative paths with `./` prefix**
  to match the existing fetch style (`./games/silly/game.yaml`
  today) so the HTML file works whether it's served from `/` or
  from a sub-path.
- **Don't be tempted to also add a picker, manifest, or CLI
  change.** The spec is deliberately scoped to the URL-param dial;
  anything else becomes noise in the review and delays the PR.
