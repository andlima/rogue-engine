const DIRECTIONS = {
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
};

function handleMove(state, action) {
  const delta = DIRECTIONS[action.dir];
  if (!delta) return state;

  const nx = state.player.x + delta.dx;
  const ny = state.player.y + delta.dy;
  const { map } = state.definition;

  // Out of bounds check
  if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) {
    return state;
  }

  // Wall check
  if (map.tiles[ny][nx] === '#') {
    return state;
  }

  return {
    ...state,
    turn: state.turn + 1,
    player: {
      ...state.player,
      x: nx,
      y: ny,
    },
  };
}

/**
 * Dispatch an action against the current state, returning a new state.
 * The previous state is never mutated.
 */
export function dispatch(state, action) {
  switch (action.type) {
    case 'move':
      return handleMove(state, action);
    default:
      return state;
  }
}
