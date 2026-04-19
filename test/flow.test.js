import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString, loadFromFile } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch } from '../src/runtime/dispatch.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Test-YAML helpers ────────────────────────────────────────────────────

function yamlFor(body) {
  return `
meta:
  id: flow-test
  name: Flow Test
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 30
    initial: 20
  - id: mp
    label: Mana
    min: 0
    max: 20
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements:
      hp: 20
      mp: 10
    tags: [player]
items:
  - id: potion
    label: Potion
    glyph: "!"
    color: red
    kind: consumable
  - id: sword
    label: Sword
    glyph: "/"
    color: white
    kind: equipment
map:
  width: 8
  height: 6
  tiles:
    - "########"
    - "#......#"
    - "#...@..#"
    - "#......#"
    - "#......#"
    - "########"
${body}
`;
}

describe('expression: distance built-ins', () => {
  it('chebyshev(a, b) with tile objects', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { a: { x: 0, y: 0 }, b: { x: 3, y: 5 } };
    assert.equal(evalExpr('chebyshev(a, b)', scope), 5);
  });

  it('manhattan(a, b) with tile objects', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { a: { x: 0, y: 0 }, b: { x: 3, y: 5 } };
    assert.equal(evalExpr('manhattan(a, b)', scope), 8);
  });

  it('euclidean(a, b) with tile objects', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } };
    assert.equal(evalExpr('euclidean(a, b)', scope), 5);
  });

  it('in_range uses chebyshev by default', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { a: { x: 0, y: 0 }, b: { x: 3, y: 3 } };
    assert.equal(evalExpr('in_range(a, b, 3)', scope), true);
    assert.equal(evalExpr('in_range(a, b, 2)', scope), false);
  });

  it('in_range accepts a metric argument', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { a: { x: 0, y: 0 }, b: { x: 3, y: 3 } };
    assert.equal(evalExpr('in_range(a, b, 6, "manhattan")', scope), true);
    assert.equal(evalExpr('in_range(a, b, 5, "manhattan")', scope), false);
  });
});

describe('expression: line_of_sight', () => {
  it('returns true for unobstructed path', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const map = {
      width: 5, height: 3,
      tiles: ['.....', '.....', '.....'],
    };
    const scope = { a: { x: 0, y: 0 }, b: { x: 4, y: 2 } };
    assert.equal(evalExpr('line_of_sight(a, b)', scope, { state: { map } }), true);
  });

  it('returns false when a wall blocks the path', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const map = {
      width: 5, height: 3,
      tiles: ['.....', '..#..', '.....'],
    };
    const scope = { a: { x: 0, y: 0 }, b: { x: 4, y: 2 } };
    assert.equal(evalExpr('line_of_sight(a, b)', scope, { state: { map } }), false);
  });
});

describe('expression: where operator', () => {
  it('filters a list by a predicate with `item` bound', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { xs: [1, 2, 3, 4, 5] };
    const result = evalExpr('xs where item > 2', scope);
    assert.deepEqual(result, [3, 4, 5]);
  });

  it('filters objects by a field', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = {
      inv: [
        { kind: 'consumable', name: 'Potion' },
        { kind: 'equipment', name: 'Sword' },
        { kind: 'consumable', name: 'Elixir' },
      ],
    };
    const result = evalExpr('inv where item.kind == "consumable"', scope);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Potion');
    assert.equal(result[1].name, 'Elixir');
  });

  it('non-list on LHS produces empty result with warning', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const warnings = [];
    const result = evalExpr('42 where item > 0', {}, { warnings });
    assert.deepEqual(result, []);
    assert.ok(warnings.some(w => w.includes("'where'")));
  });
});

describe('expression: $bindings', () => {
  it('resolves $bindings via scope._bindings', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const scope = { _bindings: { chosen_item: { name: 'Elixir' } } };
    const result = evalExpr('$chosen_item.name', scope);
    assert.equal(result, 'Elixir');
  });

  it('returns 0 and warns on unknown binding', async () => {
    const { evalExpr } = await import('../src/expressions/index.js');
    const warnings = [];
    const scope = { _bindings: {} };
    const result = evalExpr('$unknown', scope, { warnings });
    assert.equal(result, 0);
    assert.ok(warnings.some(w => w.includes('$unknown')));
  });
});

// ── Step-type unit tests ────────────────────────────────────────────────

