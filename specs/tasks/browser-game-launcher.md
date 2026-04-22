---
id: browser-game-launcher
status: not-started
area: browser
priority: 50
depends_on: []
description: Add a browser landing page that lets users pick a registered game from a list or upload their own YAML
---

# Browser Game Launcher

## Goal

Today the browser entry either auto-loads silly-game (no query string) or
loads the game named by `?game=<id>` (see `browser-game-param`). There is
no way to discover what games exist without reading the repo, and no way
to try a hand-written YAML without dropping it into `games/` first.

This task adds a launcher screen shown at `/` (no `?game=` param) with
two entry points:

1. **Pick a registered game** from a list sourced from a new
   hand-maintained manifest at `games/index.json`.
2. **Upload a YAML file** from disk — parsed in-browser via the existing
   `loadFromString()` path and run as a one-time ephemeral session
   (no persistence, gone on refresh).

Deep-link behavior is preserved: `/?game=<id>` with a valid ID bypasses
the launcher and loads that game directly, exactly as today. A small
"← Menu" button in the HUD returns to the launcher from a running
session without requiring a full reload.

## Acceptance Criteria

1. **New manifest file `games/index.json`.** Ship a hand-maintained JSON
   array cataloguing the four games currently under `games/`. Schema:
   ```json
   [
     { "id": "silly",            "title": "Silly Game",       "description": "A five-level roguelike dungeon crawl..." },
     { "id": "minimal",          "title": "Minimal Dungeon",  "description": "A minimal room to prove the engine pipeline works" },
     { "id": "interact-demo",    "title": "Interact Demo",    "description": "Exercises interaction flows, tile hooks, and the UI panel DSL" },
     { "id": "toy-hit-and-heal", "title": "Toy Hit and Heal", "description": "Two beings — a puncher and a healer — with three actions for e2e testing" }
   ]
   ```
   - Each entry has exactly these three string fields. No other fields.
   - `id` must satisfy `isValidGameId` (from `src/browser/game-select.js`)
     and must be resolvable via `getCandidatePaths(id)` against the
     current `games/` layout.
   - `title` and `description` are lifted from each game's `meta.name`
     and `meta.description` fields but live as plain strings in the
     manifest — the launcher does not parse YAML to render the list.
   - The file is human-written and committed; no generation script.

2. **New module `src/browser/manifest.js`** — pure JS, browser-safe, no
   Node imports, no DOM references. Exports:
   - `parseManifest(text)` — takes the raw JSON string, returns the
     array of entries, throws `Error` with a clear message on:
     - JSON parse failure → `"Invalid manifest JSON: <parser msg>"`
     - Non-array root → `"Manifest must be a JSON array"`
     - Any entry missing/non-string `id`, `title`, or `description` →
       `"Manifest entry <index> is missing <field>"`
     - Any entry whose `id` fails `isValidGameId` →
       `"Manifest entry <index> has invalid id: \"<raw>\""`
   - `loadManifest(fetchImpl = fetch)` — async, fetches
     `./games/index.json`, calls `parseManifest(await res.text())`,
     returns the array. If the fetch is not `ok`, throws
     `"Manifest not found at ./games/index.json (status <code>)"`.
     The `fetchImpl` parameter exists so unit tests can inject a
     stub; production callers pass nothing.

3. **Launcher UI rendered inline in `index.html`.** Add a
   `<section id="launcher">` element (sibling of `#game`) that contains:
   - A heading `<h1>` with the text `rogue-engine`.
   - A `<div id="launcher-games">` that the script populates with one
     `<button class="launcher-game">` per manifest entry. Each button's
     content shows `title` as a bold line and `description` as a
     smaller line below it. `data-game-id` attribute holds the `id`.
   - A horizontal rule or equivalent visual divider.
   - A labeled `<input type="file" id="launcher-upload" accept=".yaml,.yml,text/yaml,application/yaml">` with a `<label>` that
     reads "Or upload a YAML file" above it. No separate "upload"
     button; the `change` event on the input triggers the upload flow.
   - A `<div id="launcher-error">` (empty by default) for surfacing
     manifest-load or upload-parse errors.

   Style it to match the existing dark theme (`#0a0a0a` bg, `#cccccc`
   text, monospace, centered). The launcher and the game canvas are
   mutually exclusive: when the launcher is visible, `#game`,
   `#status`, `#messages`, `#key-hint`, and `#help` are hidden (e.g.
   via a `body.in-game` / `body.in-launcher` class toggle). The
   launcher is hidden once a session starts.

