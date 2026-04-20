import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { parse as parseExpr, collectPaths, collectCalls, ExprSyntaxError } from '../expressions/parser.js';
import { EFFECT_TYPES } from '../runtime/effects.js';
import { BUILTIN_NAMES } from '../expressions/evaluator.js';
import { validateStep as validateFlowStep, collectFlowBindings, STEP_TYPES } from '../runtime/flow.js';
import { parseKey, tryParseKey, KeyParseError } from '../input/keys.js';
import { BUILTIN_BINDINGS, BUILTIN_ACTION_IDS, BUILTIN_CONTEXTS } from '../input/builtin-bindings.js';

/**
 * Validation error with key path and optional source line info.
 */
export class SchemaError extends Error {
  constructor(path, message, line) {
    const loc = line != null ? ` (line ${line})` : '';
    super(`${path}: ${message}${loc}`);
    this.name = 'SchemaError';
    this.path = path;
    this.line = line;
  }
}

const VALID_ITEM_KINDS = new Set(['consumable', 'equipment', 'currency', 'container']);

function requireString(obj, key, path) {
  if (obj[key] == null || typeof obj[key] !== 'string') {
    throw new SchemaError(`${path}.${key}`, `required string field missing or not a string`);
  }
  return obj[key];
}

function requireNumber(obj, key, path) {
  if (obj[key] == null || typeof obj[key] !== 'number') {
    throw new SchemaError(`${path}.${key}`, `required number field missing or not a number`);
  }
  return obj[key];
}

// ── Levenshtein for near-miss suggestions ────────────────────────────────

function levenshtein(a, b) {
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

function nearMiss(unknown, known) {
  for (const k of known) {
    if (levenshtein(unknown, k) <= 2) return k;
  }
  return null;
}

// ── Core section validators (from engine-bootstrap) ──────────────────────

function validateMeta(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new SchemaError('meta', 'required section missing');
  }
  return {
    id: requireString(raw, 'id', 'meta'),
    name: requireString(raw, 'name', 'meta'),
    version: requireString(raw, 'version', 'meta'),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    player_archetype: requireString(raw, 'player_archetype', 'meta'),
  };
}

function validateMeasurements(raw) {
  if (!Array.isArray(raw)) {
    throw new SchemaError('measurements', 'must be an array');
  }
  const ids = new Set();
  const measurements = raw.map((entry, i) => {
    const path = `measurements[${i}]`;
    const id = requireString(entry, 'id', path);
    if (ids.has(id)) {
      throw new SchemaError(`${path}.id`, `duplicate measurement id '${id}'`);
    }
    ids.add(id);
    const m = {
      id,
      label: requireString(entry, 'label', path),
      min: typeof entry.min === 'number' ? entry.min : 0,
      max: entry.max === undefined ? null : entry.max,
      initial: requireNumber(entry, 'initial', path),
    };
    if (entry.regen != null) {
      if (typeof entry.regen !== 'number') {
        throw new SchemaError(`${path}.regen`, `must be a number`);
      }
      m.regen = entry.regen;
    }
    if (m.max !== null && typeof m.max !== 'number' && typeof m.max !== 'string') {
      throw new SchemaError(`${path}.max`, `must be a number, a measurement id string, or null`);
    }
    return m;
  });
  return { measurements, ids };
}

function validateMeasurementCrossRefs(measurements, ids) {
  for (const m of measurements) {
    if (typeof m.max === 'string' && !ids.has(m.max)) {
      const known = [...ids].join(', ');
      throw new SchemaError(
        `measurements.${m.id}.max`,
        `unknown measurement '${m.max}' (known: ${known})`
      );
    }
  }
}

function validateBeings(raw, measurementIds) {
  if (!Array.isArray(raw)) {
    throw new SchemaError('beings', 'must be an array');
  }
  const ids = new Set();
  return raw.map((entry, i) => {
    const path = `beings[${i}]`;
    const id = requireString(entry, 'id', path);
    if (ids.has(id)) {
      throw new SchemaError(`${path}.id`, `duplicate being id '${id}'`);
    }
    ids.add(id);
    const being = {
      id,
      label: requireString(entry, 'label', path),
      glyph: requireString(entry, 'glyph', path),
      color: requireString(entry, 'color', path),
      measurements: {},
      tags: [],
    };
    if (entry.measurements != null) {
      if (typeof entry.measurements !== 'object' || Array.isArray(entry.measurements)) {
        throw new SchemaError(`${path}.measurements`, `must be an object`);
      }
      for (const [mId, val] of Object.entries(entry.measurements)) {
        if (!measurementIds.has(mId)) {
          const known = [...measurementIds].join(', ');
          throw new SchemaError(
            `${path}.measurements.${mId}`,
            `unknown measurement '${mId}' (known: ${known})`
          );
        }
        if (typeof val !== 'number') {
          throw new SchemaError(`${path}.measurements.${mId}`, `must be a number`);
        }
        being.measurements[mId] = val;
      }
    }
    if (entry.tags != null) {
      if (!Array.isArray(entry.tags) || !entry.tags.every(t => typeof t === 'string')) {
        throw new SchemaError(`${path}.tags`, `must be an array of strings`);
      }
      being.tags = [...entry.tags];
    }
    return being;
  });
}

function validateItems(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new SchemaError('items', 'must be an array');
  }
  const ids = new Set();
  return raw.map((entry, i) => {
    const path = `items[${i}]`;
    const id = requireString(entry, 'id', path);
    if (ids.has(id)) {
      throw new SchemaError(`${path}.id`, `duplicate item id '${id}'`);
    }
    ids.add(id);
    const kind = requireString(entry, 'kind', path);
    if (!VALID_ITEM_KINDS.has(kind)) {
      throw new SchemaError(
        `${path}.kind`,
        `invalid kind '${kind}' (valid: ${[...VALID_ITEM_KINDS].join(', ')})`
      );
    }
    const item = {
      id,
      label: requireString(entry, 'label', path),
      glyph: requireString(entry, 'glyph', path),
      color: requireString(entry, 'color', path),
      kind,
      tags: [],
      properties: {},
    };
    if (entry.tags != null) {
      if (!Array.isArray(entry.tags) || !entry.tags.every(t => typeof t === 'string')) {
        throw new SchemaError(`${path}.tags`, `must be an array of strings`);
      }
      item.tags = [...entry.tags];
    }
    if (entry.properties != null) {
      if (typeof entry.properties !== 'object' || Array.isArray(entry.properties)) {
        throw new SchemaError(`${path}.properties`, `must be an object`);
      }
      item.properties = { ...entry.properties };
    }
    return item;
  });
}

