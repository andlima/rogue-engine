import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEffect, applyEffects } from '../src/runtime/effects.js';
import { createRng } from '../src/runtime/rng.js';

function makeDefinition() {
  const measurementIndex = Object.create(null);
  measurementIndex.hp = { id: 'hp', label: 'HP', min: 0, max: 20, initial: 10 };
  measurementIndex.mp = { id: 'mp', label: 'MP', min: 0, max: 10, initial: 5 };
  const beingIndex = Object.create(null);
  beingIndex.goblin = { id: 'goblin', label: 'Goblin', glyph: 'g', color: 'green', tags: ['monster'], measurements: { hp: 5 } };
  const itemIndex = Object.create(null);
  itemIndex.potion = { id: 'potion', label: 'Potion', glyph: '!', color: 'red', kind: 'consumable', tags: ['consumable'] };

  return {
    measurements: [measurementIndex.hp, measurementIndex.mp],
    beings: [beingIndex.goblin],
    items: [itemIndex.potion],
    map: {
      width: 5, height: 5,
      tiles: [
        ['#','#','#','#','#'],
        ['#','.','.','.','.'],
        ['#','.','.','.','.'],
        ['#','.','.','.','.'],
        ['#','#','#','#','#'],
      ],
    },
    _index: {
      measurements: measurementIndex,
      beings: beingIndex,
      items: itemIndex,
    },
  };
}

function makeState() {
  const rng = createRng(42);
  return {
    definition: makeDefinition(),
    turn: 0,
    level: 1,
    player: {
      x: 2, y: 2,
      archetype: 'hero',
      name: 'Hero',
      label: 'Hero',
      measurements: { hp: 15, mp: 5 },
      tags: ['player'],
      inventory: [],
      equipment: Object.create(null),
    },
    entities: [],
    messages: [],
    rng,
    terminal: null,
    terminalReason: null,
  };
}

function makeScope(state, actor, target) {
  const a = actor || state.player;
  const t = target || state.player;
  const actorIdx = a === state.player ? -1 : state.entities.indexOf(a);
  const targetIdx = t === state.player ? -1 : state.entities.indexOf(t);
  return {
    self: a,
    actor: a,
    target: t,
    tile: { x: a.x, y: a.y },
    state: { level: state.level, turn: state.turn },
    player: state.player,
    _rng: state.rng,
    _actorIdx: actorIdx,
    _targetIdx: targetIdx,
    _rawActor: a,
    _rawTarget: t,
    _rawPlayer: state.player,
  };
}

describe('effect: apply', () => {
  it('adds delta to a measurement', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'apply', target: 'player', measurement: 'hp', delta: -3,
    }, scope);
    assert.equal(next.player.measurements.hp, 12);
  });

  it('clamps to min', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'apply', target: 'player', measurement: 'hp', delta: -100,
    }, scope);
    assert.equal(next.player.measurements.hp, 0);
  });

  it('clamps to max', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'apply', target: 'player', measurement: 'hp', delta: 100,
    }, scope);
    assert.equal(next.player.measurements.hp, 20);
  });

  it('evaluates expression deltas', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'apply', target: 'player', measurement: 'hp', delta: '0 - 5',
    }, scope);
    assert.equal(next.player.measurements.hp, 10);
  });

  it('does not mutate original state', () => {
    const state = makeState();
    const scope = makeScope(state);
    applyEffect(state, {
      type: 'apply', target: 'player', measurement: 'hp', delta: -5,
    }, scope);
    assert.equal(state.player.measurements.hp, 15);
  });
});

describe('effect: set', () => {
  it('sets a measurement to an absolute value', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'set', target: 'player', measurement: 'hp', value: 7,
    }, scope);
    assert.equal(next.player.measurements.hp, 7);
  });

  it('clamps the set value', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'set', target: 'player', measurement: 'hp', value: 999,
    }, scope);
    assert.equal(next.player.measurements.hp, 20);
  });
});

describe('effect: move', () => {
  it('moves the actor in a cardinal direction', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'move', dir: 'e', target: 'actor',
    }, scope);
    assert.equal(next.player.x, 3);
  });

  it('blocks movement into walls', () => {
    const state = makeState();
    state.player.x = 1;
    state.player.y = 1;
    const scope = makeScope(state);
    const next = applyEffect(state, {
      type: 'move', dir: 'w', target: 'actor',
    }, scope);
    // Wall at (0,1), should stay
    assert.equal(next.player.x, 1);
  });
});

describe('effect: spawn', () => {
  it('spawns a being entity', () => {
    const state = makeState();
    const scope = makeScope(state);
    scope.tile = { x: 3, y: 3 };
    const next = applyEffect(state, {
      type: 'spawn', being: 'goblin',
    }, scope);
    assert.equal(next.entities.length, 1);
    assert.equal(next.entities[0].id, 'goblin');
    assert.equal(next.entities[0].kind, 'being');
    assert.equal(next.entities[0].x, 3);
    assert.equal(next.entities[0].y, 3);
  });

  it('spawns an item entity', () => {
    const state = makeState();
    const scope = makeScope(state);
    scope.tile = { x: 2, y: 2 };
    const next = applyEffect(state, {
      type: 'spawn', item: 'potion',
    }, scope);
    assert.equal(next.entities.length, 1);
    assert.equal(next.entities[0].id, 'potion');
    assert.equal(next.entities[0].kind, 'item');
  });
});

