/**
 * Canvas renderer — paints the map grid and reticle on a `<canvas>`.
 *
 * Only the map-grid surface lives here; the browser entry renders HUD,
 * messages, key-hint, and help panel into DOM elements directly. See
 * docs/rendering.md "Browser renderer".
 *
 * The constructor accepts an injected canvas element so this module
 * remains importable in Node for unit tests (pass a stub whose
 * `getContext('2d')` returns a recording mock).
 */

// Canvas-friendly CSS equivalents of the ANSI color names used by
// `ascii.js`. Authors name colors semantically in the YAML; each
// renderer maps those names to its own palette.
const CANVAS_COLORS = {
  black: '#000000',
  red: '#d24f4f',
  green: '#4fae4f',
  yellow: '#d9b54a',
  blue: '#4f7fd2',
  magenta: '#b86fb8',
  cyan: '#4fb8b8',
  white: '#cccccc',
  gray: '#7a7a7a',
  bright_red: '#ff6a6a',
  bright_green: '#6fdf6f',
  bright_yellow: '#ffd76a',
  bright_blue: '#6fa3ff',
  bright_magenta: '#ff8ce8',
  bright_cyan: '#6fe0e0',
  bright_white: '#ffffff',
};

const DEFAULT_FG = '#cccccc';
const DEFAULT_BG = '#0a0a0a';
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_TILE_SIZE = 28;

export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement|object} canvasEl — real canvas or a test stub
   * @param {object} [renderingConfig] — `rendering` section from a GameDefinition
   */
  constructor(canvasEl, renderingConfig) {
    this.canvas = canvasEl;
    this.config = renderingConfig || {};
    this.ctx = canvasEl.getContext('2d');
    this.tileSize = DEFAULT_TILE_SIZE;
    this.fontSize = DEFAULT_FONT_SIZE;
    this.font = `${this.fontSize}px monospace`;
  }

  clear() {
    const w = this.canvas.width ?? this.tileSize;
    const h = this.canvas.height ?? this.tileSize;
    this.ctx.fillStyle = DEFAULT_BG;
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.clearRect(0, 0, w, h);
  }

  /**
   * Paint a 2D `{ch, color}` grid to the canvas. Resolves tile overrides
   * from `renderingConfig.tiles` the same way `renderToString` in
   * `ascii.js` does, honoring emoji mode when `stateOrMode` requests it.
   */
  drawGrid(grid, stateOrMode) {
    const mode = typeof stateOrMode === 'string'
      ? stateOrMode
      : stateOrMode?.displayMode ?? 'ascii';
    const emoji = mode === 'emoji';
    const tiles = this.config?.tiles;

    const rows = grid.length;
    const cols = rows > 0 ? grid[0].length : 0;
    const width = cols * this.tileSize;
    const height = rows * this.tileSize;
    if (typeof this.canvas.width === 'number' && this.canvas.width !== width) {
      this.canvas.width = width;
    }
    if (typeof this.canvas.height === 'number' && this.canvas.height !== height) {
      this.canvas.height = height;
    }

    this.ctx.fillStyle = DEFAULT_BG;
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.font = this.font;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';

    for (let y = 0; y < rows; y++) {
      const row = grid[y];
      for (let x = 0; x < cols; x++) {
        const cell = row[x];
        let ch = cell.ch;
        let color = cell.color;

        const override = tiles?.[ch];
        if (override) {
          if (emoji && override.emoji) {
            ch = override.emoji;
          } else if (override.glyph) {
            ch = override.glyph;
          }
          if (override.color) color = override.color;
        }

        this.ctx.fillStyle = CANVAS_COLORS[color] || DEFAULT_FG;
        const px = x * this.tileSize;
        const py = y * this.tileSize;
        // Small vertical offset keeps the glyph visually centered
        // within the cell at the chosen font size.
        const offsetY = Math.floor((this.tileSize - this.fontSize) / 2);
        this.ctx.fillText(ch, px + 2, py + offsetY);
      }
    }
  }

  /**
   * Overlay a reticle indicator over the already-painted grid at the
   * on-grid position of `target` relative to `viewOrigin`.
   */
  drawReticle(grid, viewOrigin, target, indicator) {
    if (!grid || !target) return;
    const gy = target.y - viewOrigin.y;
    const gx = target.x - viewOrigin.x;
    if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) return;

    const ch = indicator?.glyph || '*';
    const color = indicator?.color || 'yellow';
    this.ctx.font = this.font;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = CANVAS_COLORS[color] || DEFAULT_FG;
    const px = gx * this.tileSize;
    const py = gy * this.tileSize;
    const offsetY = Math.floor((this.tileSize - this.fontSize) / 2);
    this.ctx.fillText(ch, px + 2, py + offsetY);
  }
}