describe('flow runner: pick_direction', () => {
  const YAML = yamlFor(`
keymap:
  f: kick
actions:
  player:
    - id: kick
      flow:
        - type: pick_direction
          set: cardinal
          bind: dir
      effects:
        - type: message
          text: "{actor.name} kicks {$dir}."
`);

  it('starts a flow and binds direction; effects run on commit', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'f' });
    assert.ok(state.flowState);
    assert.equal(state.flowState.actionId, 'kick');
    assert.equal(state.flowState.stepIndex, 0);

    state = dispatch(state, { type: 'flow_input', kind: 'pick_direction', dir: 'e' });
    assert.equal(state.flowState, null, 'flow cleared after commit');
    assert.ok(state.messages.at(-1).endsWith('kicks e.'));
    assert.equal(state.turn, 1, 'turn advanced');
  });

  it('rejects invalid direction input without advancing', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'f' });
    const before = state;
    state = dispatch(state, { type: 'flow_input', kind: 'pick_direction', dir: 'z' });
    assert.strictEqual(state, before, 'invalid input rejected; state unchanged');
    assert.ok(state.flowState, 'still in flow');
  });

  it('cancelling the flow does not run effects or advance turn', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'f' });
    const turn0 = state.turn;
    state = dispatch(state, { type: 'flow_cancel' });
    assert.equal(state.flowState, null);
    assert.equal(state.turn, turn0, 'turn not advanced on cancel');
    assert.equal(state.messages.length, 0, 'no effects on cancel');
  });
});

describe('flow runner: pick_item with filter', () => {
  const YAML = yamlFor(`
keymap:
  q: quaff
actions:
  player:
    - id: quaff
      flow:
        - type: pick_item
          source: actor.inventory
          filter: 'item.kind == "consumable"'
          bind: chosen_item
      effects:
        - type: apply
          target: actor
          measurement: hp
          delta: "5"
        - type: message
          text: "Quaffed {$chosen_item.label}."
`);

  it('binds item that matches filter; effects fire on commit', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    const potion = {
      id: 'potion', kind: 'item', itemKind: 'consumable',
      label: 'Potion', glyph: '!', color: 'red', tags: [], x: 0, y: 0,
    };
    // Synthesize an inventory item with a .kind field (filter uses item.kind)
    const inv = [{ ...potion, kind: 'consumable' }];
    state = { ...state, player: { ...state.player, inventory: inv, measurements: { ...state.player.measurements, hp: 10 } } };

    state = dispatch(state, { type: 'action', trigger: 'q' });
    assert.ok(state.flowState);

    state = dispatch(state, {
      type: 'flow_input',
      kind: 'pick_item',
      item: inv[0],
    });
    assert.equal(state.flowState, null, 'flow cleared after commit');
    assert.equal(state.player.measurements.hp, 15, 'healed');
    assert.ok(state.messages.at(-1).includes('Potion'));
  });

  it('rejects item that fails the filter', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    const sword = {
      id: 'sword', kind: 'equipment', itemKind: 'equipment',
      label: 'Sword', glyph: '/', color: 'white', tags: [], x: 0, y: 0,
    };
    state = { ...state, player: { ...state.player, inventory: [sword] } };
    state = dispatch(state, { type: 'action', trigger: 'q' });
    const before = state;
    state = dispatch(state, {
      type: 'flow_input',
      kind: 'pick_item',
      item: sword,
    });
    assert.strictEqual(state, before);
  });
});

describe('flow runner: pick_tile with range and LOS', () => {
  const YAML = yamlFor(`
keymap:
  z: cast
actions:
  player:
    - id: cast
      requires:
        - "actor.mp >= 3"
      flow:
        - type: pick_tile
          range: 3
          filter: "line_of_sight($origin, tile)"
          bind: target_tile
      effects:
        - type: apply
          target: actor
          measurement: mp
          delta: "-3"
`);

  it('accepts tile in range', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'z' });
    assert.ok(state.flowState);
    // Player is at (4, 2), cast at (5, 2) — 1 tile away
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 5, y: 2 } });
    assert.equal(state.flowState, null);
    assert.equal(state.player.measurements.mp, 7);
  });

  it('rejects tile out of range', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'z' });
    const before = state;
    // Player at (4,2); (1,2) is distance 3 (chebyshev) — in range
    // (1,4) is distance max(3,2)=3 — in range. Let's pick (1,5): max(3,3)=3.
    // Use a far tile like (7,4): max(3,2)=3. Hmm map is 8x6 so range of 3 covers most.
    // Just test with a specifically invalid tile: range 3 from (4,2) max is (1,2) or (7,5) but chebyshev max dx=3.
    // Let's just use an explicit constructed state with player at (1,1) and range test.
    // Reset: state player is at (4, 2). Target (0,0) has max(4,2)=4 which is > 3.
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 0, y: 0 } });
    assert.strictEqual(state, before, 'out-of-range tile rejected');
  });

  it('re-checks requires on commit', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Set mp to exactly 3
    state = { ...state, player: { ...state.player, measurements: { ...state.player.measurements, mp: 3 } } };
    state = dispatch(state, { type: 'action', trigger: 'z' });
    assert.ok(state.flowState, 'flow starts (mp=3 >= 3)');
    // Now drain mp manually before commit
    state = { ...state, player: { ...state.player, measurements: { ...state.player.measurements, mp: 0 } } };
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 5, y: 2 } });
    assert.equal(state.flowState, null, 'flow cleared');
    assert.equal(state.player.measurements.mp, 0, 'effects blocked — no mp subtraction');
  });

  it('$origin resolves in effect expressions after flow commit', () => {
    // Regression: commitFlow must not drop the implicit `$origin` binding
    // when merging user bindings. Exercises $origin in two places:
    //   (a) a message template placeholder
    //   (b) an effect `when` expression
    const YAML_ORIGIN = yamlFor(`
keymap:
  z: cast
actions:
  player:
    - id: cast
      flow:
        - type: pick_tile
          range: 5
          bind: target_tile
      effects:
        - type: message
          text: "from {$origin.x},{$origin.y}"
        - type: message
          text: "origin_was_4"
          when: "$origin.x == 4"
        - type: message
          text: "should_not_fire"
          when: "$origin.x == 0"
`);
    const def = loadFromString(YAML_ORIGIN);
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 4, y: 3 } };
    state = dispatch(state, { type: 'action', trigger: 'z' });
    assert.ok(state.flowState);
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 1, y: 1 } });
    assert.equal(state.flowState, null);
    // Message template rendered $origin correctly:
    assert.ok(
      state.messages.includes('from 4,3'),
      `expected 'from 4,3' in messages, got ${JSON.stringify(state.messages)}`,
    );
    // `when: $origin.x == 4` evaluated correctly — message fires:
    assert.ok(state.messages.includes('origin_was_4'));
    // `when: $origin.x == 0` would fire if $origin silently resolved to 0:
    assert.ok(!state.messages.includes('should_not_fire'));
  });
});

