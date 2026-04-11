import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFromFile } from '../src/config/loader.js';
import { createState } from '../src/runtime/state.js';
import { dispatch, buildScope } from '../src/runtime/dispatch.js';
import { applyEffects } from '../src/runtime/effects.js';
import { evaluate } from '../src/expressions/evaluator.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOY_YAML_PATH = join(__dirname, '..', 'games', 'toy-hit-and-heal.yaml');

describe('e2e: toy-hit-and-heal', () => {
  it('loads the game definition successfully', async () => {
    const def = await loadFromFile(TOY_YAML_PATH);
    assert.equal(def.meta.id, 'toy-hit-and-heal');
    assert.equal(def.beings.length, 2);
    assert.equal(def.actions.player.length, 3);
    assert.equal(def.actions.ai.length, 2);
    assert.ok(def.world);
    assert.ok(def.world.loss_conditions);
    assert.ok(def.rendering);
  });

  it('creates initial state with correct values', async () => {
    const def = await loadFromFile(TOY_YAML_PATH);
    const state = createState(def, 123);
    assert.equal(state.player.measurements.hp, 20);
    assert.equal(state.player.measurements.mp, 5);
    assert.equal(state.level, 1);
    assert.equal(state.turn, 0);
    assert.equal(state.terminal, null);
  });

  it('runs 10 scripted turns with deterministic state transitions', async () => {
    const def = await loadFromFile(TOY_YAML_PATH);
    const state = createState(def, 123);

    // Spawn a healer entity so AI actions have something to do
    const healerDef = def._index.beings.healer;
    const healerEntity = {
      id: 'healer',
      kind: 'being',
      label: 'Healer',
      glyph: 'h',
      color: 'green',
      tags: [...healerDef.tags],
      x: 3, y: 2,
      measurements: { hp: 10, mp: 10 },
      inventory: [],
      equipment: Object.create(null),
      name: 'Healer',
    };

    let current = { ...state, entities: [healerEntity] };

    // Turn 1: Player attacks the healer
    const attackAction = def._index.playerActions.attack;
    let scope = buildScope(current, current.player, current.entities[0]);
    scope._rng = current.rng;
    current = applyEffects(current, attackAction.effects, scope);
    assert.equal(current.entities[0].measurements.hp, 7, 'healer hp after attack');
    current = { ...current, turn: current.turn + 1 };

    // Turn 2: Player attacks again
    scope = buildScope(current, current.player, current.entities[0]);
    scope._rng = current.rng;
    current = applyEffects(current, attackAction.effects, scope);
    assert.equal(current.entities[0].measurements.hp, 4, 'healer hp after second attack');
    current = { ...current, turn: current.turn + 1 };

    // Turn 3: Player heals (costs 2 mp, heals 3 hp — but already at 20, so stays at 20)
    const healAction = def._index.playerActions.heal;
    // Check requires: actor.mp >= 2
    scope = buildScope(current, current.player, current.player);
    scope._rng = current.rng;
    const reqMet = evaluate(healAction.requires[0].ast, scope, { rng: current.rng });
    assert.ok(reqMet, 'heal precondition should pass (mp=5 >= 2)');
    current = applyEffects(current, healAction.effects, scope);
    assert.equal(current.player.measurements.mp, 3, 'mp after heal');
    assert.equal(current.player.measurements.hp, 20, 'hp stays capped at 20');
    current = { ...current, turn: current.turn + 1 };

    // Turn 4: Player waits
    const waitAction = def._index.playerActions.wait;
    scope = buildScope(current, current.player, current.player);
    scope._rng = current.rng;
    current = applyEffects(current, waitAction.effects, scope);
    assert.ok(current.messages.length > 0, 'wait produces a message');
    current = { ...current, turn: current.turn + 1 };

    // Turn 5: AI healer heals itself (hp=4 < 8, condition triggers)
    const aiHeal = def.actions.ai[0]; // ai_heal
    scope = buildScope(current, current.entities[0], current.player);
    scope._rng = current.rng;
    const aiCondMet = evaluate(aiHeal.condition.ast, scope, { rng: current.rng });
    assert.ok(aiCondMet, 'ai_heal condition should be true (healer hp=4 < 8)');
    current = applyEffects(current, aiHeal.effects, scope);
    assert.equal(current.entities[0].measurements.hp, 6, 'healer hp after ai self-heal');
    current = { ...current, turn: current.turn + 1 };

    // Turn 6: Player attacks again
    scope = buildScope(current, current.player, current.entities[0]);
    scope._rng = current.rng;
    current = applyEffects(current, attackAction.effects, scope);
    assert.equal(current.entities[0].measurements.hp, 3, 'healer hp after 3rd attack');
    current = { ...current, turn: current.turn + 1 };

    // Turn 7: Player heals again
    scope = buildScope(current, current.player, current.player);
    scope._rng = current.rng;
    current = applyEffects(current, healAction.effects, scope);
    assert.equal(current.player.measurements.mp, 1, 'mp after 2nd heal');
    current = { ...current, turn: current.turn + 1 };

    // Turn 8: Player attacks (healer goes to 0)
    scope = buildScope(current, current.player, current.entities[0]);
    scope._rng = current.rng;
    current = applyEffects(current, attackAction.effects, scope);
    assert.equal(current.entities[0].measurements.hp, 0, 'healer defeated');
    current = { ...current, turn: current.turn + 1 };

    // Turn 9: Player waits
    scope = buildScope(current, current.player, current.player);
    scope._rng = current.rng;
    current = applyEffects(current, waitAction.effects, scope);
    current = { ...current, turn: current.turn + 1 };

    // Turn 10: Player waits again
    scope = buildScope(current, current.player, current.player);
    scope._rng = current.rng;
    current = applyEffects(current, waitAction.effects, scope);
    current = { ...current, turn: current.turn + 1 };

    assert.equal(current.turn, 10);
    assert.equal(current.player.measurements.hp, 20, 'player hp preserved');
    assert.equal(current.player.measurements.mp, 1, 'player mp after heals');
    assert.equal(current.entities[0].measurements.hp, 0, 'healer defeated');
    assert.ok(current.messages.length >= 10, 'messages were accumulated');
  });

  it('triggers loss condition when player hp reaches 0', async () => {
    const def = await loadFromFile(TOY_YAML_PATH);
    const state = createState(def, 123);

    // Manually set player hp to 0 and check win/loss
    let current = {
      ...state,
      player: { ...state.player, measurements: { ...state.player.measurements, hp: 0 } },
    };

    // Dispatch any action to trigger condition check
    const next = dispatch(current, { type: 'action', trigger: 'wait' });
    assert.equal(next.terminal, 'lose');
  });
});
