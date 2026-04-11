import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, collectPaths, collectCalls, ExprSyntaxError } from '../src/expressions/parser.js';
import { evaluate, ExprRuntimeError } from '../src/expressions/evaluator.js';
import { evalExpr } from '../src/expressions/index.js';

describe('expression parser', () => {
  it('parses numeric literals', () => {
    const ast = parse('42');
    assert.deepEqual(ast, { kind: 'number', value: 42 });
  });

  it('parses float literals', () => {
    const ast = parse('3.14');
    assert.deepEqual(ast, { kind: 'number', value: 3.14 });
  });

  it('parses string literals (double quotes)', () => {
    const ast = parse('"hello"');
    assert.deepEqual(ast, { kind: 'string', value: 'hello' });
  });

  it('parses string literals (single quotes)', () => {
    const ast = parse("'world'");
    assert.deepEqual(ast, { kind: 'string', value: 'world' });
  });

  it('parses boolean true', () => {
    const ast = parse('true');
    assert.deepEqual(ast, { kind: 'boolean', value: true });
  });

  it('parses boolean false', () => {
    const ast = parse('false');
    assert.deepEqual(ast, { kind: 'boolean', value: false });
  });

  it('parses identifiers', () => {
    const ast = parse('foo');
    assert.deepEqual(ast, { kind: 'ident', name: 'foo' });
  });

  it('parses dotted member access', () => {
    const ast = parse('actor.hp');
    assert.equal(ast.kind, 'member');
    assert.equal(ast.property, 'hp');
    assert.equal(ast.object.kind, 'ident');
    assert.equal(ast.object.name, 'actor');
  });

  it('parses deep dotted paths', () => {
    const ast = parse('actor.equipped.weapon.bonus');
    assert.equal(ast.kind, 'member');
    assert.equal(ast.property, 'bonus');
  });

  it('parses arithmetic expressions', () => {
    const ast = parse('1 + 2 * 3');
    assert.equal(ast.kind, 'binary');
    assert.equal(ast.op, '+');
    assert.equal(ast.right.kind, 'binary');
    assert.equal(ast.right.op, '*');
  });

  it('parses comparison operators', () => {
    const ast = parse('actor.hp > 5');
    assert.equal(ast.kind, 'binary');
    assert.equal(ast.op, '>');
  });

  it('parses boolean operators', () => {
    const ast = parse('a and b or c');
    assert.equal(ast.kind, 'binary');
    assert.equal(ast.op, 'or');
  });

  it('parses not operator', () => {
    const ast = parse('not true');
    assert.equal(ast.kind, 'unary');
    assert.equal(ast.op, 'not');
  });

  it('parses unary minus', () => {
    const ast = parse('-5');
    assert.equal(ast.kind, 'unary');
    assert.equal(ast.op, '-');
  });

  it('parses function calls', () => {
    const ast = parse('min(1, 2)');
    assert.equal(ast.kind, 'call');
    assert.equal(ast.callee.name, 'min');
    assert.equal(ast.args.length, 2);
  });

  it('parses method calls', () => {
    const ast = parse('actor.has_tag("undead")');
    assert.equal(ast.kind, 'call');
    assert.equal(ast.callee.kind, 'member');
  });

  it('parses parenthesized expressions', () => {
    const ast = parse('(1 + 2) * 3');
    assert.equal(ast.kind, 'binary');
    assert.equal(ast.op, '*');
    assert.equal(ast.left.kind, 'binary');
    assert.equal(ast.left.op, '+');
  });

  it('throws ExprSyntaxError on bad input', () => {
    assert.throws(() => parse('1 +'), ExprSyntaxError);
  });

  it('throws on unexpected characters', () => {
    assert.throws(() => parse('1 $ 2'), ExprSyntaxError);
  });

  it('throws on unterminated strings', () => {
    assert.throws(() => parse('"hello'), ExprSyntaxError);
  });
});

