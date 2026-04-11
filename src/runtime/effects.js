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
  // Pick the raw entity reference based on the target keyword
  let rawEntity;
  if (targetRef === 'player') {
    rawEntity = scope._rawPlayer || state.player;
  } else if (targetRef === 'self' || targetRef === 'actor') {
    rawEntity = scope._rawActor || state.player;
  } else if (targetRef === 'target') {
    rawEntity = scope._rawTarget || scope._rawActor || state.player;
  } else {
    rawEntity = state.player;
  }

  // Is it the player?
  if (rawEntity === state.player) {
    return {
      entity: state.player,
      update: (newEntity) => ({ ...state, player: newEntity }),
    };
  }

  // It's an NPC entity — find by reference in entities list
  const idx = state.entities.indexOf(rawEntity);
  if (idx >= 0) {
    return {
      entity: rawEntity,
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
  const item = scope.target || scope.item;
  if (!item || !entity.equipment) return state;

  const slot = effect.slot || item.itemKind || 'default';
  const newEntity = {
    ...entity,
    equipment: { ...entity.equipment, [slot]: item },
    inventory: (entity.inventory || []).filter(i => i !== item),
  };
  return update(newEntity);
}

function handlePickup(state, effect, scope) {
  const actorRef = effect.target || 'actor';
  const { entity, update } = resolveTarget(state, actorRef, scope);
  const rawItem = scope._rawTarget;
  if (!rawItem || rawItem.kind !== 'item') return state;

  const newEntity = {
    ...entity,
    inventory: [...(entity.inventory || []), rawItem],
  };
  // Remove item from world entities
  const stateWithoutItem = { ...state, entities: state.entities.filter(e => e !== rawItem) };
  // Update the entity that picked up
  if (entity === state.player) {
    return { ...stateWithoutItem, player: newEntity };
  }
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
 * Execute a single effect, returning a new state.
 */
export function applyEffect(state, effect, scope) {
  const handler = EFFECT_HANDLERS[effect.type];
  if (!handler) return state;
  return handler(state, effect, scope);
}

/**
 * Execute a list of effects in order, threading state through.
 */
export function applyEffects(state, effects, scope) {
  let current = state;
  for (const effect of effects) {
    current = applyEffect(current, effect, scope);
    if (current.terminal) break;
  }
  return current;
}
