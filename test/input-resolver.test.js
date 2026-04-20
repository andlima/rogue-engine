import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';
import { resolve, resolveKey, getActiveContexts } from '../src/input/resolver.js';

const BASE = `
meta:
  id: resolver-test
  name: Resolver Test
  version: "0.1.0"
  player_archetype: hero
measurements:
  - { id: hp, label: HP, min: 0, max: 10, initial: 10 }
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
    - "#.@.#"
    - "#####"
actions:
  player:
    - id: quaff
      label: "Quaff"
      effects: [{ type: message, text: "q" }]
    - id: cast
      label: "Cast"
      effects: [{ type: message, text: "z" }]
    - id: rest_until_full
      label: "Rest"
      effects: [{ type: message, text: "rest" }]
    - id: examine
      label: "Examine"
      effects: [{ type: message, text: "exam" }]
    - id: debug_dump
      label: "Debug dump"
      effects: [{ type: message, text: "dbg" }]
`;

function mkState(def, overrides = {}) {
  return {
    definition: def,
    level: 1,
    turn: 0,
    flowState: null,
    panelId: null,
    player: { x: 2, y: 1, measurements: { hp: 10 } },
    rng: Math.random,
    messages: [],
    entities: [],
    inputState: {},
    ...overrides,
  };
}

describe('resolver: first-match within a context', () => {
  it('fires the first binding whose key matches', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "z", action: cast }
`);
    const state = mkState(def);
    const res = resolve(state, { type: 'key', key: 'q' });
    assert.equal(res.actions.length, 1);
    assert.equal(res.actions[0].actionId, 'quaff');
  });

  it('honors `when` — first truthy wins', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff, when: "state.level == 99" }
    - { key: "q", action: cast,  when: "state.level == 1", overlaps_with: "entry 0" }
`);
    const state = mkState(def);
    const res = resolve(state, { type: 'key', key: 'q' });
    assert.equal(res.actions[0].actionId, 'cast');
  });
});

describe('resolver: context fallback', () => {
  it('escalates flow → map when no flow binding matches', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }                       # map
    - { key: "z", action: cast,  context: flow }        # flow
`);
    // In flow state, 'q' isn't declared in flow context, so resolution
    // escalates to map.
    const state = mkState(def, {
      flowState: { actionId: 'quaff', stepIndex: 0, bindings: {}, origin: { x: 2, y: 1 } },
    });
    const res = resolve(state, { type: 'key', key: 'q' });
    assert.equal(res.actions[0].actionId, 'quaff');
  });

  it('higher context swallows key so it never escalates', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }                       # map
    - { key: "q", action: cast,  context: flow }        # flow
`);
    const state = mkState(def, {
      flowState: { actionId: 'quaff', stepIndex: 0, bindings: {}, origin: { x: 2, y: 1 } },
    });
    const res = resolve(state, { type: 'key', key: 'q' });
    assert.equal(res.actions[0].actionId, 'cast', 'flow context wins over map');
  });
});

describe('resolver: modifier combos', () => {
  it('routes CTRL+x events to the matching binding', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "CTRL+d", action: debug_dump, when: "state.debug" }
`);
    const state = mkState(def, { debug: true });
    const res = resolve(state, { type: 'key', key: 'CTRL+d' });
    assert.equal(res.actions[0].actionId, 'debug_dump');
  });

  it('`when`-gated CTRL+x falls through to the built-in quit on CTRL+c', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "CTRL+d", action: debug_dump, when: "state.debug" }
`);
    const state = mkState(def);
    const res = resolve(state, { type: 'key', key: 'CTRL+c' });
    // Built-in provides CTRL+c -> quit.
    assert.equal(res.actions[0].actionId, 'quit');
  });
});

describe('resolver: when-gated bindings', () => {
  it('skips a binding whose `when` is falsy', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "d", action: debug_dump, when: "state.debug" }
`);
    const state = mkState(def, { debug: false });
    const res = resolve(state, { type: 'key', key: 'd' });
    assert.equal(res.actions.length, 0, 'no matching binding fires');
  });

  it('fires when `when` is truthy', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "d", action: debug_dump, when: "state.debug" }
`);
    const state = mkState(def, { debug: true });
    const res = resolve(state, { type: 'key', key: 'd' });
    assert.equal(res.actions[0].actionId, 'debug_dump');
  });
});

