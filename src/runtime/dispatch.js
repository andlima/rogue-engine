/**
 * Action dispatcher — processes player and AI actions each turn.
 *
 * Player actions are resolved by trigger key. AI actions use first-match
 * (list order) selection: for each monster, the first action whose condition
 * evaluates to truthy is selected.
 */

import { evaluate } from '../expressions/evaluator.js';
import { applyEffects } from './effects.js';
import { resolvePlayerAction, beginFlow, advanceFlow, cancelFlow, resolveTileKind } from './flow.js';

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

  let next = {
    ...state,
    turn: state.turn + 1,
    player: { ...state.player, x: nx, y: ny },
  };

  // Fire the destination tile's `on_enter` hook (if any).
  next = fireTileHook(next, 'on_enter', next.player);
  return next;
}

/**
 * Dispatch a tile interaction hook for a being standing on a tile.
 * Each hook is a list of standard effects; they run in the actor's scope.
 */
function fireTileHook(state, hookName, actor) {
  const tilesCfg = state.definition.tiles;
  if (!tilesCfg) return state;
  const map = state.map || state.definition.map;
  if (!map) return state;
  const ch = map.tiles[actor.y]?.[actor.x];
  const cfg = tilesCfg[ch];
  if (!cfg || !cfg[hookName] || cfg[hookName].length === 0) return state;

  const scope = buildScope(state, actor, null);
  scope._bindings = state.flowState?.bindings || {};
  return applyEffects(state, cfg[hookName], scope);
}

/**
 * Handle the built-in `interact` player action.
 *
 * Desugars to: run the current tile's `on_interact` effects if present,
 * else push a message indicating nothing happens. Never consumes a turn
 * if there's no hook.
 */
function handleInteract(state) {
  const tilesCfg = state.definition.tiles;
  const map = state.map || state.definition.map;
  if (!map) return null;
  const { x, y } = state.player;
  const ch = map.tiles[y]?.[x];
  const cfg = tilesCfg?.[ch];
  if (!cfg || !cfg.on_interact || cfg.on_interact.length === 0) {
    // Not a turn-consumer: push a message but don't advance the turn.
    return {
      ...state,
      messages: [...(state.messages || []), 'Nothing to interact with here.'],
      _noTurn: true,
    };
  }
  const scope = buildScope(state, state.player, null);
  scope._bindings = state.flowState?.bindings || {};
  return applyEffects(state, cfg.on_interact, scope);
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
  // Expose the current tile (with `kind` resolution) as `actor.tile` so
  // context-sensitive `when` expressions like `actor.tile.kind == "stairs_down"`
  // resolve.
  const map = state.map || state.definition.map;
  if (map && actorView) {
    const ch = map.tiles[actor.y]?.[actor.x];
    actorView.tile = {
      x: actor.x, y: actor.y,
      ch,
      kind: resolveTileKind(state, ch),
    };
  }
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
 *
 * If the action has a non-empty `flow`, this initializes the flow state
 * instead of firing effects. Flow steps are advanced via `flow_input`
 * dispatches.
 */
function handlePlayerAction(state, trigger, inputData) {
  // `when`-aware resolution honors multiple actions bound to the same trigger.
  const resolved = resolvePlayerAction(state, trigger);
  if (!resolved) return null;
  const { action: actionDef } = resolved;

  // Flow-bearing actions enter flow state and wait for player input.
  if (actionDef.flow && actionDef.flow.length > 0) {
    // Check `requires` up front; a false precondition aborts before flow.
    // Populate $origin so pre-flow requires can reference it (validation
    // accepts $origin as an implicit binding in any flow-enabled scope).
    const origin = { x: state.player.x, y: state.player.y };
    const scope = buildScope(state, state.player, null);
    if (inputData) scope.input = inputData;
    scope._bindings = { origin };
    scope.origin = origin;
    if (actionDef.requires && actionDef.requires.length > 0) {
      for (const req of actionDef.requires) {
        const result = evaluate(req.ast, scope, { rng: state.rng, state });
        if (!result) return null;
      }
    }
    return beginFlow(state, actionDef);
  }

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

  // Flow cancellation: never consumes a turn, never runs effects.
  if (action.type === 'flow_cancel') {
    return cancelFlow(state);
  }

  // While a flow is active, only flow inputs / cancels advance it.
  // Any other dispatch is ignored to keep the flow state machine clean.
  // `toggle_display` is allowed through because it is a pure UI toggle —
  // analogous to open_help, which remains active during flows.
  if (state.flowState
    && action.type !== 'flow_input'
    && action.type !== 'open_panel'
    && action.type !== 'toggle_display') {
    return state;
  }

  // Flow input: advance the current flow. On commit (last step) effects
  // run and the full turn cycle (AI, conditions, turn increment) runs.
  if (action.type === 'flow_input') {
    if (!state.flowState) return state;
    const advanced = advanceFlow(state, action, { applyEffects });
    // If still mid-flow, no turn passes.
    if (advanced.flowState) return advanced;
    // If flow was cancelled (no commit), also no turn.
    if (!advanced._committedFlow) return advanced;
    newState = { ...advanced, _committedFlow: false };
  }
  // Opening a UI panel is free — not a turn-consuming action.
  else if (action.type === 'open_panel') {
    return state; // UI bookkeeping handled externally
  }
  // Interact: desugars to dispatching the tile's `on_interact` hook.
  else if (action.type === 'interact') {
    newState = handleInteract(state);
    if (!newState) return state;
  }
  // Toggle display mode: non-turn-advancing, does not run AI. Analogous to
  // open_help, but mutates state (state.displayMode) so it must go through
  // dispatch rather than being a CLI-local flag.
  else if (action.type === 'toggle_display') {
    const nextMode = state.displayMode === 'emoji' ? 'ascii' : 'emoji';
    return { ...state, displayMode: nextMode };
  }
  // Try DSL-defined player actions first
  else if (action.type === 'action') {
    newState = handlePlayerAction(state, action.trigger);
    if (!newState) return state; // Action not found or precondition failed
    // Starting a flow is free — don't run AI or advance the turn.
    if (newState.flowState && !state.flowState) return newState;
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

  // `_noTurn` short-circuit: the action intentionally does not consume a
  // turn (e.g. interact on a tile without a hook, or picking up a menu).
  if (newState._noTurn) {
    const { _noTurn, ...rest } = newState;
    return rest;
  }

  // Fire on_stand hook for the player's current tile (once per turn).
  if (!newState.terminal) {
    newState = fireTileHook(newState, 'on_stand', newState.player);
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
