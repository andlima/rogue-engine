import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'cli.js');
const FIXTURE_PATH = join(__dirname, 'fixtures', 'quick-loss.yaml');

function waitForGameOver(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.includes('Game over') && buf.includes('Press any key to exit')) {
        child.stdout.off('data', onData);
        clearTimeout(t);
        resolve(buf);
      }
    };
    const t = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`Timed out waiting for game-over screen (got: ${JSON.stringify(buf.slice(-200))})`));
    }, timeoutMs);
    child.stdout.on('data', onData);
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
  });
}

describe('cli: game-over exit', () => {
  it('exits cleanly on any keypress after a terminal state', async () => {
    const child = spawn('node', [CLI_PATH, '--game', FIXTURE_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      child.stdin.write('.');
      const output = await waitForGameOver(child, 3000);
      assert.match(output, /Game over/, 'stdout should show Game over line');
      assert.match(output, /Press any key to exit/, 'stdout should show the exit hint');

      child.stdin.write('q');

      const { code, signal } = await waitForExit(child, 2000);
      assert.equal(signal, null, 'child should exit cleanly, not by signal');
      assert.equal(code, 0, 'child should exit with status 0');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });

  it('exits on a non-printable keystroke (e.g. ENTER) after game-over', async () => {
    const child = spawn('node', [CLI_PATH, '--game', FIXTURE_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      child.stdin.write('.');
      await waitForGameOver(child, 3000);
      child.stdin.write('\r');
      const { code } = await waitForExit(child, 2000);
      assert.equal(code, 0, 'child should exit with status 0 on ENTER');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });
});
