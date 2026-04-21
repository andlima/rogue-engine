import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CanvasRenderer } from '../src/renderer/canvas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function makeRecordingCanvas() {
  const calls = [];
  const ctx = {
    fillStyle: null,
    font: '',
    textBaseline: '',
    textAlign: '',
    fillText: (...args) => calls.push({ type: 'fillText', args, fillStyle: ctx.fillStyle, font: ctx.font }),
    fillRect: (...args) => calls.push({ type: 'fillRect', args }),
    clearRect: (...args) => calls.push({ type: 'clearRect', args }),
    measureText: () => ({ width: 10 }),
  };
  return {
    width: 0,
    height: 0,
    _ctx: ctx,
    _calls: calls,
    getContext: () => ctx,
  };
}

describe('browser-interface: import map pinning', () => {
  it('import map yaml version matches package.json dependency', async () => {
    const pkgRaw = await readFile(join(ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const pkgVersion = pkg.dependencies?.yaml;
    assert.ok(pkgVersion, 'package.json must declare yaml dependency');
    const cleanPkgVersion = pkgVersion.replace(/^[\^~]/, '');

    const indexRaw = await readFile(join(ROOT, 'index.html'), 'utf8');
    // Grab the importmap JSON body, then read the yaml entry from it.
    const importMapMatch = indexRaw.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    assert.ok(importMapMatch, 'index.html must contain a <script type="importmap"> block');
    const yamlEntry = importMapMatch[1].match(/"yaml"\s*:\s*"([^"]+)"/);
    assert.ok(yamlEntry, 'import map must include a yaml entry');
    const url = yamlEntry[1];
    const urlVersion = url.match(/yaml@([^\/]+)/)?.[1];
    assert.equal(urlVersion, cleanPkgVersion,
      `import map yaml@${urlVersion} must match package.json ${pkgVersion}`);
  });
});

describe('browser-interface: CanvasRenderer smoke', () => {
  it('drawGrid paints at least one fillText per cell and resolves tile overrides', () => {
    const canvas = makeRecordingCanvas();
    const rendering = {
      tiles: {
        '#': { glyph: '▓', color: 'gray' },
      },
    };
    const renderer = new CanvasRenderer(canvas, rendering);
    const grid = [
      [{ ch: '#', color: 'gray' }, { ch: '.', color: 'white' }],
      [{ ch: '@', color: 'white' }, { ch: '.', color: 'white' }],
    ];
    renderer.drawGrid(grid, 'ascii');

    const clearCalls = canvas._calls.filter(c => c.type === 'clearRect');
    assert.ok(clearCalls.length >= 1, 'clearRect must be called at least once');

    const fillCalls = canvas._calls.filter(c => c.type === 'fillText');
    assert.ok(fillCalls.length >= 4, `expected >=4 fillText calls (one per cell), got ${fillCalls.length}`);

    const overrideCall = fillCalls.find(c => c.args[0] === '▓');
    assert.ok(overrideCall, 'fillText must use the rendering.tiles override glyph for #');
  });
});

describe('browser-interface: browser-safe imports', () => {
  it('loader.js has no top-level node: imports', async () => {
    const source = await readFile(join(ROOT, 'src/config/loader.js'), 'utf8');
    const lines = source.split('\n');
    const specifiers = [];
    let inBlockComment = false;
    for (const rawLine of lines) {
      let line = rawLine;
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end === -1) continue;
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        continue;
      }
      const match = trimmed.match(/^import\s+.*?from\s+['"]([^'"]+)['"]/);
      if (match) {
        specifiers.push(match[1]);
        continue;
      }
      break;
    }
    assert.ok(specifiers.length > 0, 'expected to find at least one top-level import in loader.js');
    const nodeImports = specifiers.filter(s => s.startsWith('node:'));
    assert.deepEqual(nodeImports, [],
      `loader.js must not have top-level node: imports (found: ${nodeImports.join(', ')}). ` +
      'Move Node-only imports behind a dynamic import() inside the function that needs them, ' +
      'so the module stays browser-resolvable.');
  });
});

describe('browser-interface: index.html structure', () => {
  it('contains the required DOM surfaces and script blocks', async () => {
    const html = await readFile(join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /<canvas[^>]+id="game"/, 'canvas#game present');
    assert.match(html, /<div[^>]+id="status"/, 'div#status present');
    assert.match(html, /<div[^>]+id="messages"/, 'div#messages present');
    assert.match(html, /<div[^>]+id="key-hint"/, 'div#key-hint present');
    assert.match(html, /<div[^>]+id="help"/, 'div#help present');
    assert.match(html, /<script type="importmap">/, 'importmap block present');
    assert.match(html, /<script type="module">/, 'module script block present');
    assert.ok(html.includes('./src/config/loader.js'), 'references loader.js');
    assert.ok(html.includes('./src/runtime/state.js'), 'references state.js');
  });
});
