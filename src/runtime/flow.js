/**
 * Flow runner — small state machine for multi-step player interactions.
 *
 * A flow is a declarative list of step descriptors attached to a player
 * action. Each step asks the player for one piece of input (item, direction,
 * tile, option, confirmation) and binds it to a name. When the final step
 * resolves, the action's `requires` is re-checked and its effects fire.
 *
 * FlowState shape on GameState:
 *   {
 *     actionId: string,
 *     stepIndex: number,
 *     bindings: { [name]: value },
 *     origin: { x, y },    // actor tile at flow start — used by range/LOS
 *   }
 *
 * Cancellation: clears flowState without running effects or consuming a turn.
 */

import { parse } from '../expressions/parser.js';
import { evaluate } from '../expressions/evaluator.js';

// ── Predicate helpers ────────────────────────────────────────────────────

/**
 * Evaluate a predicate expression with an `item` (or `tile` / `being`)
 * binding in scope. Returns boolean.
 */
function evalPredicate(predAst, scope, state, extraBindings = {}) {
  const predScope = { ...scope, ...extraBindings };
  try {
    return !!evaluate(predAst, predScope, { rng: state.rng, state });
  } catch {
    return false;
  }
}

// ── Step type registry ───────────────────────────────────────────────────

/**
 * Each step handler has two entry points:
 *   validate(stepDef, ctx) — load-time validation, returns normalized step
 *   accept(stepDef, input, state, scope) — runtime input handler,
 *      returns { ok: true, bindings: {...} } on accept,
 *      or { ok: false, reason } on reject (bad input; don't cancel flow).
 *
 * The flow runner itself handles cancellation (ESC) uniformly.
 */
const STEP_HANDLERS = {
  pick_direction: {
    accept(stepDef, input, _state, _scope) {
      const set = stepDef.set || 'cardinal';
      const dir = input?.dir;
      if (!dir) return { ok: false, reason: 'missing dir' };
      const CARDINAL = ['n', 's', 'e', 'w'];
      const OCTAL = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
      const valid = set === 'octal' ? OCTAL : CARDINAL;
      if (!valid.includes(dir)) return { ok: false, reason: `invalid direction '${dir}'` };
      return { ok: true, bindings: { [stepDef.bind || 'dir']: dir } };
    },
  },

  pick_item: {
    accept(stepDef, input, state, scope) {
      const item = input?.item;
      if (!item) return { ok: false, reason: 'missing item' };
      // Verify item passes filter
      if (stepDef.filterAst) {
        if (!evalPredicate(stepDef.filterAst, scope, state, { item })) {
          return { ok: false, reason: 'item does not match filter' };
        }
      }
      return { ok: true, bindings: { [stepDef.bind || 'chosen_item']: item } };
    },
    candidates(stepDef, state, scope) {
      const source = stepDef.source || 'actor.inventory';
      let list;
      if (source === 'actor.inventory') list = scope._rawActor?.inventory || [];
      else if (source === 'player.inventory') list = state.player?.inventory || [];
      else list = [];
      if (!stepDef.filterAst) return list;
      return list.filter(it => evalPredicate(stepDef.filterAst, scope, state, { item: it }));
    },
  },

  pick_tile: {
    accept(stepDef, input, state, scope) {
      const tile = input?.tile;
      if (!tile || typeof tile.x !== 'number' || typeof tile.y !== 'number') {
        return { ok: false, reason: 'missing tile' };
      }
      // Range check
      if (stepDef.range != null) {
        const r = stepDef.range;
        const origin = scope._flowOrigin || { x: scope._rawActor?.x, y: scope._rawActor?.y };
        const dx = Math.abs(tile.x - origin.x);
        const dy = Math.abs(tile.y - origin.y);
        if (Math.max(dx, dy) > r) return { ok: false, reason: 'out of range' };
      }
      // Map bounds check
      const map = state.map || state.definition.map;
      if (map) {
        if (tile.x < 0 || tile.x >= map.width || tile.y < 0 || tile.y >= map.height) {
          return { ok: false, reason: 'out of map' };
        }
      }
      // Predicate check
      if (stepDef.filterAst) {
        const tileView = buildTileView(state, tile);
        if (!evalPredicate(stepDef.filterAst, scope, state, { tile: tileView })) {
          return { ok: false, reason: 'tile does not match predicate' };
        }
      }
      return { ok: true, bindings: { [stepDef.bind || 'target_tile']: { x: tile.x, y: tile.y } } };
    },
  },

  pick_being: {
    accept(stepDef, input, state, scope) {
      const tile = input?.tile;
      if (!tile) return { ok: false, reason: 'missing tile' };
      // Find a being at the tile
      const being = findBeingAt(state, tile.x, tile.y);
      if (!being) return { ok: false, reason: 'no being at tile' };
      // Range check
      if (stepDef.range != null) {
        const r = stepDef.range;
        const origin = scope._flowOrigin || { x: scope._rawActor?.x, y: scope._rawActor?.y };
        const dx = Math.abs(tile.x - origin.x);
        const dy = Math.abs(tile.y - origin.y);
        if (Math.max(dx, dy) > r) return { ok: false, reason: 'out of range' };
      }
      if (stepDef.filterAst) {
        const beingView = { ...being, ...being.measurements };
        const tileView = buildTileView(state, { x: being.x, y: being.y });
        if (!evalPredicate(stepDef.filterAst, scope, state, { being: beingView, tile: tileView })) {
          return { ok: false, reason: 'being does not match predicate' };
        }
      }
      return { ok: true, bindings: { [stepDef.bind || 'target_being']: being } };
    },
  },

  pick_option: {
    accept(stepDef, input, state, scope) {
      const id = input?.option_id;
      if (!id) return { ok: false, reason: 'missing option_id' };
      const opt = (stepDef.options || []).find(o => o.id === id);
      if (!opt) return { ok: false, reason: `unknown option '${id}'` };
      if (opt.requiresAst) {
        if (!evalPredicate(opt.requiresAst, scope, state)) {
          return { ok: false, reason: `option '${id}' requirements not met` };
        }
      }
      return { ok: true, bindings: { [stepDef.bind || 'chosen_option']: opt.payload ?? opt } };
    },
    candidates(stepDef, state, scope) {
      return (stepDef.options || []).filter(o =>
        !o.requiresAst || evalPredicate(o.requiresAst, scope, state)
      );
    },
  },

  confirm: {
    accept(_stepDef, input, _state, _scope) {
      // input.confirm === true means accept; false means cancel
      if (input?.confirm === true) return { ok: true, bindings: {} };
      return { ok: 'cancel', reason: 'user declined' };
    },
  },
};

