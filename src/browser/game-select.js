export const DEFAULT_GAME_ID = 'silly';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidGameId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function resolveGameId(searchParams) {
  const raw = searchParams.get('game');
  return isValidGameId(raw) ? raw : DEFAULT_GAME_ID;
}

export function getCandidatePaths(id) {
  return [`./games/${id}/game.yaml`, `./games/${id}.yaml`];
}
