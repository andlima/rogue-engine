/**
 * Engine-wide built-in bindings and actions.
 *
 * These are merged AFTER a game's `input.bindings` in the resolution walk,
 * so a game declaration for the same key (or action id) takes precedence
 * on the first-match rule.
 */

/**
 * Built-in action descriptors. These action ids are accepted by the
 * binding validator even when the game YAML does not declare them under
 * `actions.player`. The runtime handles each id specially at dispatch.
 */
export const BUILTIN_ACTIONS = {
  open_help: {
    id: 'open_help',
    label: 'Help',
    summary: 'Show the help panel',
  },
  cancel: {
    id: 'cancel',
    label: 'Cancel',
    summary: 'Close panel / cancel flow',
  },
  quit: {
    id: 'quit',
    label: 'Quit',
    summary: 'Exit the run',
  },
  // Movement pseudo-actions — resolved by the renderer into
  // `{ type: 'move', dir: ... }` dispatches. Games may rebind them
  // without declaring them under `actions.player`.
  move_n: { id: 'move_n', label: 'Move north', summary: 'Move one tile north' },
  move_s: { id: 'move_s', label: 'Move south', summary: 'Move one tile south' },
  move_e: { id: 'move_e', label: 'Move east',  summary: 'Move one tile east' },
  move_w: { id: 'move_w', label: 'Move west',  summary: 'Move one tile west' },
  interact: { id: 'interact', label: 'Interact', summary: 'Interact with the current tile' },
  toggle_display: {
    id: 'toggle_display',
    label: 'Toggle display',
    summary: 'Switch between ASCII and emoji display modes',
  },
};

export const BUILTIN_ACTION_IDS = new Set(Object.keys(BUILTIN_ACTIONS));

export const BUILTIN_CONTEXTS = new Set(['map', 'panel', 'flow', 'targeting']);

/**
 * Default bindings the engine adds after every game's `input.bindings`.
 *
 * `context: '*'` means "apply to every context" — the validator expands
 * this into one entry per built-in context so the first-match walk can
 * treat bindings uniformly.
 */
export const BUILTIN_BINDINGS = [
  { key: '?',      action: 'open_help', context: '*' },
  { key: 'ESC',    action: 'cancel',    context: 'flow' },
  { key: 'ESC',    action: 'cancel',    context: 'panel' },
  { key: 'CTRL+c', action: 'quit',      context: '*' },
];
