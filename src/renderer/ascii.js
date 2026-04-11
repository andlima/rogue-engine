/**
 * Render a 2D grid of visible tiles to a string.
 */
export function renderToString(grid) {
  return grid.map(row => row.map(cell => cell.ch).join('')).join('\n');
}

/**
 * Render a status bar showing measurement values.
 */
export function renderStatus(state) {
  const { player, definition } = state;
  const parts = definition.measurements.map(m => {
    const val = player.measurements[m.id];
    return `${m.label}: ${val}`;
  });
  return parts.join('  |  ');
}