describe('flow runner: pick_option', () => {
  const YAML = yamlFor(`
keymap:
  z: cast
actions:
  player:
    - id: cast
      flow:
        - type: pick_option
          bind: chosen_option
          options:
            - id: fireball
              label: Fireball (5 MP)
              requires: "actor.mp >= 5"
              payload:
                spell: fireball
                cost: 5
            - id: spark
              label: Spark (1 MP)
              requires: "actor.mp >= 1"
              payload:
                spell: spark
                cost: 1
      effects:
        - type: message
          text: "{actor.name} casts {$chosen_option.spell}."
`);

  it('binds the payload of the chosen option', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'z' });
    state = dispatch(state, {
      type: 'flow_input',
      kind: 'pick_option',
      option_id: 'spark',
    });
    assert.ok(state.messages.at(-1).includes('spark'));
  });

  it('rejects option whose requires fails', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, measurements: { ...state.player.measurements, mp: 0 } } };
    state = dispatch(state, { type: 'action', trigger: 'z' });
    const before = state;
    state = dispatch(state, { type: 'flow_input', kind: 'pick_option', option_id: 'fireball' });
    assert.strictEqual(state, before);
  });
});

describe('flow runner: confirm', () => {
  const YAML = yamlFor(`
keymap:
  t: terminate
actions:
  player:
    - id: terminate
      flow:
        - type: confirm
          message: "Really end your turn?"
      effects:
        - type: message
          text: "Confirmed."
`);

  it('accepts confirm: true and commits', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 't' });
    state = dispatch(state, { type: 'flow_input', kind: 'confirm', confirm: true });
    assert.equal(state.flowState, null);
    assert.equal(state.messages.at(-1), 'Confirmed.');
  });

  it('cancels on confirm: false', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 't' });
    state = dispatch(state, { type: 'flow_input', kind: 'confirm', confirm: false });
    assert.equal(state.flowState, null);
    assert.equal(state.messages.length, 0);
  });
});

// ── Context-sensitive trigger resolution ──────────────────────────────

describe('context-sensitive `when` resolution', () => {
  const YAML = `
meta:
  id: when-test
  name: When Test
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 10
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 10 }
    tags: [player]
items: []
map:
  width: 6
  height: 4
  tiles:
    - "######"
    - "#.>..#"
    - "#.@..#"
    - "######"
tiles:
  ">":
    kind: stairs_down
keymap:
  ">": desc
  ".": desc
actions:
  player:
    - id: descend
      trigger: desc
      when: 'actor.tile.kind == "stairs_down"'
      effects:
        - type: message
          text: "You descend."
    - id: no_stairs
      trigger: desc
      when: 'actor.tile.kind != "stairs_down"'
      effects:
        - type: message
          text: "There are no stairs here."
`;

  it('picks the matching action by first-match rule', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Player is at (2, 2) — not on stairs
    state = dispatch(state, { type: 'action', trigger: 'desc' });
    assert.ok(state.messages.at(-1).includes('no stairs'));

    // Move player onto the stairs tile
    state = { ...state, player: { ...state.player, x: 2, y: 1 } };
    state = dispatch(state, { type: 'action', trigger: 'desc' });
    assert.ok(state.messages.at(-1).includes('descend'));
  });
});

