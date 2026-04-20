import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString, loadFromFile } from '../src/config/loader.js';
import { getHelpRows, getKeyHint } from '../src/input/help.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = `
meta:
  id: help-test
  name: Help Test
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
actions:
  player:
    - id: quaff
      label: "Quaff potion"
      summary: "Drink a healing potion"
      effects: [{ type: message, text: "q" }]
    - id: cast
      label: "Cast"
      summary: "Cast a spell"
      effects: [{ type: message, text: "z" }]
    - id: debug_dump
      label: "Debug dump"
      effects: [{ type: message, text: "dbg" }]
`;

describe('help: getHelpRows default layout', () => {
  it('produces a single Commands group when no sections are declared', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "z", action: cast }
`);
    const help = getHelpRows(def, {});
    assert.equal(help.title, 'Commands');
    assert.equal(help.sections.length, 1);
    assert.equal(help.sections[0].header, 'Commands');
    const ids = help.sections[0].rows.map(r => r.actionId);
    assert.ok(ids.includes('quaff'));
    assert.ok(ids.includes('cast'));
  });
});

describe('help: sections and hide', () => {
  it('groups rows by section headers', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "z", action: cast }
  help:
    title: "Spellbook"
    sections:
      - { header: "Consumables", actions: [quaff] }
      - { header: "Spells",      actions: [cast] }
`);
    const help = getHelpRows(def, {});
    assert.equal(help.title, 'Spellbook');
    assert.equal(help.sections.length, 2);
    assert.equal(help.sections[0].header, 'Consumables');
    assert.equal(help.sections[0].rows[0].actionId, 'quaff');
    assert.equal(help.sections[1].header, 'Spells');
    assert.equal(help.sections[1].rows[0].actionId, 'cast');
  });

  it('filters actions listed in input.help.hide', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "d", action: debug_dump }
  help:
    hide: [debug_dump]
`);
    const help = getHelpRows(def, {});
    const ids = help.sections.flatMap(s => s.rows.map(r => r.actionId));
    assert.ok(ids.includes('quaff'));
    assert.ok(!ids.includes('debug_dump'));
  });

  it('filters bindings guarded by `state.debug` unless debug is true', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "d", action: debug_dump, when: "state.debug" }
`);
    const nonDebug = getHelpRows(def, { state: { debug: false } });
    const ids = nonDebug.sections.flatMap(s => s.rows.map(r => r.actionId));
    assert.ok(!ids.includes('debug_dump'));

    const debug = getHelpRows(def, { debug: true, state: { debug: true } });
    const ids2 = debug.sections.flatMap(s => s.rows.map(r => r.actionId));
    assert.ok(ids2.includes('debug_dump'));
  });
});

describe('help: row content', () => {
  it('uses the binding label override when present', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: ".", action: quaff, label: "wait" }
`);
    const help = getHelpRows(def, {});
    const row = help.sections.flatMap(s => s.rows).find(r => r.actionId === 'quaff');
    assert.equal(row.label, 'wait', 'binding label overrides action label');
  });

  it('falls back to the action label when no binding label', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "q", action: quaff }
`);
    const help = getHelpRows(def, {});
    const row = help.sections.flatMap(s => s.rows).find(r => r.actionId === 'quaff');
    assert.equal(row.label, 'Quaff potion');
    assert.equal(row.summary, 'Drink a healing potion');
  });

  it('renders alias keys as an array for the display', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { keys: [UP, k], action: quaff }
`);
    const help = getHelpRows(def, {});
    const row = help.sections.flatMap(s => s.rows).find(r => r.actionId === 'quaff');
    assert.deepEqual(row.keys, ['UP', 'k']);
  });

  it('renders sequences as a space-joined display key', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { sequence: [g, g], action: quaff }
`);
    const help = getHelpRows(def, {});
    const row = help.sections.flatMap(s => s.rows).find(r => r.actionId === 'quaff');
    assert.deepEqual(row.keys, ['g g']);
  });
});

describe('help: snapshot of games/silly/game.yaml', () => {
  it('produces stable header ordering matching the input.help.sections declaration', async () => {
    const def = await loadFromFile(join(__dirname, '..', 'games', 'silly', 'game.yaml'));
    const help = getHelpRows(def, {});
    assert.equal(help.title, 'Silly Game — Commands');
    const headers = help.sections.map(s => s.header);
    assert.deepEqual(headers, ['Move', 'Actions', 'System']);
    const moveActions = help.sections[0].rows.map(r => r.actionId);
    assert.deepEqual(moveActions, ['move_n', 'move_s', 'move_e', 'move_w']);
    // System section shows the built-in help action and its binding key(s).
    const systemRow = help.sections[2].rows.find(r => r.actionId === 'open_help');
    assert.ok(systemRow, 'open_help appears in System');
    assert.deepEqual(systemRow.keys, ['?']);
  });
});

describe('help: getKeyHint', () => {
  it('derives hints from the active context bindings plus intrinsic inputs', () => {
    const def = loadFromString(BASE + `
input:
  bindings:
    - { key: "?",   action: open_help, context: flow }
`);
    const state = {
      definition: def,
      flowState: { actionId: 'quaff', stepIndex: 0, bindings: {}, origin: { x: 0, y: 0 } },
      player: { x: 0, y: 0 },
      level: 1, turn: 0,
    };
    const hint = getKeyHint(def, state, [{ keys: ['↑/↓'], label: 'select', actionId: '_select' }]);
    assert.match(hint, /↑\/↓ select/);
    assert.match(hint, /help/i);
    assert.match(hint, /cancel/i, 'built-in ESC cancel in flow');
  });
});
