import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromString } from '../src/config/loader.js';

const BASE_YAML = `
meta:
  id: test
  name: Test
  version: "1.0.0"
  player_archetype: player
measurements:
  - id: hp
    label: HP
    min: 0
    max: 20
    initial: 10
  - id: defense
    label: Defense
    min: 0
    max: null
    initial: 2
beings:
  - id: player
    label: Player
    glyph: "@"
    color: white
    measurements:
      hp: 10
    tags: [player]
  - id: goblin
    label: Goblin
    glyph: "g"
    color: green
    measurements:
      hp: 5
    tags: [monster]
items:
  - id: potion
    label: Potion
    glyph: "!"
    color: red
    kind: consumable
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

describe('loader validation - expressions referencing unknown measurements', () => {
  it('rejects expression referencing unknown measurement id', () => {
    const yaml = BASE_YAML + `
actions:
  player:
    - id: attack
      trigger: attack
      effects:
        - type: apply
          target: target
          measurement: hp
          delta: "actor.defence - 1"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown path 'actor\.defence'/);
      assert.match(err.message, /did you mean 'defense'/);
      return true;
    });
  });
});

describe('loader validation - actions referencing undefined effect types', () => {
  it('rejects unknown effect types', () => {
    const yaml = BASE_YAML + `
actions:
  player:
    - id: zap
      trigger: zap
      effects:
        - type: lightning_bolt
          damage: 10
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown effect type 'lightning_bolt'/);
      return true;
    });
  });
});

describe('loader validation - spawn tables referencing unknown being/item ids', () => {
  it('rejects spawn tables with unknown being ids', () => {
    const yaml = BASE_YAML + `
world:
  spawn_tables:
    "1":
      - id: dragon
        weight: 1
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown being or item 'dragon'/);
      return true;
    });
  });
});

describe('loader validation - win/loss conditions parse failures', () => {
  it('rejects unparseable win conditions', () => {
    const yaml = BASE_YAML + `
world:
  win_conditions:
    - "player.hp >>>= invalid"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /failed to parse expression/);
      return true;
    });
  });

  it('rejects unparseable loss conditions', () => {
    const yaml = BASE_YAML + `
world:
  loss_conditions:
    - "1 + + 2"
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /failed to parse expression/);
      return true;
    });
  });
});

describe('loader validation - rendering overrides referencing unknown ids', () => {
  it('rejects rendering being override for unknown being', () => {
    const yaml = BASE_YAML + `
rendering:
  beings:
    dragon:
      glyph: "D"
      color: red
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown being 'dragon'/);
      return true;
    });
  });

  it('rejects rendering item override for unknown item', () => {
    const yaml = BASE_YAML + `
rendering:
  items:
    excalibur:
      glyph: "/"
      color: yellow
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown item 'excalibur'/);
      return true;
    });
  });
});

describe('loader validation - effect measurement references', () => {
  it('rejects effect referencing unknown measurement with near-miss suggestion', () => {
    const yaml = BASE_YAML + `
actions:
  player:
    - id: attack
      trigger: attack
      effects:
        - type: apply
          target: target
          measurement: hq
`;
    assert.throws(() => loadFromString(yaml), (err) => {
      assert.match(err.message, /unknown measurement 'hq'/);
      assert.match(err.message, /did you mean 'hp'/);
      return true;
    });
  });
});

describe('loader validation - valid game with all sections', () => {
  it('loads a complete game definition with actions, world, rendering', () => {
    const yaml = BASE_YAML + `
actions:
  player:
    - id: attack
      trigger: attack
      effects:
        - type: apply
          target: target
          measurement: hp
          delta: "-3"
        - type: message
          text: "{actor.name} attacks!"
  ai:
    - id: ai_attack
      condition: "actor.hp > 0"
      effects:
        - type: apply
          target: target
          measurement: hp
          delta: "-1"
world:
  levels:
    count: 5
  dungeon:
    width: 40
    height: 30
    room_count: [3, 6]
    room_size: [4, 8]
    corridor_style: straight
  spawn_tables:
    "1":
      - id: goblin
        weight: 10
      - id: potion
        weight: 3
  win_conditions:
    - "state.level > 5"
  loss_conditions:
    - "player.hp <= 0"
  starting_state:
    level: 1
rendering:
  beings:
    player:
      color: bright_white
    goblin:
      color: bright_green
  items:
    potion:
      color: bright_red
  hud:
    measurements:
      - hp
      - defense
    message_log_size: 8
  status_rules:
    - when: "actor.hp < 5"
      glyph_color: red
`;
    const def = loadFromString(yaml);
    assert.ok(def.actions);
    assert.equal(def.actions.player.length, 1);
    assert.equal(def.actions.ai.length, 1);
    assert.ok(def.world);
    assert.equal(def.world.levels.count, 5);
    assert.ok(def.world.dungeon);
    assert.ok(def.world.spawn_tables);
    assert.ok(def.world.win_conditions);
    assert.ok(def.world.loss_conditions);
    assert.ok(def.rendering);
    assert.ok(def.rendering.beings);
    assert.ok(def.rendering.hud);
    assert.ok(def.rendering.status_rules);
  });
});