describe('expression evaluator', () => {
  const scope = {
    actor: { hp: 10, defense: 3, name: 'Hero', tags: ['player', 'human'] },
    target: { hp: 5, defense: 1, name: 'Goblin', tags: ['monster'], kind: 'being' },
    player: { hp: 10, name: 'Hero', tags: ['player'] },
    state: { level: 2, turn: 5 },
    self: { hp: 10, name: 'Hero' },
    tile: { x: 3, y: 4 },
  };

  it('evaluates numeric literals', () => {
    assert.equal(evalExpr('42', scope), 42);
  });

  it('evaluates string literals', () => {
    assert.equal(evalExpr('"hello"', scope), 'hello');
  });

  it('evaluates boolean literals', () => {
    assert.equal(evalExpr('true', scope), true);
    assert.equal(evalExpr('false', scope), false);
  });

  it('evaluates addition', () => {
    assert.equal(evalExpr('3 + 4', scope), 7);
  });

  it('evaluates subtraction', () => {
    assert.equal(evalExpr('10 - 3', scope), 7);
  });

  it('evaluates multiplication', () => {
    assert.equal(evalExpr('3 * 4', scope), 12);
  });

  it('evaluates integer division', () => {
    assert.equal(evalExpr('7 / 2', scope), 3);
    assert.equal(evalExpr('-7 / 2', scope), -3);
  });

  it('evaluates modulo', () => {
    assert.equal(evalExpr('7 % 3', scope), 1);
  });

  it('evaluates comparisons', () => {
    assert.equal(evalExpr('3 == 3', scope), true);
    assert.equal(evalExpr('3 != 4', scope), true);
    assert.equal(evalExpr('3 < 4', scope), true);
    assert.equal(evalExpr('4 <= 4', scope), true);
    assert.equal(evalExpr('5 > 4', scope), true);
    assert.equal(evalExpr('5 >= 5', scope), true);
    assert.equal(evalExpr('3 > 4', scope), false);
  });

  it('evaluates boolean and/or/not', () => {
    assert.equal(evalExpr('true and true', scope), true);
    assert.equal(evalExpr('true and false', scope), false);
    assert.equal(evalExpr('false or true', scope), true);
    assert.equal(evalExpr('not false', scope), true);
    assert.equal(evalExpr('not true', scope), false);
  });

  it('evaluates unary minus', () => {
    assert.equal(evalExpr('-5', scope), -5);
    assert.equal(evalExpr('-actor.defense', scope), -3);
  });

  it('evaluates dotted path references', () => {
    assert.equal(evalExpr('actor.hp', scope), 10);
    assert.equal(evalExpr('target.defense', scope), 1);
    assert.equal(evalExpr('state.level', scope), 2);
  });

  it('evaluates min()', () => {
    assert.equal(evalExpr('min(3, 7)', scope), 3);
    assert.equal(evalExpr('min(10, 2)', scope), 2);
  });

  it('evaluates max()', () => {
    assert.equal(evalExpr('max(3, 7)', scope), 7);
  });

  it('evaluates clamp()', () => {
    assert.equal(evalExpr('clamp(15, 0, 10)', scope), 10);
    assert.equal(evalExpr('clamp(-5, 0, 10)', scope), 0);
    assert.equal(evalExpr('clamp(5, 0, 10)', scope), 5);
  });

  it('evaluates abs()', () => {
    assert.equal(evalExpr('abs(-5)', scope), 5);
    assert.equal(evalExpr('abs(5)', scope), 5);
  });

  it('evaluates floor() and ceil()', () => {
    assert.equal(evalExpr('floor(3)', scope), 3);
    assert.equal(evalExpr('ceil(3)', scope), 3);
  });

  it('evaluates random() with seeded RNG', () => {
    const rng = () => 0.5; // deterministic
    const result = evalExpr('random(1, 10)', scope, { rng });
    assert.equal(typeof result, 'number');
    assert.ok(result >= 1 && result <= 10);
  });

  it('evaluates roll() with seeded RNG', () => {
    let callCount = 0;
    const rng = () => { callCount++; return 0.5; };
    const result = evalExpr('roll(2, 6)', scope, { rng });
    assert.equal(callCount, 2); // 2 dice rolled
    assert.equal(typeof result, 'number');
    assert.ok(result >= 2 && result <= 12);
  });

  it('evaluates has_tag()', () => {
    assert.equal(evalExpr('actor.has_tag("player")', scope), true);
    assert.equal(evalExpr('actor.has_tag("monster")', scope), false);
    assert.equal(evalExpr('target.has_tag("monster")', scope), true);
  });

  it('evaluates kind comparisons', () => {
    assert.equal(evalExpr('target.kind == "being"', scope), true);
    assert.equal(evalExpr('target.kind == "item"', scope), false);
  });

  it('returns 0 for unknown references with a warning', () => {
    const warnings = [];
    const result = evalExpr('unknown_var', scope, { warnings });
    assert.equal(result, 0);
    assert.ok(warnings.length > 0);
  });

  it('returns 0 for division by zero with a warning', () => {
    const warnings = [];
    const result = evalExpr('10 / 0', scope, { warnings });
    assert.equal(result, 0);
    assert.ok(warnings.some(w => w.includes('Division by zero')));
  });

  it('returns 0 for modulo by zero with a warning', () => {
    const warnings = [];
    const result = evalExpr('10 % 0', scope, { warnings });
    assert.equal(result, 0);
    assert.ok(warnings.some(w => w.includes('Modulo by zero')));
  });

  it('evaluates complex expressions', () => {
    assert.equal(evalExpr('actor.hp - target.defense * 2', scope), 8);
    assert.equal(evalExpr('(actor.hp + target.hp) / 2', scope), 7);
    assert.equal(evalExpr('actor.hp > 5 and target.hp < 10', scope), true);
  });
});

describe('collectPaths', () => {
  it('collects dotted paths from expressions', () => {
    const ast = parse('actor.hp + target.defense');
    const paths = collectPaths(ast);
    assert.deepEqual(paths, [['actor', 'hp'], ['target', 'defense']]);
  });

  it('collects deep paths', () => {
    const ast = parse('actor.equipped.weapon.bonus');
    const paths = collectPaths(ast);
    assert.deepEqual(paths, [['actor', 'equipped', 'weapon', 'bonus']]);
  });
});

describe('collectCalls', () => {
  it('collects function call info', () => {
    const ast = parse('min(1, max(2, 3))');
    const calls = collectCalls(ast);
    assert.ok(calls.some(c => c.name === 'min' && c.argCount === 2));
    assert.ok(calls.some(c => c.name === 'max' && c.argCount === 2));
  });
});
