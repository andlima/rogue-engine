# rogue-engine

A data-driven roguelike engine where gameplay is defined entirely by YAML
configuration, not code. Instead of hard-coding game rules, stats, and
content, everything is described in a YAML file that the engine loads,
validates, and runs.

## Quick Start

```bash
npm install
node cli.js --game games/minimal.yaml
```

Move with **arrow keys** or **WASD**. Quit with **q**.

## Playing in the browser

```bash
npm run serve
```

Then open [http://localhost:8000](http://localhost:8000). Arrow keys to
move, TAB to toggle emoji mode, `?` for help.

## Project Structure

```
cli.js              – CLI entrypoint
src/
  config/loader.js  – YAML loader and schema validator
  runtime/state.js  – GameState creation
  runtime/dispatch.js – Action dispatcher (functional, immutable)
  runtime/view.js   – Viewport / visible tiles helper
  renderer/ascii.js – ASCII text renderer
test/               – Unit tests (node:test)
games/              – YAML game definitions
docs/               – Schema documentation
```

## Running Tests

```bash
npm test
```

Tests use Node's built-in `node:test` runner (Node >= 20).

## Schema

See [docs/schema.md](docs/schema.md) for the full game definition schema.

A game YAML file has these top-level sections:

- **`meta`** – game identity and player archetype reference
- **`measurements`** – named numeric resources (hp, stamina, gold, etc.)
- **`beings`** – creature archetypes (player, monsters)
- **`items`** – item archetypes (consumable, equipment, currency, container)
- **`map`** – static tile map with player spawn

## Dependency Policy

**Zero runtime dependencies** except for a YAML parser (`yaml` on npm).
Dev/test dependencies are allowed but should be kept minimal. This policy
keeps the engine lightweight and avoids supply-chain risk.

## Design Principles

- **Data-driven**: the engine knows nothing about specific measurements,
  beings, or items — `hp` is just another measurement declared in YAML.
- **Functional and immutable**: every `dispatch(state, action)` returns a
  new state; the previous state is never mutated.
- **Validate at load time**: the loader validates all cross-references and
  types so runtime code can trust its inputs.
- **GameDefinition vs GameState**: loaded config (read-only) and per-turn
  runtime state (replaced each dispatch) are distinct types.