// ── pick_being ──────────────────────────────────────────────────────────

describe('flow runner: pick_being', () => {
  // A test map with the player surrounded by space; we inject beings manually
  // into state.entities for each test. The keymap binds `a` to aim.
  const YAML = `
meta:
  id: pick-being
  name: Pick Being
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 20
    initial: 20
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 20 }
    tags: [player]
  - id: goblin
    label: Goblin
    glyph: "g"
    color: green
    measurements: { hp: 6 }
    tags: [monster]
  - id: ally
    label: Ally
    glyph: "a"
    color: blue
    measurements: { hp: 6 }
    tags: [ally]
items: []
map:
  width: 10
  height: 5
  tiles:
    - "##########"
    - "#........#"
    - "#...@....#"
    - "#........#"
    - "##########"
keymap:
  a: aim
actions:
  player:
    - id: aim
      flow:
        - type: pick_being
          range: 3
          filter: 'being.has_tag("monster")'
          bind: target_being
      effects:
        - type: message
          text: "Target: {$target_being.label}"
`;

  function addBeing(state, beingDef) {
    const ent = {
      ...beingDef,
      kind: 'being',
      label: beingDef.label,
      glyph: beingDef.glyph,
      color: beingDef.color,
      tags: [...(beingDef.tags || [])],
      measurements: { ...(beingDef.measurements || {}) },
      inventory: [],
      equipment: Object.create(null),
    };
    return { ...state, entities: [...state.entities, ent] };
  }

  it('binds a being that matches the predicate', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Place a goblin within range (player is at (4, 2); goblin at (5, 2))
    state = addBeing(state, {
      id: 'goblin', label: 'Goblin', glyph: 'g', color: 'green',
      tags: ['monster'], measurements: { hp: 6 }, x: 5, y: 2,
    });
    state = dispatch(state, { type: 'action', trigger: 'a' });
    assert.ok(state.flowState, 'flow started');
    state = dispatch(state, { type: 'flow_input', kind: 'pick_being', tile: { x: 5, y: 2 } });
    assert.equal(state.flowState, null, 'committed');
    assert.ok(state.messages.at(-1).includes('Goblin'));
  });

  it('rejects a being that fails the predicate filter', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Place a non-monster ally within range
    state = addBeing(state, {
      id: 'ally', label: 'Ally', glyph: 'a', color: 'blue',
      tags: ['ally'], measurements: { hp: 6 }, x: 5, y: 2,
    });
    state = dispatch(state, { type: 'action', trigger: 'a' });
    const before = state;
    state = dispatch(state, { type: 'flow_input', kind: 'pick_being', tile: { x: 5, y: 2 } });
    assert.strictEqual(state, before, 'ally rejected by predicate');
    assert.ok(state.flowState, 'still in flow');
  });

  it('rejects a tile containing no being', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'a' });
    const before = state;
    state = dispatch(state, { type: 'flow_input', kind: 'pick_being', tile: { x: 5, y: 2 } });
    assert.strictEqual(state, before, 'empty tile rejected');
  });

  it('rejects a being out of range', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Goblin far away (chebyshev distance 5 from player)
    state = addBeing(state, {
      id: 'goblin', label: 'Goblin', glyph: 'g', color: 'green',
      tags: ['monster'], measurements: { hp: 6 }, x: 9, y: 2,
    });
    // range is 3; distance to (9,2) from (4,2) is 5
    state = { ...state, player: { ...state.player, x: 4, y: 2 } };
    // Widen the map check — goblin is at x=9 which is within map bounds (width=10)
    state = dispatch(state, { type: 'action', trigger: 'a' });
    const before = state;
    state = dispatch(state, { type: 'flow_input', kind: 'pick_being', tile: { x: 9, y: 2 } });
    assert.strictEqual(state, before, 'out-of-range being rejected');
  });

  it('cancellation leaves state unchanged and no turn consumed', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = addBeing(state, {
      id: 'goblin', label: 'Goblin', glyph: 'g', color: 'green',
      tags: ['monster'], measurements: { hp: 6 }, x: 5, y: 2,
    });
    const turn0 = state.turn;
    state = dispatch(state, { type: 'action', trigger: 'a' });
    state = dispatch(state, { type: 'flow_cancel' });
    assert.equal(state.flowState, null);
    assert.equal(state.turn, turn0, 'turn not advanced');
  });
});

// ── Tile hooks ──────────────────────────────────────────────────────────

