/**
 * Session — surface-agnostic game-loop state and input dispatch.
 *
 * Both the CLI and the browser entry construct a session per game and
 * feed it normalized `NAMED_KEYS` keypresses. The session owns the
 * game state, the flow reticle, and the help / quit-confirm toggles;
 * the surface only owns its own redraw.
 *
 * Contract:
 *   const session = createSession(definition);
 *   session.handleKey('UP');          // mutates internal state
 *   session.getState();               // current GameState
 *   session.getHelpOpen();            // boolean
 *   session.getQuitPending();         // boolean
 *   session.getReticle();             // { x, y } | null
 *   session.getIntrinsicHints();      // step-intrinsic key hints
 */

import { createState } from './state.js';
import { dispatch } from './dispatch.js';
import { resolve } from '../input/resolver.js';
import { getCurrentFlowStep, getCurrentFlowCandidates } from './flow.js';

const CARDINAL_KEY_TO_DIR = {
  UP: 'n', DOWN: 's', LEFT: 'w', RIGHT: 'e',
  k: 'n',  j: 's',    h: 'w',    l: 'e',
};
const OCTAL_EXTRA = {
  y: 'nw', u: 'ne', b: 'sw', n: 'se',
};
const RETICLE_DELTA = {
  UP:    { dx: 0,  dy: -1 },
  DOWN:  { dx: 0,  dy: 1 },
  LEFT:  { dx: -1, dy: 0 },
  RIGHT: { dx: 1,  dy: 0 },
  k:     { dx: 0,  dy: -1 },
  j:     { dx: 0,  dy: 1 },
  h:     { dx: -1, dy: 0 },
  l:     { dx: 1,  dy: 0 },
};

function isLowerAlpha(key) {
  if (typeof key !== 'string' || key.length !== 1) return false;
  const c = key.charCodeAt(0);
  return c >= 97 && c <= 122;
}

