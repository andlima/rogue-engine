import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasRenderer } from '../src/renderer/canvas.js';
import { renderToString, renderStatus, renderMessages, getBeingAppearance, getItemAppearance } from '../src/renderer/ascii.js';

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
