/**
 * Effect handlers — each takes (state, effect, scope) and returns a new state.
 * Effects are the extensibility boundary: new mechanics = new effect types in JS.
 *
 * All handlers are pure — they return a new state without mutating the input.
 */

import { parse } from '../expressions/parser.js';
import { evaluate } from '../expressions/evaluator.js';
import { generateDungeon } from './dungeon.js';
import { randomInt, weightedPick } from './rng.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function clampMeasurement(value, measurementDef, entity) {
  let v = value;
  if (measurementDef.min != null) v = Math.max(v, measurementDef.min);
  if (typeof measurementDef.max === 'number') {
    v = Math.min(v, measurementDef.max);
  } else if (typeof measurementDef.max === 'string' && entity) {
    // max can be a measurement ID reference or expression; resolve from entity
    const maxVal = entity.measurements?.[measurementDef.max];
    if (typeof maxVal === 'number') v = Math.min(v, maxVal);
  }
  return v;
}

function evalField(field, scope, rng) {
  if (typeof field === 'number') return field;
  if (typeof field === 'string') {
    const ast = parse(field);
    const warnings = [];
    return evaluate(ast, scope, { rng, warnings });
  }
  return field;
}

/**
 * Resolve a target reference to the actual entity in state and a function
 * to produce a new state with that entity updated.
 *
 * Uses _raw* scope entries (original references) to match entities in state,
 * since the regular scope entries are entity views with flattened measurements.
 *
 * target values: "self", "actor", "target", "player"
 * Returns { entity, update(newEntity) → newState }
 */
/**
 * After removing an entity at `removedIdx` from the entities array,
 * adjust scope._actorIdx and scope._targetIdx so they still point
 * at the correct entities (or are invalidated if they pointed at the
 * removed entity). Mutates scope in place.
 */
function adjustScopeIndicesAfterRemoval(scope, removedIdx) {
  if (removedIdx < 0) return;
  if (scope._targetIdx === removedIdx) {
    scope._targetIdx = -2; // sentinel: entity was removed
  } else if (scope._targetIdx > removedIdx) {
    scope._targetIdx = scope._targetIdx - 1;
  }
  if (scope._actorIdx === removedIdx) {
    scope._actorIdx = -2;
  } else if (scope._actorIdx > removedIdx) {
    scope._actorIdx = scope._actorIdx - 1;
  }
}

function resolveTarget(state, targetRef, scope) {
  // Determine which entity index to use based on the target keyword
  let idx;
  if (targetRef === 'player') {
    idx = -1;
  } else if (targetRef === 'self' || targetRef === 'actor') {
    idx = scope._actorIdx ?? -1;
  } else if (targetRef === 'target') {
    idx = scope._targetIdx ?? scope._actorIdx ?? -1;
  } else {
    idx = -1;
  }

  // Player (idx === -1)
  if (idx < 0) {
    return {
      entity: state.player,
      update: (newEntity) => ({ ...state, player: newEntity }),
    };
  }

  // NPC entity — use stable index
  if (idx < state.entities.length) {
    return {
      entity: state.entities[idx],
      update: (newEntity) => ({
        ...state,
        entities: state.entities.map((e, i) => i === idx ? newEntity : e),
      }),
    };
  }

  // Fallback to player
  return { entity: state.player, update: (ne) => ({ ...state, player: ne }) };
}

// ── Effect handlers ──────────────────────────────────────────────────────

function handleApply(state, effect, scope) {
  const { entity, update } = resolveTarget(state, effect.target, scope);
  const delta = evalField(effect.delta, scope, scope._rng);
  const mId = effect.measurement;
  const currentVal = entity.measurements[mId] ?? 0;
  const mDef = state.definition._index.measurements[mId];
  let newVal = currentVal + delta;
  if (mDef) newVal = clampMeasurement(newVal, mDef, entity);

  const newEntity = {
    ...entity,
    measurements: { ...entity.measurements, [mId]: newVal },
  };

  const newState = update(newEntity);
  // Thread computed delta through state for message template interpolation
  return { ...newState, _effectContext: { ...(newState._effectContext || {}), delta: Math.abs(delta), value: newVal } };
}

function handleSet(state, effect, scope) {
  const { entity, update } = resolveTarget(state, effect.target, scope);
  const value = evalField(effect.value, scope, scope._rng);
  const mId = effect.measurement;
  const mDef = state.definition._index.measurements[mId];
  let newVal = value;
  if (mDef) newVal = clampMeasurement(newVal, mDef, entity);

  const newEntity = {
    ...entity,
    measurements: { ...entity.measurements, [mId]: newVal },
  };
  return update(newEntity);
}