function validateMap(raw, extraTileChars) {
  if (!raw || typeof raw !== 'object') {
    // Map is now optional — procedural dungeon generation can replace it
    return null;
  }
  const allowed = new Set(['#', '.', '>', '<']);
  if (extraTileChars) for (const ch of extraTileChars) allowed.add(ch);
  const width = requireNumber(raw, 'width', 'map');
  const height = requireNumber(raw, 'height', 'map');
  if (!Array.isArray(raw.tiles)) {
    throw new SchemaError('map.tiles', 'must be an array of strings');
  }
  if (raw.tiles.length !== height) {
    throw new SchemaError('map.tiles', `expected ${height} rows, got ${raw.tiles.length}`);
  }
  let spawnCount = 0;
  let spawnX = -1;
  let spawnY = -1;
  const tiles = raw.tiles.map((row, y) => {
    if (typeof row !== 'string') {
      throw new SchemaError(`map.tiles[${y}]`, `must be a string`);
    }
    if (row.length !== width) {
      throw new SchemaError(`map.tiles[${y}]`, `expected width ${width}, got ${row.length}`);
    }
    return row.split('').map((ch, x) => {
      if (ch === '@') {
        spawnCount++;
        spawnX = x;
        spawnY = y;
        return '.';
      }
      if (!allowed.has(ch)) {
        throw new SchemaError(`map.tiles[${y}][${x}]`, `unknown tile character '${ch}'`);
      }
      return ch;
    });
  });
  if (spawnCount === 0) {
    throw new SchemaError('map', 'no player spawn (@) found');
  }
  if (spawnCount > 1) {
    throw new SchemaError('map', `expected exactly one player spawn (@), found ${spawnCount}`);
  }
  return { width, height, tiles, spawn: { x: spawnX, y: spawnY } };
}

// ── Expression validation ────────────────────────────────────────────────

/**
 * Validate an expression string — parse it, and check references.
 * context: { measurementIds, beingIds, itemIds, path }
 */
function validateExpression(exprStr, path, context) {
  if (typeof exprStr !== 'string') {
    throw new SchemaError(path, 'expression must be a string');
  }
  let ast;
  try {
    ast = parseExpr(exprStr);
  } catch (e) {
    if (e instanceof ExprSyntaxError) {
      throw new SchemaError(path, `failed to parse expression: ${e.message}`);
    }
    throw e;
  }

  // Validate references in the expression
  const { measurementIds, beingIds, itemIds } = context;
  const allKnownIds = new Set([...measurementIds, ...beingIds, ...itemIds]);

  // Validate function calls reference known built-ins or methods
  const calls = collectCalls(ast);
  for (const call of calls) {
    if (!call.name) continue;
    const parts = call.name.split('.');
    const funcName = parts[parts.length - 1];
    // Built-in functions
    if (parts.length === 1 && !BUILTIN_NAMES.has(funcName)) {
      throw new SchemaError(path, `unknown function '${funcName}'`);
    }
    // Method calls like actor.has_tag() are OK
    if (parts.length > 1 && funcName === 'has_tag') continue;
    // Other method calls — warn if function unknown
    if (parts.length > 1 && funcName !== 'has_tag' && !BUILTIN_NAMES.has(funcName)) {
      // It could be a method call on a resolved object — allow it at parse time
    }
  }

  // Validate path references
  const SCOPE_ROOTS = new Set([
    'self', 'actor', 'target', 'tile', 'state', 'player',
    'input', 'result', 'target_found',
    // Flow / comprehension local bindings:
    'item', 'being', 'row',
    // Binding helper aliases available in most scopes:
    'origin',
  ]);
  const paths = collectPaths(ast);
  const flowBindings = context.flowBindings || null;
  for (const parts of paths) {
    if (parts.length === 0) continue;
    const root = parts[0];

    // Binding references: $name
    if (root.startsWith('$')) {
      // Implicit bindings available in any flow context:
      //   $origin — the actor tile at flow start
      //   $actor — the actor entity performing the flow
      const IMPLICIT = new Set(['origin', 'actor', 'self', 'player']);
      const bindName = root.slice(1);
      if (IMPLICIT.has(bindName)) continue;
      if (flowBindings && !flowBindings.has(bindName)) {
        const known = [...flowBindings].map(n => '$' + n);
        const hint = known.length ? ` (bound in this flow: ${known.join(', ')})` : '';
        throw new SchemaError(path, `unknown binding '${root}'${hint}`);
      }
      // Outside of a flow, $bindings are rejected by the caller when
      // flowBindings is explicitly `null`. Tile hook scopes and similar
      // pass an empty set to permit "no bindings available" validation.
      if (!flowBindings) {
        throw new SchemaError(path, `binding references ('${root}') are only valid inside flow-enabled actions`);
      }
      continue;
    }

    // Skip if it's a builtin function name
    if (parts.length === 1 && BUILTIN_NAMES.has(root)) continue;
    // Skip known scope roots
    if (SCOPE_ROOTS.has(root)) {
      // If it's a measurement reference like actor.hp, validate the measurement
      if (parts.length >= 2 && SCOPE_ROOTS.has(parts[0])) {
        const field = parts[1];
        // Skip well-known fields
        const KNOWN_FIELDS = new Set([
          'x', 'y', 'name', 'label', 'glyph', 'color', 'kind',
          'tags', 'id', 'archetype', 'inventory', 'equipment',
          'equipped', 'level', 'equip_attack', 'equip_defense',
          'itemKind', 'properties', 'dir', 'dx', 'dy',
          'delta', 'value', 'bonus', 'stat', 'slot', 'moved',
          'ch', 'has_being', 'tile', 'turn', 'debug',
        ]);
        // Permit free access on comprehension / flow locals whose structure
        // varies by caller (item.kind, being.hp, row.name, tile.kind, etc.)
        const LOOSE_ROOTS = new Set(['item', 'being', 'row', 'tile']);
        if (LOOSE_ROOTS.has(root)) continue;
        if (!KNOWN_FIELDS.has(field) && !measurementIds.has(field)) {
          const suggestion = nearMiss(field, [...measurementIds, ...KNOWN_FIELDS]);
          const hint = suggestion ? ` (did you mean '${suggestion}'?)` : '';
          throw new SchemaError(
            path,
            `unknown path '${parts.join('.')}'${hint}`
          );
        }
      }
      continue;
    }
    // Single identifier that's not a scope root — unknown
    if (parts.length === 1 && !SCOPE_ROOTS.has(root)) {
      // Could be a local scope variable — allow it
    }
  }

  return ast;
}

/**
 * Validate `$name` references inside a message template string.
 * Templates use `{path}` placeholders (see handleMessage in effects.js).
 * When a placeholder root starts with `$`, enforce the same flowBindings
 * rules that validateExpression applies to expression fields — otherwise
 * misspelled binding names silently render as `'???'` at runtime.
 */
function validateMessageTemplate(text, path, context) {
  const flowBindings = context.flowBindings || null;
  const IMPLICIT = new Set(['origin', 'actor', 'self', 'player']);
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].trim().split('.');
    const root = parts[0];
    if (!root.startsWith('$')) continue;
    const bindName = root.slice(1);
    if (IMPLICIT.has(bindName)) continue;
    if (flowBindings && !flowBindings.has(bindName)) {
      const known = [...flowBindings].map(n => '$' + n);
      const hint = known.length ? ` (bound in this flow: ${known.join(', ')})` : '';
      throw new SchemaError(path, `unknown binding '${root}'${hint}`);
    }
    if (!flowBindings) {
      throw new SchemaError(path, `binding references ('${root}') are only valid inside flow-enabled actions`);
    }
  }
}

// ── Actions validation ───────────────────────────────────────────────────

