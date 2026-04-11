import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { parse as parseExpr, collectPaths, collectCalls, ExprSyntaxError } from '../expressions/parser.js';
import { EFFECT_TYPES } from '../runtime/effects.js';
import { BUILTIN_NAMES } from '../expressions/evaluator.js';

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
    };
    if (entry.tags != null) {
      if (!Array.isArray(entry.tags) || !entry.tags.every(t => typeof t === 'string')) {
        throw new SchemaError(`${path}.tags`, `must be an array of strings`);
      }
      item.tags = [...entry.tags];
    }
    return item;
  });
}

function validateMap(raw) {
  if (!raw || typeof raw !== 'object') {
    // Map is now optional — procedural dungeon generation can replace it
    return null;
  }
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
      if (ch !== '#' && ch !== '.') {
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
  const SCOPE_ROOTS = new Set(['self', 'actor', 'target', 'tile', 'state', 'player']);
  const paths = collectPaths(ast);
  for (const parts of paths) {
    if (parts.length === 0) continue;
    const root = parts[0];

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
          'equipped', 'level',
        ]);
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
  }

  if (type === 'pickup') {
    effect.target = raw.target || 'actor';
  }

  if (type === 'message') {
    effect.text = requireString(raw, 'text', path);
  }

  if (type === 'transition_level') {
    effect.delta = raw.delta ?? 1;
  }

  if (type === 'win' || type === 'lose') {
    if (raw.reason != null) effect.reason = String(raw.reason);
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
        trigger: requireString(entry, 'trigger', path),
        requires: [],
        effects: [],
      };
      if (entry.requires != null) {
        if (!Array.isArray(entry.requires)) {
          throw new SchemaError(`${path}.requires`, 'must be an array');
        }
        action.requires = entry.requires.map((expr, j) => {
          const ast = validateExpression(expr, `${path}.requires[${j}]`, context);
          return { source: expr, ast };
        });
      }
      action.effects = validateEffectsList(entry.effects, `${path}.effects`, context);
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

  const map = validateMap(raw.map);
  const actions = validateActions(raw.actions, context);
  const world = validateWorld(raw.world, context);
  const rendering = validateRendering(raw.rendering, context);

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
  const playerActionByTrigger = Object.create(null);
  for (const a of actions.player) playerActionByTrigger[a.trigger] = a;

  return {
    meta,
    measurements,
    beings,
    items,
    map,
    actions,
    world,
    rendering,
    _index: {
      measurements: measurementIndex,
      beings: beingIndex,
      items: itemIndex,
      playerActions: playerActionIndex,
      playerActionByTrigger,
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
