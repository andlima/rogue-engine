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
 * Each entry: [minArgs, maxArgs, impl(args, rng)]
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
 * @param {object} [opts] — { rng: () => number (0..1), warnings: string[] }
 * @returns {number|string|boolean}
 */
export function evaluate(ast, scope, opts = {}) {
  const rng = opts.rng || Math.random;
  const warnings = opts.warnings || [];

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
          return impl(args, rng);
        }

        warnings.push(`Unknown function '${funcName}'`);
        return 0;
      }
    }
    return 0;
  }

  return eval_(ast);
}

