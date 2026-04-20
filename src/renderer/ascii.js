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

// ── Interaction-flow surfaces ────────────────────────────────────────────

/**
 * Render a bordered panel with a title and rows. Returns a string.
 *
 * @param {object} panel — { title, columns: [{ header, width? }], rows: Array<string[]> }
 * @param {number} cursor — index of the highlighted row (optional)
 */
export function drawPanel(panel, cursor = 0) {
  const title = panel.title || '';
  const columns = panel.columns || [];
  const rows = panel.rows || [];

  // Compute column widths
  const widths = columns.map((col, i) => {
    const headerW = (col.header || '').length;
    const rowW = Math.max(0, ...rows.map(r => String(r[i] ?? '').length));
    return Math.max(headerW, rowW, col.width || 0);
  });

  const totalInner = widths.reduce((s, w) => s + w, 0) + Math.max(0, (widths.length - 1) * 2);
  const bar = '─'.repeat(Math.max(totalInner + 2, title.length + 2));
  const top = `┌${bar}┐`;
  const bottom = `└${bar}┘`;
  const titleLine = `│ ${padRight(title, bar.length - 1)}│`;
  const sep = `├${bar}┤`;

  const headerRow = columns.length > 0
    ? `│ ${columns.map((col, i) => padRight(col.header || '', widths[i])).join('  ')} │`
    : null;

  const rowLines = rows.map((r, i) => {
    const marker = i === cursor ? '>' : ' ';
    const cells = columns.map((_, ci) => padRight(String(r[ci] ?? ''), widths[ci])).join('  ');
    return `│${marker}${cells} │`;
  });

  const lines = [top, titleLine];
  if (headerRow) {
    lines.push(sep, headerRow, sep);
  } else {
    lines.push(sep);
  }
  lines.push(...rowLines, bottom);
  return lines.join('\n');
}

function padRight(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

/**
 * Render a prompt banner string (plain text with optional title/message).
 */
export function drawPrompt(prompt) {
  if (!prompt) return '';
  const parts = [];
  if (prompt.title) parts.push(`[${prompt.title}]`);
  if (prompt.message) parts.push(prompt.message);
  return parts.join(' ');
}

/**
 * Overlay a target reticle on a pre-rendered grid.
 *
 * @param {Array<Array<{ch, color}>>} grid
 * @param {{ x, y }} viewOrigin — top-left map coord of the grid
 * @param {{ x, y }} target — map coord to highlight
 * @param {{ glyph, color }} indicator
 * @returns {Array<Array<{ch, color}>>} — new grid
 */
export function drawReticle(grid, viewOrigin, target, indicator) {
  if (!grid || !target) return grid;
  const gy = target.y - viewOrigin.y;
  const gx = target.x - viewOrigin.x;
  if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) return grid;
  const result = grid.map(row => row.slice());
  result[gy][gx] = {
    ch: indicator?.glyph || '*',
    color: indicator?.color || 'yellow',
  };
  return result;
}

// ── Help panel & key hint ─────────────────────────────────────────────────

/**
 * Render the generated help panel. Accepts the shape returned by
 * `getHelpRows(definition, state)`:
 *   { title, sections: [{ header, rows: [{ keys, label, summary }] }] }
 *
 * The rendering goes through the same `drawPanel` machinery the flow
 * runner uses for item pickers, so both surfaces feel cohesive.
 */
export function drawHelpPanel(help) {
  if (!help) return '';
  const title = help.title || 'Commands';
  const lines = [];
  const sections = help.sections || [];
  // Collect rows as panel-shaped data so drawPanel can lay them out.
  // Each section yields a header row plus its rows.
  for (const sec of sections) {
    if (!sec.rows || sec.rows.length === 0) continue;
    const panelRows = sec.rows.map(r => [
      r.keys.join('/') || '',
      r.label || '',
      r.summary || '',
    ]);
    lines.push(drawPanel({
      title: sec.header || title,
      columns: [
        { header: 'Key', width: 10 },
        { header: 'Action', width: 18 },
        { header: 'Description' },
      ],
      rows: panelRows,
    }, -1));
  }
  return lines.join('\n');
}

/**
 * Render the one-line key-hint surface that sits beneath the viewport
 * while a flow or panel is active. The `hint` argument is the string
 * produced by `getKeyHint(definition, state, intrinsic)`.
 */
export function drawKeyHint(hint) {
  if (!hint) return '';
  return hint;
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
