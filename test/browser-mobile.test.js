import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeTouchDir,
  shouldStopRepeating,
  deriveActionBarItems,
  EXCLUDED_ACTION_IDS,
  HOLD_INITIAL_DELAY,
  HOLD_REPEAT_INTERVAL,
  TAP_DRAG_THRESHOLD,
} from '../src/browser/touch-controls.js';
import { loadFromFile } from '../src/config/loader.js';
import { createSession } from '../src/runtime/session.js';
import { getHelpRows } from '../src/input/help.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SILLY_GAME_PATH = join(ROOT, 'games', 'silly', 'game.yaml');
const PIRATE_GAME_PATH = join(ROOT, 'games', 'pirate.yaml');

const RECT = { left: 100, top: 200, width: 300, height: 200 };
//   center = (250, 300)

describe('touch-controls: constants', () => {
  it('exports the documented timing and threshold values', () => {
    assert.equal(HOLD_INITIAL_DELAY, 300);
    assert.equal(HOLD_REPEAT_INTERVAL, 180);
    assert.equal(TAP_DRAG_THRESHOLD, 15);
  });

  it('EXCLUDED_ACTION_IDS contains exactly the documented set', () => {
    const expected = ['move_n', 'move_s', 'move_e', 'move_w', 'open_help', 'quit', 'cancel', 'interact'];
    for (const id of expected) {
      assert.equal(EXCLUDED_ACTION_IDS.has(id), true, `must contain ${id}`);
    }
    assert.equal(EXCLUDED_ACTION_IDS.size, expected.length);
  });
});

describe('touch-controls: computeTouchDir', () => {
  it('returns UP for a tap above center', () => {
    assert.equal(computeTouchDir(250, 220, RECT), 'UP');
  });

  it('returns DOWN for a tap below center', () => {
    assert.equal(computeTouchDir(250, 380, RECT), 'DOWN');
  });

  it('returns LEFT for a tap left of center', () => {
    assert.equal(computeTouchDir(110, 300, RECT), 'LEFT');
  });

  it('returns RIGHT for a tap right of center', () => {
    assert.equal(computeTouchDir(390, 300, RECT), 'RIGHT');
  });

  it('vertical axis wins when |dy| > |dx|', () => {
    // dx = +20, dy = -50 → |dy| > |dx| → UP
    assert.equal(computeTouchDir(270, 250, RECT), 'UP');
  });

  it('horizontal axis wins on diagonal tie (|dx| === |dy|)', () => {
    // dx = +20, dy = +20 → tie goes to horizontal under the silly-game rule
    const dir = computeTouchDir(270, 320, RECT);
    assert.ok(['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(dir),
      'must return a cardinal direction without throwing');
    assert.equal(dir, 'RIGHT');
  });
});

describe('touch-controls: shouldStopRepeating', () => {
  function makeState({ player, entities = [], terminal = null, flowState = null } = {}) {
    return { player, entities, terminal, flowState };
  }

  it('returns false on a clean continuation: player moved one tile, no neighbors', () => {
    const prev = makeState({
      player: { x: 5, y: 5 },
      entities: [{ kind: 'being', x: 10, y: 10, id: 'far' }],
    });
    const next = makeState({
      player: { x: 5, y: 4 },
      entities: prev.entities,
    });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), false);
  });

  it('stops on terminal state', () => {
    const prev = makeState({ player: { x: 5, y: 5 } });
    const next = makeState({ player: { x: 5, y: 4 }, terminal: 'lose' });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), true);
  });

  it('stops when a flow opens', () => {
    const prev = makeState({ player: { x: 5, y: 5 } });
    const next = makeState({ player: { x: 5, y: 4 }, flowState: { current: 0 } });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), true);
  });

  it('stops on a no-op move (player did not move and no being attacked)', () => {
    const prev = makeState({
      player: { x: 5, y: 5 },
      entities: [],
    });
    const next = makeState({
      player: { x: 5, y: 5 },
      entities: [],
    });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), true);
  });

  it('does NOT stop on a successful bump-attack (target being changed/removed)', () => {
    const target = { kind: 'being', x: 5, y: 4, id: 'rat' };
    const prev = makeState({
      player: { x: 5, y: 5 },
      entities: [target],
    });
    // Player did not move (bump-attack), but target was removed (killed)
    const next = makeState({
      player: { x: 5, y: 5 },
      entities: [],
    });
    // Per criterion 5e, attack means the target was changed/removed — but
    // criterion 5f stops on adjacent being. The target is gone, so 5f does
    // not fire. The move was an attack (not no-op), so 5e does not fire.
    // Result: false (continue). The natural stop is on the next iteration
    // when the player tries to move into the now-empty tile.
    assert.equal(shouldStopRepeating(prev, next, 'UP'), false);
  });

  it('stops when a non-player being is at Chebyshev distance 1', () => {
    const prev = makeState({
      player: { x: 5, y: 5 },
      entities: [{ kind: 'being', x: 6, y: 6, id: 'rat' }],
    });
    const next = makeState({
      player: { x: 5, y: 4 },
      // After moving up, the rat is at (6,6), distance 2. So this case
      // should NOT stop on adjacency.
      entities: [{ kind: 'being', x: 6, y: 6, id: 'rat' }],
    });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), false);

    // Now place a rat adjacent after the move
    const next2 = makeState({
      player: { x: 5, y: 4 },
      entities: [{ kind: 'being', x: 6, y: 5, id: 'rat' }],
    });
    assert.equal(shouldStopRepeating(prev, next2, 'UP'), true);
  });

  it('does not treat items as adjacent stop conditions', () => {
    const prev = makeState({
      player: { x: 5, y: 5 },
      entities: [{ kind: 'item', x: 5, y: 4, id: 'food' }],
    });
    const next = makeState({
      player: { x: 5, y: 4 },
      entities: [{ kind: 'item', x: 5, y: 4, id: 'food' }],
    });
    assert.equal(shouldStopRepeating(prev, next, 'UP'), false);
  });
});

