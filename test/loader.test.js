import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString, loadFromFile } from '../src/config/loader.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINIMAL_YAML_PATH = join(__dirname, '..', 'games', 'minimal.yaml');

const VALID_YAML = `
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

describe('loader - schema validation errors', () => {
  it('reports missing required fields', () => {
    const yaml = `
meta:
  id: test
  version: "1.0.0"
  player_archetype: player
measurements: []
beings: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /meta\.name/);
      assert.match(err.message, /required string field/);
      return true;
    });
  });

  it('reports unknown cross-references (being → measurement)', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: HP
    initial: 10
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
    measurements:
      mp: 5
items: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown measurement 'mp'/);
      assert.match(err.message, /known: hp/);
      return true;
    });
  });

  it('reports unknown cross-references (measurement max → measurement)', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: HP
    initial: 10
    max: max_hp
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
items: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown measurement 'max_hp'/);
      return true;
    });
  });

  it('reports type mismatches (initial not a number)', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: HP
    initial: "ten"
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
items: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /initial/);
      assert.match(err.message, /not a number/);
      return true;
    });
  });

  it('reports unknown player_archetype', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: wizard
measurements:
  - id: hp
    label: HP
    initial: 10
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
items: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /meta\.player_archetype/);
      assert.match(err.message, /unknown being 'wizard'/);
      return true;
    });
  });

  it('reports missing player spawn in map', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: HP
    initial: 10
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
items: []
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#.#"
    - "###"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /no player spawn/);
      return true;
    });
  });
});

describe('loader - valid game loading', () => {
  it('loads valid YAML and produces expected GameDefinition shape', () => {
    const def = loadFromString(VALID_YAML);
    assert.equal(def.meta.id, 'test');
    assert.equal(def.meta.name, 'Test Game');
    assert.equal(def.meta.version, '1.0.0');
    assert.equal(def.meta.player_archetype, 'player');
    assert.equal(def.measurements.length, 1);
    assert.equal(def.measurements[0].id, 'hp');
    assert.equal(def.measurements[0].initial, 10);
    assert.equal(def.measurements[0].min, 0);
    assert.equal(def.measurements[0].max, null);
    assert.equal(def.beings.length, 1);
    assert.equal(def.beings[0].id, 'player');
    assert.equal(def.beings[0].glyph, '@');
    assert.deepEqual(def.beings[0].measurements, { hp: 10 });
    assert.deepEqual(def.items, []);
    assert.equal(def.map.width, 5);
    assert.equal(def.map.height, 5);
    assert.deepEqual(def.map.spawn, { x: 2, y: 2 });
    assert.ok(def._index.measurements.hp);
    assert.ok(def._index.beings.player);
  });

  it('loads games/minimal.yaml and produces valid definition', async () => {
    const def = await loadFromFile(MINIMAL_YAML_PATH);
    assert.equal(def.meta.id, 'minimal');
    assert.equal(def.meta.name, 'Minimal Dungeon');
    assert.equal(def.measurements.length, 1);
    assert.equal(def.beings.length, 1);
    assert.equal(def.map.width, 10);
    assert.equal(def.map.height, 10);
    assert.deepEqual(def.map.spawn, { x: 5, y: 5 });
  });

  it('produces deterministic results (two loads are equal)', () => {
    const def1 = loadFromString(VALID_YAML);
    const def2 = loadFromString(VALID_YAML);
    // Remove _index for comparison since it uses Object.create(null)
    const { _index: _i1, ...rest1 } = def1;
    const { _index: _i2, ...rest2 } = def2;
    assert.deepEqual(rest1, rest2);
    // Also check index keys match
    assert.deepEqual(Object.keys(_i1.measurements), Object.keys(_i2.measurements));
    assert.deepEqual(Object.keys(_i1.beings), Object.keys(_i2.beings));
  });
});
