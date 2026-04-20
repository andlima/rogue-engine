/**
 * Pure binding resolver.
 *
 * `resolve(state, event)` maps a physical input event to zero or more
 * actions by walking the game definition's `input.bindings` list.
 *
 * The resolver is a pure function of `(state, event)` — it does not read
 * wall-clock time, the filesystem, or DOM events. Sequence timeouts are
 * injected by the caller via `event: { type: 'timeout' }` or by advancing
 * `state.inputState.deadlineMs` explicitly in tests.
 *
 * Return shape:
 *   {
 *     actions: Array<{ actionId, binding }>,  // may be empty
 *     inputState: { buffer?: string[] },       // carry into next call
 *   }
 *
 * Context precedence (top of stack first, falling through to map):
 *
 *   custom contexts (in declaration order, if active)
 *   → targeting (flow step is pick_tile / pick_being)
 *   → flow  (state.flowState != null)
 *   → panel (state.panelId truthy, and not in a flow)
 *   → map   (always the floor)
 *
 * Within each context, bindings are walked in declaration order and the
 * first match whose `when` is truthy (or absent) wins.
 */

import { evaluate } from '../expressions/evaluator.js';
import { resolveTileKind } from '../runtime/flow.js';

// ── Scope helpers ────────────────────────────────────────────────────────

function buildResolverScope(state) {
  const player = state.player || null;
  const actorView = player
    ? { ...player, ...(player.measurements || {}) }
    : null;
  // Expose the current tile (with `kind` resolution) as `actor.tile` so
  // tile-sensitive binding `when` expressions like
  // `actor.tile.kind == "stairs_down"` resolve.
  if (actorView && state.definition) {
    const map = state.map || state.definition.map;
    if (map && typeof player.x === 'number' && typeof player.y === 'number') {
      const ch = map.tiles[player.y]?.[player.x];
      actorView.tile = {
        x: player.x, y: player.y, ch,
        kind: resolveTileKind(state, ch),
      };
    }
  }
  return {
    actor: actorView,
    self: actorView,
    player: actorView,
    state: {
      level: state.level ?? 0,
      turn: state.turn ?? 0,
      debug: !!(state.debug ?? state.flags?.debug),
    },
  };
}

// ── Context stack ────────────────────────────────────────────────────────

/**
 * Compute the active context stack (top first) for a state.
 */
export function getActiveContexts(state, definition) {
  const stack = [];
  const inputCfg = definition.input || {};

  // Custom contexts (top), evaluated in declaration order.
  const scope = buildResolverScope(state);
  const customContexts = inputCfg.contexts || [];
  for (const ctx of customContexts) {
    if (!ctx.whenAst) continue;
    let active = false;
    try {
      active = !!evaluate(ctx.whenAst, scope, { rng: state.rng, state });
    } catch {
      active = false;
    }
    if (active) stack.push(ctx.id);
  }

  // Built-in top. Targeting sits above flow; flow above panel; panel above map.
  if (state.flowState) {
    const action = definition._index?.playerActions?.[state.flowState.actionId];
    const step = action?.flow?.[state.flowState.stepIndex];
    if (step && (step.type === 'pick_tile' || step.type === 'pick_being')) {
      stack.push('targeting');
    }
    stack.push('flow');
  }
  if (state.panelId) {
    stack.push('panel');
  }
  stack.push('map');

  // Deduplicate while preserving order (top first).
  const seen = new Set();
  const out = [];
  for (const c of stack) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// ── Binding matchers ─────────────────────────────────────────────────────

function bindingMatchesKey(binding, key) {
  if (binding.kind === 'key') return binding.keys.includes(key);
  return false;
}

function bindingMatchesSequence(binding, buffer) {
  if (binding.kind !== 'sequence') return false;
  const seq = binding.sequence;
  if (buffer.length !== seq.length) return false;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== buffer[i]) return false;
  }
  return true;
}

function sequenceStartsWith(binding, buffer) {
  if (binding.kind !== 'sequence') return false;
  const seq = binding.sequence;
  if (buffer.length >= seq.length) return false;
  for (let i = 0; i < buffer.length; i++) {
    if (seq[i] !== buffer[i]) return false;
  }
  return true;
}

function bindingPassesWhen(binding, state) {
  if (!binding.whenAst) return true;
  const scope = buildResolverScope(state);
  try {
    return !!evaluate(binding.whenAst, scope, { rng: state.rng, state });
  } catch {
    return false;
  }
}

// ── Single-key resolution (no sequence buffering) ───────────────────────

/**
 * Find the binding that fires for a single-key event in the active contexts.
 * Returns { binding } or null. The caller determines whether to treat a
 * `disabled` binding as "swallow" or "fall-through".
 */