export const STEP_TYPES = new Set(Object.keys(STEP_HANDLERS));

// ── Helpers ──────────────────────────────────────────────────────────────

function buildTileView(state, tile) {
  const map = state.map || state.definition.map;
  let ch = '.';
  let kind = 'floor';
  if (map && tile.x >= 0 && tile.x < map.width && tile.y >= 0 && tile.y < map.height) {
    ch = map.tiles[tile.y][tile.x];
    kind = resolveTileKind(state, ch);
  }
  return {
    x: tile.x, y: tile.y,
    ch, kind,
    has_being: !!findBeingAt(state, tile.x, tile.y),
  };
}

export function resolveTileKind(state, ch) {
  const tilesCfg = state.definition.tiles;
  if (tilesCfg && tilesCfg[ch] && tilesCfg[ch].kind) return tilesCfg[ch].kind;
  if (ch === '#') return 'wall';
  if (ch === '>') return 'stairs_down';
  if (ch === '<') return 'stairs_up';
  if (ch === '.') return 'floor';
  return ch;
}

function findBeingAt(state, x, y) {
  if (state.player && state.player.x === x && state.player.y === y) return state.player;
  return (state.entities || []).find(e => e.kind === 'being' && e.x === x && e.y === y);
}

// ── Flow initialization and advancement ─────────────────────────────────

/**
 * Find the matching player action for a trigger key, honoring `when`
 * expressions and first-match selection. Returns { action, scope } or null.
 */
export function resolvePlayerAction(state, trigger) {
  const { playerActionsByTrigger, playerActionByTrigger } = state.definition._index;
  const candidates = playerActionsByTrigger?.[trigger] || (playerActionByTrigger?.[trigger] ? [playerActionByTrigger[trigger]] : []);
  if (!candidates || candidates.length === 0) return null;
  // Build scope once for predicate evaluation
  const scope = buildPlayerScope(state);
  for (const action of candidates) {
    if (action.when) {
      const result = evaluate(action.when.ast, scope, { rng: state.rng, state });
      if (!result) continue;
    }
    return { action, scope };
  }
  return null;
}

/**
 * Build a scope for player-initiated work: actor = player.
 */