describe('tile hooks: on_enter and on_stand', () => {
  const YAML = `
meta:
  id: enter-stand-hooks
  name: Enter/Stand Hooks
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 10
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 10 }
    tags: [player]
items: []
map:
  width: 6
  height: 3
  tiles:
    - "######"
    - "#@T.X#"
    - "######"
tiles:
  T:
    kind: trap
    on_enter:
      - type: message
        text: "You triggered a trap."
  X:
    kind: pit
    on_stand:
      - type: message
        text: "Pit ticks."
keymap:
  " ": interact
`;

  it('on_enter fires when the player moves onto the tile', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Player spawns at (1,1); T is at (2,1). Move east into T.
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.x, 2);
    assert.ok(state.messages.some(m => m.includes('trap')), 'on_enter fired');
  });

  it('on_enter does NOT fire when the move is blocked', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Move north into a wall — no movement, no hook.
    state = dispatch(state, { type: 'move', dir: 'n' });
    assert.equal(state.player.x, 1);
    assert.equal(state.messages.length, 0);
  });

  it('on_stand fires when the player moves onto the tile (end of turn)', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Move player onto pit tile at (4, 1): east x3
    state = dispatch(state, { type: 'move', dir: 'e' }); // to (2,1) - trap
    state = dispatch(state, { type: 'move', dir: 'e' }); // to (3,1) - floor
    state = dispatch(state, { type: 'move', dir: 'e' }); // to (4,1) - pit
    assert.equal(state.player.x, 4);
    // The last move should have fired on_stand on the pit tile.
    assert.ok(state.messages.some(m => m.includes('Pit ticks')));
  });

  it('on_stand fires exactly once per turn, not per sub-step', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Position the player directly on the pit tile
    state = { ...state, player: { ...state.player, x: 4, y: 1 } };
    // Take exactly one turn by moving to a floor tile (3,1) — this is one
    // turn. on_stand should NOT fire because the destination is floor.
    state = dispatch(state, { type: 'move', dir: 'w' }); // to (3,1)
    const pitCountAfterMove = state.messages.filter(m => m.includes('Pit ticks')).length;
    assert.equal(pitCountAfterMove, 0, 'on_stand should not fire for tiles we left');
    // Now move back onto the pit — this is one turn, should fire once.
    state = dispatch(state, { type: 'move', dir: 'e' }); // to (4,1)
    const pitCountAfterReturn = state.messages.filter(m => m.includes('Pit ticks')).length;
    assert.equal(pitCountAfterReturn, 1, 'on_stand fires exactly once on the turn we land');
  });

  it('on_stand does NOT fire on a no-turn path (interact with no hook)', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 4, y: 1 } };
    const turn0 = state.turn;
    // Interact on pit tile — pit has no on_interact, so it's a no-turn path.
    state = dispatch(state, { type: 'interact' });
    assert.equal(state.turn, turn0, 'no turn consumed on no-hook interact');
    assert.ok(!state.messages.some(m => m.includes('Pit ticks')), 'on_stand skipped on no-turn path');
  });
});

describe('tile hooks: on_interact', () => {
  const YAML = `
meta:
  id: tile-hooks
  name: Tile Hooks
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 10
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 10 }
    tags: [player]
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.@D#"
    - "#####"
tiles:
  D:
    kind: door_locked
    on_interact:
      - type: message
        text: "The door is locked."
keymap:
  " ": interact
`;

  it('dispatches on_interact effects when player presses interact on tile', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Move player adjacent to door, then into door coord via override
    state = { ...state, player: { ...state.player, x: 3, y: 1 } };
    state = dispatch(state, { type: 'interact' });
    assert.ok(state.messages.at(-1).includes('locked'));
  });

  it('emits a default message when tile has no on_interact', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Player on floor (default @ spawn)
    state = dispatch(state, { type: 'interact' });
    assert.ok(state.messages.at(-1).includes('Nothing to interact'));
  });
});

// ── End-to-end demo YAML ────────────────────────────────────────────────

