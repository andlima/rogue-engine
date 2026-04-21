#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadFromFile } from './src/config/loader.js';
import { createState } from './src/runtime/state.js';
import { dispatch } from './src/runtime/dispatch.js';
import { getVisibleTiles } from './src/runtime/view.js';
import { computeFOV } from './src/runtime/fov.js';
import { renderToString, renderStatus, drawHelpPanel, drawKeyHint } from './src/renderer/ascii.js';
import { resolve } from './src/input/resolver.js';
import { getHelpRows, getKeyHint } from './src/input/help.js';
import { normalizeTerminalInput } from './src/input/keys.js';
import { getCurrentFlowStep, getCurrentFlowCandidates } from './src/runtime/flow.js';

const { values } = parseArgs({
  options: {
    game: { type: 'string', short: 'g' },
  },
});

if (!values.game) {
  console.error('Usage: node cli.js --game <path-to-yaml>');
  process.exit(1);
}

const definition = await loadFromFile(values.game);
let state = createState(definition);
let helpOpen = false;
let inputState = {};
let quitPending = false;
// Reticle position for pick_tile / pick_being flow steps. Tracked in CLI-
// local state (not GameState) because it is a UI concern, not a game
// state transition.
let reticle = null;

const VIEW_W = 21;
const VIEW_H = 15;

// ── Step-intrinsic key translation ────────────────────────────────────────
// The spec routes a key event to the flow runner first; if the runner
// declines (input does not match the expected step type) the event falls
// through to the resolver. These tables and helpers implement the runner
// side of that boundary at the CLI layer.

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

function isLowerAlpha(key) {
  if (typeof key !== 'string' || key.length !== 1) return false;
  const c = key.charCodeAt(0);
  return c >= 97 && c <= 122;
}

function draw() {
  process.stdout.write('\x1b[2J\x1b[H');
  if (state.terminal) {
    console.log(`Game over — ${state.terminal} (${state.terminalReason ?? 'unknown'}).`);
    console.log('Press any key to exit');
    return;
  }
  if (quitPending) {
    console.log('Quit? (y/n)');
    return;
  }
  if (helpOpen) {
    console.log(drawHelpPanel(getHelpRows(state.definition, state)));
    console.log();
    console.log('Press any key to close help');
    return;
  }
  const fovMap = state.map ? computeFOV(state.map, state.player.x, state.player.y) : undefined;
  const grid = getVisibleTiles(state, VIEW_W, VIEW_H, fovMap);
  console.log(renderToString(grid, state.definition.rendering, state));
  console.log();
  console.log(renderStatus(state));
  console.log();
  const intrinsic = intrinsicHints();
  const hint = getKeyHint(state.definition, state, intrinsic);
  if (hint) {
    console.log(drawKeyHint(hint));
  } else {
    console.log('? help  ·  CTRL+c quit');
  }
  if (reticle) {
    console.log(`reticle: (${reticle.x}, ${reticle.y})`);
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

// Translate a resolved binding into a dispatch action (or handle locally).
function actOnBinding(binding) {
  const id = binding.action;
  switch (id) {
    case 'quit':
      // Spec criterion 6: confirm before quitting; on confirm, mark the run
      // as `lose { reason: "quit" }` so replay tooling sees a terminal state.
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
      // The loader indexes every player action under its id, so the CLI
      // can dispatch bindings whose target action lacks a legacy
      // `trigger:` field (the common case in the spec's examples).
      state = dispatch(state, { type: 'action', trigger: id });
      return;
  }
}

draw();

// Raw mode is a TTY-only feature. When stdin is piped (e.g. in the
// subprocess regression test), setRawMode is undefined — skip it so the
// CLI is still drivable in that configuration.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');

function exitAfterRestore() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

process.stdin.on('data', (raw) => {
  // After a terminal state, any keypress exits — short-circuit above every
  // other branch so the quit-confirm pathway is unreachable post-game-over.
  if (state.terminal) {
    exitAfterRestore();
    return;
  }

  // Quit-confirm prompt short-circuits all other input.
  if (quitPending) {
    if (raw === 'y' || raw === 'Y') {
      state = { ...state, terminal: 'lose', terminalReason: 'quit' };
      quitPending = false;
      draw();
      exitAfterRestore();
      return;
    }
    quitPending = false;
    draw();
    return;
  }

  if (helpOpen) {
    helpOpen = false;
    draw();
    return;
  }

  const key = normalizeTerminalInput(raw);
  if (!key) return;

  // Spec criterion 5: offer the key to the flow runner first. If the
  // runner declines (not a step-intrinsic input), fall through to the
  // resolver which applies `flow`-context bindings, then `map`.
  if (state.flowState) {
    ensureReticleFor(state);
    const flow = tryFlowStepInput(state, key);
    if (flow.handled) {
      if (flow.dispatch) {
        state = dispatch(state, flow.dispatch);
      }
      ensureReticleFor(state);
      draw();
      return;
    }
  }

  const res = resolve({ ...state, inputState }, { type: 'key', key });
  inputState = res.inputState || {};
  for (const action of res.actions) {
    actOnBinding(action.binding);
  }
  ensureReticleFor(state);
  draw();
});
