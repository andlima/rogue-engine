import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

/**
 * Validation error with key path and optional source line info.
 */
class SchemaError extends Error {
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
    // Validate max field type
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

function validateMap(raw, beingIds) {
  if (!raw || typeof raw !== 'object') {
    throw new SchemaError('map', 'required section missing');
  }
  const width = requireNumber(raw, 'width', 'map');
  const height = requireNumber(raw, 'height', 'map');
  if (!Array.isArray(raw.tiles)) {
    throw new SchemaError('map.tiles', 'must be an array of strings');
  }
  if (raw.tiles.length !== height) {
    throw new SchemaError(
      'map.tiles',
      `expected ${height} rows, got ${raw.tiles.length}`
    );
  }
  let spawnCount = 0;
  let spawnX = -1;
  let spawnY = -1;
  const tiles = raw.tiles.map((row, y) => {
    if (typeof row !== 'string') {
      throw new SchemaError(`map.tiles[${y}]`, `must be a string`);
    }
    if (row.length !== width) {
      throw new SchemaError(
        `map.tiles[${y}]`,
        `expected width ${width}, got ${row.length}`
      );
    }
    return row.split('').map((ch, x) => {
      if (ch === '@') {
        spawnCount++;
        spawnX = x;
        spawnY = y;
        return '.'; // spawn point is a floor tile
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

  const map = validateMap(raw.map, beingIds);

  // Build lookup tables
  const measurementIndex = Object.create(null);
  for (const m of measurements) measurementIndex[m.id] = m;
  const beingIndex = Object.create(null);
  for (const b of beings) beingIndex[b.id] = b;
  const itemIndex = Object.create(null);
  for (const it of items) itemIndex[it.id] = it;

  return {
    meta,
    measurements,
    beings,
    items,
    map,
    _index: {
      measurements: measurementIndex,
      beings: beingIndex,
      items: itemIndex,
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
