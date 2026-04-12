# Silly Game — Rogue Engine Port

A five-level roguelike dungeon crawl, faithfully ported from
[andlima/silly-game](https://github.com/andlima/silly-game) to
rogue-engine's data-driven YAML DSL.

Every constant, formula, and message string lives in `game.yaml` — the
engine has no silly-game-specific code.

## Running

```bash
node cli.js --game games/silly/game.yaml
```

## Remixability Examples

The whole point of a data-driven engine is that you can change the game
by editing YAML, not code. Here are three worked examples.

---

### 1. Triple the dragons on level 5

Open `game.yaml` and find the `spawn_tables.monsters` section. Change
the dragon's weight from 15 to 45:

```yaml
# Before
      - id: dragon
        weight: 15
        when: "state.level >= 4"

# After
      - id: dragon
        weight: 45
        when: "state.level >= 4"
```

**Effect**: On levels 4–5, dragons now make up ~45% of monster spawns
instead of ~15%. The dungeon becomes significantly more dangerous in
the late game.

---

### 2. Rename `gold` to `souls` and double food healing

Two changes in `game.yaml`:

**A. Rename gold to souls** — find the gold item and update its label:

```yaml
# Before
  - id: gold
    label: Gold
    glyph: "$"
    color: yellow
    kind: currency

# After
  - id: gold
    label: Souls
    glyph: "$"
    color: magenta
    kind: currency
```

Then update the message strings that reference gold:

```yaml
# In the move action's gold pickup effects:
# Before
          text: "You pick up {delta} gold."
# After
          text: "You harvest {delta} souls."

# In the monster death gold drop:
# Before
          text: "The {target.label} dropped {delta} gold."
# After
          text: "The {target.label} released {delta} souls."
```

**B. Double food healing** — find the `use_food` action and change
the delta from 10 to 20:

```yaml
# Before
        - type: apply
          target: actor
          measurement: hp
          delta: 10

# After
        - type: apply
          target: actor
          measurement: hp
          delta: 20
```

**Effect**: The currency is now called "Souls" with a purple glyph,
and food heals 20 HP instead of 10. The idol still costs `max_hp`
souls because its formula references the measurement, not a literal.

---

### 3. Add a sixth level with a custom boss monster

Three changes:

**A. Add the boss being**:

```yaml
# Add to the beings section:
  - id: lich
    label: Lich King
    glyph: "L"
    color: bright_magenta
    measurements:
      hp: 50
      attack: 10
      defense: 5
      awareness: 8
      min_gold: 20
      max_gold: 40
    tags: [monster]
```

**B. Increase the level count and add a spawn rule**:

```yaml
# In world section, change:
  levels:
    count: 6    # was 5

# Add a spawn_tables entry for the lich:
  spawn_tables:
    # ... existing tables ...
    lich:
      - id: lich
        weight: 1

# Add a spawn_rules entry:
  spawn_rules:
    # ... existing rules ...
    - category: lich
      count: 1
      when: "state.level >= 6"
```

**C. Update the win condition** — change level 5 to level 6 in the
descend action:

```yaml
# In the descend action's effects:
# Before
        - type: win
          when: "state.level >= 5"
# After
        - type: win
          when: "state.level >= 6"

# And the transition/message conditions similarly
        - type: message
          when: "state.level < 6"
          text: "You descend deeper into the dungeon..."
        - type: transition_level
          when: "state.level < 6"
```

**Effect**: The game now has 6 levels. Level 6 spawns a Lich King (50 HP,
10 ATK, 5 DEF) alongside the usual monsters. The player must defeat or
evade the boss to reach the final stair and escape.
