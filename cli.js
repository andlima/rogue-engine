#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadFromFile } from './src/config/loader.js';
import { createState } from './src/runtime/state.js';
import { dispatch } from './src/runtime/dispatch.js';
import { getVisibleTiles } from './src/runtime/view.js';
import { computeFOV } from './src/runtime/fov.js';
import { renderToString, renderStatus } from './src/renderer/ascii.js';

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

const VIEW_W = 21;
const VIEW_H = 15;

function draw() {
  // Clear screen
  process.stdout.write('\x1b[2J\x1b[H');
  const fovMap = state.map ? computeFOV(state.map, state.player.x, state.player.y) : undefined;
  const grid = getVisibleTiles(state, VIEW_W, VIEW_H, fovMap);
  console.log(renderToString(grid));
  console.log();
  console.log(renderStatus(state));
  console.log();
  console.log('Move: arrow keys / WASD  |  Quit: q');
}

const KEY_MAP = {
  w: 'n', W: 'n',
  a: 'w', A: 'w',
  s: 's', S: 's',
  d: 'e', D: 'e',
};

// Arrow key escape sequences
const ARROW_MAP = {
  '\x1b[A': 'n', // up
  '\x1b[B': 's', // down
  '\x1b[C': 'e', // right
  '\x1b[D': 'w', // left
};

draw();

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');

process.stdin.on('data', (key) => {
  if (key === 'q' || key === 'Q' || key === '\x03') {
    process.stdout.write('\x1b[2J\x1b[H');
    process.exit(0);
  }

  let dir = KEY_MAP[key] || ARROW_MAP[key];
  if (dir) {
    state = dispatch(state, { type: 'move', dir });
    draw();
  }
});
