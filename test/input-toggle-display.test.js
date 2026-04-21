/**
 * Tests for the `toggle_display` built-in action (emoji-rendering spec).
 *
 * Covers:
 *  - loader accepts the TAB binding + the new built-in action
 *  - dispatching `{ type: 'toggle_display' }` flips state.displayMode
 *  - the toggle is non-turn-advancing (no turn increment, entities intact,
 *    AI does not run)
 *  - rendering.default_display_mode seeds state.displayMode on state init
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch } from '../src/runtime/dispatch.js';
import { BUILTIN_ACTIONS, BUILTIN_ACTION_IDS } from '../src/input/builtin-bindings.js';

const BASE = `
meta:
  id: toggle-display-test
  name: Toggle Display Test
  version: "0.1.0"
  player_archetype: hero
measurements:
  - { id: hp, label: HP, min: 0, max: 10, initial: 10 }
beings:
  - id: hero
    label: Hero
    glyph: "@"
    emoji: "🧙"
    color: white
    measurements: { hp: 10 }
    tags: [player]
  - id: rat
    label: Rat
    glyph: "r"
    emoji: "🐀"
    color: green
    measurements: { hp: 3 }
    tags: [monster]
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.@.#"
    - "#####"
actions:
  player: []
  ai:
    - id: ai_move
      effects:
        - { type: message, text: "rat scurries" }
`;

describe('BUILTIN_ACTIONS: toggle_display', () => {
  it('is registered as a built-in action id', () => {
    assert.ok(BUILTIN_ACTIONS.toggle_display, 'toggle_display declared');
    assert.equal(BUILTIN_ACTIONS.toggle_display.id, 'toggle_display');
    assert.ok(BUILTIN_ACTION_IDS.has('toggle_display'));
  });
});

describe('loader: TAB binding and default_display_mode', () => {
  it('accepts a TAB binding that targets toggle_display', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "TAB", action: toggle_display }
`);
    const binding = def.input.bindings.find(b =>
      b.action === 'toggle_display'
      && b.kind === 'key'
      && b.keys.includes('TAB')
      && b._source === 'game',
    );
    assert.ok(binding, 'TAB binding for toggle_display is normalized in def.input.bindings');
  });

  it('accepts rendering.default_display_mode = emoji and seeds state.displayMode', () => {
    const def = loadFromString(BASE + `
rendering:
  default_display_mode: emoji
`);
    const state = createState(def);
    assert.equal(state.displayMode, 'emoji');
  });

  it('defaults state.displayMode to "ascii" when no default is configured', () => {
    const def = loadFromString(BASE);
    const state = createState(def);
    assert.equal(state.displayMode, 'ascii');
  });

  it('rejects rendering.default_display_mode other than ascii|emoji', () => {
    assert.throws(
      () => loadFromString(BASE + `
rendering:
  default_display_mode: hologram
`),
      /default_display_mode/,
    );
  });
});

describe('dispatch: toggle_display', () => {
  function mkState() {
    const def = loadFromString(BASE);
    const state = createState(def);
    // Plant an entity so we can verify the toggle does not mutate it.
    state.entities = [
      { id: 'rat', kind: 'being', label: 'Rat', glyph: 'r', color: 'green',
        x: 3, y: 1, measurements: { hp: 3 }, inventory: [], equipment: {}, tags: ['monster'] },
    ];
    return state;
  }

  it('flips state.displayMode from ascii to emoji', () => {
    const before = mkState();
    assert.equal(before.displayMode, 'ascii');
    const after = dispatch(before, { type: 'toggle_display' });
    assert.equal(after.displayMode, 'emoji');
  });

  it('flips back from emoji to ascii', () => {
    const before = { ...mkState(), displayMode: 'emoji' };
    const after = dispatch(before, { type: 'toggle_display' });
    assert.equal(after.displayMode, 'ascii');
  });

  it('does not advance state.turn', () => {
    const before = mkState();
    const after = dispatch(before, { type: 'toggle_display' });
    assert.equal(after.turn, before.turn, 'turn unchanged after toggle');
  });

  it('does not run AI or mutate entities', () => {
    const before = mkState();
    const after = dispatch(before, { type: 'toggle_display' });
    assert.strictEqual(after.entities, before.entities, 'entities reference intact');
    assert.equal(after.entities.length, 1);
    assert.deepEqual(after.entities[0].measurements, { hp: 3 });
    // No AI-generated messages should have landed in the log.
    assert.deepEqual(after.messages, before.messages);
  });

  it('does not mutate the previous state object', () => {
    const before = mkState();
    const beforeMode = before.displayMode;
    dispatch(before, { type: 'toggle_display' });
    assert.equal(before.displayMode, beforeMode, 'original state untouched');
  });
});
