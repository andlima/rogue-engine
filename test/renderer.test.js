import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasRenderer } from '../src/renderer/canvas.js';
import { renderToString, renderStatus, renderMessages, getBeingAppearance, getItemAppearance, drawPanel, drawPrompt, drawReticle, drawHelpPanel, drawKeyHint } from '../src/renderer/ascii.js';
import { parse as parseExpr } from '../src/expressions/parser.js';

function makeStubCanvas() {
  const calls = [];
  const ctx = {
    _calls: calls,
    fillStyle: null,
    font: '',
    textBaseline: '',
    textAlign: '',
    fillText: (...args) => calls.push(['fillText', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    measureText: () => ({ width: 10 }),
  };
  return {
    width: 0,
    height: 0,
    _ctx: ctx,
    getContext: () => ctx,
  };
}

describe('CanvasRenderer', () => {
  it('accepts rendering config alongside an injected canvas element', () => {
    const canvas = makeStubCanvas();
    const renderer = new CanvasRenderer(canvas, { tiles: {}, beings: {} });
    assert.ok(renderer.config);
    assert.equal(renderer.canvas, canvas);
    assert.ok(renderer.ctx);
  });

  it('exposes drawGrid, drawReticle, and clear methods', () => {
    const renderer = new CanvasRenderer(makeStubCanvas(), {});
    assert.equal(typeof renderer.drawGrid, 'function');
    assert.equal(typeof renderer.drawReticle, 'function');
    assert.equal(typeof renderer.clear, 'function');
  });
});

describe('ANSI renderer', () => {
  it('renders a grid to string', () => {
    const grid = [
      [{ ch: '#', color: 'gray' }, { ch: '.', color: 'white' }],
      [{ ch: '@', color: 'white' }, { ch: '.', color: null }],
    ];
    const result = renderToString(grid);
    assert.ok(result.includes('#'));
    assert.ok(result.includes('@'));
  });

  it('renders status bar from state', () => {
    const state = {
      player: { measurements: { hp: 15 } },
      definition: {
        measurements: [{ id: 'hp', label: 'Hit Points' }],
        rendering: null,
        _index: { measurements: { hp: { id: 'hp', label: 'Hit Points' } } },
      },
    };
    const result = renderStatus(state);
    assert.match(result, /Hit Points: 15/);
  });

  it('renders messages from state', () => {
    const state = {
      messages: ['Hello', 'World', 'Foo', 'Bar', 'Baz', 'Qux'],
      definition: { rendering: { hud: { message_log_size: 3 } } },
    };
    const msgs = renderMessages(state);
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0], 'Bar');
  });
});

describe('ANSI renderer: interaction-flow surfaces', () => {
  it('drawPanel renders a bordered box with a cursor row', () => {
    const out = drawPanel({
      title: 'Inventory',
      columns: [{ header: 'Name' }, { header: 'Kind' }],
      rows: [['Potion', 'consumable'], ['Sword', 'equipment']],
    }, 1);
    assert.ok(out.includes('Inventory'));
    assert.ok(out.includes('Potion'));
    assert.ok(out.includes('Sword'));
    // Cursor marker on the selected (index 1) row
    assert.ok(out.split('\n').some(line => line.startsWith('│>') && line.includes('Sword')));
  });

  it('drawPrompt formats title and message', () => {
    const out = drawPrompt({ title: 'Aim', message: 'Pick a target' });
    assert.match(out, /\[Aim\]/);
    assert.match(out, /Pick a target/);
  });

  it('drawReticle overlays an indicator on the grid', () => {
    const grid = [
      [{ ch: '.' }, { ch: '.' }, { ch: '.' }],
      [{ ch: '.' }, { ch: '@' }, { ch: '.' }],
      [{ ch: '.' }, { ch: '.' }, { ch: '.' }],
    ];
    const overlay = drawReticle(grid, { x: 0, y: 0 }, { x: 2, y: 0 }, { glyph: '*', color: 'yellow' });
    assert.equal(overlay[0][2].ch, '*');
    assert.equal(overlay[0][2].color, 'yellow');
    // Original grid untouched
    assert.equal(grid[0][2].ch, '.');
  });
});

describe('ANSI renderer: input-bindings surfaces', () => {
  it('drawHelpPanel renders a bordered help screen with keys/labels/summaries', () => {
    const out = drawHelpPanel({
      title: 'Commands',
      sections: [
        {
          header: 'Move',
          rows: [
            { keys: ['UP', 'k'], label: 'Move north', summary: 'Move one tile north' },
          ],
        },
      ],
    });
    assert.ok(out.includes('Move'), 'section header present');
    assert.ok(out.includes('UP/k'), 'alias keys rendered');
    assert.ok(out.includes('Move north'), 'label rendered');
    assert.ok(out.includes('tile north'), 'summary rendered');
  });

  it('drawKeyHint passes a plain string through', () => {
    const hint = '↑/↓ select · ENTER confirm · ESC cancel';
    assert.equal(drawKeyHint(hint), hint);
    assert.equal(drawKeyHint(''), '');
    assert.equal(drawKeyHint(null), '');
  });
});