4. **Launcher bootstrap flow in `boot()`.** Rewrite the top of `boot()`
   so the logic is:
   ```
   read URLSearchParams from window.location.search
   read raw = params.get('game')
   if raw && isValidGameId(raw):
     bypass launcher; enter existing load-and-start path with that id
   else:
     show launcher; call loadManifest() and render the list;
     wire game-button clicks and the file-input change handler
   ```
   - The bypass path is unchanged from today: probe
     `getCandidatePaths(raw)`, fetch, call `loadFromString`, start
     the session. Existing error branch on fetch failure is preserved
     but the error view now also shows a "← Menu" button (see
     criterion 7).
   - `resolveGameId` from `src/browser/game-select.js` is no longer
     called from `boot()` (the launcher supersedes the
     default-fallback), but the helper itself remains unchanged and
     its tests continue to pass. Do **not** modify
     `src/browser/game-select.js`.

5. **Game-button click → start session.** Clicking a
   `.launcher-game` button:
   - Reads `data-game-id` and calls `getCandidatePaths(id)`.
   - Fetches the first candidate that returns `res.ok`; `loadFromString`
     on the text; `createSession`; hide launcher; show game surface;
     begin redraw loop (reusing exactly the same code the bypass path
     uses — extract a local `startSession(yamlText)` helper in the
     inline script to avoid duplication).
   - Updates the URL to `?game=<id>` via
     `history.pushState({}, '', '?game=<id>')` so refresh and bookmark
     work. Do **not** add a `popstate` listener; a user pressing
     browser-back mid-game will see a stale URL until they refresh,
     which is acceptable for v1.
   - On fetch/parse error, remain on the launcher and show the message
     `Failed to load game "<id>": <reason>.` in `#launcher-error`
     (red text, same styling as existing status errors).

6. **File-upload → start session.** On `change` of
   `#launcher-upload`:
   - Take the first `File` from `event.target.files`.
   - Read it as text via `FileReader.readAsText(file)` wrapped in a
     `Promise`.
   - Call `loadFromString(text)` and, if successful, call the same
     `startSession` helper used above.
   - Do **not** update the URL — uploaded games are ephemeral.
   - On `FileReader` error or `loadFromString` throw, remain on the
     launcher and show
     `Failed to load uploaded file "<filename>": <error message>.`
     in `#launcher-error`. Clear the file input so the user can retry
     the same file after editing it.
   - The uploaded session is otherwise identical to a registered one:
     full redraw loop, same key handling, same help panel.

7. **"← Menu" button returns to the launcher.** Add a
   `<button id="back-to-menu">← Menu</button>` in the HUD area
   (positioned top-right of the canvas region, small and unobtrusive,
   visible whenever `body.in-game` is set). Clicking it:
   - Tears down the running session: remove the `keydown` listener
     added in `boot()`, clear the canvas, clear `#status`,
     `#messages`, `#key-hint`, and close the help overlay if open.
     Drop the reference to the `session` and `renderer` so they can
     be GC'd.
   - Shows the launcher (`body` class toggle). If the manifest was
     already loaded during this page lifetime, reuse it; otherwise
     fetch it now.
   - Updates the URL to `/` via
     `history.pushState({}, '', window.location.pathname)` so a
     subsequent refresh lands back on the launcher.
   - Works from any session state — normal play, reticle/targeting,
     help open, quit-pending, or terminal (game-over). No exception
     is rethrown from the teardown path.

   The button is also visible on the bypass-path error view
   (criterion 4) so a user who linked to `?game=typo` can escape to
   the launcher without editing the URL.

8. **Manifest failure is non-fatal.** If `loadManifest()` throws
   (file missing, malformed JSON, invalid entry), the launcher still
   renders with:
   - An empty game list, with a small note `"No registered games
     available."` where the list would go.
   - The file-upload input fully functional.
   - The manifest error message printed to `console.error` (not
     `#launcher-error`, since upload still works).

   This keeps the upload path usable even if someone checks out the
   repo before the manifest is added, or if an edit to
   `games/index.json` breaks the JSON.

9. **Unit tests in `test/browser-interface.test.js`.** Add a new
   `describe('browser-interface: launcher manifest', ...)` block with
   `it(...)` cases covering `parseManifest`:
   - Valid manifest with four entries → returns the parsed array
     unchanged (deep-equal check).
   - Empty array `[]` → returns `[]` (valid edge case).
   - `"{}"` (not an array) → throws with message containing
     `"must be a JSON array"`.
   - Malformed JSON (e.g. `"[{"`) → throws with message starting
     `"Invalid manifest JSON:"`.
   - Entry missing `id` → throws with message containing
     `"entry 0 is missing id"` (or the right index/field).
   - Entry with non-string `title` (e.g. `null`, `42`) → throws.
   - Entry with `id: "../escape"` (fails `isValidGameId`) → throws
     with message containing `"has invalid id"`.

   Add a second `describe('browser-interface: launcher manifest fetch',
   ...)` block with `it(...)` cases covering `loadManifest` using a
   stub `fetchImpl`:
   - Stub returns `{ ok: true, text: async () => '<valid JSON>' }` →
     resolves to parsed array.
   - Stub returns `{ ok: false, status: 404 }` → rejects with message
     containing `"status 404"`.

   Do **not** add DOM-dependent tests for the launcher UI itself —
   that layer is manually verified per criterion 11. The inline
   launcher wiring in `index.html` is not covered by unit tests.