function validateEffectObj(raw, path, context) {
  if (!raw || typeof raw !== 'object') {
    throw new SchemaError(path, 'effect must be an object');
  }
  const type = requireString(raw, 'type', path);
  if (!EFFECT_TYPES.has(type)) {
    throw new SchemaError(`${path}.type`, `unknown effect type '${type}' (known: ${[...EFFECT_TYPES].join(', ')})`);
  }

  const effect = { type };

  // Optional conditional gate on any effect
  if (raw.when != null) {
    const ast = validateExpression(raw.when, `${path}.when`, context);
    effect.when = { source: raw.when, ast };
  }

  // Validate type-specific fields
  if (type === 'apply' || type === 'set') {
    const target = raw.target || 'actor';
    if (typeof target !== 'string') {
      throw new SchemaError(`${path}.target`, 'must be a string');
    }
    effect.target = target;
    effect.measurement = requireString(raw, 'measurement', path);
    if (!context.measurementIds.has(effect.measurement)) {
      const suggestion = nearMiss(effect.measurement, [...context.measurementIds]);
      const hint = suggestion ? ` (did you mean '${suggestion}'?)` : '';
      throw new SchemaError(`${path}.measurement`, `unknown measurement '${effect.measurement}'${hint}`);
    }
    const valueField = type === 'apply' ? 'delta' : 'value';
    if (raw[valueField] != null) {
      if (typeof raw[valueField] === 'string') {
        validateExpression(raw[valueField], `${path}.${valueField}`, context);
      } else if (typeof raw[valueField] !== 'number') {
        throw new SchemaError(`${path}.${valueField}`, 'must be a number or expression string');
      }
      effect[valueField] = raw[valueField];
    } else {
      effect[valueField] = type === 'apply' ? 0 : 0;
    }
  }

  if (type === 'move') {
    if (raw.dir != null) {
      if (typeof raw.dir === 'string' && !['n', 's', 'e', 'w'].includes(raw.dir)) {
        // It might be an expression
        validateExpression(raw.dir, `${path}.dir`, context);
      }
      effect.dir = raw.dir;
    }
    effect.target = raw.target || 'actor';
  }

  if (type === 'spawn') {
    if (raw.being != null) {
      if (!context.beingIds.has(raw.being)) {
        throw new SchemaError(`${path}.being`, `unknown being '${raw.being}'`);
      }
      effect.being = raw.being;
    }
    if (raw.item != null) {
      if (!context.itemIds.has(raw.item)) {
        throw new SchemaError(`${path}.item`, `unknown item '${raw.item}'`);
      }
      effect.item = raw.item;
    }
    if (raw.x != null) effect.x = raw.x;
    if (raw.y != null) effect.y = raw.y;
  }

  if (type === 'remove') {
    effect.target = raw.target || 'target';
  }

  if (type === 'equip') {
    effect.target = raw.target || 'actor';
    if (raw.slot) effect.slot = raw.slot;
    if (raw.from_ground) effect.from_ground = true;
  }

  if (type === 'pickup') {
    effect.target = raw.target || 'actor';
  }

  if (type === 'consume') {
    effect.target = raw.target || 'actor';
    effect.item = requireString(raw, 'item', path);
    if (!context.itemIds.has(effect.item)) {
      throw new SchemaError(`${path}.item`, `unknown item '${effect.item}'`);
    }
  }

  if (type === 'message') {
    effect.text = requireString(raw, 'text', path);
    validateMessageTemplate(effect.text, `${path}.text`, context);
  }

  if (type === 'transition_level') {
    effect.delta = raw.delta ?? 1;
  }

  if (type === 'apply_area') {
    effect.measurement = requireString(raw, 'measurement', path);
    if (!context.measurementIds.has(effect.measurement)) {
      throw new SchemaError(`${path}.measurement`, `unknown measurement '${effect.measurement}'`);
    }
    if (raw.origin != null) {
      if (typeof raw.origin !== 'string') {
        throw new SchemaError(`${path}.origin`, 'origin must be an expression string');
      }
      validateExpression(raw.origin, `${path}.origin`, context);
      effect.origin = raw.origin;
    }
    if (raw.radius != null) {
      if (typeof raw.radius === 'string') {
        validateExpression(raw.radius, `${path}.radius`, context);
      } else if (typeof raw.radius !== 'number') {
        throw new SchemaError(`${path}.radius`, 'radius must be a number or expression string');
      }
      effect.radius = raw.radius;
    } else {
      effect.radius = 0;
    }
    if (raw.delta != null) {
      if (typeof raw.delta === 'string') {
        validateExpression(raw.delta, `${path}.delta`, context);
      } else if (typeof raw.delta !== 'number') {
        throw new SchemaError(`${path}.delta`, 'delta must be a number or expression string');
      }
      effect.delta = raw.delta;
    } else {
      effect.delta = 0;
    }
    if (raw.exclude_actor != null) effect.exclude_actor = !!raw.exclude_actor;
  }

  if (type === 'transform_tile') {
    effect.char = requireString(raw, 'char', path);
    if (raw.at != null) {
      if (typeof raw.at !== 'string') {
        throw new SchemaError(`${path}.at`, 'at must be an expression string');
      }
      validateExpression(raw.at, `${path}.at`, context);
      effect.at = raw.at;
    }
  }

  if (type === 'win' || type === 'lose') {
    if (raw.reason != null) effect.reason = String(raw.reason);
  }

  if (type === 'find_target') {
    if (raw.x != null) {
      if (typeof raw.x === 'string') validateExpression(raw.x, `${path}.x`, context);
      effect.x = raw.x;
    }
    if (raw.y != null) {
      if (typeof raw.y === 'string') validateExpression(raw.y, `${path}.y`, context);
      effect.y = raw.y;
    }
    effect.kind = raw.kind || 'being';
  }

  if (type === 'generate_level') {
    // No extra fields required — reads world.dungeon and world.spawn_rules
  }

  return effect;
}

function validateEffectsList(raw, path, context) {
  if (!Array.isArray(raw)) {
    throw new SchemaError(path, 'effects must be an array');
  }
  return raw.map((e, i) => validateEffectObj(e, `${path}[${i}]`, context));
}

