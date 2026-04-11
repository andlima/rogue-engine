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
}
