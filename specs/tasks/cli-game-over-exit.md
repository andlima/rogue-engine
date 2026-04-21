---
id: cli-game-over-exit
status: not-started
area: cli
priority: 50
depends_on: []
description: Let the user exit cli.js after game over without killing the process
---

# CLI Game-Over Exit

## Goal

After `state.terminal` is set (win or lose), `cli.js` appears frozen:
the game-over line is printed but no hint tells the player how to leave,
and raw-mode stdin swallows `CTRL+c` (Node delivers it as `\x03`, not
SIGINT). The only way out today is `kill`. This task makes the
post-terminal state exit cleanly on any keypress.

## Acceptance Criteria

1. **Exit hint in game-over draw.** In `cli.js`, when `state.terminal`
   is truthy, `draw()` still prints the existing
   `Game over — <terminal> (<reason>).` line, then prints a single
   additional line: `Press any key to exit`. No other UI (status bar,
   help panel, quit prompt, reticle) is drawn in this state.
2. **Any-key exit after game-over.** In the `process.stdin.on('data', …)`
   handler, when `state.terminal` is truthy, short-circuit **before**
   every other branch (quit-confirm, help, flow runner, resolver) and
   exit. Any keypress that produces stdin data — printable, named, or
   unmappable (e.g. `normalizeTerminalInput` returning `null`) — must
   trigger the exit.
3. **Clean terminal restore before exit.** Before `process.exit(0)`
   in the game-over branch, call `process.stdin.setRawMode(false)` and
   `process.stdin.pause()` so the shell is not left in raw mode. Exit
   status is `0` for both `win` and `lose` terminal states.
4. **Quit-confirm flow during live play is unchanged.** The existing
   `quit` built-in → `quitPending` → `y`/`n` prompt (cli.js:190–247)
   still works identically when `state.terminal` is null. Criterion 2
   only applies once the game has already reached a terminal state.
5. **Regression test.** Add a CLI subprocess test (new file
   `test/cli.test.js`, or extend an existing integration test file) that:
   a. Spawns `node cli.js --game <fixture>` as a child process with a
      pipe on stdin/stdout.
   b. Drives the game to `state.terminal === 'lose'` through stdin
      keystrokes against a fixture where the player dies quickly —
      prefer authoring a minimal YAML fixture under `test/fixtures/`
      (e.g. player starts at `hp: 1`, one adjacent hostile, `wait`
      advances a turn and the hostile kills the player) rather than
      editing `games/toy-hit-and-heal.yaml`.
   c. Reads stdout until the `Game over` line is observed.
   d. Sends one keystroke (any byte, e.g. `q` or `\r`).
   e. Asserts the child process exits with status `0` within 2 seconds
      (use a timeout that `kill`s and fails the test on timeout, so
      the regression path does not hang CI).
6. **Does not regress `spec verify`.** All existing tests
   (`test/*.test.js`) pass unchanged. The silly-parity traces are not
   affected since they do not drive `cli.js`.

## Out of Scope

- Changing the game-over message body beyond appending the exit-hint
  line. No death recap, final stats, or "play again" prompt.
- Score persistence, save files, or writing the terminal reason to
  disk.
- Canvas renderer. `src/renderer/canvas.js` remains a stub.
- Changes to the `quit` built-in binding or the mid-game confirm
  flow. The confirm dialog is only problematic *after* game-over,
  which criterion 2 resolves by bypassing it.
- SIGINT/SIGTERM handling more broadly. Raw-mode stdin already
  intercepts `\x03`; this task only makes the post-terminal path
  exitable, not live-game SIGINT handling.
- Treating `ESC` or `CTRL+c` specially versus other keys — per
  criterion 2, any keypress exits, so there is no need to branch on
  key identity.

## Design Notes

**Where to short-circuit.** The cleanest fix is a single early branch
at the top of the `data` listener:

```js
if (state.terminal) {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}
```

Placed above the `quitPending` block so the hidden quit-prompt
pathway is no longer reachable after game-over. `draw()`'s early
return for `state.terminal` already lives at the top of the function;
just extend it to print the hint line.

**Why any-key rather than ENTER only.** The player reads "Press any
key" without cognitive overhead; matching a specific key would require
calling `normalizeTerminalInput` and handling unmapped bytes (e.g.
function keys on some terminals return `null`), which is the exact
failure mode we are fixing. Any-key is also the convention used by
the existing help panel (`cli.js:249–253`).

**Fixture choice.** `games/toy-hit-and-heal.yaml` does not trivially
drive the player to 0 HP without scripted action dispatch that the
CLI does not expose. A tiny fixture with the player starting at
`hp: 1` and a hostile adjacent — so a single turn advances the loss
condition — keeps the test fast and hermetic. Put the fixture in
`test/fixtures/` next to other test-only YAML.

**Touch list:**
- `cli.js` — `draw()` game-over branch + `data` listener early-return.
- `test/cli.test.js` (new) — subprocess spawn test.
- `test/fixtures/<name>.yaml` (new, optional) — quick-loss fixture.

## Agent Notes

- Read `cli.js` end-to-end first. The control flow in the `data`
  listener has several short-circuit paths (quit-confirm, help, flow,
  resolver); the new game-over branch must sit **above** all of them.
- In raw mode on Node, `CTRL+c` arrives as `\x03` on stdin — it is
  *not* a SIGINT. Do not add `process.on('SIGINT', …)` as a "fix";
  the actual problem is that the raw-mode branch never exits. The
  `data`-listener early-return is the correct surface.
- For the subprocess test, prefer `node:child_process` `spawn` with
  explicit `stdio: ['pipe', 'pipe', 'pipe']` and await an `exit`
  event with a `setTimeout` guard that calls `child.kill('SIGKILL')`
  and fails the assertion. Reading stdout via `child.stdout.on('data')`
  and matching a `Game over` substring is sufficient — no need for
  a full terminal emulator.
- Do not remove `process.exit(0)` from the existing quit-confirm
  branch (cli.js:243). That branch still runs for mid-game quits and
  has the same raw-mode concern; add the same `setRawMode(false)` +
  `pause()` there too for consistency (considered in-scope as a
  trivial adjacent fix; no behavior change for users).