describe('motivating interactions: quaff, descend, cast, unlock', () => {
  const YAML = `
meta:
  id: motivating
  name: Motivating
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 30
    initial: 20
  - id: mp
    label: MP
    min: 0
    max: 20
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 20, mp: 10 }
    tags: [player]
items:
  - id: potion
    label: Potion
    glyph: "!"
    color: red
    kind: consumable
  - id: key
    label: Key
    glyph: "k"
    color: yellow
    kind: consumable
map:
  width: 10
  height: 5
  tiles:
    - "##########"
    - "#...@...D#"
    - "#........#"
    - "#.......>#"
    - "##########"
tiles:
  ">":
    kind: stairs_down
  "D":
    kind: door_locked
    on_interact:
      - type: message
        text: "Door unlocked."
keymap:
  q: quaff
  " ": interact
actions:
  player:
    - id: quaff
      flow:
        - type: pick_item
          filter: 'item.kind == "consumable"'
          bind: chosen_item
      effects:
        - type: apply
          target: actor
          measurement: hp
          delta: "10"
        - type: message
          text: "Quaffed."
    - id: descend
      trigger: ">"
      when: 'actor.tile.kind == "stairs_down"'
      effects:
        - type: transition_level
          delta: 1
    - id: no_stairs
      trigger: ">"
      when: 'actor.tile.kind != "stairs_down"'
      effects:
        - type: message
          text: "No stairs here."
`;

  it('quaff: pick_item consumable filter works', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    const potion = {
      id: 'potion', kind: 'consumable', itemKind: 'consumable',
      label: 'Potion', glyph: '!', color: 'red', tags: [], x: 0, y: 0,
    };
    state = { ...state, player: { ...state.player, inventory: [potion], measurements: { ...state.player.measurements, hp: 5 } } };
    state = dispatch(state, { type: 'action', trigger: 'q' });
    state = dispatch(state, { type: 'flow_input', kind: 'pick_item', item: potion });
    assert.equal(state.player.measurements.hp, 15, 'healed 10');
  });

  it('descend: fires when standing on stairs, falls back otherwise', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    // Not on stairs
    state = dispatch(state, { type: 'action', trigger: '>' });
    assert.ok(state.messages.at(-1).includes('No stairs'));

    // On stairs
    state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 8, y: 3 } };
    state = dispatch(state, { type: 'action', trigger: '>' });
    assert.equal(state.level, 2, 'descended');
  });

  it('unlock door: on_interact fires when interacting with locked door tile', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 8, y: 1 } };
    state = dispatch(state, { type: 'interact' });
    assert.ok(state.messages.at(-1).includes('Door unlocked'));
  });
});

describe('interact-demo game', () => {
  it('loads without errors', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    assert.equal(def.meta.id, 'interact-demo');
    assert.ok(def.actions.player.find(a => a.id === 'quaff_potion'));
    assert.ok(def.actions.player.find(a => a.id === 'cast_fireball'));
    assert.ok(def.actions.player.find(a => a.id === 'descend_stairs'));
    assert.ok(def.actions.player.find(a => a.id === 'no_stairs_here'));
    assert.ok(def.tiles);
    assert.ok(def.tiles['D']);
    assert.ok(def.tiles['D'].on_interact);
    assert.ok(def.ui.panels.inventory);
  });

  it('scripted integration: cast fireball through pick_option + pick_tile', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    let state = createState(def, 42);

    state = dispatch(state, { type: 'action', trigger: 'z' });
    assert.ok(state.flowState, 'fireball flow started');
    assert.equal(state.flowState.stepIndex, 0);

    state = dispatch(state, {
      type: 'flow_input',
      kind: 'pick_option',
      option_id: 'fireball',
    });
    assert.ok(state.flowState, 'still in flow (step 2 — pick_tile)');
    assert.equal(state.flowState.stepIndex, 1);

    state = dispatch(state, {
      type: 'flow_input',
      kind: 'pick_tile',
      tile: { x: 5, y: 2 },
    });
    assert.equal(state.flowState, null, 'flow committed');
    assert.equal(state.player.measurements.mp, 5, 'fireball cost 5 MP');
  });

  it('scripted input sequence [z, fireball, RIGHT, RIGHT, ENTER] commits deterministically', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    let state = createState(def, 42);
    const startMp = state.player.measurements.mp;

    // Simulate the sequence: z → pick_option(fireball) → pick_tile(right-right-enter)
    // The "right-right" is how an author drives a reticle; we express it as tile coords.
    const inputs = [
      { type: 'action', trigger: 'z' },
      { type: 'flow_input', kind: 'pick_option', option_id: 'fireball' },
      // Player at (4, 2). Right-right moves the reticle to (6, 2). ENTER commits.
      { type: 'flow_input', kind: 'pick_tile', tile: { x: 6, y: 2 } },
    ];
    for (const input of inputs) state = dispatch(state, input);
    assert.equal(state.flowState, null, 'committed');
    assert.equal(state.player.measurements.mp, startMp - 5, 'spell cost applied');
    assert.equal(state.turn, 1, 'commit consumed a turn');
  });

  it('cancelling at any point leaves state unchanged modulo flowState', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    const initial = createState(def, 42);
    let state = initial;

    state = dispatch(state, { type: 'action', trigger: 'z' });
    state = dispatch(state, { type: 'flow_input', kind: 'pick_option', option_id: 'fireball' });
    state = dispatch(state, { type: 'flow_cancel' });

    assert.equal(state.flowState, null);
    assert.equal(state.turn, initial.turn, 'turn not advanced');
    assert.equal(state.player.measurements.mp, initial.player.measurements.mp, 'no MP spent');
    assert.equal(state.messages.length, initial.messages.length, 'no messages pushed');
  });

  it('fireball applies area damage in a 1-tile radius (excluding caster)', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    let state = createState(def, 42);

    // Place two goblins: one inside the blast, one outside. Give them
    // enough HP that an 8-damage hit leaves a measurable non-clamped value.
    const goblinDef = def._index.beings.goblin;
    const baseGoblin = {
      id: 'goblin', kind: 'being', label: goblinDef.label,
      glyph: goblinDef.glyph, color: goblinDef.color, tags: [...goblinDef.tags],
      inventory: [], equipment: Object.create(null),
    };
    const inside = { ...baseGoblin, x: 6, y: 3, measurements: { hp: 15 } };
    const outside = { ...baseGoblin, x: 2, y: 2, measurements: { hp: 15 } };
    state = { ...state, entities: [inside, outside] };

    // Target (6, 2). Blast radius 1 covers x in [5,7], y in [1,3].
    // `inside` at (6,3) is hit; `outside` at (2,2) is not.
    state = dispatch(state, { type: 'action', trigger: 'z' });
    state = dispatch(state, { type: 'flow_input', kind: 'pick_option', option_id: 'fireball' });
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 6, y: 2 } });

    assert.equal(state.flowState, null, 'flow committed');
    const insideNow = state.entities.find(e => e.x === 6 && e.y === 3);
    const outsideNow = state.entities.find(e => e.x === 2 && e.y === 2);
    assert.equal(insideNow.measurements.hp, 7, 'in-blast goblin took 8 damage');
    assert.equal(outsideNow.measurements.hp, 15, 'out-of-blast goblin unharmed');
  });

  it('unlock door: requires a key; transforms tile kind on success', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'interact-demo.yaml'));
    const keyItem = def._index.items.key;

    // Case 1 — without a key, the door stays locked.
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 10, y: 3 } };
    state = dispatch(state, { type: 'interact' });
    // Door tile unchanged.
    let map1 = state.map || state.definition.map;
    assert.equal(map1.tiles[3][10], 'D', 'door still locked (no key)');
    assert.ok(state.messages.at(-1).toLowerCase().includes('locked'));

    // Case 2 — with a key, interact unlocks: tile becomes "'" (door_open) and key is consumed.
    state = createState(def, 42);
    const keyInstance = {
      id: 'key', kind: 'item', label: keyItem.label,
      glyph: keyItem.glyph, color: keyItem.color, itemKind: keyItem.kind,
      tags: [...keyItem.tags], properties: { ...keyItem.properties },
    };
    state = {
      ...state,
      player: { ...state.player, x: 10, y: 3, inventory: [keyInstance] },
    };
    state = dispatch(state, { type: 'interact' });
    const map2 = state.map || state.definition.map;
    assert.equal(map2.tiles[3][10], "'", 'tile transformed to door_open');
    assert.equal(state.player.inventory.length, 0, 'key consumed');
    assert.ok(state.messages.some(m => m.toLowerCase().includes('unlock')));
  });
});

