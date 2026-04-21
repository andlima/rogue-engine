---
id: emoji-width-validation
status: not-started
area: rendering
priority: 50
depends_on: [emoji-rendering]
description: Reject emoji strings at load time when they cannot be trusted to occupy two terminal columns
---

# Emoji Width Validation

## Goal

The `emoji-rendering` task deliberately scoped width handling out
(`specs/tasks/emoji-rendering.md:118–123`), leaving the ANSI renderer
with a single rule: "if the glyph string is more than one UTF-16 code
unit, assume it occupies two columns." That rule is wrong for three
categories of emoji that real authors reach for today:

1. **ZWJ sequences** such as `🏴‍☠️` (U+1F3F4 U+200D U+2620 U+FE0F) —
   many terminals render these as three or more columns, or fall
   back to component glyphs.
2. **Text-presentation emoji without VS16** such as `⚔` (U+2694),
   `⛵` (U+26F5), or `☠` (U+2620) — single BMP codepoints whose
   default presentation is *text*, so they may render as one column
   despite being "emoji-like". The renderer's `isNarrowGlyph` check
   (`src/renderer/ascii.js:37`) only looks at `ch.length === 1`, so
   `⚔` currently gets padded to 2 cols (assumed narrow), whereas on
   a terminal that renders it as 2 cols the trailing space overshoots
   and the next cell drifts right.
3. **Skin-tone modifiers and other multi-grapheme strings** — any
   combining sequence the renderer has no way to measure.

The user has a game spec at `~/pirate-game/pirate-v2.yaml` using
`🏴‍☠️`, `⚔`, `🛡`, `⛵`, and `🔫`. Playing it produces a jagged map
grid. Rather than teach the renderer per-glyph width measurement
(adds a dependency, still defers to font behavior), we fail fast at
load time: every `emoji` field in the YAML must be a single grapheme
that the engine can trust to render in exactly two terminal columns,
or the loader throws a `SchemaError` pointing the author at a fix.

## Acceptance Criteria

### Validation surface

1. **Every `emoji` string in the schema is validated.** The loader
   already accepts `emoji` in six places
   (`src/config/loader.js:145,208,919,943,967,994`). All six run
   through a new `validateEmojiString(str, path)` helper and throw
   `SchemaError(path, ...)` on failure. No other schema locations
   need changes.
2. **Validation runs on the raw string before it lands on the
   `being`/`item`/`rendering override` object** — i.e. fail before
   the field is copied into the validated definition, so invalid
   input never reaches the runtime.
3. **Missing emoji is still allowed.** The field remains optional
   everywhere; validation only fires when the author supplied a
   non-null string. The existing `typeof entry.emoji !== 'string'`
   check stays (it now sits beside the new width check).

### Rejection rules

4. The validator **rejects** an emoji string when any of the
   following is true:
   a. **Empty or whitespace-only string.**
   b. **Contains U+200D (ZWJ).** Example: `🏴‍☠️`, `👨‍👩‍👧`.
   c. **Contains a skin-tone modifier** (any codepoint in
      U+1F3FB..U+1F3FF). Example: `🧔🏽`.
   d. **Contains a regional indicator pair** (U+1F1E6..U+1F1FF).
      Example: `🇺🇸`. (These render as country flags whose width
      is terminal-dependent.)
   e. **Contains a tag sequence** (any codepoint in
      U+E0020..U+E007F). Example subdivision flags like
      `🏴󠁧󠁢󠁳󠁣󠁴󠁿`.
   f. **Resolves to more than one extended grapheme cluster** as
      reported by `new Intl.Segmenter(undefined, { granularity:
      'grapheme' })`. Example: `⚔⚔` (two bare swords). This is the
      backstop that catches multi-emoji strings not covered by
      (b)–(e).
   g. **Single BMP base codepoint without U+FE0F (VS16).** If the
      string's first codepoint is in the Basic Multilingual Plane
      (i.e. `.codePointAt(0) < 0x10000`) and the string is *not* the
      two-codepoint form `<base> <U+FE0F>`, reject. Examples:
      reject `⚔` (bare U+2694), accept `⚔️` (U+2694 U+FE0F).
      ASCII letters like `@` also fall under this rule, so putting
      `emoji: "@"` is a load-time error — the author should leave
      `emoji` unset and let the fallback path emit the ASCII glyph
      per emoji-rendering criterion 11.
5. The validator **accepts** everything else. In practice this
   means: a single grapheme whose base codepoint is in the
   supplementary plane (e.g. `🐀`, `💰`, `🪨`), optionally followed
   by VS16, with no ZWJ or modifier codepoints. A BMP codepoint
   plus VS16 (e.g. `⚔️`, `🛡️`, `⛵️`) is also accepted.
