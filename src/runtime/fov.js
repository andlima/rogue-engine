/**
 * Field of View — recursive shadowcasting (Albert Ford's symmetric variant).
 *
 * Generic: any roguelike can use this for visibility computation.
 * Returns a Map of "x,y" → brightness (0.45–1.0).
 *
 * Ported from silly-game's src/fov.js to keep parity with the upstream
 * reference implementation.
 */

export const TORCH_RADIUS = 6;

/**
 * Compute visible tiles from (ox, oy) within the given radius.
 *
 * @param {{ tiles: string[][], width: number, height: number }} map
 * @param {number} ox — origin x
 * @param {number} oy — origin y
 * @param {number} radius — view radius (default TORCH_RADIUS)
 * @returns {Map<string, number>} key "x,y" → brightness (0.45–1.0)
 */
export function computeFOV(map, ox, oy, radius = TORCH_RADIUS) {
  const visible = new Map();

  // Origin is always visible at full brightness
  visible.set(`${ox},${oy}`, 1.0);

  for (let octant = 0; octant < 8; octant++) {
    castOctant(map, ox, oy, radius, octant, 1, 1.0, 0.0, visible);
  }

  return visible;
}

function brightness(distance, radius) {
  const b = 1.0 - (distance / radius) * 0.55;
  return Math.max(0.45, Math.min(1.0, b));
}

function isOpaque(map, x, y) {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return true;
  return map.tiles[y][x] === '#';
}

// Transform octant-local (row, col) to map coordinates
function transformOctant(ox, oy, octant, row, col) {
  switch (octant) {
    case 0: return { x: ox + col, y: oy - row };
    case 1: return { x: ox + row, y: oy - col };
    case 2: return { x: ox + row, y: oy + col };
    case 3: return { x: ox + col, y: oy + row };
    case 4: return { x: ox - col, y: oy + row };
    case 5: return { x: ox - row, y: oy + col };
    case 6: return { x: ox - row, y: oy - col };
    case 7: return { x: ox - col, y: oy - row };
  }
}

// Symmetric shadowcasting (Albert Ford's variant).
// Guarantees: if tile A sees B then B sees A, eliminating artifacts
// where nearby visible tiles are missed.
function castOctant(map, ox, oy, radius, octant, row, startSlope, endSlope, visible) {
  if (startSlope < endSlope) return;

  let nextStartSlope = startSlope;

  for (let r = row; r <= radius; r++) {
    let foundWall = false;

    // Scan columns from high slope (startSlope side) to low slope (endSlope side)
    const maxCol = Math.floor(r * nextStartSlope + 0.5);
    const minCol = Math.max(0, Math.ceil(r * endSlope - 0.5));

    for (let col = maxCol; col >= minCol; col--) {
      const { x, y } = transformOctant(ox, oy, octant, r, col);
      const dist = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy));

      if (dist <= radius) {
        const key = `${x},${y}`;
        const b = brightness(dist, radius);
        // Keep the brighter value if seen from multiple octants
        if (!visible.has(key) || visible.get(key) < b) {
          visible.set(key, b);
        }
      }

      const opaque = isOpaque(map, x, y);

      if (opaque) {
        if (!foundWall) {
          // Recurse for the open region above this wall
          const wallSlope = (col + 0.5) / r;
          castOctant(map, ox, oy, radius, octant, r + 1, nextStartSlope, wallSlope, visible);
          foundWall = true;
        }
        // Next open region starts below this wall
        nextStartSlope = (col - 0.5) / r;
      } else {
        foundWall = false;
      }
    }

    // If the last cell in the row was a wall, the remaining arc is fully blocked
    if (foundWall) return;
  }
}
