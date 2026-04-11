/**
 * Get the visible tiles around the player as a 2D array.
 * Each cell is { ch, color } where ch is the display character.
 */
export function getVisibleTiles(state, viewW, viewH) {
  const { player, definition } = state;
  const { map } = definition;
  const playerArchetype = definition._index.beings[player.archetype];

  const halfW = Math.floor(viewW / 2);
  const halfH = Math.floor(viewH / 2);
  const startX = player.x - halfW;
  const startY = player.y - halfH;

  const grid = [];
  for (let vy = 0; vy < viewH; vy++) {
    const row = [];
    for (let vx = 0; vx < viewW; vx++) {
      const mx = startX + vx;
      const my = startY + vy;

      if (mx < 0 || mx >= map.width || my < 0 || my >= map.height) {
        row.push({ ch: ' ', color: null });
      } else if (mx === player.x && my === player.y) {
        row.push({ ch: playerArchetype.glyph, color: playerArchetype.color });
      } else {
        const tile = map.tiles[my][mx];
        row.push({ ch: tile, color: tile === '#' ? 'gray' : 'white' });
      }
    }
    grid.push(row);
  }
  return grid;
}