describe('effect: remove', () => {
  it('removes an entity from the state', () => {
    const state = makeState();
    const goblin = { id: 'goblin', kind: 'being', x: 3, y: 3, name: 'Goblin' };
    state.entities = [goblin];
    const scope = makeScope(state, state.player, goblin);
    const next = applyEffect(state, { type: 'remove', target: 'target' }, scope);
    assert.equal(next.entities.length, 0);
  });
});

describe('effect: message', () => {
  it('pushes a templated message to the log', () => {
    const state = makeState();
    const scope = makeScope(state);
    state._effectContext = { delta: 5, value: 0 };
    const next = applyEffect(state, {
      type: 'message', text: '{actor.name} deals {damage} damage!',
    }, scope);
    assert.equal(next.messages.length, 1);
    assert.equal(next.messages[0], 'Hero deals 5 damage!');
  });
});

describe('effect: transition_level', () => {
  it('advances the level by delta', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, { type: 'transition_level', delta: 1 }, scope);
    assert.equal(next.level, 2);
  });

  it('defaults delta to 1', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, { type: 'transition_level' }, scope);
    assert.equal(next.level, 2);
  });
});

describe('effect: win', () => {
  it('sets terminal state to win', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, { type: 'win', reason: 'Victory!' }, scope);
    assert.equal(next.terminal, 'win');
    assert.equal(next.terminalReason, 'Victory!');
  });
});

describe('effect: lose', () => {
  it('sets terminal state to lose', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffect(state, { type: 'lose', reason: 'Defeated!' }, scope);
    assert.equal(next.terminal, 'lose');
    assert.equal(next.terminalReason, 'Defeated!');
  });
});

describe('effect: pickup', () => {
  it('moves an item from world entities into actor inventory', () => {
    const state = makeState();
    const potion = { id: 'potion', kind: 'item', x: 2, y: 2, name: 'Potion', itemKind: 'consumable' };
    state.entities = [potion];
    const scope = makeScope(state, state.player, potion);
    const next = applyEffect(state, { type: 'pickup', target: 'actor' }, scope);
    // Item removed from world entities
    assert.equal(next.entities.length, 0);
    // Item added to player inventory
    assert.equal(next.player.inventory.length, 1);
    assert.equal(next.player.inventory[0], potion);
  });

  it('resolves item from actor tile when scope target is not an item', () => {
    const state = makeState();
    const potion = { id: 'potion', kind: 'item', x: 2, y: 2, name: 'Potion', itemKind: 'consumable' };
    state.entities = [potion];
    // Scope with no item target (same as dispatch builds for player actions)
    const scope = makeScope(state, state.player, null);
    const next = applyEffect(state, { type: 'pickup', target: 'actor' }, scope);
    assert.equal(next.entities.length, 0);
    assert.equal(next.player.inventory.length, 1);
    assert.equal(next.player.inventory[0], potion);
  });
});

describe('effect: equip', () => {
  it('moves an item from inventory to equipment slot', () => {
    const state = makeState();
    const sword = { id: 'sword', kind: 'item', name: 'Sword', itemKind: 'weapon' };
    state.player.inventory = [sword];
    state.player.equipment = Object.create(null);
    const scope = makeScope(state, state.player, sword);
    scope._rawItem = sword;
    const next = applyEffect(state, { type: 'equip', target: 'actor' }, scope);
    // Item moved to equipment
    assert.equal(next.player.equipment.weapon, sword);
    // Item removed from inventory
    assert.equal(next.player.inventory.length, 0);
  });

  it('resolves item from inventory when scope target is not an item', () => {
    const state = makeState();
    const sword = { id: 'sword', kind: 'item', name: 'Sword', itemKind: 'weapon' };
    state.player.inventory = [sword];
    state.player.equipment = Object.create(null);
    // Scope with no item target (same as dispatch builds for player actions)
    const scope = makeScope(state, state.player, null);
    const next = applyEffect(state, { type: 'equip', target: 'actor' }, scope);
    assert.equal(next.player.equipment.weapon, sword);
    assert.equal(next.player.inventory.length, 0);
  });

  it('resolves item by id from effect definition', () => {
    const state = makeState();
    const sword = { id: 'sword', kind: 'item', name: 'Sword', itemKind: 'weapon' };
    const shield = { id: 'shield', kind: 'item', name: 'Shield', itemKind: 'armor' };
    state.player.inventory = [sword, shield];
    state.player.equipment = Object.create(null);
    const scope = makeScope(state, state.player, null);
    const next = applyEffect(state, { type: 'equip', target: 'actor', item: 'shield' }, scope);
    assert.equal(next.player.equipment.armor, shield);
    assert.equal(next.player.inventory.length, 1);
    assert.equal(next.player.inventory[0], sword);
  });
});

describe('applyEffects', () => {
  it('chains multiple effects returning final state', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffects(state, [
      { type: 'apply', target: 'player', measurement: 'hp', delta: -3 },
      { type: 'message', text: 'Took 3 damage' },
    ], scope);
    assert.equal(next.player.measurements.hp, 12);
    assert.equal(next.messages.length, 1);
  });

  it('stops at terminal effects', () => {
    const state = makeState();
    const scope = makeScope(state);
    const next = applyEffects(state, [
      { type: 'lose', reason: 'dead' },
      { type: 'apply', target: 'player', measurement: 'hp', delta: 100 },
    ], scope);
    assert.equal(next.terminal, 'lose');
    // hp unchanged after terminal
    assert.equal(next.player.measurements.hp, 15);
  });
});