function validateActions(raw, context) {
  if (raw == null) return { player: [], ai: [] };
  if (typeof raw !== 'object') {
    throw new SchemaError('actions', 'must be an object');
  }

  const actions = { player: [], ai: [] };

  // Player actions
  if (raw.player != null) {
    if (!Array.isArray(raw.player)) {
      throw new SchemaError('actions.player', 'must be an array');
    }
    actions.player = raw.player.map((entry, i) => {
      const path = `actions.player[${i}]`;
      if (!entry || typeof entry !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const action = {
        id: requireString(entry, 'id', path),
        // `trigger` may be omitted if a top-level `keymap` routes a key to this id.
        trigger: typeof entry.trigger === 'string' ? entry.trigger : null,
        label: typeof entry.label === 'string' ? entry.label : null,
        summary: typeof entry.summary === 'string' ? entry.summary : null,
        requires: [],
        effects: [],
        flow: null,
      };

      // Context-sensitive `when` expression — chooses among multiple actions
      // sharing the same trigger. Evaluated before the flow begins.
      if (entry.when != null) {
        const ast = validateExpression(entry.when, `${path}.when`, context);
        action.when = { source: entry.when, ast };
      }

      if (entry.requires != null) {
        if (!Array.isArray(entry.requires)) {
          throw new SchemaError(`${path}.requires`, 'must be an array');
        }
        action.requires = entry.requires.map((expr, j) => {
          const ast = validateExpression(expr, `${path}.requires[${j}]`, context);
          return { source: expr, ast };
        });
      }

      // Flow: ordered list of step descriptors. Collect declared bindings
      // and expose them when validating the action's `effects` so refs to
      // `$name` can be caught at load time.
      if (entry.flow != null) {
        if (!Array.isArray(entry.flow)) {
          throw new SchemaError(`${path}.flow`, 'must be an array');
        }
        const seenBindings = new Set();
        action.flow = entry.flow.map((step, j) => {
          const stepPath = `${path}.flow[${j}]`;
          const norm = validateFlowStep(step, stepPath, {
            ...context,
            SchemaError,
            validateExpression: (expr, p) => validateExpression(expr, p, {
              ...context,
              flowBindings: seenBindings,
            }),
          });
          if (norm.bind) {
            if (seenBindings.has(norm.bind)) {
              throw new SchemaError(`${stepPath}.bind`, `duplicate binding name '${norm.bind}' within flow`);
            }
            seenBindings.add(norm.bind);
          }
          return norm;
        });
      }

      // Effects: validate with flowBindings context if a flow is defined
      const effectsCtx = action.flow
        ? { ...context, flowBindings: collectFlowBindings(action.flow) }
        : context;
      action.effects = validateEffectsList(entry.effects, `${path}.effects`, effectsCtx);
      return action;
    });
  }

  // AI actions
  if (raw.ai != null) {
    if (!Array.isArray(raw.ai)) {
      throw new SchemaError('actions.ai', 'must be an array');
    }
    actions.ai = raw.ai.map((entry, i) => {
      const path = `actions.ai[${i}]`;
      if (!entry || typeof entry !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const action = {
        id: requireString(entry, 'id', path),
        effects: [],
      };
      if (entry.condition != null) {
        const ast = validateExpression(entry.condition, `${path}.condition`, context);
        action.condition = { source: entry.condition, ast };
      }
      action.effects = validateEffectsList(entry.effects, `${path}.effects`, context);
      return action;
    });
  }

  return actions;
}

// ── World validation ─────────────────────────────────────────────────────

function validateWorld(raw, context) {
  if (raw == null) return null;
  if (typeof raw !== 'object') {
    throw new SchemaError('world', 'must be an object');
  }

  const world = {};

  // Levels
  if (raw.levels != null) {
    if (typeof raw.levels === 'object' && !Array.isArray(raw.levels)) {
      world.levels = {
        count: typeof raw.levels.count === 'number' ? raw.levels.count : 1,
        overrides: {},
      };
      if (raw.levels.overrides != null && typeof raw.levels.overrides === 'object') {
        for (const [key, val] of Object.entries(raw.levels.overrides)) {
          world.levels.overrides[key] = val;
        }
      }
    } else if (Array.isArray(raw.levels)) {
      world.levels = { count: raw.levels.length, list: raw.levels };
    }
  }

  // Dungeon generation params
  if (raw.dungeon != null) {
    const d = raw.dungeon;
    const path = 'world.dungeon';
    world.dungeon = {
      width: typeof d.width === 'number' ? d.width : 80,
      height: typeof d.height === 'number' ? d.height : 40,
      room_count: d.room_count || [3, 7],
      room_size: d.room_size || [4, 10],
      corridor_style: d.corridor_style || 'straight',
      seed: d.seed ?? null,
    };
    if (!['straight', 'l_shaped'].includes(world.dungeon.corridor_style)) {
      throw new SchemaError(`${path}.corridor_style`, `must be 'straight' or 'l_shaped'`);
    }
  }

  // Spawn tables
  if (raw.spawn_tables != null) {
    if (typeof raw.spawn_tables !== 'object') {
      throw new SchemaError('world.spawn_tables', 'must be an object');
    }
    world.spawn_tables = {};
    for (const [level, table] of Object.entries(raw.spawn_tables)) {
      const path = `world.spawn_tables.${level}`;
      if (!Array.isArray(table)) {
        throw new SchemaError(path, 'must be an array');
      }
      world.spawn_tables[level] = table.map((entry, i) => {
        const ePath = `${path}[${i}]`;
        const result = {
          id: requireString(entry, 'id', ePath),
          weight: typeof entry.weight === 'number' ? entry.weight : 1,
        };
        // Validate that the id references a known being or item
        if (!context.beingIds.has(result.id) && !context.itemIds.has(result.id)) {
          throw new SchemaError(`${ePath}.id`, `unknown being or item '${result.id}'`);
        }
        if (entry.requires != null) {
          validateExpression(entry.requires, `${ePath}.requires`, context);
          result.requires = entry.requires;
        }
        if (entry.when != null) {
          const ast = validateExpression(entry.when, `${ePath}.when`, context);
          result.when = { source: entry.when, ast };
        }
        return result;
      });
    }
  }

  // Win conditions
  if (raw.win_conditions != null) {
    if (!Array.isArray(raw.win_conditions)) {
      throw new SchemaError('world.win_conditions', 'must be an array');
    }
    world.win_conditions = raw.win_conditions.map((expr, i) => {
      const ast = validateExpression(expr, `world.win_conditions[${i}]`, context);
      return { source: expr, ast };
    });
  }

  // Loss conditions
  if (raw.loss_conditions != null) {
    if (!Array.isArray(raw.loss_conditions)) {
      throw new SchemaError('world.loss_conditions', 'must be an array');
    }
    world.loss_conditions = raw.loss_conditions.map((expr, i) => {
      const ast = validateExpression(expr, `world.loss_conditions[${i}]`, context);
      return { source: expr, ast };
    });
  }

  // Spawn rules for level generation
  if (raw.spawn_rules != null) {
    if (!Array.isArray(raw.spawn_rules)) {
      throw new SchemaError('world.spawn_rules', 'must be an array');
    }
    world.spawn_rules = raw.spawn_rules.map((entry, i) => {
      const path = `world.spawn_rules[${i}]`;
      if (!entry || typeof entry !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const rule = {
        category: requireString(entry, 'category', path),
        mode: entry.mode || 'per_level',
      };
      if (entry.count != null) rule.count = entry.count;
      if (entry.when != null) rule.when = entry.when;
      return rule;
    });
  }

  // Starting state
  if (raw.starting_state != null) {
    const s = raw.starting_state;
    world.starting_state = {};
    if (s.level != null) world.starting_state.level = s.level;
    if (s.inventory != null) world.starting_state.inventory = s.inventory;
    if (s.measurements != null) world.starting_state.measurements = s.measurements;
  }

  return world;
}

// ── Rendering validation ─────────────────────────────────────────────────

function validateRendering(raw, context) {
  if (raw == null) return null;
  if (typeof raw !== 'object') {
    throw new SchemaError('rendering', 'must be an object');
  }

  const rendering = {};

  // Tiles
  if (raw.tiles != null) {
    if (typeof raw.tiles !== 'object') {
      throw new SchemaError('rendering.tiles', 'must be an object');
    }
    rendering.tiles = {};
    for (const [symbol, override] of Object.entries(raw.tiles)) {
      rendering.tiles[symbol] = {
        glyph: override.glyph || symbol,
        color: override.color || null,
      };
    }
  }

  // Beings
  if (raw.beings != null) {
    if (typeof raw.beings !== 'object') {
      throw new SchemaError('rendering.beings', 'must be an object');
    }
    rendering.beings = {};
    for (const [id, override] of Object.entries(raw.beings)) {
      if (!context.beingIds.has(id)) {
        throw new SchemaError(`rendering.beings.${id}`, `unknown being '${id}'`);
      }
      rendering.beings[id] = {
        glyph: override.glyph || null,
        color: override.color || null,
      };
    }
  }

  // Items
  if (raw.items != null) {
    if (typeof raw.items !== 'object') {
      throw new SchemaError('rendering.items', 'must be an object');
    }
    rendering.items = {};
    for (const [id, override] of Object.entries(raw.items)) {
      if (!context.itemIds.has(id)) {
        throw new SchemaError(`rendering.items.${id}`, `unknown item '${id}'`);
      }
      rendering.items[id] = {
        glyph: override.glyph || null,
        color: override.color || null,
      };
    }
  }

  // Status rules
  if (raw.status_rules != null) {
    if (!Array.isArray(raw.status_rules)) {
      throw new SchemaError('rendering.status_rules', 'must be an array');
    }
    rendering.status_rules = raw.status_rules.map((rule, i) => {
      const path = `rendering.status_rules[${i}]`;
      if (!rule || typeof rule !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const validated = {};
      if (rule.when != null) {
        const ast = validateExpression(rule.when, `${path}.when`, context);
        validated.when = { source: rule.when, ast };
      }
      if (rule.glyph_color) validated.glyph_color = rule.glyph_color;
      if (rule.glyph) validated.glyph = rule.glyph;
      return validated;
    });
  }

  // HUD
  if (raw.hud != null) {
    if (typeof raw.hud !== 'object') {
      throw new SchemaError('rendering.hud', 'must be an object');
    }
    rendering.hud = {};
    if (raw.hud.measurements != null) {
      if (!Array.isArray(raw.hud.measurements)) {
        throw new SchemaError('rendering.hud.measurements', 'must be an array');
      }
      rendering.hud.measurements = raw.hud.measurements.map((entry, i) => {
        if (typeof entry === 'string') {
          if (!context.measurementIds.has(entry)) {
            throw new SchemaError(`rendering.hud.measurements[${i}]`, `unknown measurement '${entry}'`);
          }
          return { id: entry };
        }
        if (typeof entry === 'object' && entry.id) {
          if (!context.measurementIds.has(entry.id)) {
            throw new SchemaError(`rendering.hud.measurements[${i}].id`, `unknown measurement '${entry.id}'`);
          }
          return entry;
        }
        throw new SchemaError(`rendering.hud.measurements[${i}]`, 'must be a string or object with id');
      });
    }
    if (raw.hud.message_log_size != null) {
      rendering.hud.message_log_size = raw.hud.message_log_size;
    }
  }

  return rendering;
}

// ── Tiles (interaction hooks + rendering) ────────────────────────────────

/**
 * Validate the top-level `tiles` section. Each entry is keyed by a tile
 * symbol (one character) and may declare:
 *   - kind: semantic name exposed as `actor.tile.kind`
 *   - glyph / color: rendering overrides
 *   - on_enter, on_stand, on_interact: effect lists
 */
function validateTiles(raw, context) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('tiles', 'must be an object');
  }
  const tiles = {};
  for (const [sym, cfg] of Object.entries(raw)) {
    const path = `tiles.${sym}`;
    if (!cfg || typeof cfg !== 'object') {
      throw new SchemaError(path, 'tile config must be an object');
    }
    const norm = {};
    if (cfg.kind != null) {
      if (typeof cfg.kind !== 'string') {
        throw new SchemaError(`${path}.kind`, 'must be a string');
      }
      norm.kind = cfg.kind;
    }
    if (cfg.glyph != null) norm.glyph = String(cfg.glyph);
    if (cfg.color != null) norm.color = String(cfg.color);
    for (const hook of ['on_enter', 'on_stand', 'on_interact']) {
      if (cfg[hook] != null) {
        // No $bindings in tile hooks — pass flowBindings: empty set to
        // fail any stray $refs.
        const hookCtx = { ...context, flowBindings: new Set() };
        norm[hook] = validateEffectsList(cfg[hook], `${path}.${hook}`, hookCtx);
      }
    }
    tiles[sym] = norm;
  }
  return tiles;
}

// ── Keymap ───────────────────────────────────────────────────────────────

function validateKeymap(raw, actions) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('keymap', 'must be an object');
  }
  const actionIds = new Set(actions.player.map(a => a.id));
  const triggers = new Set(actions.player.map(a => a.trigger).filter(Boolean));
  // Built-in actions that require no explicit definition:
  const BUILTINS = new Set(['interact', 'move_n', 'move_s', 'move_e', 'move_w', 'move', 'wait']);
  const map = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'string') {
      throw new SchemaError(`keymap.${key}`, 'must be a string (action id or trigger)');
    }
    if (!actionIds.has(val) && !triggers.has(val) && !BUILTINS.has(val)) {
      throw new SchemaError(
        `keymap.${key}`,
        `unknown action id or trigger '${val}' (known ids: ${[...actionIds].join(', ')}; triggers: ${[...triggers].join(', ')}; builtins: ${[...BUILTINS].join(', ')})`
      );
    }
    map[key] = val;
  }
  return map;
}

