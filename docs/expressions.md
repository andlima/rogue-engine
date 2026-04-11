# Expression Language

The rogue-engine expression language is a small, pure-functional language used
in action preconditions (`requires`), AI conditions, effect fields (e.g.
`delta`), measurement `max` fields, and win/loss conditions.

Expressions are **pure**: they have no side effects and never mutate state.
All state changes happen through effects.

## Grammar

```
expr        = or_expr
or_expr     = and_expr ("or" and_expr)*
and_expr    = not_expr ("and" not_expr)*
not_expr    = "not" not_expr | comparison
comparison  = addition (("==" | "!=" | "<=" | ">=" | "<" | ">") addition)?
addition    = multiply (("+" | "-") multiply)*
multiply    = unary (("*" | "/" | "%") unary)*
unary       = "-" unary | postfix
postfix     = primary ( "(" args ")" | "." IDENT )*
primary     = NUMBER | STRING | "true" | "false" | IDENT | "(" expr ")"
```

## Literals

| Type    | Examples             |
|---------|---------------------|
| Number  | `42`, `3.14`, `0`   |
| String  | `"hello"`, `'world'`|
| Boolean | `true`, `false`     |

## Operators

### Arithmetic
| Op  | Description          | Notes                         |
|-----|---------------------|-------------------------------|
| `+` | Addition            |                               |
| `-` | Subtraction / negate|                               |
| `*` | Multiplication      |                               |
| `/` | Division            | Integer division (truncates)  |
| `%` | Modulo              |                               |

Division or modulo by zero returns `0` and pushes a warning (no crash).

### Comparison
`==`, `!=`, `<`, `<=`, `>`, `>=`

### Boolean
`and`, `or`, `not` — short-circuit evaluation.

## Built-in Functions

| Function               | Description                                       |
|-----------------------|---------------------------------------------------|
| `min(a, b)`           | Minimum of two values                             |
| `max(a, b)`           | Maximum of two values                             |
| `clamp(val, lo, hi)`  | Clamp value to range [lo, hi]                     |
| `abs(x)`              | Absolute value                                    |
| `floor(x)`            | Floor (round down)                                |
| `ceil(x)`             | Ceiling (round up)                                |
| `random(lo, hi)`      | Random integer in [lo, hi] inclusive (seeded RNG)  |
| `roll(n, sides)`      | Roll n dice with given sides, return sum (seeded)  |

## Scope

Every expression runs against a **scope object** with these bindings:

| Name     | Description                                                  |
|----------|-------------------------------------------------------------|
| `self`   | The entity performing the action (same as `actor`)          |
| `actor`  | The entity performing the action                            |
| `target` | The target entity (opponent, item, etc.)                    |
| `tile`   | Current tile `{ x, y }`                                     |
| `state`  | Global state `{ level, turn }`                              |
| `player` | The player entity (always available)                        |

### Entity shape

Entities (player, beings) expose:
- `name` / `label` — display name
- `x`, `y` — position
- `measurements.{id}` or shorthand `{id}` — measurement values (e.g. `actor.hp`)
- `tags` — array of tag strings
- `inventory` — items carried
- `equipment` — equipped items by slot

### Measurement references

Dotted paths resolve measurement values:
```
actor.hp              → actor's current HP
target.defense        → target's defense measurement
player.inventory.gold → (not implemented yet — future)
state.level           → current dungeon level
```

### Tag predicates

```
actor.has_tag("undead")    → true if actor has the "undead" tag
target.kind == "consumable" → true if target's kind is "consumable"
```

## Validation

Expressions are validated at **load time** after the full game definition is
known. The loader catches:

- Syntax errors in expression strings
- References to unknown measurement IDs (with Levenshtein ≤ 2 near-miss
  suggestions)
- References to unknown built-in function names
- Unknown effect types in action effects

Runtime errors (e.g. divide by zero) return `0` and push a warning rather
than crashing.

## Determinism

All randomness flows through a seeded PRNG threaded through `GameState`.
Given the same seed and the same sequence of actions, the engine produces
identical results. This enables deterministic replay and parity testing.