function buildPlayerScope(state) {
  const actor = state.player;
  const tileView = buildTileView(state, { x: actor.x, y: actor.y });
  const actorView = { ...actor, ...(actor?.measurements || {}), tile: tileView };
  const origin = state.flowState?.origin ?? { x: actor.x, y: actor.y };
  // Carry flow bindings if active and merge implicit bindings
  const userBindings = state.flowState?.bindings || {};
  const bindings = {
    ...userBindings,
    origin,
    actor: actorView,
    self: actorView,
    player: actorView,
  };
  return {
    self: actorView,
    actor: actorView,
    target: actorView,
    tile: tileView,
    state: { level: state.level, turn: state.turn },
    player: actorView,
    _rng: state.rng,
    _actorIdx: -1,
    _targetIdx: -1,
    _rawActor: actor,
    _rawTarget: actor,
    _rawPlayer: actor,
    _bindings: bindings,
    _flowOrigin: origin,
  };
}

/**
 * Begin a flow for an action whose `flow` is a non-empty list.
 * Returns new state with `flowState` set to step 0.
 */
export function beginFlow(state, action) {
  const flowState = {
    actionId: action.id,
    stepIndex: 0,
    bindings: Object.create(null),
    origin: { x: state.player.x, y: state.player.y },
  };
  return { ...state, flowState };
}

/**
 * Handle a flow_input dispatch. Returns a new state.
 *
 * Input shapes (canonical):
 *   { type: 'flow_input', kind: 'pick_direction', dir: 'n' }
 *   { type: 'flow_input', kind: 'pick_item', item: <item ref> }
 *   { type: 'flow_input', kind: 'pick_tile', tile: { x, y } }
 *   { type: 'flow_input', kind: 'pick_being', tile: { x, y } }
 *   { type: 'flow_input', kind: 'pick_option', option_id: 'fireball' }
 *   { type: 'flow_input', kind: 'confirm', confirm: true|false }
 *   { type: 'flow_cancel' }
 *
 * If the input does not match the current step's kind, the input is
 * rejected and state is unchanged.
 */
export function advanceFlow(state, input, ctx) {
  const flow = state.flowState;
  if (!flow) return state;
  const action = state.definition._index.playerActions[flow.actionId];
  if (!action || !action.flow) {
    return { ...state, flowState: null };
  }
  const step = action.flow[flow.stepIndex];
  if (!step) return state;

  if (input.kind && input.kind !== step.type) {
    return state; // Input doesn't match expected step
  }

  const scope = buildPlayerScope(state);
  const handler = STEP_HANDLERS[step.type];
  if (!handler) return state;

  const result = handler.accept(step, input, state, scope);
  if (result.ok === 'cancel') return cancelFlow(state);
  if (!result.ok) return state; // Input rejected; remain at the same step

  // Merge new bindings
  const newBindings = { ...flow.bindings, ...result.bindings };
  const nextIndex = flow.stepIndex + 1;

  if (nextIndex >= action.flow.length) {
    // Final step resolved — re-check `requires`, then fire effects.
    return commitFlow(state, action, newBindings, ctx);
  }

  return {
    ...state,
    flowState: { ...flow, stepIndex: nextIndex, bindings: newBindings },
  };
}

export function cancelFlow(state) {
  if (!state.flowState) return state;
  return { ...state, flowState: null };
}

/**
 * Commit a flow: re-evaluate `requires`, then run effects with flow bindings
 * in scope. Turn bookkeeping is left to the caller.
 */
function commitFlow(state, action, bindings, ctx) {
  // buildPlayerScope merges user bindings with implicit ones (origin, actor,
  // self, player). Pass the updated bindings via a synthetic flowState so the
  // merged _bindings is correct; do NOT overwrite it afterward.
  const scope = buildPlayerScope({ ...state, flowState: { ...state.flowState, bindings } });

  // Re-check `requires`
  if (action.requires && action.requires.length > 0) {
    for (const req of action.requires) {
      const ok = evaluate(req.ast, scope, { rng: state.rng, state });
      if (!ok) {
        // Commit blocked — cancel flow, leave state otherwise unchanged
        return { ...state, flowState: null };
      }
    }
  }

  // Run effects via caller-supplied `applyEffects` (passed in to avoid circular import)
  const applyEffectsFn = ctx && ctx.applyEffects;
  if (!applyEffectsFn) return { ...state, flowState: null };

  let next = applyEffectsFn(state, action.effects || [], scope);
  next = { ...next, flowState: null, _committedFlow: true };
  return next;
}

// ── Load-time validation ─────────────────────────────────────────────────

/**
 * Validate a flow step descriptor from YAML.
 *
 * @param {object} raw — raw step object from YAML
 * @param {string} pathPrefix — for error messages
 * @param {object} context — { measurementIds, beingIds, itemIds, validateExpression, promptIds, knownBindings, actionBindings }
 * @returns {object} normalized step
 */
