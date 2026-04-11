/**
 * Effect handlers — each takes (state, effect, scope) and returns a new state.
 * Effects are the extensibility boundary: new mechanics = new effect types in JS.
 *
 * All handlers are pure — they return a new state without mutating the input.
 */

import { parse } from '../expressions/parser.js';
import { evaluate } from '../expressions/evaluator.js';

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
  return { ...newState, _effectContext: { delta: Math.abs(delta), value: newVal } };
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
  const { map } = state.definition;
  if (!map) return state;

  if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) return state;
  if (map.tiles[ny][nx] === '#') return state;

  return update({ ...entity, x: nx, y: ny });
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
  return { ...state, entities: state.entities.filter(e => e !== entity) };
}

function handleEquip(state, effect, scope) {
  const { entity, update } = resolveTarget(state, effect.target || 'actor', scope);
  if (!entity.equipment) return state;

  // Resolve the item to equip:
  // 1. Explicit item id from effect definition
  // 2. Scope target if it's an item
  // 3. First item in actor's inventory
  let rawItem;
  if (effect.item) {
    rawItem = (entity.inventory || []).find(i => i.id === effect.item);
  }
  if (!rawItem && scope._rawTarget && scope._rawTarget.kind === 'item') {
    rawItem = scope._rawTarget;
  }
  if (!rawItem) {
    rawItem = (entity.inventory || []).find(i => i.kind === 'item');
  }
  if (!rawItem || rawItem.kind !== 'item') return state;

  const slot = effect.slot || rawItem.itemKind || 'default';
  const newEntity = {
    ...entity,
    equipment: { ...entity.equipment, [slot]: rawItem },
    inventory: (entity.inventory || []).filter(i => i !== rawItem),
  };
  return update(newEntity);
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
  // Remove item from world entities, then update the actor via stable index
  const stateWithoutItem = { ...state, entities: state.entities.filter(e => e !== rawItem) };
  // Re-resolve using the updated entities list since filter may shift indices
  const actorIdx = scope._actorIdx ?? -1;
  if (actorIdx < 0) {
    return { ...stateWithoutItem, player: newEntity };
  }
  return {
    ...stateWithoutItem,
    entities: stateWithoutItem.entities.map((e, i) => i === actorIdx ? newEntity : e),
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

// ── Effect registry ──────────────────────────────────────────────────────

const EFFECT_HANDLERS = {
  apply: handleApply,
  set: handleSet,
  move: handleMove,
  spawn: handleSpawn,
  remove: handleRemove,
  equip: handleEquip,
  pickup: handlePickup,
  message: handleMessage,
  transition_level: handleTransitionLevel,
  win: handleWin,
  lose: handleLose,
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
  const actor = actorIdx >= 0 ? state.entities[actorIdx] : state.player;
  const target = targetIdx >= 0 ? state.entities[targetIdx] : state.player;
  if (!actor) return scope; // entity was removed; keep stale scope

  const actorView = entityView(actor);
  const targetView = target ? entityView(target) : actorView;
  return {
    ...scope,
    self: actorView,
    actor: actorView,
    target: targetView,
    tile: { x: actor.x, y: actor.y },
    player: entityView(state.player),
    _rawActor: actor,
    _rawTarget: target || actor,
    _rawPlayer: state.player,
  };
}

/**
 * Execute a single effect, returning a new state.
 */
export function applyEffect(state, effect, scope) {
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
