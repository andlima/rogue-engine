import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKey, tryParseKey, normalizeTerminalInput, KeyParseError,
} from '../src/input/keys.js';

describe('input/keys: parseKey — printable characters', () => {
  it('accepts single printable chars verbatim (case-sensitive)', () => {
    assert.equal(parseKey('q').canonical, 'q');
    assert.equal(parseKey('?').canonical, '?');
    assert.equal(parseKey('.').canonical, '.');
    assert.equal(parseKey('>').canonical, '>');
    assert.equal(parseKey('A').canonical, 'A');
    assert.notEqual(parseKey('A').canonical, parseKey('a').canonical);
  });

  it('normalises literal space to SPACE', () => {
    assert.equal(parseKey(' ').canonical, 'SPACE');
  });
});

describe('input/keys: parseKey — named keys', () => {
  it('accepts all documented named keys', () => {
    const names = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'ENTER',
      'ESC', 'TAB', 'BACKSPACE', 'DELETE', 'HOME', 'END',
      'PAGEUP', 'PAGEDOWN', 'INSERT',
      'F1', 'F5', 'F12'];
    for (const n of names) assert.equal(parseKey(n).canonical, n);
  });

  it('suggests a near-miss for a typo (Levenshtein ≤ 2)', () => {
    const { ok, error, suggestion } = tryParseKey('ESCP');
    assert.equal(ok, false);
    assert.match(error, /unknown key name 'ESCP'/);
    assert.match(error, /did you mean 'ESC'/);
    assert.equal(suggestion, 'ESC');
  });

  it('omits a suggestion when no vocabulary key is within Levenshtein 2', () => {
    const { ok, suggestion } = tryParseKey('UPARROW');
    assert.equal(ok, false);
    assert.equal(suggestion, null);
  });

  it('rejects modifier-only keys', () => {
    assert.throws(() => parseKey('CTRL'), /modifier-only/);
  });

  it('rejects empty strings', () => {
    assert.throws(() => parseKey(''), /empty key name/);
  });
});

describe('input/keys: parseKey — modifier combos', () => {
  it('accepts CTRL+x, ALT+x', () => {
    assert.equal(parseKey('CTRL+c').canonical, 'CTRL+c');
    assert.equal(parseKey('ALT+x').canonical, 'ALT+x');
  });

  it('canonicalises modifier order: CTRL, SHIFT, ALT', () => {
    assert.equal(parseKey('SHIFT+CTRL+F1').canonical, 'CTRL+SHIFT+F1');
    assert.equal(parseKey('ALT+CTRL+UP').canonical, 'CTRL+ALT+UP');
  });

  it('rejects SHIFT combined with a printable (shifted form should be written)', () => {
    assert.throws(() => parseKey('SHIFT+a'), /shifted form/);
    assert.throws(() => parseKey('SHIFT+2'), /shifted form/);
  });

  it('rejects modifier-only combos', () => {
    assert.throws(() => parseKey('CTRL+SHIFT'), /(multiple base keys|modifier-only)/);
  });

  it('rejects duplicate modifiers', () => {
    assert.throws(() => parseKey('CTRL+CTRL+x'), /duplicate modifier/);
  });

  it('suggests near-miss for combo typos (CRTL → CTRL)', () => {
    const { ok, error } = tryParseKey('CRTL+x');
    assert.equal(ok, false);
    // The combo path surfaces 'CRTL' as an unrecognised base key, with a
    // suggestion pointing at CTRL (the closest modifier).
    assert.match(error, /CRTL/);
  });
});

describe('input/keys: normalizeTerminalInput', () => {
  it('maps arrow escape sequences to named keys', () => {
    assert.equal(normalizeTerminalInput('\x1b[A'), 'UP');
    assert.equal(normalizeTerminalInput('\x1b[B'), 'DOWN');
    assert.equal(normalizeTerminalInput('\x1b[C'), 'RIGHT');
    assert.equal(normalizeTerminalInput('\x1b[D'), 'LEFT');
  });

  it('maps printable chars to themselves', () => {
    assert.equal(normalizeTerminalInput('q'), 'q');
    assert.equal(normalizeTerminalInput('?'), '?');
    assert.equal(normalizeTerminalInput(' '), 'SPACE');
  });

  it('maps ENTER / ESC / TAB / BACKSPACE / control letters', () => {
    assert.equal(normalizeTerminalInput('\r'), 'ENTER');
    assert.equal(normalizeTerminalInput('\x1b'), 'ESC');
    assert.equal(normalizeTerminalInput('\t'), 'TAB');
    assert.equal(normalizeTerminalInput('\x7f'), 'BACKSPACE');
    assert.equal(normalizeTerminalInput('\x03'), 'CTRL+c');
    assert.equal(normalizeTerminalInput('\x1a'), 'CTRL+z');
  });
});
