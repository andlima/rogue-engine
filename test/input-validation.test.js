import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';

const BASE = `
meta:
  id: input-validate
  name: Input Validate
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
      effects:
        - { type: message, text: "ok" }
    - id: cast
      label: "Cast"
      effects:
        - { type: message, text: "ok" }
`;

function yamlWith(input) {
  return `${BASE}\n${input}\n`;
}

// ── criterion 8: validation rejects/warns ──────────────────────────────

describe('input validation: unknown action id', () => {
  it('rejects a binding whose action is not declared', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: blortomatic }
`);
    assert.throws(() => loadFromString(y), /unknown action id 'blortomatic'/);
  });
});

describe('input validation: unknown context id', () => {
  it('rejects a binding referencing an unknown context', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff, context: inventory }
`);
    assert.throws(() => loadFromString(y), /unknown context id 'inventory'/);
  });

  it('accepts a custom context declared under input.contexts', () => {
    const y = yamlWith(`input:
  contexts:
    - { id: shopping, when: "state.level > 0" }
  bindings:
    - { key: "b", action: quaff, context: shopping }
`);
    const def = loadFromString(y);
    const b = def.input.bindings.find(b => b.context === 'shopping');
    assert.ok(b, 'binding present in shopping context');
  });

  it('rejects redefining a built-in context id', () => {
    const y = yamlWith(`input:
  contexts:
    - { id: map, when: "state.level > 0" }
  bindings: []
`);
    assert.throws(() => loadFromString(y), /built-in context/);
  });
});

describe('input validation: duplicate bindings', () => {
  it('rejects two unguarded bindings in the same context for the same key', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "q", action: cast }
`);
    assert.throws(() => loadFromString(y), /duplicate binding/);
  });

  it('warns (not errors) on overlapping `when`-guarded bindings', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff, when: "state.level == 1" }
    - { key: "q", action: cast,  when: "state.level == 2" }
`);
    const def = loadFromString(y);
    assert.ok(
      def.warnings.some(w => w.includes('overlapping bindings')),
      `expected overlap warning; got: ${JSON.stringify(def.warnings)}`
    );
  });

  it('accepts `overlaps_with:` to suppress the overlap warning', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff, when: "state.level == 1" }
    - { key: "q", action: cast,  when: "state.level == 2", overlaps_with: "input.bindings[0]" }
`);
    const def = loadFromString(y);
    assert.ok(
      !def.warnings.some(w => w.includes('overlapping bindings')),
      `expected no overlap warning; got: ${JSON.stringify(def.warnings)}`
    );
  });
});

describe('input validation: bad key names', () => {
  it('rejects a non-vocabulary key with a near-miss suggestion', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "ESCP", action: quaff }
`);
    assert.throws(() => loadFromString(y), /did you mean 'ESC'/);
  });

  it('rejects modifier-only keys', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "CTRL", action: quaff }
`);
    assert.throws(() => loadFromString(y), /modifier-only/);
  });
});

describe('input validation: sequences', () => {
  it('rejects empty sequence', () => {
    const y = yamlWith(`input:
  bindings:
    - { sequence: [], action: quaff }
`);
    assert.throws(() => loadFromString(y), /at least two elements/);
  });

  it('rejects one-element sequence', () => {
    const y = yamlWith(`input:
  bindings:
    - { sequence: [g], action: quaff }
`);
    assert.throws(() => loadFromString(y), /at least two elements/);
  });

  it('rejects sequences containing modifier combos', () => {
    const y = yamlWith(`input:
  bindings:
    - { sequence: [g, "CTRL+x"], action: quaff }
`);
    assert.throws(() => loadFromString(y), /modifier combos/);
  });
});

describe('input validation: multiple key forms', () => {
  it('rejects a binding with both `key` and `keys`', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", keys: ["q"], action: quaff }
`);
    assert.throws(() => loadFromString(y), /exactly one of/);
  });

  it('rejects a binding with no key form', () => {
    const y = yamlWith(`input:
  bindings:
    - { action: quaff }
`);
    assert.throws(() => loadFromString(y), /exactly one of/);
  });
});

describe('input validation: help section refs', () => {
  it('rejects help.sections referencing an unknown action id', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff }
  help:
    sections:
      - { header: "Main", actions: [quaff, nope_action] }
`);
    assert.throws(() => loadFromString(y), /unknown action id 'nope_action'/);
  });

  it('rejects help.hide naming an action with no binding', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff }
  help:
    hide: [cast]
`);
    assert.throws(() => loadFromString(y), /no binding — nothing to hide/);
  });
});

describe('input validation: overlaps_with fixture passes', () => {
  it('accepts an intentional overlap marked with overlaps_with', () => {
    const y = yamlWith(`input:
  bindings:
    - { key: "q", action: quaff }
    - { key: "q", action: cast, when: "state.level > 5", overlaps_with: "earlier entry" }
`);
    // Does not throw; does not warn about overlaps.
    const def = loadFromString(y);
    assert.ok(!def.warnings.some(w => w.includes('overlapping bindings')));
  });
});