function resolveSingleKey(state, definition, key) {
  const contexts = getActiveContexts(state, definition);
  const bindings = definition.input?.bindings || [];
  for (const ctx of contexts) {
    for (const b of bindings) {
      if (b.context !== ctx) continue;
      if (b.kind !== 'key') continue;
      if (!bindingMatchesKey(b, key)) continue;
      if (!bindingPassesWhen(b, state)) continue;
      return b;
    }
  }
  return null;
}

/**
 * Does any sequence binding, in some active context, START WITH `buffer`?
 * Used to decide whether to keep buffering or to flush.
 */
function anySequencePrefixes(state, definition, buffer) {
  const contexts = new Set(getActiveContexts(state, definition));
  const bindings = definition.input?.bindings || [];
  for (const b of bindings) {
    if (b.kind !== 'sequence') continue;
    if (!contexts.has(b.context)) continue;
    if (sequenceStartsWith(b, buffer)) return true;
  }
  return false;
}

/**
 * Find a sequence binding that matches `buffer` exactly. First-match wins
 * within context; higher contexts win over lower.
 */
function resolveSequenceExact(state, definition, buffer) {
  const contexts = getActiveContexts(state, definition);
  const bindings = definition.input?.bindings || [];
  for (const ctx of contexts) {
    for (const b of bindings) {
      if (b.context !== ctx) continue;
      if (b.kind !== 'sequence') continue;
      if (!bindingMatchesSequence(b, buffer)) continue;
      if (!bindingPassesWhen(b, state)) continue;
      return b;
    }
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Resolve an input event. Returns `{ actions, inputState }`.
 *
 * @param {object} state — GameState (needs: definition, flowState, panelId, player, level, turn, etc.)
 * @param {object} event — { type: 'key', key: string } | { type: 'timeout' }
 * @returns {{ actions: Array<{actionId, binding}>, inputState: object }}
 */
export function resolve(state, event) {
  const definition = state.definition || state._definition;
  if (!definition) {
    throw new Error('resolve: state is missing a definition');
  }
  const inputState = state.inputState || {};
  const buffer = Array.isArray(inputState.buffer) ? inputState.buffer : [];

  if (event && event.type === 'timeout') {
    return flushBuffer(state, definition, buffer);
  }
  if (!event || event.type !== 'key' || typeof event.key !== 'string') {
    return { actions: [], inputState: buffer.length ? { buffer } : {} };
  }
  const key = event.key;

  // Append the key to the buffer and try sequence / prefix matching first.
  const extended = [...buffer, key];
  const exact = resolveSequenceExact(state, definition, extended);
  if (exact) {
    const action = fireBinding(exact);
    return { actions: action ? [action] : [], inputState: {} };
  }
  if (anySequencePrefixes(state, definition, extended)) {
    // Wait for more keys (or a timeout event).
    return { actions: [], inputState: { buffer: extended } };
  }

  // No sequence path — flush any buffered prefix first, then process the
  // incoming key as a single press.
  const flushed = flushBufferAsSingles(state, definition, buffer);
  const fireNow = resolveSingleKey(state, definition, key);
  if (fireNow) {
    const action = fireBinding(fireNow);
    if (action) flushed.push(action);
  }
  return { actions: flushed, inputState: {} };
}

function fireBinding(binding) {
  if (binding.disabled) return null;
  return { actionId: binding.action, binding };
}

/**
 * Flush the pending sequence buffer as if the timeout expired.
 */
function flushBuffer(state, definition, buffer) {
  if (!buffer || buffer.length === 0) {
    return { actions: [], inputState: {} };
  }
  const actions = flushBufferAsSingles(state, definition, buffer);
  return { actions, inputState: {} };
}

/**
 * Replay each buffered key in order as a single-key event, collecting any
 * actions that would fire. Used both on explicit timeout events and when
 * a disambiguating key makes the buffered prefix unreachable.
 */
function flushBufferAsSingles(state, definition, buffer) {
  const fired = [];
  for (const k of buffer) {
    const b = resolveSingleKey(state, definition, k);
    if (b) {
      const a = fireBinding(b);
      if (a) fired.push(a);
    }
  }
  return fired;
}

// ── Synchronous convenience ─────────────────────────────────────────────

/**
 * One-shot key resolution that ignores sequence buffering. Convenient for
 * tests and for callers that don't care about chord support.
 */
export function resolveKey(state, key) {
  const definition = state.definition || state._definition;
  if (!definition) throw new Error('resolveKey: missing definition');
  const b = resolveSingleKey(state, definition, key);
  return b ? fireBinding(b) : null;
}
