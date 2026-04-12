/**
 * Field of View — recursive shadowcasting (Albert Ford's symmetric variant).
 *
 * Generic: any roguelike can use this for visibility computation.
 * Returns a Map of "x,y" → brightness (0.45–1.0).
 */

/**
 * Compute visible tiles from (ox, oy) within the given radius.
 *
 * @param {{ tiles: string[][], width: number, height: number }} map
 * @param {number} ox — origin x
 * @param {number} oy — origin y
 * @param {number} radius — view radius (default 6)
 * @returns {Map<string, number>} key "x,y" → brightness (0.45–1.0)
 */
export function computeFOV(map, ox, oy, radius = 6) {
  const visible = new Map();
  visible.set(`${ox},${oy}`, 1.0);

  for (let octant = 0; octant < 8; octant++) {
    castOctant(map, ox, oy, radius, octant, visible);
  }

  return visible;
}

/**
 * Check line-of-sight between two points using Bresenham's line.
 * Returns true if no opaque tile blocks the path.
 */
export function hasLOS(map, x1, y1, x2, y2) {
  let dx = Math.abs(x2 - x1);
  let dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  let cx = x1;
  let cy = y1;

  while (cx !== x2 || cy !== y2) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
    // Check intermediate tiles (not start or end)
    if ((cx !== x2 || cy !== y2) && isOpaque(map, cx, cy)) {
      return false;
    }
  }
  return true;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function brightness(distance, radius) {
  const b = 1.0 - (distance / radius) * 0.55;
  return Math.max(0.45, Math.min(1.0, b));
}

function isOpaque(map, x, y) {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return true;
  return map.tiles[y][x] === '#';
}

/**
 * Octant transform: maps (row, col) in abstract octant space to (x, y) in map space.
 */
function transform(ox, oy, row, col, octant) {
  switch (octant) {
    case 0: return [ox + col, oy - row];
    case 1: return [ox + row, oy - col];
    case 2: return [ox + row, oy + col];
    case 3: return [ox + col, oy + row];
    case 4: return [ox - col, oy + row];
    case 5: return [ox - row, oy + col];
    case 6: return [ox - row, oy - col];
    case 7: return [ox - col, oy - row];
  }
}

function castOctant(map, ox, oy, radius, octant, visible) {
  // Iterative stack-based approach to avoid deep recursion
  const stack = [{ row: 1, startSlope: 1.0, endSlope: 0.0 }];

  while (stack.length > 0) {
    let { row, startSlope, endSlope } = stack.pop();
    if (startSlope < endSlope) continue;

    let nextStartSlope = startSlope;

    for (let r = row; r <= radius; r++) {
      let blocked = false;

      for (let col = Math.round(r * startSlope); col >= 0; col--) {
        const leftSlope = (col + 0.5) / (r - 0.5);
        const rightSlope = (col - 0.5) / (r + 0.5);

        if (rightSlope > startSlope) continue;
        if (leftSlope < endSlope) break;

        const [tx, ty] = transform(ox, oy, r, col, octant);
        const dist = Math.sqrt(col * col + r * r);

        if (dist <= radius) {
          const b = brightness(dist, radius);
          const key = `${tx},${ty}`;
          const existing = visible.get(key);
          if (existing === undefined || b > existing) {
            visible.set(key, b);
          }
        }

        const opaque = isOpaque(map, tx, ty);

        if (blocked) {
          if (opaque) {
            nextStartSlope = (col - 0.5) / (r + 0.5);
          } else {
            blocked = false;
            startSlope = nextStartSlope;
          }
        } else if (opaque && r < radius) {
          blocked = true;
          stack.push({ row: r + 1, startSlope: nextStartSlope, endSlope: (col - 0.5) / (r + 0.5) });
          nextStartSlope = (col - 0.5) / (r + 0.5);
        }
      }

      if (blocked) break;
    }
  }
}