10. **Existing tests pass unchanged.** `node --test` continues to
    succeed. In particular, the existing
    `browser-interface: game selection` block from the
    `browser-game-param` task (testing `resolveGameId`,
    `isValidGameId`, `getCandidatePaths`) passes without
    modification — `src/browser/game-select.js` is not edited.

11. **Manual verification in the browser.** Start `npm run serve` and
    confirm all of the following before reporting done:
    1. `http://localhost:8000/` — the launcher shows, listing four
       games with titles and descriptions, plus the file-upload
       control. No canvas visible.
    2. Click each of the four game buttons in turn — each starts the
       correct game, URL updates to `?game=<id>`, arrows/actions
       work, help (`?`) works.
    3. From a running game, click "← Menu" — returns to launcher,
       URL clears to `/`, canvas is blank, HUD is empty.
    4. From the launcher, upload `games/minimal.yaml` — minimal boots
       and runs; URL stays at `/`.
    5. Upload a plainly invalid file (e.g. `package.json` renamed to
       `.yaml`, or a text file with bad YAML) — error appears in
       `#launcher-error` naming the file and the reason; launcher
       remains usable.
    6. `http://localhost:8000/?game=minimal` — bypasses launcher,
       boots minimal directly.
    7. `http://localhost:8000/?game=typo` — error view appears
       (`Failed to load game "typo": not found.`); "← Menu" button
       returns to the launcher.
    8. Temporarily rename `games/index.json` to simulate a missing
       manifest and reload — launcher still renders with the empty
       note, upload still works, console has the error.

## Out of Scope

- **No `popstate` / browser-back handling.** Pressing browser-back
  mid-game shows a stale URL; a refresh reconciles it. Full
  history-driven routing (manifest as SPA router) is a follow-up.
- **No persistence of uploaded games.** No `localStorage`, no
  IndexedDB, no "recent uploads" list. A refresh loses the uploaded
  game; the user re-uploads. This keeps scope tight and avoids
  privacy/size questions about storing arbitrary user files.
- **No drag-and-drop upload.** Just the `<input type="file">`
  element. Drag-drop adds event wiring and visual affordances worth
  a separate task if we want it.
- **No validation of uploaded YAML beyond what `loadFromString`
  already does.** The engine's schema validator is the source of
  truth; the launcher surfaces its error message verbatim.
- **No manifest generation script.** The manifest is hand-maintained;
  if someone adds a game to `games/`, they also add an entry to
  `games/index.json`. A `npm run games:index` generator can come
  later if the catalog grows.
- **No CLI changes.** The launcher is browser-only. The CLI's
  `--game <path>` dial is unaffected.
- **No keyboard shortcut for "back to menu".** The button is
  mouse-only in v1. A key binding (e.g. `CTRL+M`) adds a collision
  surface with existing keys and is worth scoping separately.
- **No launcher theming/skinning.** Plain dark-theme CSS inline in
  `index.html`, matching the existing aesthetic. No assets, no
  icons beyond the Unicode "←" in the menu button.
- **No i18n or localization.** English strings are hardcoded.
- **No changes to `src/browser/game-select.js`.** Its helpers are
  reused as-is; modifying them risks the `browser-game-param` tests
  and the bypass path.
- **No changes to `src/config/loader.js` or `src/runtime/session.js`.**
  Both already work browser-side; the launcher just calls them.

## Design Notes

**Why a hand-maintained manifest rather than scanning `games/` or
fetching every YAML.** The browser has no directory-listing API;
any "list games" feature needs *some* catalog. Options considered:
- Generate `games/index.json` from a script at commit time —
  adds a pre-commit hook or `npm run` step to remember. Worth it
  once the catalog grows past ~10 games; not worth it for 4.
- Fetch every YAML's `meta` block at launcher-load to build the
  list — four round trips on the cold launcher render, and grows
  linearly. Rejected.
- Hand-maintain a tiny JSON file — adds one line to commit when a
  new game ships, zero runtime cost, trivially cacheable. Chosen.