// ── Input bindings (criterion 1–9) ───────────────────────────────────────

const DEFAULT_SEQUENCE_TIMEOUT_MS = 750;

function normalizeBindingEntry(entry, path, knownActions, knownContexts, validateExpr) {
  if (!entry || typeof entry !== 'object') {
    throw new SchemaError(path, 'binding must be an object');
  }
  const { key, keys, sequence, action, context, when, label, disabled, overlaps_with } = entry;

  const forms = [key != null, keys != null, sequence != null].filter(Boolean).length;
  if (forms === 0) {
    throw new SchemaError(path, 'binding must declare exactly one of `key`, `keys`, or `sequence`');
  }
  if (forms > 1) {
    throw new SchemaError(path, 'binding must declare exactly one of `key`, `keys`, or `sequence` (got multiple)');
  }

  if (typeof action !== 'string' || action.length === 0) {
    throw new SchemaError(`${path}.action`, 'required string field missing');
  }
  if (!knownActions.has(action)) {
    const known = [...knownActions].slice(0, 20).join(', ');
    throw new SchemaError(
      `${path}.action`,
      `unknown action id '${action}' (known: ${known}${knownActions.size > 20 ? ', …' : ''})`
    );
  }

  const ctx = context == null ? 'map' : context;
  if (typeof ctx !== 'string') {
    throw new SchemaError(`${path}.context`, 'must be a string');
  }
  if (!knownContexts.has(ctx)) {
    throw new SchemaError(
      `${path}.context`,
      `unknown context id '${ctx}' (known: ${[...knownContexts].join(', ')})`
    );
  }

  const binding = {
    context: ctx,
    action,
    disabled: !!disabled,
    _source: 'game',
    _path: path,
  };
  if (overlaps_with != null) binding.overlaps_with = overlaps_with;
  if (typeof label === 'string') binding.label = label;

  if (when != null) {
    if (typeof when !== 'string') {
      throw new SchemaError(`${path}.when`, 'must be an expression string');
    }
    binding.when = when;
    binding.whenAst = validateExpr(when, `${path}.when`);
  }

  if (key != null) {
    if (typeof key !== 'string') {
      throw new SchemaError(`${path}.key`, 'must be a string');
    }
    try {
      const parsed = parseKey(key);
      binding.kind = 'key';
      binding.keys = [parsed.canonical];
    } catch (e) {
      if (e instanceof KeyParseError) {
        throw new SchemaError(`${path}.key`, e.message);
      }
      throw e;
    }
  } else if (keys != null) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new SchemaError(`${path}.keys`, 'must be a non-empty array of key names');
    }
    const parsedList = keys.map((k, i) => {
      if (typeof k !== 'string') {
        throw new SchemaError(`${path}.keys[${i}]`, 'must be a string');
      }
      try {
        return parseKey(k).canonical;
      } catch (e) {
        if (e instanceof KeyParseError) {
          throw new SchemaError(`${path}.keys[${i}]`, e.message);
        }
        throw e;
      }
    });
    binding.kind = 'key';
    binding.keys = parsedList;
  } else {
    // sequence
    if (!Array.isArray(sequence)) {
      throw new SchemaError(`${path}.sequence`, 'must be an array');
    }
    if (sequence.length < 2) {
      throw new SchemaError(`${path}.sequence`, 'sequence must contain at least two elements (use `key:` for single keys)');
    }
    const parsedSeq = sequence.map((k, i) => {
      if (typeof k !== 'string') {
        throw new SchemaError(`${path}.sequence[${i}]`, 'must be a string');
      }
      try {
        const parsed = parseKey(k);
        if (parsed.modifiers.length > 0) {
          throw new SchemaError(
            `${path}.sequence[${i}]`,
            `modifier combos (e.g. '${parsed.canonical}') may not appear inside sequences; use a single-key binding instead`,
          );
        }
        return parsed.canonical;
      } catch (e) {
        if (e instanceof SchemaError) throw e;
        if (e instanceof KeyParseError) {
          throw new SchemaError(`${path}.sequence[${i}]`, e.message);
        }
        throw e;
      }
    });
    binding.kind = 'sequence';
    binding.sequence = parsedSeq;
  }

  return binding;
}

