import { createRng } from './rng.js';

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

  const spawnX = map ? map.spawn.x : 0;
  const spawnY = map ? map.spawn.y : 0;
  const startLevel = world?.starting_state?.level ?? 1;

  const rngSeed = seed ?? world?.dungeon?.seed ?? 42;

  return {
    definition,
    turn: 0,
    level: startLevel,
    player: {
      x: spawnX,
      y: spawnY,
      archetype: meta.player_archetype,
      measurements: playerMeasurements,
      tags: playerArchetype.tags ? [...playerArchetype.tags] : [],
      inventory: [],
      equipment: Object.create(null),
      name: playerArchetype.label,
      label: playerArchetype.label,
    },
    entities: [],
    messages: [],
    rng: createRng(rngSeed),
    terminal: null,
    terminalReason: null,
  };
}