describe('touch-controls: deriveActionBarItems', () => {
  it('filters out the excluded action ids', () => {
    const helpRows = {
      title: 'X',
      sections: [
        {
          header: 'Move',
          rows: [
            { actionId: 'move_n', keys: ['UP'], label: 'Up', summary: '' },
            { actionId: 'move_s', keys: ['DOWN'], label: 'Down', summary: '' },
          ],
        },
        {
          header: 'Actions',
          rows: [
            { actionId: 'wait', keys: ['.'], label: 'Wait', summary: '' },
            { actionId: 'open_help', keys: ['?'], label: 'Help', summary: '' },
            { actionId: 'quit', keys: ['CTRL+c'], label: 'Quit', summary: '' },
            { actionId: 'cancel', keys: ['ESC'], label: 'Cancel', summary: '' },
            { actionId: 'interact', keys: ['SPACE'], label: 'Interact', summary: '' },
          ],
        },
      ],
    };
    const items = deriveActionBarItems(helpRows);
    assert.deepEqual(items, [{ label: 'Wait', key: '.' }]);
  });

  it('deduplicates by actionId, keeping the first row', () => {
    const helpRows = {
      sections: [{
        rows: [
          { actionId: 'wait', keys: ['.'], label: 'Wait' },
          { actionId: 'wait', keys: ['s'], label: 'Wait alt' },
          { actionId: 'fire', keys: ['f'], label: 'Fire' },
        ],
      }],
    };
    const items = deriveActionBarItems(helpRows);
    assert.deepEqual(items, [
      { label: 'Wait', key: '.' },
      { label: 'Fire', key: 'f' },
    ]);
  });

  it('preserves help-row order across sections', () => {
    const helpRows = {
      sections: [
        { header: 'A', rows: [{ actionId: 'a1', keys: ['1'], label: 'a1' }] },
        { header: 'B', rows: [{ actionId: 'b1', keys: ['2'], label: 'b1' }] },
        { header: 'C', rows: [{ actionId: 'c1', keys: ['3'], label: 'c1' }] },
      ],
    };
    const items = deriveActionBarItems(helpRows);
    assert.deepEqual(items, [
      { label: 'a1', key: '1' },
      { label: 'b1', key: '2' },
      { label: 'c1', key: '3' },
    ]);
  });

  it('uses the first bound key for each row', () => {
    const helpRows = {
      sections: [{
        rows: [{ actionId: 'wait', keys: ['.', 's'], label: 'Wait' }],
      }],
    };
    const items = deriveActionBarItems(helpRows);
    assert.deepEqual(items, [{ label: 'Wait', key: '.' }]);
  });

  it('handles an empty / missing sections list', () => {
    assert.deepEqual(deriveActionBarItems({}), []);
    assert.deepEqual(deriveActionBarItems({ sections: [] }), []);
    assert.deepEqual(deriveActionBarItems(null), []);
  });
});

