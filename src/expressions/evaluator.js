/**
 * Expression evaluator — walks an AST produced by the parser and returns a value.
 *
 * Scope shape:
 *   { self, actor, target, tile, state, player }
 *
 * Each scope entry is a plain object whose properties can be traversed via
 * dotted paths in the expression language (e.g. `actor.hp`, `state.level`).
 *
 * Built-in functions: min, max, clamp, abs, random, roll, floor, ceil
 */

import { ExprSyntaxError } from './parser.js';

export class ExprRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExprRuntimeError';
  }
}

/**
 * Built-in function registry.
 * Each entry: [minArgs, maxArgs, impl(args, rng, ctx)]
 * ctx = { state, scope } — available for builtins needing map/entity access.
 */
const BUILTINS = {
  min: [2, 2, (args) => Math.min(args[0], args[1])],
  max: [2, 2, (args) => Math.max(args[0], args[1])],
  clamp: [3, 3, (args) => Math.min(Math.max(args[0], args[1]), args[2])],
  abs: [1, 1, (args) => Math.abs(args[0])],
  floor: [1, 1, (args) => Math.floor(args[0])],
  ceil: [1, 1, (args) => Math.ceil(args[0])],
  random: [2, 2, (args, rng) => {
    const lo = Math.floor(args[0]);
    const hi = Math.floor(args[1]);
    return lo + Math.floor(rng() * (hi - lo + 1));
  }],
  roll: [2, 2, (args, rng) => {
    const n = Math.floor(args[0]);
    const sides = Math.floor(args[1]);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += 1 + Math.floor(rng() * sides);
    }
    return total;
  }],
  // Manhattan distance between two points
  manhattan: [4, 4, (args) => Math.abs(args[2] - args[0]) + Math.abs(args[3] - args[1])],
  // Cardinal direction from (x1,y1) toward (x2,y2).
  // Prefers the axis with the larger gap; horizontal on tie.
  dir_toward: [4, 4, (args, _rng, ctx) => {
    const [ax, ay, tx, ty] = args;
    const dx = Math.sign(tx - ax);
    const dy = Math.sign(ty - ay);
    const absDx = Math.abs(tx - ax);
    const absDy = Math.abs(ty - ay);
    if (absDx === 0 && absDy === 0) return 'n'; // already at target
    // Build candidates: prefer larger-gap axis, horizontal on tie
    const candidates = absDx >= absDy
      ? [{ dir: dx > 0 ? 'e' : 'w', mx: ax + dx, my: ay },
         { dir: dy > 0 ? 's' : (dy < 0 ? 'n' : ''), mx: ax, my: ay + dy }]
      : [{ dir: dy > 0 ? 's' : 'n', mx: ax, my: ay + dy },
         { dir: dx > 0 ? 'e' : (dx < 0 ? 'w' : ''), mx: ax + dx, my: ay }];
    // Return first walkable direction, or primary if none walkable
    const map = ctx?.state?.map || ctx?.state?.definition?.map;
    const entities = ctx?.state?.entities;
    for (const c of candidates) {
      if (!c.dir) continue;
      if (map) {
        if (c.mx < 0 || c.mx >= map.width || c.my < 0 || c.my >= map.height) continue;
        if (map.tiles[c.my][c.mx] === '#') continue;
      }
      // Check for entity collision (monsters can't overlap)
      if (entities && entities.some(e => e.kind === 'being' && e.x === c.mx && e.y === c.my)) continue;
      return c.dir;
    }
    // Fallback to primary direction even if blocked (move will fail)
    return candidates[0]?.dir || 'n';
  }],
  // Check if tile at (x,y) is walkable (not wall, in bounds)
  walkable: [2, 2, (args, _rng, ctx) => {
    const [x, y] = [Math.floor(args[0]), Math.floor(args[1])];
    const map = ctx?.state?.map || ctx?.state?.definition?.map;
    if (!map) return false;
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
    return map.tiles[y][x] !== '#';
  }],
  // Line-of-sight check between two points
  los: [4, 4, (args, _rng, ctx) => {
    const [x1, y1, x2, y2] = args.map(Math.floor);
    const map = ctx?.state?.map || ctx?.state?.definition?.map;
    if (!map) return false;
    // Bresenham raycast
    let dx = Math.abs(x2 - x1);
    let dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let cx = x1, cy = y1;
    while (cx !== x2 || cy !== y2) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
      if ((cx !== x2 || cy !== y2) &&
          (cx < 0 || cx >= map.width || cy < 0 || cy >= map.height || map.tiles[cy][cx] === '#')) {
        return false;
      }
    }
    return true;
  }],
  // Get bonus of equipment in a given slot on the actor
  slot_bonus: [1, 1, (args, _rng, ctx) => {
    const slot = args[0];
    const actor = ctx?.scope?._rawActor || ctx?.scope?._rawPlayer;
    if (!actor || !actor.equipment) return 0;
    const item = actor.equipment[slot];
    if (!item || !item.properties) return 0;
    return item.properties.bonus || 0;
  }],
  // Check if a tile character matches at position
  tile_at: [2, 2, (args, _rng, ctx) => {
    const [x, y] = [Math.floor(args[0]), Math.floor(args[1])];
    const map = ctx?.state?.map || ctx?.state?.definition?.map;
    if (!map || x < 0 || x >= map.width || y < 0 || y >= map.height) return '';
    return map.tiles[y][x];
  }],
  // Check if the actor has an item with the given id in inventory
  has_item: [1, 1, (args, _rng, ctx) => {
    const itemId = args[0];
    const actor = ctx?.scope?._rawActor || ctx?.scope?._rawPlayer;
    if (!actor || !actor.inventory) return false;
    return actor.inventory.some(i => i.id === itemId);
  }],
};