6. **No Unicode data table ships in this task.** Rules (4b)–(4g)
   above are the whole ruleset; the implementer does not need to
   consult `emoji-data.txt` or any width library. `Intl.Segmenter`
   is built into Node.js (available since v16) and is the only
   "external" dependency, and no new npm package is added.

### Error message

7. Each `SchemaError` message names the offending string, the
   category it failed, and a concrete suggestion. Suggested phrasing
   per category — implementer can tune wording as long as all three
   pieces (input, reason, suggestion) appear:
   - ZWJ: `emoji "🏴‍☠️" contains a ZWJ sequence; pick a single-
     codepoint emoji like "🏴" or "☠️"`
   - Skin tone: `emoji "🧔🏽" contains a skin-tone modifier; use the
     base emoji without the modifier (e.g. "🧔")`
   - Regional / tag: `emoji "🇺🇸" is a flag sequence whose width is
     terminal-dependent; pick a non-flag emoji`
   - Multi-grapheme: `emoji "⚔⚔" is more than one grapheme; use a
     single emoji per field`
   - BMP without VS16: `emoji "⚔" is a text-presentation codepoint
     without VS16; write "⚔️" (append U+FE0F) to force emoji
     presentation`
   - Empty: `emoji must be a non-empty string; omit the field to
     fall back to the ASCII glyph`
8. The error is a `SchemaError` with the correct `path` (e.g.
   `beings[3].emoji`, `rendering.items.flintlock.emoji`,
   `rendering.status_rules[0].emoji`). Re-use the `path` argument
   already threaded through each call site; do not invent a new
   error type.

### Fixture audit

9. **`games/silly/game.yaml`** passes the new validation without
   modification *or* is updated so that it does. If any declared
   emoji fails, change only the offending string — do not restyle
   unaffected emoji. After the change, `node --test
   test/silly-parity.test.js` still passes and the YAML still
   loads.
10. **No other committed YAMLs in `games/` need updates** unless
    they already declare `emoji` fields that fail validation. (At
    time of writing, only the silly game declares emoji.)

### Regression coverage

11. **New tests in `test/loader.test.js`** (or a new
    `test/loader-emoji.test.js` — either is fine; prefer the
    existing file to keep loader tests co-located). Each test
    asserts that loading a minimal YAML with the named emoji
    produces a `SchemaError` whose message mentions the expected
    category substring:
    - `🏴‍☠️` → "ZWJ"
    - `⚔` alone → "VS16" or "text-presentation"
    - `🧔🏽` → "skin-tone"
    - `🇺🇸` → "flag"
    - `⚔⚔` → "grapheme"
    - `""` (empty) → "non-empty"
    - `@` (single ASCII char as emoji field) → "VS16" or
      "text-presentation"
12. **Acceptance tests** in the same file, asserting that each of
    the following loads without error when placed in the `emoji`
    field of a being:
    - `🐀` (supplementary plane, no VS16)
    - `💰` (supplementary plane)
    - `⚔️` (BMP + VS16)
    - `🛡️` (supplementary + VS16, no-op but valid)
13. **End-to-end rejection test** at `test/fixtures/pirate-v2-like.yaml`
    — a minimal fixture that declares a single being with
    `emoji: "🏴‍☠️"`. A test in `test/loader.test.js` loads the
    fixture via the normal `loadGame` path and asserts the
    `SchemaError` surfaces the correct `path` and the ZWJ category.
    Keep the fixture under 40 lines; strip every section that is
    not required by the loader.
14. **`test/silly-parity.test.js` and every other existing
    `test/*.test.js`** pass unchanged. This is the regression
    guard; no existing behavior shifts because no valid emoji in
    the current codebase becomes invalid under the new rules
    (criterion 9 covers the one place that might).

### Docs

15. **`docs/schema.md`** — in the section that documents the
    `emoji` field (added by emoji-rendering), append a short
    "Allowed emoji" subsection listing rules (4a)–(4g) and the
    pointer to `docs/rendering.md` for the "why". No other docs
    changes.
16. **`docs/rendering.md`** — in the existing "Display modes"
    subsection, add one paragraph explaining that the engine
    assumes every declared emoji occupies exactly two columns and
    that the loader enforces this at parse time. Mention the three
    most common author-facing mistakes (ZWJ sequences, bare
    text-presentation emoji, skin-tone modifiers) with the
    suggested workaround for each.

## Out of Scope

- Measuring per-glyph width at render time. The `isNarrowGlyph`
  check in `src/renderer/ascii.js:37` stays as-is; it is safe
  because the loader now guarantees no emoji with `.length >= 2`
  will misrender. Do not add `string-width`, `wcwidth`, or any
  other width library.
- The canvas renderer (`src/renderer/canvas.js`) — still a stub;
  width validation is only needed for the ANSI path today.