function handleMove(state, effect, scope) {
  const DIRS = { n: { dx: 0, dy: -1 }, s: { dx: 0, dy: 1 }, e: { dx: 1, dy: 0 }, w: { dx: -1, dy: 0 } };
  const dir = typeof effect.dir === 'string' && DIRS[effect.dir]
    ? effect.dir
    : String(evalField(effect.dir, scope, scope._rng));
  const delta = DIRS[dir];
  if (!delta) return state;

  const { entity, update } = resolveTarget(state, effect.target || 'actor', scope);
  const nx = entity.x + delta.dx;
  const ny = entity.y + delta.dy;
  const map = state.map || state.definition.map;
  if (!map) return state;

  if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) return state;
  if (map.tiles[ny][nx] === '#') return state;

  const newState = update({ ...entity, x: nx, y: ny });
  return { ...newState, _effectContext: { ...(newState._effectContext || {}), moved: true } };
}

function handleSpawn(state, effect, scope) {
  const beingDef = state.definition._index.beings[effect.being];
  const itemDef = state.definition._index.items[effect.item];

  if (beingDef) {
    // Spawn a being entity
    const x = effect.x != null ? evalField(effect.x, scope, scope._rng) : (scope.tile?.x ?? 0);
    const y = effect.y != null ? evalField(effect.y, scope, scope._rng) : (scope.tile?.y ?? 0);
    const measurements = Object.create(null);
    for (const m of state.definition.measurements) {
      measurements[m.id] = beingDef.measurements[m.id] ?? m.initial;
    }
    const entity = {
      id: beingDef.id,
      kind: 'being',
      label: beingDef.label,
      glyph: beingDef.glyph,
      color: beingDef.color,
      tags: [...beingDef.tags],
      x, y,
      measurements,
      inventory: [],
      equipment: Object.create(null),
    };
    return { ...state, entities: [...state.entities, entity] };
  }

  if (itemDef) {
    const x = effect.x != null ? evalField(effect.x, scope, scope._rng) : (scope.tile?.x ?? 0);
    const y = effect.y != null ? evalField(effect.y, scope, scope._rng) : (scope.tile?.y ?? 0);
    const entity = {
      id: itemDef.id,
      kind: 'item',
      label: itemDef.label,
      glyph: itemDef.glyph,
      color: itemDef.color,
      tags: [...itemDef.tags],
      itemKind: itemDef.kind,
      properties: itemDef.properties ? { ...itemDef.properties } : {},
      x, y,
    };
    return { ...state, entities: [...state.entities, entity] };
  }

  return state;
}

function handleRemove(state, effect, scope) {
  const targetRef = effect.target || 'target';
  const { entity } = resolveTarget(state, targetRef, scope);
  if (entity === state.player) return state; // Can't remove the player
  const removedIdx = state.entities.indexOf(entity);
  const newEntities = state.entities.filter(e => e !== entity);
  adjustScopeIndicesAfterRemoval(scope, removedIdx);
  return { ...state, entities: newEntities };
}

/**
 * Consume (remove) an item from the actor's inventory by item id.
 */
function handleConsume(state, effect, scope) {
  const { entity, update } = resolveTarget(state, effect.target || 'actor', scope);
  const itemId = effect.item;
  if (!itemId || !entity.inventory) return state;
  const idx = entity.inventory.findIndex(i => i.id === itemId);
  if (idx < 0) return state;
  const newInventory = [...entity.inventory];
  newInventory.splice(idx, 1);
  return update({ ...entity, inventory: newInventory });
}

