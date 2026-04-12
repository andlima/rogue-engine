# Silly Game Reference Source

This directory contains reference material used to verify parity between
the rogue-engine port (`games/silly/game.yaml`) and the original silly-game.

## Upstream

- **Repository**: https://github.com/andlima/silly-game
- **Key files consulted**:
  - `src/game.js` — game constants, combat formula, monster AI, item logic
  - `src/dungeon.js` — dungeon generation parameters (80x50, 5-10 rooms, 4-10 room size)
  - `src/fov.js` — recursive shadowcasting (torch radius 6, brightness formula)

## Constants Transcribed

All constants were transcribed exactly from the source:

| Constant | Value | Source |
|----------|-------|--------|
| Player HP | 30 | game.js |
| Player ATK | 5 | game.js |
| Player DEF | 2 | game.js |
| Rat HP/ATK/DEF/AW | 5/2/0/3 | game.js MONSTER_TYPES |
| Skeleton HP/ATK/DEF/AW | 10/4/1/4 | game.js MONSTER_TYPES |
| Bear HP/ATK/DEF/AW | 20/6/3/5 | game.js MONSTER_TYPES |
| Dragon HP/ATK/DEF/AW | 30/8/4/6 | game.js MONSTER_TYPES |
| Dagger bonus | +2 ATK | game.js EQUIPMENT_TYPES |
| Sword bonus | +4 ATK | game.js EQUIPMENT_TYPES |
| Helmet bonus | +1 DEF | game.js EQUIPMENT_TYPES |
| Shield bonus | +2 DEF | game.js EQUIPMENT_TYPES |
| Food heal | 10 HP | game.js |
| Idol cost | max_hp gold | game.js |
| Idol bonus | +5 max HP, full heal | game.js |
| Gold value | 2 * level | game.js |
| Torch radius | 6 | fov.js |
| Map size | 80x50 | dungeon.js |
| Room count | 5-10 | dungeon.js |
| Room size | 4-10 | dungeon.js |
| Max messages | 20 | game.js |
| Win level | 5 | game.js |

## Combat Formula

```
damage = max(0, attacker.attack + equip_bonus - defender.defense + random(-1, +1))
```

## Monster AI

1. If staggered: skip turn, clear stagger
2. If adjacent (manhattan ≤ 1): attack player, set staggered
3. If within awareness and LOS: move toward player (prefer larger gap axis)
4. Otherwise: idle

## Note

This is a test-time reference only. It does not ship with the engine runtime.