function flattenHelpRows(helpRows) {
  const out = [];
  for (const sec of helpRows?.sections ?? []) {
    for (const row of sec?.rows ?? []) out.push(row);
  }
  return out;
}

function expectedLabel(helpRows, actionId) {
  const row = flattenHelpRows(helpRows).find(r => r.actionId === actionId);
  return row?.label;
}

describe('touch-controls: deriveActionBarItems on real games', () => {
  it('silly: bar contains buttons for use_food, interact_idol, descend, wait, toggle_display', async () => {
    const def = await loadFromFile(SILLY_GAME_PATH);
    const session = createSession(def);
    const helpRows = getHelpRows(def, session.getState());
    const items = deriveActionBarItems(helpRows);
    const labels = items.map(i => i.label);

    const expectedActionIds = ['use_food', 'interact_idol', 'descend', 'wait', 'toggle_display'];
    for (const id of expectedActionIds) {
      const label = expectedLabel(helpRows, id);
      assert.ok(label, `silly help rows must declare a label for ${id}`);
      assert.ok(labels.includes(label),
        `bar must include "${label}" (action ${id}); got: ${labels.join(', ')}`);
    }

    // Movement, help, quit, cancel, interact must not appear.
    for (const excluded of ['move_n', 'move_s', 'move_e', 'move_w', 'open_help', 'quit', 'cancel', 'interact']) {
      const label = expectedLabel(helpRows, excluded);
      if (!label) continue;
      assert.equal(labels.includes(label), false,
        `bar must not include excluded action ${excluded} ("${label}")`);
    }
  });

  it('pirate: bar contains buttons for quaff_grog, eat_hardtack, fire_pistol, open_chest, wait, toggle_display', async () => {
    const def = await loadFromFile(PIRATE_GAME_PATH);
    const session = createSession(def);
    const helpRows = getHelpRows(def, session.getState());
    const items = deriveActionBarItems(helpRows);
    const labels = items.map(i => i.label);

    const expectedActionIds = ['quaff_grog', 'eat_hardtack', 'fire_pistol', 'open_chest', 'wait', 'toggle_display'];
    for (const id of expectedActionIds) {
      const label = expectedLabel(helpRows, id);
      assert.ok(label, `pirate help rows must declare a label for ${id}`);
      assert.ok(labels.includes(label),
        `bar must include "${label}" (action ${id}); got: ${labels.join(', ')}`);
    }

    for (const excluded of ['move_n', 'move_s', 'move_e', 'move_w', 'open_help', 'quit', 'cancel', 'interact']) {
      const label = expectedLabel(helpRows, excluded);
      if (!label) continue;
      assert.equal(labels.includes(label), false,
        `bar must not include excluded action ${excluded} ("${label}")`);
    }
  });
});