// ── apply_area and transform_tile effect tests ────────────────────────

describe('effect: apply_area', () => {
  const YAML = `
meta:
  id: area
  name: Area
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 20
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 10 }
    tags: [player]
  - id: goblin
    label: Goblin
    glyph: "g"
    color: green
    measurements: { hp: 6 }
    tags: [monster]
items: []
map:
  width: 7
  height: 3
  tiles:
    - "#######"
    - "#..@..#"
    - "#######"
keymap:
  b: blast
actions:
  player:
    - id: blast
      flow:
        - type: pick_tile
          range: 3
          bind: target_tile
      effects:
        - type: apply_area
          origin: "$target_tile"
          radius: 1
          measurement: hp
          delta: "-4"
`;

  it('applies delta to all beings (including player) within chebyshev radius', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    const goblinDef = def._index.beings.goblin;
    // Goblin at (5, 1) — distance 2 from player (3,1)
    const goblin = {
      id: 'goblin', kind: 'being', label: goblinDef.label,
      glyph: goblinDef.glyph, color: goblinDef.color, tags: [...goblinDef.tags],
      x: 5, y: 1, measurements: { hp: 6 },
      inventory: [], equipment: Object.create(null),
    };
    state = { ...state, entities: [goblin] };
    state = dispatch(state, { type: 'action', trigger: 'b' });
    // Target (5,1) — radius 1 hits player? Player at (3,1) distance 2 — no.
    // Hits goblin at (5,1) — yes.
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 5, y: 1 } });
    assert.equal(state.flowState, null);
    const goblinAfter = state.entities.find(e => e.x === 5 && e.y === 1);
    assert.equal(goblinAfter.measurements.hp, 2, 'goblin took 4 damage');
    assert.equal(state.player.measurements.hp, 10, 'player not hit');
  });

  it('includes the player by default when in blast radius', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = dispatch(state, { type: 'action', trigger: 'b' });
    // Target the player's own tile — radius 1 covers the player.
    state = dispatch(state, { type: 'flow_input', kind: 'pick_tile', tile: { x: 3, y: 1 } });
    assert.equal(state.player.measurements.hp, 6, 'player hit by own blast');
  });
});

