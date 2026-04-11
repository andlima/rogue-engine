/**
 * Expression language — public API.
 *
 * Re-exports parser and evaluator, and wires them together so
 * evalExpr() works without callers needing to do manual setup.
 */

export { parse, collectPaths, collectCalls, AST, ExprSyntaxError } from './parser.js';
export { evaluate, BUILTIN_NAMES, ExprRuntimeError } from './evaluator.js';
import { parse } from './parser.js';
import { evaluate } from './evaluator.js';

/**
 * Parse and evaluate an expression string in one call.
 */
export function evalExpr(source, scope, opts = {}) {
  const ast = parse(source);
  return evaluate(ast, scope, opts);
}