describe('resolver: built-in vs game precedence', () => {
  it('game binding for `?` wins over built-in open_help', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "?", action: examine }
`);
    const state = mkState(def);
    const res = resolve(state, { type: 'key', key: '?' });
    assert.equal(res.actions[0].actionId, 'examine');
  });

  it('disabled: true swallows the key without firing', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "?", action: open_help, disabled: true }
`);
    const state = mkState(def);
    const res = resolve(state, { type: 'key', key: '?' });
    assert.equal(res.actions.length, 0, 'no action fires');
  });
});

describe('resolver: sequences', () => {
  it('[g, g] fires rest_until_full after the second press', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { sequence: [g, g], action: rest_until_full }
`);
    let state = mkState(def);
    let res = resolve(state, { type: 'key', key: 'g' });
    assert.equal(res.actions.length, 0);
    assert.deepEqual(res.inputState.buffer, ['g']);

    state = { ...state, inputState: res.inputState };
    res = resolve(state, { type: 'key', key: 'g' });
    assert.equal(res.actions.length, 1);
    assert.equal(res.actions[0].actionId, 'rest_until_full');
    assert.deepEqual(res.inputState, {});
  });

  it('prefix ambiguity: `g` alone buffers; timeout flushes to single-key binding', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "g",         action: examine }
    - { sequence: [g, g], action: rest_until_full }
`);
    let state = mkState(def);
    let res = resolve(state, { type: 'key', key: 'g' });
    assert.equal(res.actions.length, 0, 'buffered, waiting for disambiguation');
    assert.deepEqual(res.inputState.buffer, ['g']);

    // Simulate timeout — the single-key binding flushes.
    state = { ...state, inputState: res.inputState };
    res = resolve(state, { type: 'timeout' });
    assert.equal(res.actions.length, 1);
    assert.equal(res.actions[0].actionId, 'examine');
  });

  it('disambiguating non-sequence key flushes buffered prefix first', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "g",         action: examine }
    - { key: "q",         action: quaff }
    - { sequence: [g, g], action: rest_until_full }
`);
    let state = mkState(def);
    let res = resolve(state, { type: 'key', key: 'g' });
    assert.equal(res.actions.length, 0);
    state = { ...state, inputState: res.inputState };
    // Disambiguating 'q' — buffer flushes `g` as single-key, then `q` fires.
    res = resolve(state, { type: 'key', key: 'q' });
    assert.equal(res.actions.length, 2);
    assert.equal(res.actions[0].actionId, 'examine');
    assert.equal(res.actions[1].actionId, 'quaff');
  });
});

describe('resolver: resolveKey convenience', () => {
  it('ignores sequence buffering and returns just the key match', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
`);
    const state = mkState(def);
    const match = resolveKey(state, 'q');
    assert.equal(match.actionId, 'quaff');
  });
});

describe('resolver: remixability', () => {
  it('rebinding `move_e` from `l` to `d` in YAML changes resolution with zero JS', () => {
    const before = loadFromString(BASE + `
input:
  bindings:
    - { key: "l", action: quaff }
`);
    const after = loadFromString(BASE + `
input:
  bindings:
    - { key: "d", action: quaff }
`);
    const stateBefore = mkState(before);
    const stateAfter  = mkState(after);

    assert.equal(resolve(stateBefore, { type: 'key', key: 'l' }).actions[0].actionId, 'quaff');
    assert.equal(resolve(stateBefore, { type: 'key', key: 'd' }).actions.length, 0);

    assert.equal(resolve(stateAfter, { type: 'key', key: 'd' }).actions[0].actionId, 'quaff');
    assert.equal(resolve(stateAfter, { type: 'key', key: 'l' }).actions.length, 0);
  });
});

describe('resolver: active contexts', () => {
  it('flow active pushes flow + map (built-in fall-through)', () => {
    const def = loadFromString(BASE + `
input:
  bindings: []
`);
    const state = mkState(def, {
      flowState: { actionId: 'quaff', stepIndex: 0, bindings: {}, origin: { x: 2, y: 1 } },
    });
    const stack = getActiveContexts(state, def);
    assert.ok(stack.indexOf('flow') < stack.indexOf('map'));
  });

  it('custom contexts stack on top of built-in when active', () => {
    const def = loadFromString(BASE + `
input:
  contexts:
    - { id: shop, when: "state.level == 1" }
  bindings: []
`);
    const state = mkState(def);
    const stack = getActiveContexts(state, def);
    assert.equal(stack[0], 'shop', 'custom context on top');
  });
});