function handleEquip(state, effect, scope) {
  const { entity, update } = resolveTarget(state, effect.target || 'actor', scope);
  if (!entity.equipment) return state;

  // Resolve the item to equip:
  // 1. Explicit item id from effect definition
  // 2. Scope target if it's an item (in inventory OR on ground)
  // 3. First item in actor's inventory
  let rawItem;
  let fromGround = false;
  if (effect.item) {
    rawItem = (entity.inventory || []).find(i => i.id === effect.item);
  }
  if (!rawItem && scope._rawTarget && scope._rawTarget.kind === 'item') {
    if ((entity.inventory || []).includes(scope._rawTarget)) {
      rawItem = scope._rawTarget;
    } else if (effect.from_ground && state.entities.includes(scope._rawTarget)) {
      // Item is on the ground — pick up and equip in one step (opt-in)
      rawItem = scope._rawTarget;
      fromGround = true;
    }
  }
  if (!rawItem) {
    rawItem = (entity.inventory || []).find(i => i.kind === 'item');
  }
  if (!rawItem || rawItem.kind !== 'item') return state;

  // Determine slot: effect.slot expression, item properties, or item kind
  let slot;
  if (effect.slot) {
    slot = typeof effect.slot === 'string' ? evalField(effect.slot, scope, scope._rng) : effect.slot;
    slot = String(slot);
  } else {
    slot = rawItem.properties?.slot || rawItem.itemKind || 'default';
  }

  let newState = state;
  let updatedEntity = entity;

  if (fromGround) {
    // Remove item from ground entities
    const removedIdx = newState.entities.indexOf(rawItem);
    newState = { ...newState, entities: newState.entities.filter(e => e !== rawItem) };
    adjustScopeIndicesAfterRemoval(scope, removedIdx);
    // Re-resolve entity after state change (player may have shifted)
    const actorIdx = scope._actorIdx ?? -1;
    updatedEntity = actorIdx < 0 ? newState.player : newState.entities[actorIdx];
  }

  const newEquipment = { ...updatedEntity.equipment, [slot]: rawItem };
  const newInventory = fromGround
    ? [...(updatedEntity.inventory || [])]
    : (updatedEntity.inventory || []).filter(i => i !== rawItem);

  const newEntity = { ...updatedEntity, equipment: newEquipment, inventory: newInventory };

  const actorIdx = scope._actorIdx ?? -1;
  if (actorIdx < 0) {
    return { ...newState, player: newEntity };
  }
  return { ...newState, entities: newState.entities.map((e, i) => i === actorIdx ? newEntity : e) };
}

function handlePickup(state, effect, scope) {
  const actorRef = effect.target || 'actor';
  const { entity, update } = resolveTarget(state, actorRef, scope);

  // Resolve the item to pick up:
  // 1. Scope target if it's an item (when dispatched with item as target)
  // 2. First item entity at the actor's tile position
  let rawItem;
  if (scope._rawTarget && scope._rawTarget.kind === 'item') {
    rawItem = scope._rawTarget;
  }
  if (!rawItem) {
    rawItem = state.entities.find(
      e => e.kind === 'item' && e.x === entity.x && e.y === entity.y
    );
  }
  if (!rawItem || rawItem.kind !== 'item') return state;

  const newEntity = {
    ...entity,
    inventory: [...(entity.inventory || []), rawItem],
  };
  // Remove item from world entities, then update the actor by identity match
  const removedIdx = state.entities.indexOf(rawItem);
  const stateWithoutItem = { ...state, entities: state.entities.filter(e => e !== rawItem) };
  adjustScopeIndicesAfterRemoval(scope, removedIdx);
  const actorIdx = scope._actorIdx ?? -1;
  if (actorIdx < 0) {
    return { ...stateWithoutItem, player: newEntity };
  }
  // Match by identity — filtering may have shifted indices
  return {
    ...stateWithoutItem,
    entities: stateWithoutItem.entities.map(e => e === entity ? newEntity : e),
  };
}

function handleMessage(state, effect, scope) {
  let text = effect.text || '';
  // Template substitution: {actor.name}, {target.name}, {damage}, etc.
  text = text.replace(/\{([^}]+)\}/g, (_, path) => {
    const parts = path.trim().split('.');
    // Check scope for special keys first
    if (parts.length === 1) {
      if (parts[0] === 'damage' || parts[0] === 'delta') return state._effectContext?.delta ?? 0;
      if (parts[0] === 'value') return state._effectContext?.value ?? 0;
      if (scope[parts[0]] != null) return scope[parts[0]];
    }
    // Resolve dotted path in scope
    let cur = scope;
    for (const p of parts) {
      if (cur == null) return '???';
      cur = cur[p];
    }
    return cur ?? '???';
  });

  const messages = [...(state.messages || []), text];
  return { ...state, messages };
}

function handleTransitionLevel(state, effect, scope) {
  const delta = effect.delta != null ? evalField(effect.delta, scope, scope._rng) : 1;
  const currentLevel = state.level || 1;
  return { ...state, level: currentLevel + delta };
}