- Auto-fixing invalid emoji (e.g. "if you meant `⚔`, we'll insert
  VS16 for you"). The error message suggests the fix; the author
  edits the YAML.
- Emoji used inside `message` text, panel titles, or other
  free-form strings. Those render through plain string write and
  are not on the map grid; width drift there is at most a
  cosmetic line-wrap issue and has its own solutions (message log
  truncation) outside this task.
- A Unicode data table / auto-detection of text-presentation
  emoji. The BMP-without-VS16 rule (4g) is intentionally a
  conservative over-approximation: it rejects any single BMP
  codepoint without VS16 rather than consulting `emoji-data.txt`.
  This means some "safe" BMP emoji get rejected too (there aren't
  many, and the fix — adding VS16 — is always safe).
- Changing the emoji-rendering spec's criteria 1–2 wording ("may
  be a multi-codepoint emoji with ZWJ/variation selectors"). That
  file is historical; this task supersedes it without editing it.
  Only `docs/schema.md` and `docs/rendering.md` are updated.
- CLI `--check` / `spec lint` subcommands. Validation runs during
  the normal load path; no new CLI surface.

## Design Notes

**Why BMP-without-VS16 over a curated text-presentation list.**
The set of emoji with default-text presentation (about 160 of
them, per Unicode emoji-data) is stable but non-trivial to ship.
Hand-maintaining a list invites bit-rot when Unicode adds new
codepoints. The simpler rule — "if it's in the BMP, require
VS16" — over-rejects a handful of safe BMP emoji (e.g. U+1F3F4 if
it existed; it doesn't, it's actually supplementary) but never
under-rejects a problematic one, and the fix for a false positive
(append VS16) is always valid. The trade-off favors authors:
"always write emoji with their emoji-presentation form" is a
clearer rule than "memorize which codepoints default to text."

**Why `Intl.Segmenter`.** It is built into Node.js, has no I/O
cost, and correctly handles every Unicode 15 grapheme cluster
including ZWJ sequences and skin-tone composites. Using it for the
multi-grapheme backstop (4f) means we do not need to manually
enumerate every combining codepoint — the segmenter already does.
We still explicitly check for ZWJ / skin tone / regional / tag
codepoints (4b–e) because those generate clearer error messages
than "more than one grapheme would."

**Why reject rather than auto-strip.** A silent `.replace(/‍/g,
'')` would turn `🏴‍☠️` into `🏴☠️`, which renders as two emoji
side-by-side and breaks the grid in a *different* way. Rejection
with a pointed error puts the author in the loop; they pick the
single emoji that matches their intent.

**Touch list:**
- `src/config/loader.js` — add `validateEmojiString(str, path)`
  near the top (alongside `requireString`). Call it from each of
  the six `emoji` fields. No change to the surrounding object
  construction.
- `test/loader.test.js` (preferred) — add a `describe('emoji
  validation', …)` block covering criteria 11–13.
- `test/fixtures/pirate-v2-like.yaml` — new minimal fixture for
  criterion 13.
- `games/silly/game.yaml` — only if criterion 9's audit surfaces a
  failure.
- `docs/schema.md`, `docs/rendering.md` — the additions in
  criteria 15–16.

## Agent Notes

- Read `src/config/loader.js:145–150, 208–213, 919–924, 943–948,
  967–972, 994–999` before writing the helper — you need to see
  all six call sites to ensure the helper signature
  (`(str, path) => void` that throws on invalid) fits each.
- `Intl.Segmenter` needs Node 16+ and the full ICU build. Node
  ships with small-ICU by default on some platforms; if the CI
  image uses that, `Segmenter` throws when the user passes a
  non-`'en'` locale. Call it with `undefined` as the locale (the
  default) — per the MDN docs, grapheme segmentation is built
  into small-ICU for the default locale.
- The BMP-without-VS16 rule has a subtle corner: the string
  `"⚔️"` has `.length === 2` but starts with a BMP codepoint.
  Do not use `str.length === 1` as the "BMP-only" test — use
  `str.codePointAt(0) < 0x10000 && str.length > 2` as the
  "rejected" signal, or equivalently accept `str === String.fromCodePoint(cp) + '️'`
  for a BMP base. The test suite in criterion 12 has `⚔️` as an
  acceptance case so this will catch the mistake.
- Audit `games/silly/game.yaml` by running `node -e` with the
  loader before writing any test, to see whether silly-game is
  affected. The emoji-rendering spec suggested `🛡` for armor,
  which is supplementary plane and passes under (4g); but double-
  check what actually shipped.
- The user's pirate-v2.yaml lives at `~/pirate-game/pirate-v2.yaml`
  (outside the repo) — do not copy it into `games/`. Use the
  minimal fixture in `test/fixtures/` (criterion 13) to exercise
  the rejection path; no need to import the whole game.
- Error messages are user-facing; keep them imperative and
  specific. `SchemaError` already prepends the path and line, so
  the message body just needs the *what* and the *fix*.