describe('ANSI renderer: emoji display mode', () => {
  function mkDef(overrides = {}) {
    return {
      rendering: overrides.rendering ?? null,
      _index: {
        beings: {
          hero: { id: 'hero', glyph: '@', emoji: '🧙', color: 'white' },
          rat:  { id: 'rat',  glyph: 'r', emoji: '🐀', color: 'green' },
          ghost:{ id: 'ghost',glyph: 'g', color: 'gray' }, // no emoji declared
        },
        items: {
          gold: { id: 'gold', glyph: '$', emoji: '💰', color: 'yellow' },
          bag:  { id: 'bag',  glyph: '(', color: 'gray' },
        },
      },
    };
  }

  it('getBeingAppearance returns the emoji when state.displayMode === "emoji"', () => {
    const def = mkDef();
    const asciiState = { displayMode: 'ascii', player: {}, entities: [] };
    const emojiState = { displayMode: 'emoji', player: {}, entities: [] };
    assert.equal(getBeingAppearance('rat', def, asciiState).glyph, 'r');
    assert.equal(getBeingAppearance('rat', def, emojiState).glyph, '🐀');
  });

  it('getBeingAppearance falls back to glyph when no emoji is declared', () => {
    const def = mkDef();
    const emojiState = { displayMode: 'emoji', player: {}, entities: [] };
    const out = getBeingAppearance('ghost', def, emojiState);
    assert.equal(out.glyph, 'g', 'missing emoji falls through to ASCII glyph');
  });

  it('getItemAppearance respects state.displayMode', () => {
    const def = mkDef();
    const asciiState = { displayMode: 'ascii' };
    const emojiState = { displayMode: 'emoji' };
    assert.equal(getItemAppearance('gold', def, asciiState).glyph, '$');
    assert.equal(getItemAppearance('gold', def, emojiState).glyph, '💰');
    // No emoji declared → fallback to glyph.
    assert.equal(getItemAppearance('bag', def, emojiState).glyph, '(');
  });

  it('rendering.beings.<id>.emoji override wins over beings.<id>.emoji', () => {
    const def = mkDef({
      rendering: {
        beings: {
          rat: { emoji: '🐁', glyph: null, color: null },
        },
      },
    });
    const emojiState = { displayMode: 'emoji', player: {}, entities: [] };
    assert.equal(getBeingAppearance('rat', def, emojiState).glyph, '🐁');
  });

  it('status_rules[].emoji override applies when its `when` matches', () => {
    const def = {
      rendering: {
        status_rules: [
          {
            when: { ast: parseExpr('actor.hp < 5') },
            emoji: '🩸',
            glyph: '!',
          },
        ],
      },
      _index: {
        beings: {
          hero: { id: 'hero', glyph: '@', emoji: '🧙', color: 'white' },
        },
        items: {},
      },
    };
    const emojiState = {
      displayMode: 'emoji',
      level: 1,
      turn: 0,
      rng: () => 0.5,
      player: { measurements: { hp: 3 }, hp: 3 },
      entities: [],
    };
    // Rule matches (hp < 5) → override fires; emoji mode picks the emoji.
    assert.equal(getBeingAppearance('hero', def, emojiState).glyph, '🩸');
    // In ASCII mode, the same match yields the rule's glyph override.
    const asciiState = { ...emojiState, displayMode: 'ascii' };
    assert.equal(getBeingAppearance('hero', def, asciiState).glyph, '!');

    // When the rule does NOT match (hp = 9), no override is applied.
    const healthy = {
      ...emojiState,
      player: { measurements: { hp: 9 }, hp: 9 },
    };
    assert.equal(getBeingAppearance('hero', def, healthy).glyph, '🧙');
  });

  it('renderToString pads ASCII cells to two columns in emoji mode', () => {
    const grid = [[{ ch: '@', color: null }, { ch: '.', color: null }]];
    const out = renderToString(grid, null, { displayMode: 'emoji' });
    // Two ASCII cells → each padded with a trailing space.
    assert.equal(out, '@ . ');
  });

  it('renderToString leaves emoji cells unpadded in emoji mode', () => {
    const grid = [[{ ch: '🐀', color: null }, { ch: '@', color: null }]];
    const out = renderToString(grid, null, { displayMode: 'emoji' });
    // Emoji is emitted as-is; trailing ASCII cell pads with a space.
    assert.equal(out, '🐀@ ');
  });

  it('renderToString preserves single-column width in ascii mode', () => {
    const grid = [[{ ch: '@', color: null }, { ch: '.', color: null }]];
    const out = renderToString(grid, null, { displayMode: 'ascii' });
    assert.equal(out, '@.');
    // Also ensure omitting the state argument defaults to ascii.
    assert.equal(renderToString(grid), '@.');
  });

  it('renderToString applies tile emoji override in emoji mode only', () => {
    const grid = [[{ ch: '#', color: null }]];
    const rendering = { tiles: { '#': { glyph: '#', emoji: '🧱', color: null } } };
    const asciiOut = renderToString(grid, rendering, { displayMode: 'ascii' });
    const emojiOut = renderToString(grid, rendering, { displayMode: 'emoji' });
    assert.ok(asciiOut.startsWith('#'), 'ASCII mode keeps the raw glyph');
    assert.ok(emojiOut.startsWith('🧱'), 'emoji mode substitutes the tile emoji');
  });
});