function handleWin(state, effect) {
  return { ...state, terminal: 'win', terminalReason: effect.reason || 'You win!' };
}

function handleLose(state, effect) {
  return { ...state, terminal: 'lose', terminalReason: effect.reason || 'You lose!' };
}

/**
 * Find an entity at (x, y) matching kind and set it as the scope target.
 * This effect modifies the scope (by reference) rather than state.
 * Subsequent effects in the chain see the found entity as `target`.
 */
function handleFindTarget(state, effect, scope) {
  const x = effect.x != null ? Math.floor(evalField(effect.x, scope, scope._rng)) : scope.tile?.x ?? 0;
  const y = effect.y != null ? Math.floor(evalField(effect.y, scope, scope._rng)) : scope.tile?.y ?? 0;
  const kind = effect.kind || 'being';

  const entity = state.entities.find(e => e.kind === kind && e.x === x && e.y === y);

  if (entity) {
    const idx = state.entities.indexOf(entity);
    scope._targetIdx = idx;
    scope.target_found = true;
    const ev = entityView(entity);
    scope.target = ev;
    scope._rawTarget = entity;
  } else {
    scope.target_found = false;
  }

  return state;
}

/**
 * Generate a new dungeon level: create map, spawn entities from tables.
 * Reads world.dungeon for generation params and world.spawn_rules/spawn_tables
 * for entity placement.
 */
function handleGenerateLevel(state, effect, scope) {
  const world = state.definition.world;
  if (!world || !world.dungeon) return state;

  const rng = scope._rng;
  const map = generateDungeon(rng, world.dungeon);
  const level = state.level;

  // Clear non-player entities
  let entities = [];

  // Build scope for evaluating spawn conditions
  const evalScope = { state: { level, turn: state.turn }, player: scope.player };
  const evalOpts = { rng, state: { ...state, map } };

  // Process spawn rules
  if (world.spawn_rules && world.spawn_tables) {
    for (const rule of world.spawn_rules) {
      // Check spawn rule condition
      if (rule.when) {
        const whenAst = parse(rule.when);
        if (!evaluate(whenAst, evalScope, evalOpts)) continue;
      }

      const table = world.spawn_tables[rule.category];
      if (!table) continue;

      // Filter table entries by level conditions
      const eligible = table.filter(entry => {
        if (!entry.when) return true;
        return !!evaluate(entry.when.ast, evalScope, evalOpts);
      });
      if (eligible.length === 0) continue;

      // Determine count
      let count = 1;
      if (rule.count != null) {
        if (typeof rule.count === 'number') {
          count = rule.count;
        } else {
          const ast = parse(String(rule.count));
          count = evaluate(ast, evalScope, evalOpts);
        }
      }
      count = Math.max(0, Math.floor(count));

      if (rule.mode === 'per_room') {
        // Spawn `count` entities in each room (skip first room = player spawn)
        for (let r = 1; r < map.rooms.length; r++) {
          const room = map.rooms[r];
          // Re-evaluate count per room (it may use random())
          let roomCount = count;
          if (typeof rule.count === 'string') {
            const ast = parse(rule.count);
            roomCount = Math.max(0, Math.floor(evaluate(ast, evalScope, evalOpts)));
          }
          for (let n = 0; n < roomCount; n++) {
            const entry = pickWeighted(rng, eligible);
            if (!entry) continue;
            const pos = randomFloorInRoom(rng, room, map, entities, state.player);
            if (!pos) continue;
            const ent = createSpawnedEntity(entry.id, pos.x, pos.y, state.definition);
            if (ent) entities.push(ent);
          }
        }
      } else {
        // per_level: spawn `count` entities in random rooms
        for (let n = 0; n < count; n++) {
          const entry = pickWeighted(rng, eligible);
          if (!entry) continue;
          // Pick a random non-spawn room
          const roomIdx = map.rooms.length > 1 ? randomInt(rng, 1, map.rooms.length - 1) : 0;
          const room = map.rooms[roomIdx];
          const pos = randomFloorInRoom(rng, room, map, entities, state.player);
          if (!pos) continue;
          const ent = createSpawnedEntity(entry.id, pos.x, pos.y, state.definition);
          if (ent) entities.push(ent);
        }
      }
    }
  }

  // Move player to spawn
  const player = { ...state.player, x: map.spawn.x, y: map.spawn.y };

  return { ...state, map, entities, player };
}

