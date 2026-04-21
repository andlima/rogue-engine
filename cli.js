#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadFromFile } from './src/config/loader.js';
import { createSession } from './src/runtime/session.js';
import { getVisibleTiles } from './src/runtime/view.js';
import { computeFOV } from './src/runtime/fov.js';
import { renderToString, renderStatus, drawHelpPanel, drawKeyHint } from './src/renderer/ascii.js';
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
const session = createSession(definition);

const VIEW_W = 21;
const VIEW_H = 15;

function draw() {
  process.stdout.write('\x1b[2J\x1b[H');
  const state = session.getState();
  if (state.terminal) {
    console.log(`Game over — ${state.terminal} (${state.terminalReason ?? 'unknown'}).`);
    console.log('Press any key to exit');
    return;
  }
  if (session.getQuitPending()) {
    console.log('Quit? (y/n)');
    return;
  }
  if (session.getHelpOpen()) {
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
  const hint = getKeyHint(state.definition, state, session.getIntrinsicHints());
  if (hint) {
    console.log(drawKeyHint(hint));
  } else {
    console.log('? help  ·  CTRL+c quit');
  }
  const reticle = session.getReticle();
  if (reticle) {
    console.log(`reticle: (${reticle.x}, ${reticle.y})`);
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
  if (session.getState().terminal) {
    exitAfterRestore();
    return;
  }

  const key = normalizeTerminalInput(raw);
  session.handleKey(key);
  draw();
});
