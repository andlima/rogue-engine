---
id: fix-blank-browser-page
status: not-started
area: config
priority: 50
depends_on: []
description: Defer the node:fs/promises import in loader.js so the module is browser-resolvable and index.html boots
---

# Fix Blank Browser Page

## Goal

The browser entry added by `browser-interface` is currently blank on load.
Root cause: `src/config/loader.js:1` has a top-level
`import { readFile } from 'node:fs/promises';`. Browsers cannot resolve the
`node:` scheme (the import map only defines `yaml`), so the module fails to
resolve. That failure cascades through the module graph — `index.html`'s
`<script type="module">` never executes, and no DOM text or canvas drawing
happens. `readFile` is used exactly once, inside `loadFromFile`
(`src/config/loader.js:1904`), and the browser path uses `loadFromString`
rather than `loadFromFile`. Move the Node-only import behind a dynamic
import inside `loadFromFile` so the module's static import graph is
browser-safe, keeping all existing CLI and test callers of `loadFromFile`
working unchanged.

## Acceptance Criteria

1. **Remove the top-level `node:fs/promises` import** from
   `src/config/loader.js:1`. No other top-level import in the file changes.
2. **Inline a dynamic import inside `loadFromFile`** so the function body
   resolves `readFile` lazily:
   ```js
   export async function loadFromFile(filePath) {
     const { readFile } = await import('node:fs/promises');
     const content = await readFile(filePath, 'utf-8');
     return loadFromString(content);
   }
   ```
   The function signature, name, and return value are unchanged.
3. **Blank-page symptom is resolved.** With the fix applied, running
   `npm run serve` and opening `http://localhost:8000` boots the silly-game
   map: the canvas paints a visible grid, `#status` shows the HUD, and
   keypresses advance the game. (This is a manual verification — no
   headless-browser test is added for it; criterion 5 codifies the
   module-level invariant that the regression would violate.)
4. **All existing tests pass unchanged.** `node --test` continues to
   succeed — in particular `test/loader.test.js`, `test/runtime.test.js`,
   `test/silly-parity.test.js`, `test/input-help.test.js`,
   `test/e2e.test.js`, and `test/flow.test.js` (the six test files that
   import or exercise `loadFromFile`) run green without edits. CLI smoke
   (`cli.js` → `loadFromFile(values.game)`) continues to work.
5. **Regression guard in `test/browser-interface.test.js`.** Add a new
   `it(...)` block (inside an existing `describe` or a new
   `describe('browser-interface: browser-safe imports', ...)` block) that:
   - reads `src/config/loader.js` as text,
   - extracts every `import … from '<specifier>'` statement that appears
     at the top of the file before the first non-import, non-comment line
     (a substring regex is fine — no AST parser),
   - asserts none of those specifiers start with `node:`.
   The test's purpose is to catch the exact regression this task fixes —
   anyone adding a new top-level `node:` import to `loader.js` will get a
   failing test with a clear message. Scope the check to `loader.js`
   only; other `src/` files may legitimately import `node:` modules in
   the future (e.g. a Node-only test helper).

## Out of Scope

- Splitting `loader.js` into a browser-safe core plus a Node-only file
  helper module. That is more invasive than needed — only one function
  (`loadFromFile`) is Node-specific, and the dynamic-import fix keeps the
  module graph clean for both runtimes.
- A broader sweep for `node:` imports across all `src/` files. Today
  `loader.js` is the only offender in `src/`; the regression test in
  criterion 5 is scoped to this one file, not the whole tree. A future
  task can generalize if new browser-consumed modules appear.
- Changing the import map, esm.sh pin, or anything in `index.html`.
- Adding a headless-browser (puppeteer/playwright) test to catch the
  original blank-page symptom automatically. Criterion 5's module-level
  check is the lighter-weight equivalent.
- Touching `loadFromString`, validation logic, or any other function in
  `loader.js` beyond the single-function edit.

## Design Notes

**Why a dynamic import, not a conditional top-level import.** A static
`import` is resolved at module evaluation time regardless of whether the
name is used — there is no tree-shaking at the browser's native module
loader level. Putting the `node:` specifier inside a dynamic `await
import(...)` defers resolution until `loadFromFile` is actually called,
which the browser never does. Node handles this path with no special
treatment (the import returns the real `node:fs/promises` module and
`loadFromFile` works exactly as before).

**Why scope the regression test to `loader.js` and not all of `src/`.**
A tree-wide scan would be noisy: plenty of future modules will
legitimately want `node:` imports (e.g. a Node-only dev helper, a
build-time script). The specific invariant that matters is "every module
the browser entry pulls in must be browser-resolvable." Rather than
statically computing that closure from `index.html`, we anchor the check
to the one module that actually broke the browser. If another module is
ever imported by the browser path and adds a top-level `node:` import,
it will fail at runtime loudly — at which point the fix is to add it
to this same test (or factor the check into a helper) rather than
pre-emptively cover files that the browser may never touch.

**Touch list:**
- `src/config/loader.js` — remove the top-level `readFile` import; add a
  dynamic import inside `loadFromFile`.
- `test/browser-interface.test.js` — add one `it(...)` block asserting no
  top-level `node:` imports in `loader.js`.

## Agent Notes

- **Verify the fix manually after the edit.** Start `npm run serve` (or
  `node scripts/serve.js`) and open `http://localhost:8000` in a
  browser. If the map paints and arrow keys move the player, the fix
  works. If the page is still blank, open DevTools → Console and the
  error will name the next unresolvable specifier; it should not be a
  `node:` specifier after this change.
- **Keep the edit minimal.** Two lines in `loader.js` — delete line 1,
  add one line inside `loadFromFile`. Don't reorder other imports,
  don't reformat the function, don't add comments describing the
  dance; the why is captured in this spec and the commit.
- **Don't move `loadFromFile` to a separate module.** `loader.js`'s
  named exports are consumed by eight files (see
  `grep -l loadFromFile`); moving the export would cascade into every
  caller. The dynamic-import fix is local.
- **Run `node --test` after the edit** to confirm the seven test files
  that touch `loadFromFile` or `loader.js` still pass. The new
  regression test in `test/browser-interface.test.js` should pass
  immediately after the loader edit — if it fails, the regex is
  catching a comment or a string literal and needs tightening.