describe('effect: transform_tile', () => {
  const YAML = `
meta:
  id: transform
  name: Transform
  version: "0.1.0"
  player_archetype: hero
measurements:
  - id: hp
    label: HP
    min: 0
    max: 10
    initial: 10
beings:
  - id: hero
    label: Hero
    glyph: "@"
    color: white
    measurements: { hp: 10 }
    tags: [player]
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.@D#"
    - "#####"
tiles:
  D:
    kind: door_locked
    on_interact:
      - type: transform_tile
        char: "'"
  "'":
    kind: door_open
keymap:
  " ": interact
`;

  it('mutates the map tile at the actor position by default', () => {
    const def = loadFromString(YAML);
    let state = createState(def, 42);
    state = { ...state, player: { ...state.player, x: 3, y: 1 } };
    const before = state.definition.map.tiles[1][3];
    assert.equal(before, 'D');
    state = dispatch(state, { type: 'interact' });
    const after = (state.map || state.definition.map).tiles[1][3];
    assert.equal(after, "'", 'tile replaced');
  });
});

// ── Loader-validation tests for criterion 8 ────────────────────────────

describe('loader validation: flows', () => {
  it('rejects flow step with unknown prompt id', () => {
    const yaml = yamlFor(`
ui:
  prompts:
    existing:
      message: "Hi"
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_direction
          prompt: missing
      effects: []
`);
    assert.throws(() => loadFromString(yaml), /unknown prompt id 'missing'/);
  });

  it('rejects duplicate bind names within a single flow', () => {
    const yaml = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_direction
          bind: x
        - type: pick_item
          bind: x
      effects: []
`);
    assert.throws(() => loadFromString(yaml), /duplicate binding name 'x'/);
  });

  it('rejects effect referencing a $name the flow does not bind', () => {
    // Expression-bearing field (delta):
    const yaml = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_item
          bind: chosen_item
      effects:
        - type: apply
          target: actor
          measurement: hp
          delta: "$chosen_weapon.bonus"
`);
    assert.throws(() => loadFromString(yaml), /unknown binding '\$chosen_weapon'/);

    // Message template placeholder — must also be validated:
    const yaml2 = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_direction
          bind: d
      effects:
        - type: message
          text: "go {$chosen_weapon.label}"
`);
    assert.throws(() => loadFromString(yaml2), /unknown binding '\$chosen_weapon'/);
  });

  it('accepts implicit $origin/$actor bindings in message templates', () => {
    const yaml = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_direction
          bind: d
      effects:
        - type: message
          text: "from {$origin.x},{$origin.y} via {$actor.name}"
`);
    assert.doesNotThrow(() => loadFromString(yaml));
  });

  it('rejects $name in message templates outside a flow-enabled action', () => {
    const yaml = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      effects:
        - type: message
          text: "nope {$chosen_item}"
`);
    assert.throws(() => loadFromString(yaml), /binding references/);
  });

  it('rejects panel.on_select referencing an unknown action id', () => {
    const yaml = yamlFor(`
ui:
  panels:
    inv:
      open_on: i
      title: Inv
      data: "actor.inventory"
      on_select: nonexistent_action
`);
    assert.throws(() => loadFromString(yaml), /unknown action id 'nonexistent_action'/);
  });

  it('rejects pick_tile with non-positive range', () => {
    const yaml = yamlFor(`
actions:
  player:
    - id: foo
      trigger: f
      flow:
        - type: pick_tile
          range: 0
      effects: []
`);
    assert.throws(() => loadFromString(yaml), /range must be a positive integer/);
  });

  it('warns on duplicate triggers with no disambiguating `when`', () => {
    const yaml = yamlFor(`
actions:
  player:
    - id: a
      trigger: f
      effects:
        - type: message
          text: "a"
    - id: b
      trigger: f
      effects:
        - type: message
          text: "b"
`);
    const def = loadFromString(yaml);
    assert.ok(def.warnings.some(w => w.includes('duplicate trigger')));
  });

  it('warns on duplicate triggers when one action is keymap-routed', () => {
    // `a` declares trigger "f". `b` has no explicit trigger but the keymap
    // routes "f" to it. Both resolve to trigger "f" with no `when` — the
    // warning must still fire.
    const yaml = yamlFor(`
keymap:
  f: b
actions:
  player:
    - id: a
      trigger: f
      effects:
        - type: message
          text: "a"
    - id: b
      effects:
        - type: message
          text: "b"
`);
    const def = loadFromString(yaml);
    assert.ok(
      def.warnings.some(w => w.includes('duplicate trigger')),
      'expected a duplicate-trigger warning for keymap-routed collisions'
    );
  });
});
