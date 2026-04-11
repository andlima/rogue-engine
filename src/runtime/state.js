/**
 * Create an initial GameState from a validated GameDefinition.
 */
export function createState(definition) {
  const { meta, measurements, map, _index } = definition;
  const playerArchetype = _index.beings[meta.player_archetype];

  // Initialize player measurements from definition defaults + archetype overrides
  const playerMeasurements = Object.create(null);
  for (const m of measurements) {
    playerMeasurements[m.id] =
      playerArchetype.measurements[m.id] != null
        ? playerArchetype.measurements[m.id]
        : m.initial;
  }

  return {
    definition,
    turn: 0,
    player: {
      x: map.spawn.x,
      y: map.spawn.y,
      archetype: meta.player_archetype,
      measurements: playerMeasurements,
    },
    entities: [],
  };
}
