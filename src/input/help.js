/**
 * Generated help-screen rows.
 *
 * `getHelpRows(definition, state)` produces a flat list of rows that both
 * renderers consume. Grouping by `input.help.sections` is returned as
 * `{ header, rows }` groups; ungrouped games collapse to a single
 * "Commands" group sorted by declaration order.
 *
 * Rules (per spec criterion 7):
 *  - Bindings listed in `input.help.hide` (by action id) are filtered out.
 *  - Bindings whose `when` explicitly references `state.debug` are
 *    filtered out unless `state.debug` is true.
 *  - Other `when` guards (tile-kind, target-presence, etc.) do NOT filter
 *    rows — those bindings stay discoverable in help and the resolver
 *    decides at runtime whether they fire.
 *  - Bindings that compare equal — same `(action, key combo)` — collapse
 *    into a single row so built-ins registered with `context: '*'` (which
 *    the loader expands per built-in context) don't repeat themselves.
 *  - Built-in bindings appear at the bottom of the default "Commands"
 *    group when no sections are declared.
 *  - Each row shows: `keys` (array of display strings), `label`
 *    (binding.label || action.label || action.id), and `summary`
 *    (action.summary || "").
 */

import { BUILTIN_ACTIONS } from './builtin-bindings.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function displayKeys(binding) {
  if (binding.kind === 'key') return binding.keys.slice();
  if (binding.kind === 'sequence') return [binding.sequence.join(' ')];
  return [];
}

function referencesDebug(binding) {
  if (!binding.when || typeof binding.when !== 'string') return false;
  return /\bstate\.debug\b/.test(binding.when);
}

function lookupAction(definition, actionId) {
  const playerAction = definition._index?.playerActions?.[actionId];
  if (playerAction) {
    return {
      id: actionId,
      label: playerAction.label || actionId,
      summary: playerAction.summary || '',
    };
  }
  const builtin = BUILTIN_ACTIONS[actionId];
  if (builtin) return builtin;
  return { id: actionId, label: actionId, summary: '' };
}

function rowFor(binding, definition) {
  const action = lookupAction(definition, binding.action);
  return {
    actionId: binding.action,
    keys: displayKeys(binding),
    label: binding.label || action.label || binding.action,
    summary: action.summary || '',
    binding,
  };
}

// Built-in bindings registered with `context: '*'` are expanded by the
// loader into one entry per built-in context (map/panel/flow/targeting).
// In the help screen we want a single row per (action id, key combo)
// regardless of how many contexts share it — otherwise `open_help` would
// appear N times in the System section. Game-authored duplicates with
// identical key + action also collapse, since they would render identically.
function dedupeKey(binding) {
  return `${binding.action}\u0000${displayKeys(binding).join('/')}`;
}

// ── Filtering ────────────────────────────────────────────────────────────

function shouldHide(binding, definition, state) {
  if (binding.disabled) return true;
  const hide = definition.input?.help?.hide;
  if (Array.isArray(hide) && hide.includes(binding.action)) return true;
  if (referencesDebug(binding)) {
    const debug = !!(state?.debug ?? state?.flags?.debug);
    if (!debug) return true;
  }
  // Other `when` guards (e.g. `actor.tile.kind == "stairs_down"`) are NOT
  // applied here. Per spec criterion 7, only `input.help.hide` and
  // debug-style guards filter rows from help. Tile-guarded or
  // context-sensitive bindings should still be discoverable on the help
  // panel even when their `when` is false in the current snapshot — the
  // resolver decides whether they fire at runtime.
  return false;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Return the generated help rows grouped by section. Shape:
 *
 *   {
 *     title: string,
 *     sections: [
 *       { header: string, rows: Array<{ actionId, keys, label, summary }> }
 *     ],
 *   }
 */
export function getHelpRows(definition, state = {}) {
  const input = definition.input || {};
  const bindings = (input.bindings || []).filter(b => !shouldHide(b, definition, state));
  const help = input.help || {};
  const title = help.title || 'Commands';

  if (Array.isArray(help.sections) && help.sections.length > 0) {
    const sections = help.sections.map(sec => {
      const rows = [];
      const seen = new Set();
      for (const actionId of sec.actions || []) {
        for (const b of bindings) {
          if (b.action !== actionId) continue;
          const key = dedupeKey(b);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(rowFor(b, definition));
        }
      }
      return { header: sec.header || '', rows };
    });
    return { title, sections };
  }

  // No declared sections — group everything under "Commands", sorted by
  // declaration order (bindings already preserve that).
  const seen = new Set();
  const rows = [];
  for (const b of bindings) {
    const key = dedupeKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(rowFor(b, definition));
  }
  return { title, sections: [{ header: title, rows }] };
}

/**
 * Derive the one-line key-hint string the ANSI renderer shows beneath
 * the viewport during a flow or panel step. The hint combines:
 *   - step-intrinsic inputs provided by the caller (e.g. the flow runner)
 *   - the active context's meta-bindings (e.g. ESC → cancel, ? → help)
 *
 * Format: `"↑/↓ select · ENTER confirm · ESC cancel"`.
 */
export function getKeyHint(definition, state, intrinsic = []) {
  const input = definition.input || {};
  const bindings = input.bindings || [];
  const activeContexts = new Set(getHintContexts(state));
  const items = [...intrinsic];
  const seenActions = new Set(intrinsic.map(p => p.actionId).filter(Boolean));

  for (const b of bindings) {
    if (!activeContexts.has(b.context)) continue;
    if (b.disabled) continue;
    if (referencesDebug(b)) continue;
    if (seenActions.has(b.action)) continue;
    const keys = displayKeys(b);
    if (keys.length === 0) continue;
    const action = lookupAction(definition, b.action);
    const label = b.label || action.label || b.action;
    items.push({ keys, label, actionId: b.action });
    seenActions.add(b.action);
  }

  return items
    .map(p => `${p.keys.join('/')} ${p.label.toLowerCase()}`)
    .join(' · ');
}

function getHintContexts(state) {
  const out = [];
  if (state?.flowState) out.push('flow');
  if (state?.panelId) out.push('panel');
  // Don't include map — key hints are for active step surfaces only.
  return out;
}
