/**
 * Procedural dungeon generator — rooms-and-corridors algorithm.
 *
 * Generic: any roguelike can use this with different parameters.
 * Produces a map compatible with the engine's tile format.
 */

import { randomInt } from './rng.js';

/**
 * Generate a dungeon map.
 *
 * @param {Function} rng  — seeded PRNG returning [0, 1)
 * @param {object} params — { width, height, room_count: [min, max],
 *                            room_size: [min, max], max_attempts }
 * @returns {{ width, height, tiles: string[][], spawn: {x,y}, rooms, stair: {x,y} }}
 */
export function generateDungeon(rng, params) {
  const width = params.width || 80;
  const height = params.height || 50;
  const roomCountMin = Array.isArray(params.room_count) ? params.room_count[0] : 5;
  const roomCountMax = Array.isArray(params.room_count) ? params.room_count[1] : 10;
  const roomSizeMin = Array.isArray(params.room_size) ? params.room_size[0] : 4;
  const roomSizeMax = Array.isArray(params.room_size) ? params.room_size[1] : 10;
  const maxAttempts = params.max_attempts || 200;

  // Fill with walls
  const tiles = [];
  for (let y = 0; y < height; y++) {
    tiles.push(new Array(width).fill('#'));
  }

  const targetRooms = randomInt(rng, roomCountMin, roomCountMax);
  const rooms = [];

  for (let attempt = 0; attempt < maxAttempts && rooms.length < targetRooms; attempt++) {
    const rw = randomInt(rng, roomSizeMin, roomSizeMax);
    const rh = randomInt(rng, roomSizeMin, roomSizeMax);
    const rx = randomInt(rng, 1, width - rw - 1);
    const ry = randomInt(rng, 1, height - rh - 1);

    // Check collision with existing rooms (1-tile buffer)
    let collision = false;
    for (const room of rooms) {
      if (rx - 1 < room.x + room.w + 1 &&
          rx + rw + 1 > room.x - 1 &&
          ry - 1 < room.y + room.h + 1 &&
          ry + rh + 1 > room.y - 1) {
        collision = true;
        break;
      }
    }
    if (collision) continue;

    rooms.push({ x: rx, y: ry, w: rw, h: rh });

    // Carve room floor
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        tiles[y][x] = '.';
      }
    }
  }

  // Connect rooms with L-shaped corridors
  for (let i = 1; i < rooms.length; i++) {
    const r1 = rooms[i - 1];
    const r2 = rooms[i];
    const cx1 = Math.floor(r1.x + r1.w / 2);
    const cy1 = Math.floor(r1.y + r1.h / 2);
    const cx2 = Math.floor(r2.x + r2.w / 2);
    const cy2 = Math.floor(r2.y + r2.h / 2);

    if (rng() < 0.5) {
      carveHCorridor(tiles, cx1, cx2, cy1);
      carveVCorridor(tiles, cy1, cy2, cx2);
    } else {
      carveVCorridor(tiles, cy1, cy2, cx1);
      carveHCorridor(tiles, cx1, cx2, cy2);
    }
  }

  // Player spawn at center of first room
  const spawn = {
    x: Math.floor(rooms[0].x + rooms[0].w / 2),
    y: Math.floor(rooms[0].y + rooms[0].h / 2),
  };

  // Stair at center of last room
  const lastRoom = rooms[rooms.length - 1];
  const stairX = Math.floor(lastRoom.x + lastRoom.w / 2);
  const stairY = Math.floor(lastRoom.y + lastRoom.h / 2);
  tiles[stairY][stairX] = '>';

  return { width, height, tiles, spawn, rooms, stair: { x: stairX, y: stairY } };
}

function carveHCorridor(tiles, x1, x2, y) {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (let x = lo; x <= hi; x++) {
    tiles[y][x] = '.';
  }
}

function carveVCorridor(tiles, y1, y2, x) {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  for (let y = lo; y <= hi; y++) {
    tiles[y][x] = '.';
  }
}
