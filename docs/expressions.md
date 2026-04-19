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

| Function                                 | Description                                       |
|------------------------------------------|---------------------------------------------------|
| `min(a, b)`                              | Minimum of two values                             |
| `max(a, b)`                              | Maximum of two values                             |
| `clamp(val, lo, hi)`                     | Clamp value to range [lo, hi]                     |
| `abs(x)`                                 | Absolute value                                    |
| `floor(x)`                               | Floor (round down)                                |
| `ceil(x)`                                | Ceiling (round up)                                |
| `random(lo, hi)`                         | Random integer in [lo, hi] inclusive (seeded RNG)  |
| `roll(n, sides)`                         | Roll n dice with given sides, return sum (seeded)  |
| `manhattan(a, b)`                        | Manhattan distance between two tile-like objects  |
| `chebyshev(a, b)`                        | Chebyshev (king-move) distance                    |
| `euclidean(a, b)`                        | Euclidean distance (float)                        |
| `in_range(a, b, r, metric = chebyshev)`  | Sugar: `<metric>(a, b) <= r`                      |
| `line_of_sight(a, b)`                    | Boolean — unobstructed path between two tiles     |

Each distance built-in accepts tile-like objects (`{ x, y }`). The four
argument form `(x1, y1, x2, y2)` is also accepted for backward
compatibility.

## List operations

### `where`

`<list> where <predicate>` filters a list. The current element is bound
as `item` inside the predicate. Typical uses:

```
actor.inventory where item.kind == "consumable"
entities where item.kind == "being" and item.has_tag("undead")
```

`where` has the lowest precedence in the grammar and is intended for
`data` / filter positions, not general arithmetic. A non-list LHS
returns `[]` and pushes a warning.

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

### Flow binding references

Inside a flow-enabled action, a step's output is available via a
`$name` sugar. `$origin`, `$actor`, `$self`, `$player` are always
available; other names are whatever the flow's steps declare via
`bind:`.

```
$chosen_item.label         → the label of the item chosen in pick_item
in_range($origin, tile, 5) → reticle constrained by the flow's origin
$target_tile.x             → x coord of the tile the player picked
```

Referencing an unbound `$name` is a **load-time** error with a hint
listing the bindings the flow *does* produce.

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
