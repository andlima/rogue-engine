import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFromString, loadFromFile } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch } from '../src/runtime/dispatch.js';
import { getVisibleTiles } from '../src/runtime/view.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLACEMENT_MAP_PATH = join(__dirname, 'fixtures', 'placement-map.yaml');

const GAME_YAML = `
meta:
  id: test
  name: Test Game
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: Hit Points
    min: 0
    max: null
    initial: 10
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
    measurements:
      hp: 10
items: []
map:
  width: 5
  height: 5
  tiles:
    - "#####"
    - "#...#"
    - "#.@.#"
    - "#...#"
    - "#####"
`;

function makeState() {
  const def = loadFromString(GAME_YAML);
  return createState(def);
}

describe('createState', () => {
  it('creates initial state with player at spawn', () => {
    const state = makeState();
    assert.equal(state.player.x, 2);
    assert.equal(state.player.y, 2);
    assert.equal(state.turn, 0);
    assert.equal(state.player.archetype, 'player');
    assert.equal(state.player.measurements.hp, 10);
    assert.ok(state.rng, 'state has RNG');
    assert.ok(Array.isArray(state.messages), 'state has messages array');
    assert.ok(Array.isArray(state.entities), 'state has entities array');
    assert.equal(state.terminal, null);
  });

  it('seeds entities from map placements with being defaults and correct positions', async () => {
    const def = await loadFromFile(PLACEMENT_MAP_PATH);
    const state = createState(def);
    assert.equal(state.entities.length, 3);
    // Player is at the @ cell and not duplicated in entities
    assert.equal(state.player.x, 2);
    assert.equal(state.player.y, 2);
    assert.equal(state.player.archetype, 'player');
    assert.ok(!state.entities.some(e => e.id === 'player'));

    const crab = state.entities.find(e => e.id === 'crab');
    assert.ok(crab);
    assert.equal(crab.kind, 'being');
    assert.equal(crab.x, 4);
    assert.equal(crab.y, 2);
    // Being-default measurements applied
    assert.equal(crab.measurements.hp, 3);

    const shark = state.entities.find(e => e.id === 'shark');
    assert.ok(shark);
    assert.equal(shark.x, 7);
    assert.equal(shark.y, 4);
    assert.equal(shark.measurements.hp, 8);

    const coin = state.entities.find(e => e.id === 'coin');
    assert.ok(coin);
    assert.equal(coin.kind, 'item');
    assert.equal(coin.x, 5);
    assert.equal(coin.y, 3);
  });

  it('state.entities order matches map.placements scan order (row-major)', async () => {
    const def = await loadFromFile(PLACEMENT_MAP_PATH);
    const state = createState(def);
    const placementOrder = def.map.placements.map(p => p.id);
    const entityOrder = state.entities.map(e => e.id);
    assert.deepEqual(entityOrder, placementOrder);
    assert.deepEqual(entityOrder, ['crab', 'coin', 'shark']);
  });
});

describe('dispatch - move', () => {
  it('moves the player east when target is floor', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(next.player.x, 3);
    assert.equal(next.player.y, 2);
    assert.equal(next.turn, 1);
  });

  it('moves the player west when target is floor', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 'w' });
    assert.equal(next.player.x, 1);
    assert.equal(next.player.y, 2);
  });

  it('moves the player north when target is floor', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 'n' });
    assert.equal(next.player.x, 2);
    assert.equal(next.player.y, 1);
  });

  it('moves the player south when target is floor', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 's' });
    assert.equal(next.player.x, 2);
    assert.equal(next.player.y, 3);
  });

  it('is a no-op when target is a wall (returns same state)', () => {
    const state = makeState();
    const state2 = dispatch(state, { type: 'move', dir: 'e' });
    const state3 = dispatch(state2, { type: 'move', dir: 'e' });
    assert.equal(state3.player.x, 3);
    assert.equal(state3.player.y, 2);
    assert.equal(state2, state3);
  });

  it('does not mutate the previous state', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 'e' });
    assert.equal(state.player.x, 2);
    assert.equal(state.player.y, 2);
    assert.equal(state.turn, 0);
    assert.notEqual(state, next);
    assert.equal(next.player.x, 3);
  });

  it('handles unknown action types gracefully', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'unknown_action' });
    assert.equal(state, next);
  });
});

describe('getVisibleTiles', () => {
  it('returns a 2D grid of the expected dimensions', () => {
    const state = makeState();
    const grid = getVisibleTiles(state, 5, 5);
    assert.equal(grid.length, 5);
    assert.equal(grid[0].length, 5);
  });

  it('places the player glyph at the center', () => {
    const state = makeState();
    const grid = getVisibleTiles(state, 5, 5);
    assert.equal(grid[2][2].ch, '@');
  });

  it('shows walls and floors around the player', () => {
    const state = makeState();
    const grid = getVisibleTiles(state, 5, 5);
    assert.equal(grid[0][0].ch, '#');
    assert.equal(grid[1][1].ch, '.');
  });
});
