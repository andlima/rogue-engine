import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';
import { resolve } from '../src/input/resolver.js';

const BASE = `
meta:
  id: migration-test
  name: Migration Test
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
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;

function mkState(def) {
  return {
    definition: def,
    level: 1, turn: 0, flowState: null, panelId: null,
    player: { x: 1, y: 1, measurements: { hp: 10 } },
    entities: [], messages: [], inputState: {},
  };
}

describe('migration: legacy `trigger:` normalises to input.bindings', () => {
  it('key-shaped trigger on an action produces a map-context binding', () => {
    const def = loadFromString(BASE + `
actions:
  player:
    - id: quaff
      trigger: "q"
      effects: [{ type: message, text: "ok" }]
`);
    const res = resolve(mkState(def), { type: 'key', key: 'q' });
    assert.equal(res.actions[0].actionId, 'quaff');
  });

  it('legacy `trigger:` and new `input.bindings` produce equivalent resolver output', () => {
    const legacy = loadFromString(BASE + `
actions:
  player:
    - id: quaff
      trigger: "q"
      effects: [{ type: message, text: "ok" }]
`);
    const modern = loadFromString(BASE + `
actions:
  player:
    - id: quaff
      effects: [{ type: message, text: "ok" }]
input:
  bindings:
    - { key: "q", action: quaff }
`);
    const resLegacy = resolve(mkState(legacy), { type: 'key', key: 'q' });
    const resModern = resolve(mkState(modern), { type: 'key', key: 'q' });
    assert.equal(resLegacy.actions[0].actionId, resModern.actions[0].actionId);
  });

  it('explicit input.bindings wins over trigger:; trigger is ignored with a warning', () => {
    const def = loadFromString(BASE + `
actions:
  player:
    - id: quaff
      trigger: "q"
      effects: [{ type: message, text: "legacy" }]
input:
  bindings:
    - { key: "z", action: quaff }
`);
    assert.ok(
      def.warnings.some(w => w.includes('trigger') && w.includes('ignored')),
      `expected a 'trigger ignored' warning; got: ${JSON.stringify(def.warnings)}`
    );
    // The input.bindings entry fires, not the legacy trigger.
    const z = resolve(mkState(def), { type: 'key', key: 'z' });
    assert.equal(z.actions[0].actionId, 'quaff');
  });

  it('non-key-shaped trigger (e.g. `move`) is left alone — no physical binding added', () => {
    const def = loadFromString(BASE + `
actions:
  player:
    - id: move
      trigger: "move"
      effects: [{ type: message, text: "moved" }]
`);
    // No legacy binding for 'move' because 'move' is not a valid key name.
    const movekey = def.input.bindings.find(b => b.kind === 'key' && b.keys.includes('move'));
    assert.equal(movekey, undefined);
  });
});

describe('migration: legacy `keymap:` normalises to input.bindings', () => {
  it('keymap entries produce map-context bindings', () => {
    const def = loadFromString(BASE + `
keymap:
  q: quaff
actions:
  player:
    - id: quaff
      effects: [{ type: message, text: "ok" }]
`);
    const res = resolve(mkState(def), { type: 'key', key: 'q' });
    assert.equal(res.actions[0].actionId, 'quaff');
  });
});