function normalizeBuiltinBindings(knownActions, knownContexts) {
  const out = [];
  for (const b of BUILTIN_BINDINGS) {
    const targets = b.context === '*'
      ? [...BUILTIN_CONTEXTS]
      : [b.context];
    for (const ctx of targets) {
      const parsed = parseKey(b.key);
      out.push({
        kind: 'key',
        keys: [parsed.canonical],
        context: ctx,
        action: b.action,
        disabled: false,
        _source: 'builtin',
        _path: `<builtin:${b.action}:${b.key}:${ctx}>`,
      });
    }
  }
  return out;
}

/**
 * Validate and normalize the `input:` section, merging legacy `trigger:`
 * and `keymap:` forms and the engine's built-in bindings.
 */
function validateInput(raw, actions, keymap, context, warnings) {
  // Collect known action ids — game's player actions plus built-ins plus
  // anything keymap routes to (which may be plain triggers like 'move').
  const knownActions = new Set([
    ...actions.player.map(a => a.id),
    ...BUILTIN_ACTION_IDS,
  ]);
  // Accept action IDs bound via `trigger:` field — keymap / legacy flows
  // route through these.
  for (const a of actions.player) {
    if (a.trigger) knownActions.add(a.trigger);
  }
  if (keymap) {
    for (const val of Object.values(keymap)) knownActions.add(val);
  }

  // Known contexts: built-ins plus any declared custom contexts.
  const knownContexts = new Set(BUILTIN_CONTEXTS);
  const customContexts = [];
  const rawInput = raw && typeof raw === 'object' ? raw : {};

  if (rawInput.contexts != null) {
    if (!Array.isArray(rawInput.contexts)) {
      throw new SchemaError('input.contexts', 'must be an array');
    }
    for (let i = 0; i < rawInput.contexts.length; i++) {
      const entry = rawInput.contexts[i];
      const path = `input.contexts[${i}]`;
      if (!entry || typeof entry !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const id = requireString(entry, 'id', path);
      if (BUILTIN_CONTEXTS.has(id)) {
        throw new SchemaError(`${path}.id`, `'${id}' is a built-in context and cannot be redefined`);
      }
      if (knownContexts.has(id)) {
        throw new SchemaError(`${path}.id`, `duplicate context id '${id}'`);
      }
      knownContexts.add(id);
      const whenExpr = requireString(entry, 'when', path);
      const whenAst = validateExpression(whenExpr, `${path}.when`, context);
      customContexts.push({ id, when: whenExpr, whenAst });
    }
  }

  const gameBindings = [];
  const validateExpr = (expr, p) => validateExpression(expr, p, context);

  if (rawInput.bindings != null) {
    if (!Array.isArray(rawInput.bindings)) {
      throw new SchemaError('input.bindings', 'must be an array');
    }
    for (let i = 0; i < rawInput.bindings.length; i++) {
      const path = `input.bindings[${i}]`;
      const binding = normalizeBindingEntry(
        rawInput.bindings[i],
        path,
        knownActions,
        knownContexts,
        validateExpr,
      );
      gameBindings.push(binding);
    }
  }

  // Migrate legacy `trigger:` on actions.player.<id> — unless the game
  // already declared an explicit input.bindings entry for the same action.
  const legacyBindings = [];
  const explicitActions = new Set(gameBindings.map(b => b.action));
  for (const a of actions.player) {
    if (!a.trigger || typeof a.trigger !== 'string') continue;
    // Skip triggers that look like pseudo-names rather than key vocabulary.
    // E.g. "attack", "move", "wait" are dispatch triggers, not physical keys.
    const parsed = tryParseKey(a.trigger);
    if (!parsed.ok) continue;
    if (explicitActions.has(a.id)) {
      warnings.push(
        `actions.player.${a.id}: both 'trigger' and an explicit input.bindings entry target this action; trigger is ignored.`
      );
      continue;
    }
    legacyBindings.push({
      kind: 'key',
      keys: [parsed.canonical],
      context: 'map',
      action: a.id,
      disabled: false,
      _source: 'trigger',
      _path: `actions.player.${a.id}.trigger`,
    });
  }

  // Migrate legacy `keymap:` — if no explicit input.bindings entry targets
  // the same action for the same key.
  if (keymap) {
    for (const [rawKey, val] of Object.entries(keymap)) {
      const parsed = tryParseKey(rawKey);
      if (!parsed.ok) {
        // Leave unparseable keymap keys alone — legacy keymap never validated them
        // through the key vocabulary, and the test suite relies on passing through
        // entries like 'q' unchanged. tryParseKey returning !ok is impossible for
        // single-char printables, so this branch only triggers for exotic entries.
        continue;
      }
      // Skip if the same key+action already exists in game bindings
      const dup = gameBindings.some(
        b => b.context === 'map' && b.kind === 'key'
          && b.keys.includes(parsed.canonical)
          && (b.action === val),
      );
      if (dup) continue;
      legacyBindings.push({
        kind: 'key',
        keys: [parsed.canonical],
        context: 'map',
        action: val,
        disabled: false,
        _source: 'keymap',
        _path: `keymap.${rawKey}`,
      });
    }
  }

  const builtinBindings = normalizeBuiltinBindings(knownActions, knownContexts);

  // Detect duplicates within each context — identical key / sequence.
  // Load-time error when both entries are unguarded; warning when one has a
  // `when` that the validator cannot prove mutually exclusive.
  detectBindingConflicts(gameBindings, warnings);

  // Merge: game entries first (so they win first-match), then legacy
  // trigger/keymap entries, then built-ins at the tail.
  const merged = [...gameBindings, ...legacyBindings, ...builtinBindings];

  // Validate help section (criterion 1, 7, 8)
  const helpCfg = validateHelp(rawInput.help, actions, merged);

  const sequenceTimeoutMs = (() => {
    const v = rawInput.sequence_timeout_ms;
    if (v == null) return DEFAULT_SEQUENCE_TIMEOUT_MS;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new SchemaError('input.sequence_timeout_ms', 'must be a positive number');
    }
    return v;
  })();

  return {
    bindings: merged,
    contexts: customContexts,
    help: helpCfg,
    sequence_timeout_ms: sequenceTimeoutMs,
  };
}

