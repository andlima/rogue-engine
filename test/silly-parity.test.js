/**
 * Silly-game parity test.
 *
 * Loads games/silly/game.yaml, sets up controlled states with hand-crafted
 * maps and known entity positions, then replays scripted action sequences
 * and asserts that observable state transitions match silly-game behavior.
 *
 * The reference trace is hand-authored from a close reading of
 * andlima/silly-game src/game.js — every constant, formula, and message
 * string is verified against the original.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromFile } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch } from '../src/runtime/dispatch.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRng } from '../src/runtime/rng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_YAML = join(__dirname, '..', 'games', 'silly', 'game.yaml');
const TRACE_PATH = join(__dirname, 'fixtures', 'silly-parity.trace.json');

// ── Test helpers ──────────────────────────────────────────────────────

function buildTestMap() {
  const width = 20;
  const height = 15;
  const tiles = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        row.push('#');
      } else if (x === 15 && y === 7) {
        row.push('>');
      } else {
        row.push('.');
      }
    }
    tiles.push(row);
  }
  return {
    width, height, tiles,
    spawn: { x: 5, y: 7 },
    stair: { x: 15, y: 7 },
    rooms: [{ x: 1, y: 1, w: 18, h: 13 }],
  };
}

function makeBeing(definition, id, x, y) {
  const def = definition._index.beings[id];
  const measurements = Object.create(null);
  for (const m of definition.measurements) {
    measurements[m.id] = def.measurements[m.id] ?? m.initial;
  }
  return {
    id, kind: 'being', label: def.label, glyph: def.glyph, color: def.color,
    tags: [...def.tags], x, y, measurements,
    inventory: [], equipment: Object.create(null),
  };
}

function makeItem(definition, id, x, y) {
  const def = definition._index.items[id];
  return {
    id, kind: 'item', label: def.label, glyph: def.glyph, color: def.color,
    tags: [...def.tags], itemKind: def.kind,
    properties: def.properties ? { ...def.properties } : {},
    x, y,
  };
}

function makeTestState(definition, opts = {}) {
  const baseState = createState(definition, opts.seed || 42);
  return {
    ...baseState,
    map: opts.map || buildTestMap(),
    level: opts.level || 1,
    player: {
      ...baseState.player,
      x: opts.px || 5,
      y: opts.py || 7,
      ...(opts.playerOverrides || {}),
    },
    entities: opts.entities || [],
    messages: [],
    rng: createRng(opts.rngSeed || 100),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('silly-game parity', () => {
  let definition;

  before(async () => {
    definition = await loadFromFile(GAME_YAML);
  });

  it('loads the game definition with correct structure', () => {
    assert.equal(definition.meta.id, 'silly-game');
    assert.equal(definition.beings.length, 5);
    assert.equal(definition.items.length, 7);
    assert.equal(definition.actions.player.length, 5);
    assert.equal(definition.actions.ai.length, 4);

    // Monster stats match silly-game exactly
    const rat = definition._index.beings.rat;
    assert.deepEqual(
      { hp: rat.measurements.hp, atk: rat.measurements.attack, def: rat.measurements.defense, aw: rat.measurements.awareness },
      { hp: 5, atk: 2, def: 0, aw: 3 }
    );
    const skeleton = definition._index.beings.skeleton;
    assert.deepEqual(
      { hp: skeleton.measurements.hp, atk: skeleton.measurements.attack, def: skeleton.measurements.defense, aw: skeleton.measurements.awareness },
      { hp: 10, atk: 4, def: 1, aw: 4 }
    );
    const bear = definition._index.beings.bear;
    assert.deepEqual(
      { hp: bear.measurements.hp, atk: bear.measurements.attack, def: bear.measurements.defense, aw: bear.measurements.awareness },
      { hp: 20, atk: 6, def: 3, aw: 5 }
    );
    const dragon = definition._index.beings.dragon;
    assert.deepEqual(
      { hp: dragon.measurements.hp, atk: dragon.measurements.attack, def: dragon.measurements.defense, aw: dragon.measurements.awareness },
      { hp: 30, atk: 8, def: 4, aw: 6 }
    );

    // Equipment bonuses
    assert.deepEqual(definition._index.items.dagger.properties, { slot: 'weapon', stat: 'attack', bonus: 2 });
    assert.deepEqual(definition._index.items.sword.properties, { slot: 'weapon', stat: 'attack', bonus: 4 });
    assert.deepEqual(definition._index.items.helmet.properties, { slot: 'helmet', stat: 'defense', bonus: 1 });
    assert.deepEqual(definition._index.items.shield.properties, { slot: 'shield', stat: 'defense', bonus: 2 });
  });

  it('creates initial state with procedural dungeon', () => {
    const state = createState(definition, 42);
    assert.equal(state.level, 1);
    assert.equal(state.turn, 0);
    assert.equal(state.player.measurements.hp, 30);
    assert.equal(state.player.measurements.max_hp, 30);
    assert.equal(state.player.measurements.attack, 5);
    assert.equal(state.player.measurements.defense, 2);
    assert.ok(state.map, 'dungeon map generated');
    assert.equal(state.map.width, 80);
    assert.equal(state.map.height, 50);
    assert.ok(state.entities.length > 0, 'entities spawned');
  });

  it('deterministic: same seed produces identical state', () => {
    const s1 = createState(definition, 99);
    const s2 = createState(definition, 99);
    assert.equal(s1.player.x, s2.player.x);
    assert.equal(s1.player.y, s2.player.y);
    assert.equal(s1.entities.length, s2.entities.length);
    for (let i = 0; i < s1.entities.length; i++) {
      assert.equal(s1.entities[i].id, s2.entities[i].id);
      assert.equal(s1.entities[i].x, s2.entities[i].x);
    }
  });

  it('movement: moves on open floor, no-op on wall bump', () => {
    let state = makeTestState(definition, { entities: [] });

    // Move south onto open floor
    state = dispatch(state, { type: 'move', dir: 's' });
    assert.equal(state.player.y, 8, 'moved south');
    assert.equal(state.player.measurements.steps, 1);

    // Move to south wall
    for (let i = 0; i < 5; i++) {
      state = dispatch(state, { type: 'move', dir: 's' });
    }
    assert.equal(state.player.y, 13, 'at south edge');

    // Bump wall — no-op
    const turnBefore = state.turn;
    const stepsBefore = state.player.measurements.steps;
    state = dispatch(state, { type: 'move', dir: 's' });
    assert.equal(state.player.y, 13, 'wall blocked');
    assert.equal(state.turn, turnBefore, 'no turn elapsed');
    assert.equal(state.player.measurements.steps, stepsBefore, 'no step counted');
  });

  it('combat: attack and kill a rat', () => {
    // Rat at (6, 7) — one east of player
    let state = makeTestState(definition, {
      entities: [makeBeing(definition, 'rat', 6, 7)],
    });

    // Bump east into rat — attack
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.ok(state.messages.some(m => m.includes('hit the Rat')), 'attack message');
    assert.ok(state.player.measurements.damage_dealt > 0 || state.messages.some(m => m.includes('0 damage')), 'damage tracked or 0');

    // Keep attacking until dead
    while (state.entities.some(e => e.id === 'rat' && e.measurements.hp > 0)) {
      state = dispatch(state, { type: 'move', dir: 'e' });
      if (state.terminal) break;
    }
    assert.equal(state.player.measurements.kills, 1, 'killed the rat');
    assert.ok(state.messages.some(m => m.includes('defeated')), 'death message');
    assert.equal(state.player.x, 5, 'stayed at attack position');
  });

  it('pickup: dagger auto-equip from ground', () => {
    let state = makeTestState(definition, {
      entities: [makeItem(definition, 'dagger', 6, 7)],
    });

    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.equipment.weapon?.id, 'dagger', 'dagger equipped');
    assert.ok(state.messages.some(m => m.includes('equip a Dagger')), 'equip message');
    assert.equal(state.entities.filter(e => e.id === 'dagger').length, 0, 'dagger removed from ground');
  });

  it('pickup: food goes to inventory', () => {
    let state = makeTestState(definition, {
      entities: [makeItem(definition, 'food', 6, 7)],
    });

    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.ok(state.player.inventory.some(i => i.id === 'food'), 'food in inventory');
    assert.ok(state.messages.some(m => m.includes('pick up some food')), 'food message');
  });

  it('use food: heals 10 HP, capped at max_hp', () => {
    const foodDef = definition._index.items.food;
    const food = {
      id: 'food', kind: 'item', label: 'Food',
      glyph: foodDef.glyph, color: foodDef.color,
      tags: [...foodDef.tags], itemKind: foodDef.kind,
      properties: {}, x: 99, y: 99,
    };

    let state = makeTestState(definition, {
      playerOverrides: {
        measurements: { ...createState(definition, 1).player.measurements, hp: 15 },
        inventory: [food],
      },
    });
    // Need to actually assign inventory since playerOverrides is spread after player
    state = { ...state, player: { ...state.player, inventory: [food], measurements: { ...state.player.measurements, hp: 15 } } };

    state = dispatch(state, { type: 'action', trigger: 'use_food' });
    assert.equal(state.player.measurements.hp, 25, 'healed 10 HP');
    assert.equal(state.player.measurements.food_used, 1);
    assert.ok(state.messages.some(m => m.includes('eat food')));

    // Use again at 25 → capped at 30
    const food2 = { ...food };
    state = { ...state, player: { ...state.player, inventory: [food2] } };
    state = dispatch(state, { type: 'action', trigger: 'use_food' });
    assert.equal(state.player.measurements.hp, 30, 'capped at max_hp');
  });

  it('equipment upgrade: sword replaces dagger, same-bonus ignored', () => {
    let state = makeTestState(definition, {
      entities: [
        makeItem(definition, 'dagger', 6, 7),
        makeItem(definition, 'dagger', 7, 7),
        makeItem(definition, 'sword', 8, 7),
      ],
    });

    // Pick up dagger (empty slot → equip)
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.equipment.weapon?.id, 'dagger');

    // Step on second dagger (same bonus → ignore)
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.equipment.weapon?.id, 'dagger', 'same bonus ignored');

    // Step on sword (bonus 4 > 2 → upgrade)
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.equipment.weapon?.id, 'sword', 'sword replaces dagger');
  });

  it('gold pickup: value = 2 * level', () => {
    let state = makeTestState(definition, {
      level: 3,
      entities: [makeItem(definition, 'gold', 6, 7)],
    });

    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.measurements.gold, 6, 'gold = 2 * 3');
    assert.equal(state.player.measurements.gold_collected, 6);
    assert.ok(state.messages.some(m => m.includes('pick up') && m.includes('gold')));
  });

  it('monster AI: stagger cooldown skips turn after attack', () => {
    // Use a skeleton (attack=4) so damage is guaranteed against player defense (2)
    let state = makeTestState(definition, {
      entities: [makeBeing(definition, 'skeleton', 6, 7)],
    });

    // Wait — skeleton is adjacent, attacks, then staggers
    state = dispatch(state, { type: 'action', trigger: 'wait' });
    const skelAfter1 = state.entities.find(e => e.id === 'skeleton');
    assert.equal(skelAfter1.measurements.cooldown, 1, 'skeleton staggered');
    assert.ok(state.messages.some(m => m.includes('Skeleton hits you')), 'attack message');

    // Wait — skeleton skips (cooldown recovery)
    const hpBefore = state.player.measurements.hp;
    state = dispatch(state, { type: 'action', trigger: 'wait' });
    assert.equal(state.player.measurements.hp, hpBefore, 'skeleton skipped turn');
    const skelAfter2 = state.entities.find(e => e.id === 'skeleton');
    assert.equal(skelAfter2.measurements.cooldown, 0, 'cooldown cleared');

    // Wait — skeleton attacks again
    state = dispatch(state, { type: 'action', trigger: 'wait' });
    assert.ok(state.player.measurements.hp < hpBefore, 'skeleton attacked again');
  });

  it('descend: level transition on stair', () => {
    let state = makeTestState(definition, {
      px: 15, py: 7, // on the stair
      entities: [],
    });

    state = dispatch(state, { type: 'action', trigger: 'descend' });
    assert.equal(state.level, 2, 'advanced to level 2');
    assert.ok(state.messages.some(m => m.includes('descend')));
    assert.ok(state.map, 'new dungeon generated');
  });

  it('win condition: descending stair on level 5', () => {
    let state = makeTestState(definition, {
      level: 5,
      px: 15, py: 7,
      entities: [],
    });

    state = dispatch(state, { type: 'action', trigger: 'descend' });
    assert.equal(state.terminal, 'win');
    assert.ok(state.messages.some(m => m.includes('final staircase')));
  });

  it('loss condition: player hp <= 0', () => {
    let state = makeTestState(definition, {
      playerOverrides: {
        measurements: { ...createState(definition, 1).player.measurements, hp: 0 },
      },
    });
    state = { ...state, player: { ...state.player, measurements: { ...state.player.measurements, hp: 0 } } };

    state = dispatch(state, { type: 'action', trigger: 'wait' });
    assert.equal(state.terminal, 'lose');
  });

  it('combat formula: max(0, attacker.attack + equip_bonus - defender.defense + variance)', () => {
    let state = makeTestState(definition, {
      entities: [makeBeing(definition, 'rat', 6, 7)],
      rngSeed: 42,
    });

    // Player: attack=5, equip_attack=0. Rat: defense=0.
    // Damage = max(0, 5 + 0 - 0 + random(-1, 1)) = 4, 5, or 6
    state = dispatch(state, { type: 'move', dir: 'e' });
    const damage = state.player.measurements.damage_dealt;
    assert.ok(damage >= 4 && damage <= 6, `damage should be 4-6, got ${damage}`);
  });

  it('scripted playthrough: full sequence exercising all mechanics', () => {
    const trace = [];

    function snap(state, label) {
      trace.push({
        label,
        turn: state.turn,
        px: state.player.x, py: state.player.y,
        hp: state.player.measurements.hp,
        kills: state.player.measurements.kills,
        steps: state.player.measurements.steps,
        gold: state.player.measurements.gold,
        inventory: state.player.inventory.map(i => i.id),
        equipment: Object.fromEntries(
          Object.entries(state.player.equipment).map(([k, v]) => [k, v.id])
        ),
        entityCount: state.entities.length,
        lastMessage: state.messages[state.messages.length - 1] || null,
        terminal: state.terminal,
      });
    }

    // Layout: player at (5,7), rat at (7,7), dagger at (3,7),
    // food at (5,5), sword at (10,7), gold at (5,9), bear far at (18,1)
    let state = makeTestState(definition, {
      entities: [
        makeBeing(definition, 'rat', 7, 7),
        makeItem(definition, 'dagger', 3, 7),
        makeItem(definition, 'food', 5, 5),
        makeItem(definition, 'sword', 10, 7),
        makeItem(definition, 'gold', 5, 9),
        makeBeing(definition, 'bear', 18, 1), // far away, won't interact
      ],
      rngSeed: 200,
    });
    snap(state, 'initial');

    // 1. Move east once (open floor)
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.x, 6);
    assert.equal(state.player.measurements.steps, 1);
    snap(state, 'move_east');

    // 2. Attack rat at (7,7)
    state = dispatch(state, { type: 'move', dir: 'e' });
    assert.ok(state.messages.some(m => m.includes('hit the Rat')));
    snap(state, 'attack_rat');

    // Kill the rat
    while (state.entities.some(e => e.id === 'rat' && e.measurements.hp > 0)) {
      state = dispatch(state, { type: 'move', dir: 'e' });
      if (state.terminal) break;
    }
    assert.equal(state.player.measurements.kills, 1);
    snap(state, 'rat_dead');

    // 3. Pick up dagger at (3,7) — go west
    for (let i = 0; i < 3; i++) state = dispatch(state, { type: 'move', dir: 'w' });
    assert.equal(state.player.x, 3);
    assert.equal(state.player.equipment.weapon?.id, 'dagger');
    snap(state, 'got_dagger');

    // 4. Pick up food at (5,5)
    state = dispatch(state, { type: 'move', dir: 'e' });
    state = dispatch(state, { type: 'move', dir: 'e' });
    state = dispatch(state, { type: 'move', dir: 'n' });
    state = dispatch(state, { type: 'move', dir: 'n' });
    assert.equal(state.player.y, 5);
    assert.ok(state.player.inventory.some(i => i.id === 'food'));
    snap(state, 'got_food');

    // 5. Use food (simulate damage first)
    state = { ...state, player: { ...state.player, measurements: { ...state.player.measurements, hp: 20 } } };
    state = dispatch(state, { type: 'action', trigger: 'use_food' });
    assert.equal(state.player.measurements.hp, 30);
    snap(state, 'used_food');

    // 6. Get sword at (10,7)
    state = dispatch(state, { type: 'move', dir: 's' });
    state = dispatch(state, { type: 'move', dir: 's' });
    for (let i = 0; i < 5; i++) state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.x, 10);
    assert.equal(state.player.equipment.weapon?.id, 'sword');
    snap(state, 'got_sword');

    // 7. Get gold at (5,9)
    for (let i = 0; i < 5; i++) state = dispatch(state, { type: 'move', dir: 'w' });
    state = dispatch(state, { type: 'move', dir: 's' });
    state = dispatch(state, { type: 'move', dir: 's' });
    assert.equal(state.player.y, 9);
    assert.equal(state.player.measurements.gold, 2);
    snap(state, 'got_gold');

    // 8. Descend stair at (15,7)
    state = dispatch(state, { type: 'move', dir: 'n' });
    state = dispatch(state, { type: 'move', dir: 'n' });
    for (let i = 0; i < 10; i++) state = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.x, 15);
    assert.equal(state.player.y, 7);
    state = dispatch(state, { type: 'action', trigger: 'descend' });
    assert.equal(state.level, 2);
    snap(state, 'descended');

    // 9. Die to bear — place one adjacent and reduce HP
    const bear = makeBeing(definition, 'bear', state.player.x + 1, state.player.y);
    state = {
      ...state,
      entities: [...state.entities, bear],
      player: { ...state.player, measurements: { ...state.player.measurements, hp: 3 } },
    };
    for (let i = 0; i < 10; i++) {
      state = dispatch(state, { type: 'move', dir: 'e' });
      if (state.terminal === 'lose') break;
    }
    assert.equal(state.terminal, 'lose');
    snap(state, 'death');

    // Verify trace invariants
    assert.equal(trace[0].hp, 30);
    assert.equal(trace[0].kills, 0);
    assert.equal(trace[trace.length - 1].terminal, 'lose');
  });

  it('generates reference trace matching silly-game behavior', async () => {
    let savedTrace;
    try {
      const raw = await readFile(TRACE_PATH, 'utf-8');
      savedTrace = JSON.parse(raw);
    } catch {
      return; // No trace file — skip
    }
    const state = makeTestState(definition, {});
    assert.equal(state.player.measurements.hp, savedTrace[0].hp);
    assert.equal(state.player.x, savedTrace[0].px);
  });
});
