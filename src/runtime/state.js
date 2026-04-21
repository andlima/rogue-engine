import { createRng } from './rng.js';
import { generateDungeon } from './dungeon.js';
import { randomInt, weightedPick } from './rng.js';
import { parse } from '../expressions/parser.js';
import { evaluate } from '../expressions/evaluator.js';

/**
 * Create an initial GameState from a validated GameDefinition.
 *
 * State shape:
 *   {
 *     definition,        // read-only config
 *     turn: number,      // 0-indexed turn counter
 *     level: number,     // current dungeon level (1-based)
 *     player: { x, y, archetype, measurements, inventory, equipment, tags },
 *     entities: Array,   // NPCs, monsters, items on the ground
 *     messages: Array,   // message log
 *     rng: () => number, // seeded PRNG
 *     map: object|null,  // generated map (overrides definition.map)
 *     terminal: null | 'win' | 'lose',
 *     terminalReason: string | null,
 *   }
 */
export function createState(definition, seed) {
  const { meta, measurements, map, _index, world } = definition;
  const playerArchetype = _index.beings[meta.player_archetype];

  // Initialize player measurements from definition defaults + archetype overrides
  const playerMeasurements = Object.create(null);
  for (const m of measurements) {
    playerMeasurements[m.id] =
      playerArchetype.measurements[m.id] != null
        ? playerArchetype.measurements[m.id]
        : m.initial;
  }

  // Apply starting_state measurement overrides if present
  if (world?.starting_state?.measurements) {
    for (const [mId, val] of Object.entries(world.starting_state.measurements)) {
      if (mId in playerMeasurements) {
        playerMeasurements[mId] = val;
      }
    }
  }

  const rngSeed = seed ?? world?.dungeon?.seed ?? 42;
  const rng = createRng(rngSeed);
  const startLevel = world?.starting_state?.level ?? 1;

  // Generate dungeon if configured and no static map provided
  let generatedMap = null;
  let entities = [];
  let spawnX, spawnY;

  if (!map && world?.dungeon) {
    generatedMap = generateDungeon(rng, world.dungeon);
    spawnX = generatedMap.spawn.x;
    spawnY = generatedMap.spawn.y;

    // Spawn entities from spawn rules
    if (world.spawn_rules && world.spawn_tables) {
      entities = spawnLevelEntities(rng, generatedMap, startLevel, world, definition);
    }
  } else {
    spawnX = map ? map.spawn.x : 0;
    spawnY = map ? map.spawn.y : 0;
  }

  const player = {
    x: spawnX,
    y: spawnY,
    archetype: meta.player_archetype,
    measurements: playerMeasurements,
    tags: playerArchetype.tags ? [...playerArchetype.tags] : [],
    inventory: [],
    equipment: Object.create(null),
    name: playerArchetype.label,
    label: playerArchetype.label,
  };

  const displayMode = definition.rendering?.default_display_mode ?? 'ascii';

  return {
    definition,
    turn: 0,
    level: startLevel,
    player,
    entities,
    messages: [],
    rng,
    map: generatedMap,
    terminal: null,
    terminalReason: null,
    flowState: null,
    displayMode,
  };
}

/**
 * Spawn entities for a level based on spawn_rules and spawn_tables.
 */
function spawnLevelEntities(rng, map, level, world, definition) {
  const entities = [];
  const evalScope = { state: { level, turn: 0 }, player: { x: map.spawn.x, y: map.spawn.y } };
  const evalOpts = { rng, state: { map, definition } };

  for (const rule of world.spawn_rules) {
    // Check condition
    if (rule.when) {
      const ast = parse(rule.when);
      if (!evaluate(ast, evalScope, evalOpts)) continue;
    }

    const table = world.spawn_tables[rule.category];
    if (!table) continue;

    // Filter eligible entries
    const eligible = table.filter(entry => {
      if (!entry.when) return true;
      return !!evaluate(entry.when.ast, evalScope, evalOpts);
    });
    if (eligible.length === 0) continue;

    if (rule.mode === 'per_room') {
      for (let r = 1; r < map.rooms.length; r++) {
        const room = map.rooms[r];
        let count = 1;
        if (rule.count != null) {
          if (typeof rule.count === 'number') {
            count = rule.count;
          } else {
            const ast = parse(String(rule.count));
            count = Math.floor(evaluate(ast, evalScope, evalOpts));
          }
        }
        for (let n = 0; n < count; n++) {
          const entry = pickWeighted(rng, eligible);
          if (!entry) continue;
          const pos = randomFloorInRoom(rng, room, map, entities, map.spawn);
          if (!pos) continue;
          const ent = createEntity(entry.id, pos.x, pos.y, definition);
          if (ent) entities.push(ent);
        }
      }
    } else {
      let count = 1;
      if (rule.count != null) {
        if (typeof rule.count === 'number') {
          count = rule.count;
        } else {
          const ast = parse(String(rule.count));
          count = Math.floor(evaluate(ast, evalScope, evalOpts));
        }
      }
      for (let n = 0; n < count; n++) {
        const entry = pickWeighted(rng, eligible);
        if (!entry) continue;
        const roomIdx = map.rooms.length > 1 ? randomInt(rng, 1, map.rooms.length - 1) : 0;
        const room = map.rooms[roomIdx];
        const pos = randomFloorInRoom(rng, room, map, entities, map.spawn);
        if (!pos) continue;
        const ent = createEntity(entry.id, pos.x, pos.y, definition);
        if (ent) entities.push(ent);
      }
    }
  }

  return entities;
}

function pickWeighted(rng, entries) {
  const total = entries.reduce((s, e) => s + (e.weight || 1), 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= (entry.weight || 1);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function randomFloorInRoom(rng, room, map, entities, playerPos) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = randomInt(rng, room.x, room.x + room.w - 1);
    const y = randomInt(rng, room.y, room.y + room.h - 1);
    if (map.tiles[y][x] !== '.') continue;
    if (x === playerPos.x && y === playerPos.y) continue;
    if (map.stair && x === map.stair.x && y === map.stair.y) continue;
    if (entities.some(e => e.x === x && e.y === y)) continue;
    return { x, y };
  }
  return null;
}

function createEntity(id, x, y, definition) {
  const beingDef = definition._index.beings[id];
  if (beingDef) {
    const measurements = Object.create(null);
    for (const m of definition.measurements) {
      measurements[m.id] = beingDef.measurements[m.id] ?? m.initial;
    }
    return {
      id: beingDef.id, kind: 'being', label: beingDef.label,
      glyph: beingDef.glyph, color: beingDef.color, tags: [...beingDef.tags],
      x, y, measurements, inventory: [], equipment: Object.create(null),
    };
  }
  const itemDef = definition._index.items[id];
  if (itemDef) {
    return {
      id: itemDef.id, kind: 'item', label: itemDef.label,
      glyph: itemDef.glyph, color: itemDef.color, tags: [...itemDef.tags],
      itemKind: itemDef.kind, properties: itemDef.properties ? { ...itemDef.properties } : {},
      x, y,
    };
  }
  return null;
}
