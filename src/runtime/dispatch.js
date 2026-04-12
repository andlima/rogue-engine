/**
 * Action dispatcher — processes player and AI actions each turn.
 *
 * Player actions are resolved by trigger key. AI actions use first-match
 * (list order) selection: for each monster, the first action whose condition
 * evaluates to truthy is selected.
 */

import { evaluate } from '../expressions/evaluator.js';
import { applyEffects } from './effects.js';

const DIRECTIONS = {
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
};

function handleMove(state, action) {
  const delta = DIRECTIONS[action.dir];
  if (!delta) return state;

  const nx = state.player.x + delta.dx;
  const ny = state.player.y + delta.dy;
  const map = state.map || state.definition.map;

  if (!map) return state;
  if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) return state;
  if (map.tiles[ny][nx] === '#') return state;

  return {
    ...state,
    turn: state.turn + 1,
    player: { ...state.player, x: nx, y: ny },
  };
}

/**
 * Create a scope-friendly view of an entity that exposes measurements
 * as direct properties (e.g. `actor.hp` instead of `actor.measurements.hp`).
 * Also computes equipment bonus aggregates (equip_attack, equip_defense).
 */
function entityView(entity) {
  if (!entity) return entity;
  const view = entity.measurements
    ? { ...entity, ...entity.measurements }
    : { ...entity };
  // Compute equipment bonuses
  if (entity.equipment) {
    let equip_attack = 0;
    let equip_defense = 0;
    for (const item of Object.values(entity.equipment)) {
      if (item && item.properties) {
        if (item.properties.stat === 'attack') equip_attack += item.properties.bonus || 0;
        if (item.properties.stat === 'defense') equip_defense += item.properties.bonus || 0;
      }
    }
    view.equip_attack = equip_attack;
    view.equip_defense = equip_defense;
  }
  return view;
}

/**
 * Build the scope object used by expression evaluation and effect handlers.
 *
 * Expression evaluation uses the top-level keys (actor, target, etc.) which
 * are entity views with measurements flattened. Effect handlers use _raw
 * entries to find the actual entity references in state for immutable updates.
 */
function buildScope(state, actor, target) {
  const actorView = entityView(actor);
  const targetView = target ? entityView(target) : actorView;
  // Compute stable indices: -1 means player, >= 0 means index in state.entities
  const actorIdx = actor === state.player ? -1 : state.entities.indexOf(actor);
  const targetIdx = target
    ? (target === state.player ? -1 : state.entities.indexOf(target))
    : actorIdx;
  return {
    self: actorView,
    actor: actorView,
    target: targetView,
    tile: { x: actor.x, y: actor.y },
    state: {
      level: state.level,
      turn: state.turn,
    },
    player: entityView(state.player),
    _rng: state.rng,
    // Stable indices for effect target resolution (survives immutable updates)
    _actorIdx: actorIdx,
    _targetIdx: targetIdx,
    // Raw references for backward compat
    _rawActor: actor,
    _rawTarget: target || actor,
    _rawPlayer: state.player,
  };
}

/**
 * Execute a defined player action by trigger.
 * If inputData is provided (e.g. direction for move), it is added to scope
 * as scope.input with { dir, dx, dy }.
 */
function handlePlayerAction(state, trigger, inputData) {
  const actionDef = state.definition._index.playerActionByTrigger[trigger];
  if (!actionDef) return null;

  const scope = buildScope(state, state.player, null);

  // Inject input data for directional actions
  if (inputData) {
    scope.input = inputData;
  }

  // Check preconditions
  if (actionDef.requires && actionDef.requires.length > 0) {
    for (const req of actionDef.requires) {
      const result = evaluate(req.ast, scope, { rng: state.rng, state });
      if (!result) return null; // Precondition failed
    }
  }

  // Apply effects
  let newState = applyEffects(state, actionDef.effects, scope);
  return newState;
}

/**
 * Run AI actions for all monster entities.
 * Uses first-match: for each entity, pick the first action whose condition is true.
 */
