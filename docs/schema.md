# Game Definition Schema

A rogue-engine game is defined by a single YAML file with the following
top-level sections. The engine loader validates this schema at load time;
runtime code can trust validated data without further checks.

## `meta`

Game metadata. Required.

| Field              | Type   | Required | Description |
|--------------------|--------|----------|-------------|
| `id`               | string | yes      | Unique game identifier (slug) |
| `name`             | string | yes      | Human-readable game name |
| `version`          | string | yes      | Semantic version string |
| `description`      | string | no       | Optional description |
| `player_archetype` | string | yes      | ID of the being archetype used for the player |

## `measurements`

Array of named numeric resources. These are abstract — `hp`, `stamina`,
`gold`, `xp` are all the same kind of thing to the engine.

| Field     | Type                       | Required | Default | Description |
|-----------|----------------------------|----------|---------|-------------|
| `id`      | string                     | yes      |         | Unique identifier |
| `label`   | string                     | yes      |         | Display name |
| `min`     | number                     | no       | `0`     | Minimum value |
| `max`     | number \| string \| null   | no       | `null`  | Maximum value. Can be a literal number, another measurement's ID (e.g. `"max_hp"`), or `null` for unbounded |
| `initial` | number                     | yes      |         | Starting value |
| `regen`   | number                     | no       |         | Amount regenerated per turn |

### Cross-reference resolution for `max`

When `max` is a string, it must match the `id` of another measurement in the
same file. The loader validates this reference at load time. Resolution of the
actual numeric value happens at runtime using the entity's current measurement
values.

## `beings`

Array of being archetypes (player, monsters, NPCs).

| Field          | Type             | Required | Description |
|----------------|------------------|----------|-------------|
| `id`           | string           | yes      | Unique identifier |
| `label`        | string           | yes      | Display name |
| `glyph`        | string           | yes      | Single character for map rendering |
| `color`        | string           | yes      | Display color name |
| `measurements` | object           | no       | Map of measurement ID → initial value override |
| `tags`         | array of strings | no       | Arbitrary tags for grouping/filtering |

The player archetype is identified by `meta.player_archetype`. Every
measurement ID referenced in a being's `measurements` object must exist in
the top-level `measurements` array.

## `items`

Array of item archetypes.

| Field   | Type             | Required | Description |
|---------|------------------|----------|-------------|
| `id`    | string           | yes      | Unique identifier |
| `label` | string           | yes      | Display name |
| `glyph` | string           | yes      | Single character for map rendering |
| `color` | string           | yes      | Display color name |
| `kind`  | string           | yes      | One of: `consumable`, `equipment`, `currency`, `container` |
| `tags`  | array of strings | no       | Arbitrary tags |

Item behaviors (pickup, use, equip effects) are not part of this schema
version — they are defined by the actions DSL in a follow-up spec.

## `map`

A static map definition for the game world.

| Field    | Type             | Required | Description |
|----------|------------------|----------|-------------|
| `width`  | number           | yes      | Map width in tiles |
| `height` | number           | yes      | Map height in tiles |
| `tiles`  | array of strings | yes      | Row strings where each character is a tile |

### Tile characters

| Char | Meaning      |
|------|-------------|
| `#`  | Wall         |
| `.`  | Floor        |
| `@`  | Player spawn |

The `tiles` array must contain exactly `height` strings, each of length
`width`. Exactly one `@` tile must be present. The player archetype
referenced by `meta.player_archetype` must exist in `beings`.
