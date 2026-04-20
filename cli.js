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

const VIEW_W = 21;
const VIEW_H = 15;

function draw() {
  process.stdout.write('\x1b[2J\x1b[H');
  if (helpOpen) {
    console.log(drawHelpPanel(getHelpRows(state.definition, state)));
    console.log();
    console.log('Press any key to close help');
    return;
  }
  const fovMap = state.map ? computeFOV(state.map, state.player.x, state.player.y) : undefined;
  const grid = getVisibleTiles(state, VIEW_W, VIEW_H, fovMap);
  console.log(renderToString(grid));
  console.log();
  console.log(renderStatus(state));
  console.log();
  const hint = getKeyHint(state.definition, state, []);
  if (hint) {
    console.log(drawKeyHint(hint));
  } else {
    console.log('? help  ·  CTRL+c quit');
  }
}

// Translate a resolved binding into a dispatch action (or handle locally).
function actOnBinding(binding) {
  const id = binding.action;
  switch (id) {
    case 'quit':
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
      break;
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
    default:
      state = dispatch(state, { type: 'action', trigger: id });
      return;
  }
}

draw();

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');

process.stdin.on('data', (raw) => {
  if (helpOpen) {
    helpOpen = false;
    draw();
    return;
  }
  const key = normalizeTerminalInput(raw);
  if (!key) return;
  const res = resolve({ ...state, inputState }, { type: 'key', key });
  inputState = res.inputState || {};
  for (const action of res.actions) {
    actOnBinding(action.binding);
  }
  draw();
});