function pickWeighted(rng, entries) {
  const total = entries.reduce((s, e) => s + (e.weight || 1), 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= (entry.weight || 1);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function randomFloorInRoom(rng, room, map, entities, player) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = randomInt(rng, room.x, room.x + room.w - 1);
    const y = randomInt(rng, room.y, room.y + room.h - 1);
    if (map.tiles[y][x] !== '.') continue;
    if (x === player.x && y === player.y) continue;
    if (x === map.stair?.x && y === map.stair?.y) continue;
    if (entities.some(e => e.x === x && e.y === y)) continue;
    return { x, y };
  }
  return null;
}

function createSpawnedEntity(id, x, y, definition) {
  const beingDef = definition._index.beings[id];
  if (beingDef) {
    const measurements = Object.create(null);
    for (const m of definition.measurements) {
      measurements[m.id] = beingDef.measurements[m.id] ?? m.initial;
    }
    return {
      id: beingDef.id,
      kind: 'being',
      label: beingDef.label,
      glyph: beingDef.glyph,
      color: beingDef.color,
      tags: [...beingDef.tags],
      x, y,
      measurements,
      inventory: [],
      equipment: Object.create(null),
    };
  }
  const itemDef = definition._index.items[id];
  if (itemDef) {
    return {
      id: itemDef.id,
      kind: 'item',
      label: itemDef.label,
      glyph: itemDef.glyph,
      color: itemDef.color,
      tags: [...itemDef.tags],
      itemKind: itemDef.kind,
      properties: itemDef.properties ? { ...itemDef.properties } : {},
      x, y,
    };
  }
  return null;
}

// ── Effect registry ──────────────────────────────────────────────────────

const EFFECT_HANDLERS = {
  apply: handleApply,
  set: handleSet,
  move: handleMove,
  spawn: handleSpawn,
  remove: handleRemove,
  consume: handleConsume,
  equip: handleEquip,
  pickup: handlePickup,
  message: handleMessage,
  transition_level: handleTransitionLevel,
  win: handleWin,
  lose: handleLose,
  find_target: handleFindTarget,
  generate_level: handleGenerateLevel,
};

export const EFFECT_TYPES = new Set(Object.keys(EFFECT_HANDLERS));

/**
 * Create a shallow view of an entity with measurements flattened as top-level keys.
 */
function entityView(entity) {
  if (!entity || !entity.measurements) return entity;
  return { ...entity, ...entity.measurements };
}

/**
 * Refresh scope references after an effect has updated the state.
 * Uses stable indices (_actorIdx, _targetIdx) to find the current entity
 * objects in the updated state, and re-flattens measurements for expressions.
 */
function refreshScope(scope, state) {
  const actorIdx = scope._actorIdx ?? -1;
  const targetIdx = scope._targetIdx ?? -1;
  // -2 sentinel means entity was removed; fall back to player
  const actor = actorIdx >= 0 ? state.entities[actorIdx] : state.player;
  const target = targetIdx >= 0 ? state.entities[targetIdx] : state.player;
  if (!actor) return scope; // entity was removed; keep stale scope

  const actorView = entityView(actor);
  const targetView = target ? entityView(target) : actorView;
  const result = state._effectContext || scope.result || {};
  return {
    ...scope,
    self: actorView,
    actor: actorView,
    target: targetView,
    tile: { x: actor.x, y: actor.y },
    player: entityView(state.player),
    result,
    _rawActor: actor,
    _rawTarget: target || actor,
    _rawPlayer: state.player,
  };
}

/**
 * Execute a single effect, returning a new state.
 * If the effect has a `when` expression, it is evaluated first;
 * the effect is skipped if the condition is falsy.
 */
export function applyEffect(state, effect, scope) {
  // Evaluate conditional gate
  if (effect.when) {
    const condResult = evaluate(effect.when.ast, scope, { rng: scope._rng, state });
    if (!condResult) return state;
  }
  const handler = EFFECT_HANDLERS[effect.type];
  if (!handler) return state;
  return handler(state, effect, scope);
}

/**
 * Execute a list of effects in order, threading state through.
 * After each effect, refreshes scope references so subsequent effects
 * see updated entity state and measurements.
 */
export function applyEffects(state, effects, scope) {
  let current = state;
  let liveScope = scope;
  for (const effect of effects) {
    current = applyEffect(current, effect, liveScope);
    if (current.terminal) break;
    // Refresh scope: update raw references and re-flatten measurements
    liveScope = refreshScope(liveScope, current);
  }
  return current;
}
