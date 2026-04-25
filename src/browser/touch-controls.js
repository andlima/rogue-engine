/**
 * Pure helpers for the browser surface's touch / mobile UI.
 *
 * Three exports power the mobile experience built into `index.html`:
 *
 *   - `computeTouchDir(clientX, clientY, rect)` — map a tap relative to
 *     a rect (the canvas's getBoundingClientRect()) to one of the four
 *     named-key directions: 'UP' / 'DOWN' / 'LEFT' / 'RIGHT'. The rule
 *     mirrors silly-game's `computeTouchDir`: vertical axis wins when
 *     `|dy| > |dx|`, otherwise horizontal axis wins.
 *
 *   - `shouldStopRepeating(prevState, nextState, dir)` — given pre- and
 *     post-state snapshots and the auto-walk direction, decide whether
 *     the hold-to-repeat loop should stop. Encapsulates conditions
 *     (b) terminal, (c) flow opened, (e) no-op move, and (f) adjacent
 *     non-player being from spec criterion 5. Touch-end (a) and
 *     help/quit (d) are checked at the surface level.
 *
 *   - `deriveActionBarItems(helpRows)` — flatten the section list
 *     returned by `getHelpRows(definition, state)` into a list of
 *     `{ label, key }` entries to render as buttons. Excludes movement,
 *     help, quit, cancel, and `interact` (handled by tap-quadrant or
 *     dedicated chrome buttons), and dedupes by `actionId`.
 *
 * No DOM access here — the helpers are imported by `index.html` and by
 * `test/browser-mobile.test.js`. Keeping them DOM-free keeps the test
 * suite browser-free.
 */

export const HOLD_INITIAL_DELAY = 300;
export const HOLD_REPEAT_INTERVAL = 180;
export const TAP_DRAG_THRESHOLD = 15;

export const EXCLUDED_ACTION_IDS = new Set([
  'move_n', 'move_s', 'move_e', 'move_w',
  'open_help', 'quit', 'cancel', 'interact',
]);

const DIR_DELTAS = {
  UP:    { dx: 0,  dy: -1 },
  DOWN:  { dx: 0,  dy: 1 },
  LEFT:  { dx: -1, dy: 0 },
  RIGHT: { dx: 1,  dy: 0 },
};

export function computeTouchDir(clientX, clientY, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? 'UP' : 'DOWN';
  }
  return dx < 0 ? 'LEFT' : 'RIGHT';
}

export function shouldStopRepeating(prevState, nextState, dir) {
  if (nextState && nextState.terminal != null) return true;
  if (nextState && nextState.flowState != null) return true;

  const prevPlayer = prevState?.player ?? { x: 0, y: 0 };
  const nextPlayer = nextState?.player ?? { x: 0, y: 0 };
  const delta = DIR_DELTAS[dir] ?? { dx: 0, dy: 0 };

  const moved = prevPlayer.x !== nextPlayer.x || prevPlayer.y !== nextPlayer.y;
  if (!moved) {
    const targetX = prevPlayer.x + delta.dx;
    const targetY = prevPlayer.y + delta.dy;
    const prevEntities = prevState?.entities ?? [];
    const nextEntities = nextState?.entities ?? [];
    const prevTargetBeing = prevEntities.find(
      e => e && e.kind === 'being' && e.x === targetX && e.y === targetY,
    );
    let attacked = false;
    if (prevTargetBeing) {
      const stillThere = nextEntities.includes(prevTargetBeing);
      if (!stillThere) attacked = true;
    }
    if (!attacked) return true;
  }

  const nextEntities = nextState?.entities ?? [];
  for (const e of nextEntities) {
    if (!e || e.kind !== 'being') continue;
    const ax = Math.abs(e.x - nextPlayer.x);
    const ay = Math.abs(e.y - nextPlayer.y);
    const cheb = Math.max(ax, ay);
    if (cheb === 1) return true;
  }
  return false;
}

export function deriveActionBarItems(helpRows) {
  const sections = helpRows?.sections ?? [];
  const seen = new Set();
  const items = [];
  for (const section of sections) {
    const rows = section?.rows ?? [];
    for (const row of rows) {
      const id = row?.actionId;
      if (!id) continue;
      if (EXCLUDED_ACTION_IDS.has(id)) continue;
      if (seen.has(id)) continue;
      const keys = row?.keys ?? [];
      if (keys.length === 0) continue;
      seen.add(id);
      items.push({ label: row.label || id, key: keys[0] });
    }
  }
  return items;
}
