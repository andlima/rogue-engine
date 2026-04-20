/**
 * Key-name vocabulary for input bindings.
 *
 * Renderers translate their native events into vocabulary names (e.g.
 * `'\x1b[A'` → `'UP'`) before calling the resolver. Bindings and
 * sequences reference only these vocabulary strings.
 */

export const NAMED_KEYS = new Set([
  'UP', 'DOWN', 'LEFT', 'RIGHT',
  'SPACE', 'ENTER', 'ESC', 'TAB',
  'BACKSPACE', 'DELETE',
  'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'INSERT',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export const MODIFIERS = ['CTRL', 'SHIFT', 'ALT'];
const MODIFIER_SET = new Set(MODIFIERS);

/**
 * Levenshtein distance for near-miss suggestions.
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

export function suggestKey(unknown) {
  let best = null;
  let bestDist = 3;
  const pool = [...NAMED_KEYS, ...MODIFIERS];
  for (const k of pool) {
    const d = levenshtein(unknown.toUpperCase(), k);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return best;
}

/**
 * Parse a single key-name string (e.g. "q", "ESC", "CTRL+c", "CTRL+SHIFT+x").
 * Returns a normalized descriptor or throws KeyParseError.
 */
export class KeyParseError extends Error {
  constructor(message, input, suggestion) {
    super(message);
    this.name = 'KeyParseError';
    this.input = input;
    this.suggestion = suggestion;
  }
}

/**
 * Parse a key-name string into a normalized descriptor.
 *
 * @param {string} s
 * @returns {{ modifiers: string[], key: string, canonical: string }}
 */
export function parseKey(s) {
  if (typeof s !== 'string' || s.length === 0) {
    throw new KeyParseError(`empty key name`, s);
  }
  const raw = s;

  // Single-character printable? (No '+' handling needed.)
  if (s.length === 1) {
    // Normalize literal space to the named form so events and bindings agree.
    if (s === ' ') {
      return { modifiers: [], key: 'SPACE', canonical: 'SPACE' };
    }
    return { modifiers: [], key: s, canonical: s };
  }

  // Named key? (Uppercase token without '+')
  if (!s.includes('+')) {
    if (NAMED_KEYS.has(s)) {
      return { modifiers: [], key: s, canonical: s };
    }
    if (MODIFIER_SET.has(s)) {
      throw new KeyParseError(
        `modifier-only key '${s}' is not allowed; combine with a base key (e.g. '${s}+c')`,
        raw,
      );
    }
    const suggestion = suggestKey(s);
    throw new KeyParseError(
      `unknown key name '${s}'${suggestion ? ` (did you mean '${suggestion}'?)` : ''}`,
      raw,
      suggestion,
    );
  }

  // Modifier combo — parse parts
  const parts = s.split('+');
  if (parts.some(p => p === '')) {
    throw new KeyParseError(`invalid key '${raw}' — empty segment`, raw);
  }
  const modifiers = [];
  const baseParts = [];
  for (const p of parts) {
    if (MODIFIER_SET.has(p)) {
      if (modifiers.includes(p)) {
        throw new KeyParseError(`duplicate modifier '${p}' in '${raw}'`, raw);
      }
      modifiers.push(p);
    } else {
      baseParts.push(p);
    }
  }
  if (baseParts.length === 0) {
    throw new KeyParseError(`modifier-only key '${raw}' is not allowed`, raw);
  }
  if (baseParts.length > 1) {
    throw new KeyParseError(`invalid key '${raw}' — multiple base keys`, raw);
  }
  const base = baseParts[0];
  // Validate base: one printable char OR a named key
  if (base.length !== 1 && !NAMED_KEYS.has(base)) {
    const suggestion = suggestKey(base);
    throw new KeyParseError(
      `unknown key name '${base}' in '${raw}'${suggestion ? ` (did you mean '${suggestion}'?)` : ''}`,
      raw,
      suggestion,
    );
  }
  // SHIFT combined with a printable is disallowed — author should write the shifted form
  if (modifiers.includes('SHIFT') && base.length === 1) {
    throw new KeyParseError(
      `SHIFT combined with a printable character '${base}' — write the shifted form directly (e.g. 'A' instead of 'SHIFT+a')`,
      raw,
    );
  }
  // Canonicalize modifier order: CTRL, SHIFT, ALT
  const canonicalModifiers = MODIFIERS.filter(m => modifiers.includes(m));
  const canonical = [...canonicalModifiers, base].join('+');
  return { modifiers: canonicalModifiers, key: base, canonical };
}

/**
 * Validate a key name without producing an error object. Returns a
 * `{ ok, canonical, error, suggestion }` result.
 */
export function tryParseKey(s) {
  try {
    const k = parseKey(s);
    return { ok: true, canonical: k.canonical, descriptor: k };
  } catch (e) {
    if (e instanceof KeyParseError) {
      return { ok: false, error: e.message, suggestion: e.suggestion };
    }
    throw e;
  }
}

/**
 * Normalize raw terminal input (or a synthetic event) into a vocabulary key.
 * Renderers use this to translate their native events before feeding the
 * resolver. Returns `null` if the input isn't mappable.
 */
export function normalizeTerminalInput(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  switch (raw) {
    case '\x1b[A': return 'UP';
    case '\x1b[B': return 'DOWN';
    case '\x1b[C': return 'RIGHT';
    case '\x1b[D': return 'LEFT';
    case '\x1b':   return 'ESC';
    case '\r':     return 'ENTER';
    case '\n':     return 'ENTER';
    case '\t':     return 'TAB';
    case ' ':      return 'SPACE';
    case '\x7f':   return 'BACKSPACE';
    case '\x08':   return 'BACKSPACE';
    case '\x03':   return 'CTRL+c';
    case '\x04':   return 'CTRL+d';
    case '\x1a':   return 'CTRL+z';
  }
  // Single printable character
  if (raw.length === 1) {
    const code = raw.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) return raw;
    // Control character in the range 0x01..0x1a maps to CTRL+<letter>
    if (code >= 0x01 && code <= 0x1a) {
      return 'CTRL+' + String.fromCharCode(code + 0x60);
    }
  }
  return null;
}
