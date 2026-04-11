/**
 * Get the visible tiles around the player as a 2D array.
 * Each cell is { ch, color } where ch is the display character.
 *
 * Renders entities (beings and items) on top of the tile map.
 */
export function getVisibleTiles(state, viewW, viewH) {
  const { player, definition, entities } = state;
  const { map } = definition;
  const playerArchetype = definition._index.beings[player.archetype];

  const halfW = Math.floor(viewW / 2);
  const halfH = Math.floor(viewH / 2);
  const startX = player.x - halfW;
  const startY = player.y - halfH;

  // Build entity lookup by position
  const entityAt = Object.create(null);
  if (entities) {
    for (const e of entities) {
      const key = `${e.x},${e.y}`;
      entityAt[key] = e;
    }
  }

  const renderingBeings = definition.rendering?.beings;
  const renderingItems = definition.rendering?.items;
  const renderingTiles = definition.rendering?.tiles;

  const grid = [];
  for (let vy = 0; vy < viewH; vy++) {
    const row = [];
    for (let vx = 0; vx < viewW; vx++) {
      const mx = startX + vx;
      const my = startY + vy;

      if (!map || mx < 0 || mx >= map.width || my < 0 || my >= map.height) {
        row.push({ ch: ' ', color: null });
      } else if (mx === player.x && my === player.y) {
        let glyph = playerArchetype.glyph;
        let color = playerArchetype.color;
        if (renderingBeings?.[player.archetype]) {
          const override = renderingBeings[player.archetype];
          if (override.glyph) glyph = override.glyph;
          if (override.color) color = override.color;
        }
        row.push({ ch: glyph, color });
      } else {
        // Check for entity at this position
        const entity = entityAt[`${mx},${my}`];
        if (entity) {
          if (entity.kind === 'being') {
            let glyph = entity.glyph;
            let color = entity.color;
            if (renderingBeings?.[entity.id]) {
              const override = renderingBeings[entity.id];
              if (override.glyph) glyph = override.glyph;
              if (override.color) color = override.color;
            }
            row.push({ ch: glyph, color });
          } else if (entity.kind === 'item') {
            let glyph = entity.glyph;
            let color = entity.color;
            if (renderingItems?.[entity.id]) {
              const override = renderingItems[entity.id];
              if (override.glyph) glyph = override.glyph;
              if (override.color) color = override.color;
            }
            row.push({ ch: glyph, color });
          } else {
            const tile = map.tiles[my][mx];
            row.push({ ch: tile, color: tile === '#' ? 'gray' : 'white' });
          }
        } else {
          const tile = map.tiles[my][mx];
          let ch = tile;
          let color = tile === '#' ? 'gray' : 'white';
          if (renderingTiles?.[tile]) {
            const override = renderingTiles[tile];
            if (override.glyph) ch = override.glyph;
            if (override.color) color = override.color;
          }
          row.push({ ch, color });
        }
      }
    }
    grid.push(row);
  }
  return grid;
}
