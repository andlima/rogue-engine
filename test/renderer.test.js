import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasRenderer } from '../src/renderer/canvas.js';
import { renderToString, renderStatus, renderMessages, getBeingAppearance, getItemAppearance, drawPanel, drawPrompt, drawReticle } from '../src/renderer/ascii.js';

describe('CanvasRenderer stub', () => {
  it('accepts rendering config in constructor', () => {
    const renderer = new CanvasRenderer({ tiles: {}, beings: {} });
    assert.ok(renderer.config);
  });

  it('exposes a draw(state) method that throws not-implemented', () => {
    const renderer = new CanvasRenderer({});
    assert.throws(() => renderer.draw({}), /not implemented/);
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

describe('Canvas renderer: flow-surface stubs', () => {
  it('drawPanel / drawPrompt / drawReticle all throw not-implemented', () => {
    const r = new CanvasRenderer({});
    assert.throws(() => r.drawPanel({}, 0), /not implemented/);
    assert.throws(() => r.drawPrompt({}), /not implemented/);
    assert.throws(() => r.drawReticle([], {}, {}, {}), /not implemented/);
  });
});
