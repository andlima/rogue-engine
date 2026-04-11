import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch } from '../src/runtime/dispatch.js';
import { getVisibleTiles } from '../src/runtime/view.js';

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
    // Move east twice: first to (3,2), then (3,2) → east is (4,2) which is '#'
    const state2 = dispatch(state, { type: 'move', dir: 'e' });
    const state3 = dispatch(state2, { type: 'move', dir: 'e' });
    // Should be blocked — same position
    assert.equal(state3.player.x, 3);
    assert.equal(state3.player.y, 2);
    // State reference is the same when blocked (no mutation)
    assert.equal(state2, state3);
  });

  it('does not mutate the previous state', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'move', dir: 'e' });
    // Original state unchanged
    assert.equal(state.player.x, 2);
    assert.equal(state.player.y, 2);
    assert.equal(state.turn, 0);
    // New state is different
    assert.notEqual(state, next);
    assert.equal(next.player.x, 3);
  });

  it('handles unknown action types gracefully', () => {
    const state = makeState();
    const next = dispatch(state, { type: 'attack' });
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
    // Top-left of viewport is map (0,0) which is '#'
    assert.equal(grid[0][0].ch, '#');
    // (1,1) in viewport is map (1,1) which is '.'
    assert.equal(grid[1][1].ch, '.');
  });
});