The drift risk (manifest's `title` / `description` falling out of
sync with the YAML's `meta.name` / `meta.description`) is real but
small, and a future generation step can close the gap without
changing consumers.

**Why list entries duplicate `title` and `description` rather than
deriving them at render time.** Rendering a button for a game
shouldn't require fetching that game. Duplication in a four-entry
JSON file is cheap; lazy-loading YAMLs for a picker is not.

**Why the launcher is inline in `index.html` rather than its own
module.** The launcher is ~60 lines of DOM construction and
event wiring with no reusable logic beyond the manifest parser
(which is extracted). Splitting the DOM into its own module would
require a thin `mount(root, { onStart, onUpload })` shim with no
testable surface — the parser is where the unit tests actually
help. Keeping the inline footprint modest means the existing
`<script type="module">` block stays the single entry point for
the browser.

**Why the `?game=<id>` bypass preserves today's deep-link behavior
instead of always showing the launcher.** Links that already exist
(`?game=minimal` shared in a chat, a bookmark, the out-of-the-box
default path) should keep working without forcing a user to click
through a menu. A user who wants the launcher can strip the query
string; a user with a link should land on the game.

**Why invalid `?game=<raw>` falls through to the launcher instead
of silently defaulting.** This is a subtle behavioral change from
the `browser-game-param` behavior (invalid → default silly). With
the launcher present, the UX failure mode for a typo'd URL is
"show the menu, let the user pick again" rather than "load
something unexpected". `resolveGameId`'s default-to-silly contract
still holds as tested; it's just no longer called from `boot()`.
Flagged explicitly in Agent Notes so the implementer doesn't try
to rewire `resolveGameId` itself.

**Why "← Menu" tears down the session rather than pausing it.**
Preserving a running session across a menu round-trip means either
(a) keeping the `session` in memory and repainting when the user
picks the same game, or (b) serializing to storage. Both add scope
and state machines. v1 semantics: "← Menu" is conceptually a
reload-without-losing-the-page — the game restarts if picked
again. A "resume" affordance is a natural follow-up if users want
one.

**Why the manifest failure is non-fatal and upload-only survives.**
The upload path doesn't depend on the manifest at all. Coupling
the launcher's availability to a file that could drift or break
would punish users trying out hand-written YAMLs — the opposite
of what the upload path is for.

**Touch list:**
- `games/index.json` — **new file**, ~15 lines of JSON.
- `src/browser/manifest.js` — **new file**, ~40 lines, exports
  `parseManifest` and `loadManifest`. Imports `isValidGameId` from
  `./game-select.js`.
- `index.html` — add launcher `<section>` + "← Menu" button; add
  import of `{ parseManifest, loadManifest }`; rewrite top of
  `boot()`; extract `startSession(yamlText)` helper; add
  `teardownSession()` helper; expand CSS block with launcher
  styles (list layout, button styling, error color, body-class
  toggle to show/hide launcher vs. game).
- `test/browser-interface.test.js` — add two new `describe`
  blocks covering `parseManifest` and `loadManifest`.

## Agent Notes

- **Read the `browser-game-param` and `browser-interface` specs
  first.** They are at `specs/tasks/browser-game-param.md` and
  `specs/tasks/browser-interface.md`. They define the helpers
  you're building on (`isValidGameId`, `getCandidatePaths`,
  `createSession`, `CanvasRenderer`) and establish the style of
  acceptance criteria / unit testing in this project.
- **Do not modify `src/browser/game-select.js`** — its contract
  and tests are load-bearing. The launcher uses `isValidGameId`
  and `getCandidatePaths` as-is.
- **Extract `startSession(yamlText)` inline.** The registered-game
  click handler, the file-upload handler, and the bypass path all
  call `loadFromString` → `createSession` → `CanvasRenderer` →
  `redraw` loop → keydown listener. Writing that body three times
  is a bug magnet. One inline helper is enough.
- **Likewise extract `teardownSession()`** — back-to-menu needs to
  remove the keydown listener, clear DOM state, and null out
  references. Keep it short.
- **Keep `src/browser/manifest.js` browser-safe.** No
  `node:fs`, no `window`, no `document`. Its only import is from
  `./game-select.js`. Unit tests will import it under
  `node --test` with a stub `fetchImpl`.
- **Use the existing dark theme.** CSS for the launcher goes in
  the existing inline `<style>` block. Keep the monospace font.
  Do not introduce a UI framework or icon set.
- **The "← Menu" button needs to be a real DOM button, not a
  canvas pixel.** It lives outside the canvas and is visible via
  body-class toggles so it's pointer-clickable. Place it near
  the top-right of the canvas container.
- **Do the full manual checklist in criterion 11.** The unit
  tests only cover the manifest parser. The DOM wiring,
  FileReader path, URL-history updates, and teardown are only
  validated by actually using the launcher in a browser.
- **Pre-flight:** `npm run serve`, then verify each of the eight
  steps in criterion 11 hits the expected state. Failing any one
  is a blocker.
- **Don't add CLI or engine changes.** The scope is purely the
  browser entry. If a missing engine affordance gets in the way
  (it shouldn't), call it out in the completion report rather
  than fixing it in this PR.
