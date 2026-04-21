import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString, loadFromFile } from '../src/config/loader.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINIMAL_YAML_PATH = join(__dirname, '..', 'games', 'minimal.yaml');
const PLACEMENT_MAP_PATH = join(__dirname, 'fixtures', 'placement-map.yaml');

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
    // New sections default to empty/null
    assert.ok(def.actions);
    assert.deepEqual(def.actions.player, []);
    assert.deepEqual(def.actions.ai, []);
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
    const { _index: _i1, ...rest1 } = def1;
    const { _index: _i2, ...rest2 } = def2;
    assert.deepEqual(rest1, rest2);
    assert.deepEqual(Object.keys(_i1.measurements), Object.keys(_i2.measurements));
    assert.deepEqual(Object.keys(_i1.beings), Object.keys(_i2.beings));
  });

  it('has empty map.placements when no entity glyphs appear in tiles', () => {
    const def = loadFromString(VALID_YAML);
    assert.deepEqual(def.map.placements, []);
  });
});

describe('loader - map entity placement', () => {
  it('records entity glyphs as placements and rewrites their cells to floor', async () => {
    const def = await loadFromFile(PLACEMENT_MAP_PATH);
    assert.equal(def.map.placements.length, 3);
    assert.deepEqual(def.map.placements[0], { kind: 'being', id: 'crab', x: 4, y: 2 });
    assert.deepEqual(def.map.placements[1], { kind: 'item', id: 'coin', x: 5, y: 3 });
    assert.deepEqual(def.map.placements[2], { kind: 'being', id: 'shark', x: 7, y: 4 });
    // Source cells should all be rewritten to '.'
    assert.equal(def.map.tiles[2][4], '.');
    assert.equal(def.map.tiles[3][5], '.');
    assert.equal(def.map.tiles[4][7], '.');
    // Spawn '@' cell also rewritten
    assert.equal(def.map.tiles[2][2], '.');
    assert.deepEqual(def.map.spawn, { x: 2, y: 2 });
  });

  it('throws unknown tile character for glyphs that are neither tile nor entity', () => {
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
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.Q@#"
    - "#####"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown tile character 'Q'/);
      return true;
    });
  });

  it('throws SchemaError listing both ids when a colliding glyph is used in the map', () => {
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
  - id: rat
    label: Rat
    glyph: r
    color: brown
  - id: roach
    label: Roach
    glyph: r
    color: black
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#r@.#"
    - "#####"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /glyph 'r'/);
      assert.match(err.message, /being:rat/);
      assert.match(err.message, /being:roach/);
      return true;
    });
  });

  it('allows an unused colliding glyph — collision only errors when the glyph is in the map', () => {
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
  - id: rat
    label: Rat
    glyph: r
    color: brown
  - id: roach
    label: Roach
    glyph: r
    color: black
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.@.#"
    - "#####"
`;
    const def = loadFromString(yaml);
    assert.deepEqual(def.map.placements, []);
  });

  it('gives tile precedence over entity glyph when a custom tile shares the glyph', () => {
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
items:
  - id: rock
    label: Rock
    glyph: x
    color: gray
    kind: currency
tiles:
  x:
    kind: lava
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#x@.#"
    - "#####"
`;
    const def = loadFromString(yaml);
    assert.equal(def.map.tiles[1][1], 'x');
    assert.deepEqual(def.map.placements, []);
  });

  it('treats @ as player spawn even when a being declares glyph "@"', () => {
    const yaml = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: captain
measurements:
  - id: hp
    label: HP
    initial: 10
beings:
  - id: captain
    label: Captain
    glyph: "@"
    color: white
items: []
map:
  width: 5
  height: 3
  tiles:
    - "#####"
    - "#.@.#"
    - "#####"
`;
    const def = loadFromString(yaml);
    assert.deepEqual(def.map.spawn, { x: 2, y: 1 });
    assert.deepEqual(def.map.placements, []);
  });
});

describe('loader - emoji validation', () => {
  const withBeingEmoji = (emoji) => `
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
    emoji: ${JSON.stringify(emoji)}
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

  const rejectionCases = [
    { label: 'ZWJ sequence (pirate flag)', emoji: '🏴‍☠️', needle: /ZWJ/ },
    { label: 'bare text-presentation (⚔)', emoji: '⚔', needle: /VS16|text-presentation/ },
    { label: 'skin-tone modifier', emoji: '🧔🏽', needle: /skin-tone/ },
    { label: 'regional indicator flag (🇺🇸)', emoji: '🇺🇸', needle: /flag/ },
    { label: 'multi-grapheme (⚔⚔)', emoji: '⚔⚔', needle: /grapheme/ },
    { label: 'empty string', emoji: '', needle: /non-empty/ },
    { label: 'single ASCII char (@)', emoji: '@', needle: /VS16|text-presentation/ },
  ];

  for (const { label, emoji, needle } of rejectionCases) {
    it(`rejects ${label}`, () => {
      assert.throws(() => loadFromString(withBeingEmoji(emoji)), (err) => {
        assert.equal(err.name, 'SchemaError');
        assert.equal(err.path, 'beings[0].emoji');
        assert.match(err.message, needle);
        return true;
      });
    });
  }

  const acceptanceCases = [
    { label: 'supplementary plane without VS16 (🐀)', emoji: '🐀' },
    { label: 'supplementary plane (💰)', emoji: '💰' },
    { label: 'BMP base + VS16 (⚔️)', emoji: '⚔️' },
    { label: 'supplementary + VS16 (🛡️)', emoji: '🛡️' },
  ];

  for (const { label, emoji } of acceptanceCases) {
    it(`accepts ${label}`, () => {
      const def = loadFromString(withBeingEmoji(emoji));
      assert.equal(def.beings[0].emoji, emoji);
    });
  }

  it('still allows missing emoji field', () => {
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
    - "#@#"
    - "###"
`;
    const def = loadFromString(yaml);
    assert.equal(def.beings[0].emoji, undefined);
  });

  it('validates rendering.tiles emoji overrides', () => {
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
    - "#@#"
    - "###"
rendering:
  tiles:
    "#":
      emoji: "⚔"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.equal(err.name, 'SchemaError');
      assert.equal(err.path, 'rendering.tiles.#.emoji');
      assert.match(err.message, /VS16|text-presentation/);
      return true;
    });
  });

  it('validates rendering.items emoji overrides', () => {
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
items:
  - id: coin
    label: Coin
    glyph: "$"
    color: yellow
    kind: currency
map:
  width: 3
  height: 3
  tiles:
    - "###"
    - "#@#"
    - "###"
rendering:
  items:
    coin:
      emoji: "🇺🇸"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.equal(err.name, 'SchemaError');
      assert.equal(err.path, 'rendering.items.coin.emoji');
      assert.match(err.message, /flag/);
      return true;
    });
  });

  it('surfaces ZWJ rejection with correct path when loading from file', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'pirate-v2-like.yaml');
    await assert.rejects(loadFromFile(fixturePath), (err) => {
      assert.equal(err.name, 'SchemaError');
      assert.equal(err.path, 'beings[0].emoji');
      assert.match(err.message, /ZWJ/);
      return true;
    });
  });
});
