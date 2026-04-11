/**
 * Seeded PRNG — mulberry32.
 * Fast, simple, 32-bit state, good enough for a roguelike.
 * Returns a function that yields the next float in [0, 1).
 */
export function createRng(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a random integer in [lo, hi] (inclusive).
 */
export function randomInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Pick from a weighted list: [{ weight, value }].
 * Returns value of the chosen entry.
 */
export function weightedPick(rng, entries) {
  if (entries.length === 0) return undefined;
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}
