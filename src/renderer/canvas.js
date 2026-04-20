/**
 * Canvas renderer stub — proves the rendering contract is renderer-agnostic.
 *
 * Accepts the same rendering config as the ANSI renderer and exposes a
 * draw(state) method. Implementation is intentionally deferred.
 *
 * TODO: https://github.com/andlima/rogue-engine/issues/canvas-renderer
 */

export class CanvasRenderer {
  /**
   * @param {object} renderingConfig — the `rendering` section from a GameDefinition
   */
  constructor(renderingConfig) {
    this.config = renderingConfig || {};
  }

  /**
   * Draw the current game state to a canvas.
   * @param {object} state — a GameState object
   */
  draw(state) {
    throw new Error('CanvasRenderer.draw() is not implemented — see TODO link above');
  }

  /**
   * Draw a panel surface (inventory / menu). Accepts the same semantic
   * descriptor shape the ANSI renderer consumes.
   */
  drawPanel(panel, cursor) {
    throw new Error('CanvasRenderer.drawPanel() is not implemented — see TODO link above');
  }

  /**
   * Draw a prompt banner.
   */
  drawPrompt(prompt) {
    throw new Error('CanvasRenderer.drawPrompt() is not implemented — see TODO link above');
  }

  /**
   * Overlay a target reticle while pick_tile / pick_being is active.
   */
  drawReticle(grid, viewOrigin, target, indicator) {
    throw new Error('CanvasRenderer.drawReticle() is not implemented — see TODO link above');
  }

  /**
   * Render the generated help panel. Accepts the shape produced by
   * `getHelpRows(definition, state)`. Shared contract — see
   * docs/rendering.md.
   */
  drawHelpPanel(help) {
    throw new Error('CanvasRenderer.drawHelpPanel() is not implemented — see TODO link above');
  }

  /**
   * Render the one-line key-hint surface beneath the viewport while a
   * flow or panel is active. Accepts the string produced by
   * `getKeyHint(definition, state, intrinsic)`.
   */
  drawKeyHint(hint) {
    throw new Error('CanvasRenderer.drawKeyHint() is not implemented — see TODO link above');
  }
}