export function createSession(definition) {
  let state = createState(definition);
  let helpOpen = false;
  let quitPending = false;
  let reticle = null;
  let inputState = {};

  function ensureReticleFor(currentState) {
    const step = getCurrentFlowStep(currentState);
    const needs = step && (step.type === 'pick_tile' || step.type === 'pick_being');
    if (!needs) {
      reticle = null;
      return;
    }
    if (reticle == null) {
      const origin = currentState.flowState?.origin ?? currentState.player;
      reticle = { x: origin.x, y: origin.y };
    }
  }

  function tryFlowStepInput(currentState, key) {
    const step = getCurrentFlowStep(currentState);
    if (!step) return { handled: false };

    switch (step.type) {
      case 'pick_direction': {
        const set = step.set || 'cardinal';
        let dir = CARDINAL_KEY_TO_DIR[key];
        if (!dir && set === 'octal') dir = OCTAL_EXTRA[key];
        if (!dir) return { handled: false };
        return { handled: true, dispatch: { type: 'flow_input', kind: 'pick_direction', dir } };
      }
      case 'pick_item': {
        if (!isLowerAlpha(key)) return { handled: false };
        const idx = key.charCodeAt(0) - 'a'.charCodeAt(0);
        const candidates = getCurrentFlowCandidates(currentState);
        if (idx >= candidates.length) return { handled: false };
        return { handled: true, dispatch: { type: 'flow_input', kind: 'pick_item', item: candidates[idx] } };
      }
      case 'pick_option': {
        if (!isLowerAlpha(key)) return { handled: false };
        const idx = key.charCodeAt(0) - 'a'.charCodeAt(0);
        const opts = step.options || [];
        if (idx >= opts.length) return { handled: false };
        return { handled: true, dispatch: { type: 'flow_input', kind: 'pick_option', option_id: opts[idx].id } };
      }
      case 'pick_tile':
      case 'pick_being': {
        const delta = RETICLE_DELTA[key];
        if (delta) {
          reticle = { x: reticle.x + delta.dx, y: reticle.y + delta.dy };
          return { handled: true };
        }
        if (key === 'ENTER' || key === 'SPACE') {
          return { handled: true, dispatch: { type: 'flow_input', kind: step.type, tile: { ...reticle } } };
        }
        return { handled: false };
      }
      case 'confirm': {
        if (key === 'y' || key === 'Y' || key === 'ENTER') {
          return { handled: true, dispatch: { type: 'flow_input', kind: 'confirm', confirm: true } };
        }
        if (key === 'n' || key === 'N') {
          return { handled: true, dispatch: { type: 'flow_input', kind: 'confirm', confirm: false } };
        }
        return { handled: false };
      }
    }
    return { handled: false };
  }

  function actOnBinding(binding) {
    const id = binding.action;
    switch (id) {
      case 'quit':
        quitPending = true;
        return;
      case 'open_help':
        helpOpen = true;
        return;
      case 'cancel':
        if (helpOpen) { helpOpen = false; return; }
        state = dispatch(state, { type: 'flow_cancel' });
        return;
      case 'move_n':
        state = dispatch(state, { type: 'move', dir: 'n' });
        return;
      case 'move_s':
        state = dispatch(state, { type: 'move', dir: 's' });
        return;
      case 'move_e':
        state = dispatch(state, { type: 'move', dir: 'e' });
        return;
      case 'move_w':
        state = dispatch(state, { type: 'move', dir: 'w' });
        return;
      case 'interact':
        state = dispatch(state, { type: 'interact' });
        return;
      case 'toggle_display':
        state = dispatch(state, { type: 'toggle_display' });
        return;
      default:
        state = dispatch(state, { type: 'action', trigger: id });
        return;
    }
  }

  function intrinsicHints() {
    const step = getCurrentFlowStep(state);
    if (!step) return [];
    switch (step.type) {
      case 'pick_direction':
        return [{ keys: ['↑/↓/←/→'], label: 'direction', actionId: '_pick_direction' }];
      case 'pick_item':
        return [{ keys: ['a-z'], label: 'select item', actionId: '_pick_item' }];
      case 'pick_option':
        return [{ keys: ['a-z'], label: 'select option', actionId: '_pick_option' }];
      case 'pick_tile':
      case 'pick_being':
        return [{ keys: ['↑/↓/←/→'], label: 'aim', actionId: '_reticle' },
                { keys: ['ENTER'], label: 'confirm', actionId: '_commit' }];
      case 'confirm':
        return [{ keys: ['y/n'], label: 'confirm', actionId: '_confirm' }];
    }
    return [];
  }

  function handleKey(key) {
    // After a terminal state, the session signals the surface that the
    // run is over — the surface decides what "exit" means (CLI exits
    // process, browser just freezes the last frame).
    if (state.terminal) {
      return { changed: false, terminal: state.terminal };
    }

    if (quitPending) {
      if (key === 'y' || key === 'Y') {
        state = { ...state, terminal: 'lose', terminalReason: 'quit' };
        quitPending = false;
        return { changed: true, terminal: state.terminal };
      }
      quitPending = false;
      return { changed: true, terminal: null };
    }

    if (helpOpen) {
      helpOpen = false;
      return { changed: true, terminal: null };
    }

    if (key == null) return { changed: false, terminal: null };

    if (state.flowState) {
      ensureReticleFor(state);
      const flow = tryFlowStepInput(state, key);
      if (flow.handled) {
        if (flow.dispatch) {
          state = dispatch(state, flow.dispatch);
        }
        ensureReticleFor(state);
        return { changed: true, terminal: state.terminal };
      }
    }

    const res = resolve({ ...state, inputState }, { type: 'key', key });
    inputState = res.inputState || {};
    for (const action of res.actions) {
      actOnBinding(action.binding);
    }
    ensureReticleFor(state);
    return { changed: true, terminal: state.terminal };
  }

  return {
    getState: () => state,
    getHelpOpen: () => helpOpen,
    getQuitPending: () => quitPending,
    getReticle: () => reticle,
    getIntrinsicHints: intrinsicHints,
    handleKey,
  };
}