export function validateStep(raw, pathPrefix, context) {
  if (!raw || typeof raw !== 'object') {
    throw new context.SchemaError(pathPrefix, 'flow step must be an object');
  }
  const type = raw.type;
  if (typeof type !== 'string') {
    throw new context.SchemaError(`${pathPrefix}.type`, 'required string field missing');
  }
  if (!STEP_TYPES.has(type)) {
    throw new context.SchemaError(
      `${pathPrefix}.type`,
      `unknown flow step type '${type}' (known: ${[...STEP_TYPES].join(', ')})`
    );
  }

  // Prompt reference
  if (raw.prompt != null) {
    if (typeof raw.prompt !== 'string') {
      throw new context.SchemaError(`${pathPrefix}.prompt`, 'prompt must be a string id');
    }
    if (context.promptIds && !context.promptIds.has(raw.prompt)) {
      throw new context.SchemaError(
        `${pathPrefix}.prompt`,
        `unknown prompt id '${raw.prompt}' (known: ${[...context.promptIds].join(', ')})`
      );
    }
  }

  const step = { type };
  if (raw.prompt) step.prompt = raw.prompt;
  if (raw.message) step.message = String(raw.message);
  if (raw.bind != null) {
    if (typeof raw.bind !== 'string') {
      throw new context.SchemaError(`${pathPrefix}.bind`, 'bind must be a string');
    }
    step.bind = raw.bind;
  }

  // Type-specific validation
  if (type === 'pick_direction') {
    const set = raw.set || 'cardinal';
    if (set !== 'cardinal' && set !== 'octal') {
      throw new context.SchemaError(`${pathPrefix}.set`, `must be 'cardinal' or 'octal'`);
    }
    step.set = set;
    step.bind = step.bind || 'dir';
  } else if (type === 'pick_item') {
    step.source = raw.source || 'actor.inventory';
    if (typeof step.source !== 'string') {
      throw new context.SchemaError(`${pathPrefix}.source`, 'source must be a string');
    }
    if (raw.filter != null) {
      const ast = context.validateExpression(raw.filter, `${pathPrefix}.filter`);
      step.filter = raw.filter;
      step.filterAst = ast;
    }
    step.bind = step.bind || 'chosen_item';
  } else if (type === 'pick_tile') {
    if (raw.range != null) {
      if (typeof raw.range !== 'number' || !Number.isInteger(raw.range) || raw.range <= 0) {
        throw new context.SchemaError(
          `${pathPrefix}.range`,
          `range must be a positive integer (got ${JSON.stringify(raw.range)})`
        );
      }
      step.range = raw.range;
    }
    if (raw.filter != null) {
      const ast = context.validateExpression(raw.filter, `${pathPrefix}.filter`);
      step.filter = raw.filter;
      step.filterAst = ast;
    }
    step.bind = step.bind || 'target_tile';
  } else if (type === 'pick_being') {
    if (raw.range != null) {
      if (typeof raw.range !== 'number' || !Number.isInteger(raw.range) || raw.range <= 0) {
        throw new context.SchemaError(
          `${pathPrefix}.range`,
          `range must be a positive integer (got ${JSON.stringify(raw.range)})`
        );
      }
      step.range = raw.range;
    }
    if (raw.filter != null) {
      const ast = context.validateExpression(raw.filter, `${pathPrefix}.filter`);
      step.filter = raw.filter;
      step.filterAst = ast;
    }
    step.bind = step.bind || 'target_being';
  } else if (type === 'pick_option') {
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      throw new context.SchemaError(
        `${pathPrefix}.options`,
        'pick_option requires a non-empty options array'
      );
    }
    step.options = raw.options.map((opt, i) => {
      const optPath = `${pathPrefix}.options[${i}]`;
      if (!opt || typeof opt !== 'object') {
        throw new context.SchemaError(optPath, 'option must be an object');
      }
      if (typeof opt.id !== 'string') {
        throw new context.SchemaError(`${optPath}.id`, 'required string id');
      }
      const norm = {
        id: opt.id,
        label: typeof opt.label === 'string' ? opt.label : opt.id,
      };
      if (opt.requires != null) {
        norm.requiresAst = context.validateExpression(opt.requires, `${optPath}.requires`);
        norm.requires = opt.requires;
      }
      if (opt.payload != null) norm.payload = opt.payload;
      return norm;
    });
    step.bind = step.bind || 'chosen_option';
  } else if (type === 'confirm') {
    step.message = typeof raw.message === 'string' ? raw.message : 'Confirm?';
    // no bind
    step.bind = null;
  }

  return step;
}

/**
 * Compute the set of binding names a flow produces.
 */
export function collectFlowBindings(flow) {
  const set = new Set();
  if (!flow) return set;
  for (const step of flow) {
    if (step.bind) set.add(step.bind);
  }
  return set;
}
