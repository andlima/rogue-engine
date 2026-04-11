/**
 * ANSI text renderer — consumes the rendering section from a GameDefinition.
 */

import { evaluate } from '../expressions/evaluator.js';

// ANSI color codes
const ANSI_COLORS = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bright_red: '\x1b[91m',
  bright_green: '\x1b[92m',
  bright_yellow: '\x1b[93m',
  bright_blue: '\x1b[94m',
  bright_magenta: '\x1b[95m',
  bright_cyan: '\x1b[96m',
  bright_white: '\x1b[97m',
};
const ANSI_RESET = '\x1b[0m';

function colorize(ch, color) {
  if (!color || !ANSI_COLORS[color]) return ch;
  return `${ANSI_COLORS[color]}${ch}${ANSI_RESET}`;
}

/**
 * Render a 2D grid of visible tiles to a string.
 * If renderingConfig is provided, applies glyph/color overrides.
 */
export function renderToString(grid, renderingConfig) {
  return grid.map(row =>
    row.map(cell => {
      let ch = cell.ch;
      let color = cell.color;

      // Apply rendering overrides for tiles
      if (renderingConfig?.tiles?.[ch]) {
        const override = renderingConfig.tiles[ch];
        if (override.glyph) ch = override.glyph;
        if (override.color) color = override.color;
      }

      return colorize(ch, color);
    }).join('')
  ).join('\n');
}

/**
 * Render a status bar showing measurement values.
 * If renderingConfig.hud is provided, use its measurement list.
 */
export function renderStatus(state) {
  const { player, definition } = state;
  const hud = definition.rendering?.hud;

  let measurementList;
  if (hud?.measurements) {
    measurementList = hud.measurements.map(entry => {
      const id = typeof entry === 'string' ? entry : entry.id;
      return definition._index.measurements[id];
    }).filter(Boolean);
  } else {
    measurementList = definition.measurements;
  }

  const parts = measurementList.map(m => {
    const val = player.measurements[m.id];
    return `${m.label}: ${val}`;
  });
  return parts.join('  |  ');
}

/**
 * Render the message log.
 */
export function renderMessages(state, maxLines) {
  const messages = state.messages || [];
  const hud = state.definition.rendering?.hud;
  const limit = maxLines ?? hud?.message_log_size ?? 5;
  return messages.slice(-limit);
}

/**
 * Get the effective glyph and color for a being entity.
 * Checks rendering overrides, then falls back to definition defaults.
 */
export function getBeingAppearance(beingId, definition, state) {
  const beingDef = definition._index.beings[beingId];
  if (!beingDef) return { glyph: '?', color: null };

  let glyph = beingDef.glyph;
  let color = beingDef.color;

  // Apply rendering overrides
  const renderOverride = definition.rendering?.beings?.[beingId];
  if (renderOverride) {
    if (renderOverride.glyph) glyph = renderOverride.glyph;
    if (renderOverride.color) color = renderOverride.color;
  }

  // Apply status rules (conditional overrides)
  if (definition.rendering?.status_rules && state) {
    // Find the actual being entity to evaluate status rules against
    const beingEntity = state.entities.find(e => e.id === beingId && e.kind === 'being');
    const beingView = beingEntity
      ? { ...beingEntity, ...beingEntity.measurements }
      : state.player;
    const scope = {
      actor: beingView,
      self: beingView,
      player: state.player,
      state: { level: state.level, turn: state.turn },
    };
    for (const rule of definition.rendering.status_rules) {
      if (rule.when) {
        try {
          const result = evaluate(rule.when.ast, scope, { rng: state.rng });
          if (result) {
            if (rule.glyph_color) color = rule.glyph_color;
            if (rule.glyph) glyph = rule.glyph;
          }
        } catch {
          // Skip broken rules at runtime
        }
      }
    }
  }

  return { glyph, color };
}

/**
 * Get the effective glyph and color for an item entity.
 */
export function getItemAppearance(itemId, definition) {
  const itemDef = definition._index.items[itemId];
  if (!itemDef) return { glyph: '?', color: null };

  let glyph = itemDef.glyph;
  let color = itemDef.color;

  const renderOverride = definition.rendering?.items?.[itemId];
  if (renderOverride) {
    if (renderOverride.glyph) glyph = renderOverride.glyph;
    if (renderOverride.color) color = renderOverride.color;
  }

  return { glyph, color };
}
