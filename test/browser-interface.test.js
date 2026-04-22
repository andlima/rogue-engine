import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CanvasRenderer } from '../src/renderer/canvas.js';
import {
  DEFAULT_GAME_ID,
  isValidGameId,
  resolveGameId,
  getCandidatePaths,
} from '../src/browser/game-select.js';
import { parseManifest, loadManifest } from '../src/browser/manifest.js';

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
    const topImports = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')
          || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
        continue;
      }
      const importMatch = trimmed.match(/^import\s+.*\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        topImports.push(importMatch[1]);
        continue;
      }
      break;
    }
    const nodeSpecifiers = topImports.filter(s => s.startsWith('node:'));
    assert.deepEqual(nodeSpecifiers, [],
      `src/config/loader.js is loaded by the browser entry (index.html) and must not have top-level node: imports; found: ${nodeSpecifiers.join(', ')}`);
  });
});

describe('browser-interface: game selection', () => {
  it('DEFAULT_GAME_ID is "silly"', () => {
    assert.equal(DEFAULT_GAME_ID, 'silly');
  });

  it('resolveGameId returns "silly" for empty URLSearchParams', () => {
    assert.equal(resolveGameId(new URLSearchParams('')), 'silly');
  });

  it('resolveGameId returns "minimal" for game=minimal', () => {
    assert.equal(resolveGameId(new URLSearchParams('game=minimal')), 'minimal');
  });

  it('resolveGameId returns default for game=../etc/passwd', () => {
    assert.equal(resolveGameId(new URLSearchParams('game=../etc/passwd')), 'silly');
  });

  it('resolveGameId returns default for game=Minimal (uppercase)', () => {
    assert.equal(resolveGameId(new URLSearchParams('game=Minimal')), 'silly');
  });

  it('resolveGameId returns default for empty game= value', () => {
    assert.equal(resolveGameId(new URLSearchParams('game=')), 'silly');
  });

  it('isValidGameId accepts current game IDs', () => {
    assert.equal(isValidGameId('silly'), true);
    assert.equal(isValidGameId('minimal'), true);
    assert.equal(isValidGameId('interact-demo'), true);
    assert.equal(isValidGameId('toy-hit-and-heal'), true);
  });

  it('isValidGameId rejects invalid IDs', () => {
    assert.equal(isValidGameId(''), false);
    assert.equal(isValidGameId('../x'), false);
    assert.equal(isValidGameId('a/b'), false);
    assert.equal(isValidGameId('A'), false);
    assert.equal(isValidGameId('-leading-dash'), false);
    assert.equal(isValidGameId(null), false);
    assert.equal(isValidGameId(undefined), false);
  });

  it('getCandidatePaths("silly") returns nested-first candidates', () => {
    assert.deepEqual(getCandidatePaths('silly'), [
      './games/silly/game.yaml',
      './games/silly.yaml',
    ]);
  });

  it('getCandidatePaths("minimal") returns nested-first candidates', () => {
    assert.deepEqual(getCandidatePaths('minimal'), [
      './games/minimal/game.yaml',
      './games/minimal.yaml',
    ]);
  });
});

describe('browser-interface: launcher manifest', () => {
  const validEntries = [
    { id: 'silly', title: 'Silly Game', description: 'A dungeon crawl' },
    { id: 'minimal', title: 'Minimal Dungeon', description: 'A minimal room' },
    { id: 'interact-demo', title: 'Interact Demo', description: 'Exercises interactions' },
    { id: 'toy-hit-and-heal', title: 'Toy Hit and Heal', description: 'Two beings' },
  ];

  it('parses a valid manifest with four entries and returns the array unchanged', () => {
    const text = JSON.stringify(validEntries);
    assert.deepEqual(parseManifest(text), validEntries);
  });

  it('accepts an empty array as a valid manifest', () => {
    assert.deepEqual(parseManifest('[]'), []);
  });

  it('throws when the root is not an array', () => {
    assert.throws(() => parseManifest('{}'), /must be a JSON array/);
  });

  it('throws with "Invalid manifest JSON:" when the JSON is malformed', () => {
    assert.throws(() => parseManifest('[{'), /^Error: Invalid manifest JSON:/);
  });

  it('throws when an entry is missing the id field', () => {
    const text = JSON.stringify([{ title: 'T', description: 'D' }]);
    assert.throws(() => parseManifest(text), /entry 0 is missing id/);
  });

  it('throws when an entry has a non-string title (null)', () => {
    const text = JSON.stringify([{ id: 'silly', title: null, description: 'D' }]);
    assert.throws(() => parseManifest(text), /entry 0 is missing title/);
  });

  it('throws when an entry has a non-string title (number)', () => {
    const text = JSON.stringify([{ id: 'silly', title: 42, description: 'D' }]);
    assert.throws(() => parseManifest(text), /entry 0 is missing title/);
  });

  it('throws when an entry has an id that fails isValidGameId', () => {
    const text = JSON.stringify([{ id: '../escape', title: 'T', description: 'D' }]);
    assert.throws(() => parseManifest(text), /has invalid id/);
  });
});

describe('browser-interface: launcher manifest fetch', () => {
  it('resolves to the parsed array on ok response', async () => {
    const entries = [{ id: 'silly', title: 'Silly', description: 'desc' }];
    const fetchImpl = async () => ({
      ok: true,
      text: async () => JSON.stringify(entries),
    });
    const result = await loadManifest(fetchImpl);
    assert.deepEqual(result, entries);
  });

  it('rejects with a "status 404" message when the response is not ok', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404 });
    await assert.rejects(() => loadManifest(fetchImpl), /status 404/);
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
