/**
 * Expression language parser — hand-written recursive descent.
 *
 * Grammar (informal):
 *   expr        = or_expr
 *   or_expr     = and_expr ("or" and_expr)*
 *   and_expr    = not_expr ("and" not_expr)*
 *   not_expr    = "not" not_expr | comparison
 *   comparison  = addition (("==" | "!=" | "<=" | ">=" | "<" | ">") addition)?
 *   addition    = multiply (("+" | "-") multiply)*
 *   multiply    = unary (("*" | "/" | "%") unary)*
 *   unary       = "-" unary | call
 *   call        = primary ( "(" args ")" | "." IDENT )*
 *   primary     = NUMBER | STRING | "true" | "false" | IDENT | "(" expr ")"
 */

// ── Token types ──────────────────────────────────────────────────────────

const T = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  IDENT: 'IDENT',
  OP: 'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  DOT: 'DOT',
  COMMA: 'COMMA',
  EOF: 'EOF',
};

const KEYWORDS = new Set(['true', 'false', 'and', 'or', 'not']);

// ── Lexer ────────────────────────────────────────────────────────────────

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // number literal
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < source.length && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) {
        num += source[i++];
      }
      tokens.push({ type: T.NUMBER, value: Number(num), pos: i - num.length });
      continue;
    }

    // string literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++; // skip opening quote
      let str = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i++;
          str += source[i++];
        } else {
          str += source[i++];
        }
      }
      if (i >= source.length) throw new ExprSyntaxError(`Unterminated string at position ${i}`);
      i++; // skip closing quote
      tokens.push({ type: T.STRING, value: str, pos: i - str.length - 2 });
      continue;
    }

    // identifier or keyword
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let ident = '';
      const start = i;
      while (
        i < source.length &&
        ((source[i] >= 'a' && source[i] <= 'z') ||
          (source[i] >= 'A' && source[i] <= 'Z') ||
          (source[i] >= '0' && source[i] <= '9') ||
          source[i] === '_')
      ) {
        ident += source[i++];
      }
      tokens.push({ type: T.IDENT, value: ident, pos: start });
      continue;
    }

    // two-character operators
    if (i + 1 < source.length) {
      const two = source[i] + source[i + 1];
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        tokens.push({ type: T.OP, value: two, pos: i });
        i += 2;
        continue;
      }
    }

    // single-character tokens
    if ('+-*/%<>'.includes(ch)) {
      tokens.push({ type: T.OP, value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: T.LPAREN, value: '(', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: T.RPAREN, value: ')', pos: i }); i++; continue; }
    if (ch === '.') { tokens.push({ type: T.DOT, value: '.', pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ type: T.COMMA, value: ',', pos: i }); i++; continue; }

    throw new ExprSyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }
  tokens.push({ type: T.EOF, value: null, pos: i });
  return tokens;
}

// ── AST node constructors ────────────────────────────────────────────────

export const AST = {
  number: (value) => ({ kind: 'number', value }),
  string: (value) => ({ kind: 'string', value }),
  boolean: (value) => ({ kind: 'boolean', value }),
  ident: (name) => ({ kind: 'ident', name }),
  unary: (op, operand) => ({ kind: 'unary', op, operand }),
  binary: (op, left, right) => ({ kind: 'binary', op, left, right }),
  call: (callee, args) => ({ kind: 'call', callee, args }),
  member: (object, property) => ({ kind: 'member', object, property }),
};

// ── Errors ───────────────────────────────────────────────────────────────

export class ExprSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExprSyntaxError';
  }
}

