---
id: hide-demo-games-from-launcher
status: not-started
area: games
priority: 50
depends_on: []
description: Remove the three demo/test games (minimal, interact-demo, toy-hit-and-heal) from games/index.json so the launcher only shows real games
---

# Hide Demo Games from Launcher

## Goal

The browser launcher's game picker is fed by `games/index.json`. It
currently lists six entries, three of which are engine-internal demos
used only by tests (`minimal`, `interact-demo`, `toy-hit-and-heal`).
Drop those three from the manifest so the launcher shows only the
three real games (`silly`, `pirate`, `ninja`). The YAML files stay in
`games/` — tests load them by id and deep-links to them must continue
to work.

## Acceptance Criteria

1. **`games/index.json` contains exactly three entries**, in this
   order, with content unchanged from today:
   - `silly` — "Silly Game"
   - `pirate` — "Treasure of the Cursed Cove"
   - `ninja`  — "Shadow of the Moonless Castle"

2. **The three demo YAMLs are not deleted.** `games/minimal.yaml`,
   `games/interact-demo.yaml`, and `games/toy-hit-and-heal.yaml` remain
   on disk byte-identical to their current state.

3. **Launcher only shows the three real games.** With
   `npm run serve` running, opening `http://localhost:8000/` renders
   exactly three buttons (Silly Game, Treasure of the Cursed Cove,
   Shadow of the Moonless Castle), in that order, and no entries for
   the removed demos.

4. **Deep-links to demo games still boot directly.**
   `http://localhost:8000/?game=minimal`,
   `?game=interact-demo`, and `?game=toy-hit-and-heal` each load the
   corresponding YAML and start the game without going through the
   launcher (same behavior as before — `?game=<id>` is governed by the
   resolver, not the manifest).

5. **All existing tests still pass.** `npm test` is green; in
   particular the loader / flow / e2e / browser-interface suites that
   reference `minimal`, `interact-demo`, and `toy-hit-and-heal` must
   continue to load those games by id.

## Out of Scope

- Deleting the demo YAML files.
- Refactoring the launcher rendering code, the resolver, or
  `getCandidatePaths`.
- Changing how `?game=<id>` URLs are parsed or validated.
- Touching tests, other specs, or documentation that mentions the
  removed game ids.

## Design Notes

- `games/index.json` is the only file that needs to change. It is a
  hand-maintained manifest consumed by the launcher; the engine's
  game resolver works directly off `games/<id>.yaml` and does not
  consult the manifest.
- Preserve the existing JSON formatting style (two-space indent,
  one entry per line, trailing newline) so the diff is minimal.

## Agent Notes

- Do not run `prettier` or any formatter over `games/index.json` — the
  current file uses bespoke column alignment for readability and a
  reformat would balloon the diff. Edit only the three lines being
  removed.
- Verify criterion 4 by actually loading a deep-link in the browser,
  not just by reading the resolver code — the bug class this guards
  against is "manifest filtering accidentally leaking into the
  resolver."
