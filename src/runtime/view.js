/**
 * Get the visible tiles around the player as a 2D array.
 * Each cell is { ch, color } where ch is the display character.
 *
 * Renders entities (beings and items) on top of the tile map.
 * If fovMap is provided, only visible tiles are rendered; others are blank.
 *
 * When `state.displayMode === 'emoji'`, the inline override walk mirrors
 * `getBeingAppearance` / `getItemAppearance`: emoji fields win over glyphs
 * whenever declared, and missing emoji falls back to the ASCII glyph so
 * entities never render as `?`.
 */
export function getVisibleTiles(state, viewW, viewH, fovMap) {
  const { player, definition, entities } = state;
  const map = state.map || definition.map;
  const playerArchetype = definition._index.beings[player.archetype];
  const emojiMode = state.displayMode === 'emoji';

  const halfW = Math.floor(viewW / 2);
  const halfH = Math.floor(viewH / 2);
  const startX = player.x - halfW;
  const startY = player.y - halfH;

  // Build entity lookup by position
  const entityAt = Object.create(null);
  if (entities) {
    for (const e of entities) {
      const key = `${e.x},${e.y}`;
      if (!entityAt[key]) entityAt[key] = e;
    }
  }

  const renderingBeings = definition.rendering?.beings;
  const renderingItems = definition.rendering?.items;
  const renderingTiles = definition.rendering?.tiles;

  // Resolve the visible glyph/color for a being (player or entity) by
  // walking archetype → rendering override, picking `emoji` when the
  // display mode requests it and one is declared.
  function resolveBeing(archetypeDef, beingId) {
    let glyph = archetypeDef.glyph;
    let color = archetypeDef.color;
    let emoji = archetypeDef.emoji || null;
    const override = renderingBeings?.[beingId];
    if (override) {
      if (override.glyph) glyph = override.glyph;
      if (override.color) color = override.color;
      if (override.emoji) emoji = override.emoji;
    }
    if (emojiMode && emoji) return { ch: emoji, color };
    return { ch: glyph, color };
  }

  function resolveItem(itemDef, itemId) {
    let glyph = itemDef.glyph;
    let color = itemDef.color;
    let emoji = itemDef.emoji || null;
    const override = renderingItems?.[itemId];
    if (override) {
      if (override.glyph) glyph = override.glyph;
      if (override.color) color = override.color;
      if (override.emoji) emoji = override.emoji;
    }
    if (emojiMode && emoji) return { ch: emoji, color };
    return { ch: glyph, color };
  }

  const grid = [];
  for (let vy = 0; vy < viewH; vy++) {
    const row = [];
    for (let vx = 0; vx < viewW; vx++) {
      const mx = startX + vx;
      const my = startY + vy;

      if (!map || mx < 0 || mx >= map.width || my < 0 || my >= map.height) {
        row.push({ ch: ' ', color: null });
      } else if (fovMap && !fovMap.has(`${mx},${my}`)) {
        // Not visible — show blank
        row.push({ ch: ' ', color: null });
      } else if (mx === player.x && my === player.y) {
        row.push(resolveBeing(playerArchetype, player.archetype));
      } else {
        // Check for entity at this position
        const entity = entityAt[`${mx},${my}`];
        if (entity) {
          if (entity.kind === 'being') {
            // Use the archetype's emoji (if any) — entity objects copy
            // glyph/color up front but not emoji, so read from the index.
            const archetypeDef = definition._index.beings[entity.id] || entity;
            row.push(resolveBeing(archetypeDef, entity.id));
          } else if (entity.kind === 'item') {
            const itemDef = definition._index.items[entity.id] || entity;
            row.push(resolveItem(itemDef, entity.id));
          } else {
            const tile = map.tiles[my][mx];
            row.push({ ch: tile, color: tile === '#' ? 'gray' : 'white' });
          }
        } else {
          const tile = map.tiles[my][mx];
          let ch = tile;
          let color = tile === '#' ? 'gray' : (tile === '>' ? 'yellow' : 'white');
          if (renderingTiles?.[tile]) {
            const override = renderingTiles[tile];
            if (emojiMode && override.emoji) {
              ch = override.emoji;
            } else if (override.glyph) {
              ch = override.glyph;
            }
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