// ── Parser ───────────────────────────────────────────────────────────────

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type, value) {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new ExprSyntaxError(
        `Expected ${value ?? type} but got '${tok.value}' at position ${tok.pos}`
      );
    }
    return this.advance();
  }

  match(type, value) {
    const tok = this.peek();
    if (tok.type === type && (value === undefined || tok.value === value)) {
      return this.advance();
    }
    return null;
  }

  // expr = or_expr
  parseExpr() {
    return this.parseOr();
  }

  // or_expr = and_expr ("or" and_expr)*
  parseOr() {
    let left = this.parseAnd();
    while (this.match(T.IDENT, 'or')) {
      left = AST.binary('or', left, this.parseAnd());
    }
    return left;
  }

  // and_expr = not_expr ("and" not_expr)*
  parseAnd() {
    let left = this.parseNot();
    while (this.match(T.IDENT, 'and')) {
      left = AST.binary('and', left, this.parseNot());
    }
    return left;
  }

  // not_expr = "not" not_expr | comparison
  parseNot() {
    if (this.match(T.IDENT, 'not')) {
      return AST.unary('not', this.parseNot());
    }
    return this.parseComparison();
  }

  // comparison = addition (comp_op addition)?
  parseComparison() {
    let left = this.parseAddition();
    const tok = this.peek();
    if (tok.type === T.OP && ['==', '!=', '<', '<=', '>', '>='].includes(tok.value)) {
      const op = this.advance().value;
      left = AST.binary(op, left, this.parseAddition());
    }
    return left;
  }

  // addition = multiply (("+"|"-") multiply)*
  parseAddition() {
    let left = this.parseMultiply();
    while (this.peek().type === T.OP && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      left = AST.binary(op, left, this.parseMultiply());
    }
    return left;
  }

  // multiply = unary (("*"|"/"|"%") unary)*
  parseMultiply() {
    let left = this.parseUnary();
    while (this.peek().type === T.OP && ['*', '/', '%'].includes(this.peek().value)) {
      const op = this.advance().value;
      left = AST.binary(op, left, this.parseUnary());
    }
    return left;
  }

  // unary = "-" unary | postfix
  parseUnary() {
    if (this.match(T.OP, '-')) {
      return AST.unary('-', this.parseUnary());
    }
    return this.parsePostfix();
  }

  // postfix = primary ( "(" args ")" | "." IDENT )*
  parsePostfix() {
    let node = this.parsePrimary();
    while (true) {
      if (this.match(T.DOT)) {
        const prop = this.expect(T.IDENT).value;
        node = AST.member(node, prop);
      } else if (this.match(T.LPAREN)) {
        const args = [];
        if (this.peek().type !== T.RPAREN) {
          args.push(this.parseExpr());
          while (this.match(T.COMMA)) {
            args.push(this.parseExpr());
          }
        }
        this.expect(T.RPAREN);
        node = AST.call(node, args);
      } else {
        break;
      }
    }
    return node;
  }

  // primary = NUMBER | STRING | "true" | "false" | IDENT | "(" expr ")"
  parsePrimary() {
    const tok = this.peek();

    if (tok.type === T.NUMBER) {
      this.advance();
      return AST.number(tok.value);
    }
    if (tok.type === T.STRING) {
      this.advance();
      return AST.string(tok.value);
    }
    if (tok.type === T.IDENT) {
      if (tok.value === 'true') { this.advance(); return AST.boolean(true); }
      if (tok.value === 'false') { this.advance(); return AST.boolean(false); }
      if (tok.value === 'and' || tok.value === 'or' || tok.value === 'not') {
        throw new ExprSyntaxError(`Unexpected keyword '${tok.value}' at position ${tok.pos}`);
      }
      this.advance();
      return AST.ident(tok.value);
    }
    if (tok.type === T.LPAREN) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(T.RPAREN);
      return expr;
    }

    throw new ExprSyntaxError(`Unexpected token '${tok.value}' at position ${tok.pos}`);
  }
}

/**
 * Parse an expression string into an AST.
 */
export function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseExpr();
  if (parser.peek().type !== T.EOF) {
    const tok = parser.peek();
    throw new ExprSyntaxError(`Unexpected token '${tok.value}' at position ${tok.pos}`);
  }
  return ast;
}

/**
 * Collect all dotted path references from an AST.
 * Returns an array of path arrays, e.g. [['actor', 'hp'], ['target', 'defense']].
 */
export function collectPaths(ast) {
  const paths = [];
  function walk(node) {
    switch (node.kind) {
      case 'number':
      case 'string':
      case 'boolean':
        break;
      case 'ident':
        paths.push([node.name]);
        break;
      case 'member': {
        // Flatten a.b.c chain
        const parts = [];
        let cur = node;
        while (cur.kind === 'member') {
          parts.unshift(cur.property);
          cur = cur.object;
        }
        if (cur.kind === 'ident') {
          parts.unshift(cur.name);
          paths.push(parts);
        } else {
          walk(cur);
        }
        break;
      }
      case 'call':
        walk(node.callee);
        for (const arg of node.args) walk(arg);
        break;
      case 'binary':
        walk(node.left);
        walk(node.right);
        break;
      case 'unary':
        walk(node.operand);
        break;
    }
  }
  walk(ast);
  return paths;
}

/**
 * Collect all function calls from an AST.
 * Returns an array of { name, argCount }.
 */
export function collectCalls(ast) {
  const calls = [];
  function walk(node) {
    switch (node.kind) {
      case 'call': {
        // Extract function name from callee
        let name = null;
        if (node.callee.kind === 'ident') {
          name = node.callee.name;
        } else if (node.callee.kind === 'member') {
          // e.g. actor.has_tag("undead") — collect the method call info
          const parts = [];
          let cur = node.callee;
          while (cur.kind === 'member') {
            parts.unshift(cur.property);
            cur = cur.object;
          }
          if (cur.kind === 'ident') parts.unshift(cur.name);
          name = parts.join('.');
        }
        calls.push({ name, argCount: node.args.length });
        walk(node.callee);
        for (const arg of node.args) walk(arg);
        break;
      }
      case 'binary':
        walk(node.left);
        walk(node.right);
        break;
      case 'unary':
        walk(node.operand);
        break;
      case 'member':
        walk(node.object);
        break;
      case 'number':
      case 'string':
      case 'boolean':
      case 'ident':
        break;
    }
  }
  walk(ast);
  return calls;
}