export const BUILTIN_NAMES = new Set(Object.keys(BUILTINS));

/**
 * Resolve a dotted path on a scope object.
 * Returns undefined if the path doesn't exist.
 */
function resolvePath(scope, parts) {
  let current = scope;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Evaluate an AST node in the given scope.
 *
 * @param {object} ast    — AST node from parser
 * @param {object} scope  — { self, actor, target, tile, state, player }
 * @param {object} [opts] — { rng, warnings, state }
 * @returns {number|string|boolean}
 */
export function evaluate(ast, scope, opts = {}) {
  const rng = opts.rng || Math.random;
  const warnings = opts.warnings || [];
  const ctx = { state: opts.state, scope };

  function eval_(node) {
    switch (node.kind) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;

      case 'ident': {
        // Check scope first
        if (node.name in scope) {
          return scope[node.name];
        }
        // Could be a built-in function name referenced without calling — just return the name
        if (BUILTINS[node.name]) return node.name;
        warnings.push(`Unknown reference '${node.name}'`);
        return 0;
      }

      case 'member': {
        // Flatten to path
        const parts = [];
        let cur = node;
        while (cur.kind === 'member') {
          parts.unshift(cur.property);
          cur = cur.object;
        }
        if (cur.kind === 'ident') {
          parts.unshift(cur.name);
          const val = resolvePath(scope, parts);
          if (val === undefined) {
            warnings.push(`Unknown path '${parts.join('.')}'`);
            return 0;
          }
          return val;
        }
        // Dynamic member access — evaluate the object first
        const obj = eval_(cur);
        return resolvePath(obj, parts) ?? 0;
      }

      case 'unary': {
        const operand = eval_(node.operand);
        if (node.op === '-') return -operand;
        if (node.op === 'not') return !operand;
        return 0;
      }

      case 'binary': {
        // Short-circuit for boolean ops
        if (node.op === 'and') {
          const l = eval_(node.left);
          return l ? eval_(node.right) : l;
        }
        if (node.op === 'or') {
          const l = eval_(node.left);
          return l ? l : eval_(node.right);
        }
        const left = eval_(node.left);
        const right = eval_(node.right);
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': {
            if (right === 0) {
              warnings.push('Division by zero');
              return 0;
            }
            // Integer division as specified
            return Math.trunc(left / right);
          }
          case '%': {
            if (right === 0) {
              warnings.push('Modulo by zero');
              return 0;
            }
            return left % right;
          }
          case '==': return left === right;
          case '!=': return left !== right;
          case '<': return left < right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '>=': return left >= right;
          default: return 0;
        }
      }

      case 'call': {
        // Check if it's a method call like actor.has_tag("undead")
        if (node.callee.kind === 'member') {
          const parts = [];
          let cur = node.callee;
          while (cur.kind === 'member') {
            parts.unshift(cur.property);
            cur = cur.object;
          }
          if (cur.kind === 'ident') {
            parts.unshift(cur.name);
          }
          const methodName = parts[parts.length - 1];

          if (methodName === 'has_tag') {
            // Resolve the object path (everything except the last part)
            const objParts = parts.slice(0, -1);
            const obj = resolvePath(scope, objParts);
            if (obj == null) {
              warnings.push(`Cannot call has_tag on '${objParts.join('.')}'`);
              return false;
            }
            const tag = eval_(node.args[0]);
            if (Array.isArray(obj.tags)) {
              return obj.tags.includes(tag);
            }
            return false;
          }
        }

        // Built-in function call
        let funcName = null;
        if (node.callee.kind === 'ident') {
          funcName = node.callee.name;
        }

        if (funcName && BUILTINS[funcName]) {
          const [minArgs, maxArgs, impl] = BUILTINS[funcName];
          const args = node.args.map(a => eval_(a));
          if (args.length < minArgs || args.length > maxArgs) {
            warnings.push(`${funcName} expects ${minArgs}–${maxArgs} arguments, got ${args.length}`);
            return 0;
          }
          return impl(args, rng, ctx);
        }

        warnings.push(`Unknown function '${funcName}'`);
        return 0;
      }
    }
    return 0;
  }

  return eval_(ast);
}