function detectBindingConflicts(gameBindings, warnings) {
  // Group by (context, kind, signature)
  const groups = new Map();
  for (const b of gameBindings) {
    const sig = b.kind === 'sequence'
      ? `seq:${b.sequence.join(',')}`
      : `key:${b.keys.join('|')}`;
    const groupKey = `${b.context}::${sig}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(b);
  }
  for (const [groupKey, list] of groups) {
    if (list.length < 2) continue;
    const unguarded = list.filter(b => !b.when && !b.overlaps_with);
    if (unguarded.length > 1) {
      const paths = list.map(b => b._path).join(' and ');
      throw new SchemaError(
        list[list.length - 1]._path,
        `duplicate binding in context '${list[0].context}' for ${groupKey.split('::')[1]} — collides with ${paths}; add a distinguishing 'when' or different action`,
      );
    }
    // Non-trivial `when` present — warn (can't prove mutually exclusive).
    const acknowledged = list.some(b => b.overlaps_with);
    if (!acknowledged) {
      warnings.push(
        `input.bindings: overlapping bindings in context '${list[0].context}' for ${groupKey.split('::')[1]} (${list.map(b => b._path).join(', ')}). Add an 'overlaps_with' field on the later entry to acknowledge the overlap.`
      );
    }
  }
}

function validateHelp(raw, actions, bindings) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('input.help', 'must be an object');
  }
  const help = {};
  if (raw.title != null) {
    if (typeof raw.title !== 'string') {
      throw new SchemaError('input.help.title', 'must be a string');
    }
    help.title = raw.title;
  }
  const actionIds = new Set([
    ...actions.player.map(a => a.id),
    ...BUILTIN_ACTION_IDS,
  ]);
  const boundActions = new Set(bindings.map(b => b.action));

  if (raw.sections != null) {
    if (!Array.isArray(raw.sections)) {
      throw new SchemaError('input.help.sections', 'must be an array');
    }
    help.sections = raw.sections.map((sec, i) => {
      const path = `input.help.sections[${i}]`;
      if (!sec || typeof sec !== 'object') {
        throw new SchemaError(path, 'must be an object');
      }
      const header = typeof sec.header === 'string' ? sec.header : '';
      const actionsList = sec.actions;
      if (!Array.isArray(actionsList)) {
        throw new SchemaError(`${path}.actions`, 'must be an array of action ids');
      }
      for (let j = 0; j < actionsList.length; j++) {
        const aId = actionsList[j];
        if (typeof aId !== 'string') {
          throw new SchemaError(`${path}.actions[${j}]`, 'must be a string');
        }
        if (!actionIds.has(aId)) {
          throw new SchemaError(
            `${path}.actions[${j}]`,
            `unknown action id '${aId}'`,
          );
        }
      }
      return { header, actions: [...actionsList] };
    });
  }
  if (raw.hide != null) {
    if (!Array.isArray(raw.hide)) {
      throw new SchemaError('input.help.hide', 'must be an array');
    }
    help.hide = raw.hide.map((aId, i) => {
      const path = `input.help.hide[${i}]`;
      if (typeof aId !== 'string') {
        throw new SchemaError(path, 'must be a string');
      }
      if (!actionIds.has(aId)) {
        throw new SchemaError(path, `unknown action id '${aId}'`);
      }
      if (!boundActions.has(aId)) {
        throw new SchemaError(
          path,
          `action '${aId}' has no binding — nothing to hide`,
        );
      }
      return aId;
    });
  }
  return help;
}

// ── UI (panels / prompts / hud) ──────────────────────────────────────────

function validateUiPrompts(raw, context) {
  if (raw == null) return { ids: new Set(), map: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('ui.prompts', 'must be an object');
  }
  const ids = new Set();
  const map = {};
  for (const [id, cfg] of Object.entries(raw)) {
    const path = `ui.prompts.${id}`;
    if (!cfg || typeof cfg !== 'object') {
      throw new SchemaError(path, 'prompt config must be an object');
    }
    ids.add(id);
    map[id] = {
      id,
      title: typeof cfg.title === 'string' ? cfg.title : null,
      message: typeof cfg.message === 'string' ? cfg.message : null,
    };
  }
  return { ids, map };
}

function validateUiPanels(raw, context) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('ui.panels', 'must be an object');
  }
  const panels = {};
  const actionIds = new Set((context.actions || []).map(a => a.id));
  for (const [id, cfg] of Object.entries(raw)) {
    const path = `ui.panels.${id}`;
    if (!cfg || typeof cfg !== 'object') {
      throw new SchemaError(path, 'panel config must be an object');
    }
    const panel = { id };
    if (cfg.open_on != null) {
      if (Array.isArray(cfg.open_on)) {
        panel.open_on = cfg.open_on.map(String);
      } else if (typeof cfg.open_on === 'string') {
        panel.open_on = [cfg.open_on];
      } else {
        throw new SchemaError(`${path}.open_on`, 'must be a string or array of strings');
      }
    }
    if (cfg.title != null) panel.title = String(cfg.title);
    if (cfg.data != null) {
      if (typeof cfg.data !== 'string') {
        throw new SchemaError(`${path}.data`, 'data must be an expression string');
      }
      panel.dataAst = validateExpression(cfg.data, `${path}.data`, context);
      panel.data = cfg.data;
    }
    if (cfg.columns != null) {
      if (!Array.isArray(cfg.columns)) {
        throw new SchemaError(`${path}.columns`, 'must be an array');
      }
      panel.columns = cfg.columns.map((col, i) => {
        const colPath = `${path}.columns[${i}]`;
        if (!col || typeof col !== 'object') {
          throw new SchemaError(colPath, 'column must be an object');
        }
        const header = typeof col.header === 'string' ? col.header : '';
        if (typeof col.field !== 'string') {
          throw new SchemaError(`${colPath}.field`, 'field must be an expression string');
        }
        const fieldAst = validateExpression(col.field, `${colPath}.field`, context);
        return { header, field: col.field, fieldAst };
      });
    }
    if (cfg.on_select != null) {
      if (typeof cfg.on_select === 'string') {
        // Reference to an action id
        if (!actionIds.has(cfg.on_select)) {
          throw new SchemaError(
            `${path}.on_select`,
            `unknown action id '${cfg.on_select}' (known: ${[...actionIds].join(', ')})`
          );
        }
        panel.on_select = { actionId: cfg.on_select };
      } else if (Array.isArray(cfg.on_select)) {
        const effects = validateEffectsList(cfg.on_select, `${path}.on_select`, {
          ...context, flowBindings: new Set(['selected_row']),
        });
        panel.on_select = { effects };
      } else {
        throw new SchemaError(`${path}.on_select`, 'must be an action id string or effects list');
      }
    }
    panels[id] = panel;
  }
  return panels;
}

function validateUiHud(raw, _context) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError('ui.hud', 'must be an object');
  }
  const hud = {};
  if (raw.target_indicator != null) {
    if (typeof raw.target_indicator === 'object') {
      hud.target_indicator = {
        glyph: typeof raw.target_indicator.glyph === 'string' ? raw.target_indicator.glyph : '*',
        color: typeof raw.target_indicator.color === 'string' ? raw.target_indicator.color : 'yellow',
      };
    } else {
      hud.target_indicator = { glyph: '*', color: 'yellow' };
    }
  }
  if (raw.prompt_banner != null) {
    const pos = typeof raw.prompt_banner === 'object' && raw.prompt_banner.position
      ? raw.prompt_banner.position
      : 'bottom';
    if (pos !== 'top' && pos !== 'bottom') {
      throw new SchemaError('ui.hud.prompt_banner.position', `must be 'top' or 'bottom'`);
    }
    hud.prompt_banner = { position: pos };
  }
  return hud;
}

// ── Duplicate-trigger ambiguity warning ──────────────────────────────────

function detectDuplicateTriggers(playerActionsByTrigger, warnings) {
  for (const [trigger, list] of Object.entries(playerActionsByTrigger)) {
    if (!list || list.length < 2) continue;
    const unguarded = list.filter(a => !a.when);
    // Ambiguous if more than one has no `when`, or if all have no `when`.
    if (unguarded.length > 1) {
      warnings.push(
        `actions: duplicate trigger '${trigger}' with ${unguarded.length} unguarded actions (${unguarded.map(a => a.id).join(', ')}). ` +
        `Add 'when' expressions to disambiguate.`
      );
    }
  }
}

// ── Main loader ──────────────────────────────────────────────────────────

/**
 * Parse and validate a YAML game definition string.
 * Returns a normalized GameDefinition object.
 */
export function loadFromString(yamlString) {
  const raw = YAML.parse(yamlString);
  if (!raw || typeof raw !== 'object') {
    throw new SchemaError('root', 'YAML must parse to an object');
  }

  const meta = validateMeta(raw.meta);
  const { measurements, ids: measurementIds } = validateMeasurements(raw.measurements);
  validateMeasurementCrossRefs(measurements, measurementIds);
  const beings = validateBeings(raw.beings, measurementIds);
  const items = validateItems(raw.items);

  // Validate player_archetype reference
  const beingIds = new Set(beings.map(b => b.id));
  if (!beingIds.has(meta.player_archetype)) {
    const known = [...beingIds].join(', ');
    throw new SchemaError(
      'meta.player_archetype',
      `unknown being '${meta.player_archetype}' (known: ${known})`
    );
  }

  const itemIds = new Set(items.map(it => it.id));

  // Build validation context for expressions and cross-refs
  const context = { measurementIds, beingIds, itemIds };

  // Tiles: per-symbol config with optional on_enter/on_stand/on_interact hooks.
  // Validated before actions so the actions pass can know which tile kinds
  // exist for `on_interact` desugaring; and before the map so custom tile
  // symbols declared here are permitted in `map.tiles`.
  const tiles = validateTiles(raw.tiles, context);

  const map = validateMap(raw.map, tiles ? Object.keys(tiles) : null);

  // Prompts come before actions so flow steps can reference them by id.
  const uiPrompts = validateUiPrompts(raw.ui?.prompts, context);

  const actionsContext = { ...context, promptIds: uiPrompts.ids };
  const actions = validateActions(raw.actions, actionsContext);

  // Keymap: optional top-level `{ key: action_id }` routing
  const keymap = validateKeymap(raw.keymap, actions);

  const warnings = [];

  // Warn if any on_interact tile has no keymap / input.bindings entry for `interact`.
  // (Run this check after validateInput so input.bindings is populated.)

  const world = validateWorld(raw.world, context);
  const rendering = validateRendering(raw.rendering, context);

  // Input section — validated after actions + keymap so it can cross-check
  // action ids and absorb the legacy `trigger:` / `keymap:` forms. The
  // returned `input` carries the merged binding list (game + legacy +
  // built-ins) and any custom contexts.
  const input = validateInput(raw.input, actions, keymap, context, warnings);

  // Warn if any on_interact tile has no binding for `interact`.
  if (tiles && Object.values(tiles).some(t => t.on_interact && t.on_interact.length > 0)) {
    const hasInteractBinding = input.bindings.some(b => b.action === 'interact' && !b.disabled)
      || actions.player.some(a => a.trigger === 'interact' || a.id === 'interact');
    if (!hasInteractBinding) {
      warnings.push(
        `tiles: on_interact hooks defined but no key is bound to 'interact' — these hooks are unreachable.`
      );
    }
  }

  // UI panels: validated after actions so on_select can reference them.
  const ui = {
    panels: validateUiPanels(raw.ui?.panels, { ...context, actions: actions.player }),
    prompts: uiPrompts.map,
    hud: validateUiHud(raw.ui?.hud, context),
  };

  // Build lookup tables
  const measurementIndex = Object.create(null);
  for (const m of measurements) measurementIndex[m.id] = m;
  const beingIndex = Object.create(null);
  for (const b of beings) beingIndex[b.id] = b;
  const itemIndex = Object.create(null);
  for (const it of items) itemIndex[it.id] = it;

  // Build action index
  const playerActionIndex = Object.create(null);
  for (const a of actions.player) playerActionIndex[a.id] = a;
  // First-match-wins index: first action to declare a trigger. Kept for
  // back-compat with callers that expect a single action per key.
  const playerActionByTrigger = Object.create(null);
  // Grouped index: all actions bound to the same trigger (for first-match-
  // via-`when` resolution).
  const playerActionsByTrigger = Object.create(null);
  for (const a of actions.player) {
    const triggers = [];
    // The action's own id is always a valid dispatch trigger. This lets
    // callers that hold an action id (e.g. the CLI translating a resolved
    // binding) dispatch without needing to know the legacy `trigger:` string.
    triggers.push(a.id);
    if (a.trigger && a.trigger !== a.id) triggers.push(a.trigger);
    // Keymap-based triggers: any key whose value matches this action's id
    // OR trigger. Both forms are accepted so authors can migrate gradually.
    if (keymap) {
      for (const [k, val] of Object.entries(keymap)) {
        if ((val === a.id || val === a.trigger) && !triggers.includes(k)) {
          triggers.push(k);
        }
      }
    }
    // input.bindings-based triggers: any binding whose `action` matches the
    // action's id or trigger contributes its key(s) to the trigger index so
    // dispatches continue to work by key name (legacy behaviour).
    for (const b of input.bindings || []) {
      if (b.kind !== 'key') continue;
      if (b.context !== 'map') continue;
      if (b.action !== a.id && b.action !== a.trigger) continue;
      for (const k of b.keys) {
        if (!triggers.includes(k)) triggers.push(k);
      }
    }
    for (const t of triggers) {
      if (!(t in playerActionByTrigger)) playerActionByTrigger[t] = a;
      if (!playerActionsByTrigger[t]) playerActionsByTrigger[t] = [];
      playerActionsByTrigger[t].push(a);
    }
  }

  // Detect duplicate-trigger ambiguity across player actions (warning).
  // Uses the resolved trigger index so keymap-routed bindings are included.
  detectDuplicateTriggers(playerActionsByTrigger, warnings);

  return {
    meta,
    measurements,
    beings,
    items,
    map,
    tiles,
    actions,
    world,
    rendering,
    ui,
    keymap,
    input,
    warnings,
    _index: {
      measurements: measurementIndex,
      beings: beingIndex,
      items: itemIndex,
      playerActions: playerActionIndex,
      playerActionByTrigger,
      playerActionsByTrigger,
    },
  };
}

/**
 * Load a game definition from a YAML file path.
 */
export async function loadFromFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return loadFromString(content);
}