function runAiActions(state) {
  const aiActions = state.definition.actions?.ai;
  if (!aiActions || aiActions.length === 0) return state;

  let current = state;
  // Snapshot entity references upfront so removals during iteration don't
  // cause index drift (skipped or out-of-bounds entities).
  const snapshot = state.entities.filter(e => e.kind === 'being');
  for (const originalEntity of snapshot) {
    if (current.terminal) break;
    // Re-find the entity by id+position in the current array, since prior
    // effects may have replaced it with a new object (immutable updates).
    const entity = current.entities.find(e => e === originalEntity)
      || current.entities.find(e => e.id === originalEntity.id && e.kind === 'being'
          && e.x === originalEntity.x && e.y === originalEntity.y);
    if (!entity) continue; // entity was removed by a prior action

    const scope = buildScope(current, entity, current.player);

    // First-match selection
    for (const actionDef of aiActions) {
      let matches = true;
      if (actionDef.condition) {
        matches = !!evaluate(actionDef.condition.ast, scope, { rng: current.rng, state: current });
      }
      if (matches) {
        current = applyEffects(current, actionDef.effects, scope);
        break;
      }
    }
  }

  return current;
}

/**
 * Check win/loss conditions.
 */
function checkConditions(state) {
  const world = state.definition.world;
  if (!world) return state;

  const scope = buildScope(state, state.player, null);

  // Check loss conditions first
  if (world.loss_conditions) {
    for (const cond of world.loss_conditions) {
      if (evaluate(cond.ast, scope, { rng: state.rng, state })) {
        return { ...state, terminal: 'lose', terminalReason: cond.source };
      }
    }
  }

  // Check win conditions
  if (world.win_conditions) {
    for (const cond of world.win_conditions) {
      if (evaluate(cond.ast, scope, { rng: state.rng, state })) {
        return { ...state, terminal: 'win', terminalReason: cond.source };
      }
    }
  }

  return state;
}

/**
 * Dispatch an action against the current state, returning a new state.
 * The previous state is never mutated.
 *
 * Full turn cycle:
 * 1. Resolve player action
 * 2. Run AI actions for all monsters
 * 3. Check win/loss conditions
 * 4. Increment turn
 */
export function dispatch(state, action) {
  if (state.terminal) return state;

  let newState;

  // Try DSL-defined player actions first
  if (action.type === 'action') {
    newState = handlePlayerAction(state, action.trigger);
    if (!newState) return state; // Action not found or precondition failed
  } else if (action.type === 'move') {
    const dirDeltas = { n: { dx: 0, dy: -1 }, s: { dx: 0, dy: 1 }, e: { dx: 1, dy: 0 }, w: { dx: -1, dy: 0 } };
    const inputData = {
      dir: action.dir,
      ...(dirDeltas[action.dir] || { dx: 0, dy: 0 }),
    };
    // Try generic 'move' trigger with direction injected into scope
    const genericResult = handlePlayerAction(state, 'move', inputData);
    if (genericResult) {
      newState = genericResult;
    }
    // Try direction-specific triggers (move_n, etc.)
    if (!newState) {
      const dirMap = { n: 'move_n', s: 'move_s', e: 'move_e', w: 'move_w' };
      const trigger = dirMap[action.dir];
      if (trigger) {
        const dslResult = handlePlayerAction(state, trigger, inputData);
        if (dslResult) {
          newState = dslResult;
        }
      }
    }
    // Fall back to built-in move handler
    if (!newState) {
      newState = handleMove(state, action);
      if (newState === state) return state; // No-op
    }
  } else {
    return state;
  }

  // Run AI actions
  if (!newState.terminal) {
    newState = runAiActions(newState);
  }

  // Check win/loss conditions
  if (!newState.terminal) {
    newState = checkConditions(newState);
  }

  // Increment turn
  if (newState !== state) {
    newState = { ...newState, turn: (newState.turn === state.turn) ? state.turn + 1 : newState.turn };
  }

  return newState;
}

export { buildScope };
