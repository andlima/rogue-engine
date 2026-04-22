import { isValidGameId } from './game-select.js';

const MANIFEST_PATH = './games/index.json';
const REQUIRED_FIELDS = ['id', 'title', 'description'];

export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid manifest JSON: ${err.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('Manifest must be a JSON array');
  }
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (entry == null || typeof entry !== 'object') {
      throw new Error(`Manifest entry ${i} is missing id`);
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string') {
        throw new Error(`Manifest entry ${i} is missing ${field}`);
      }
    }
    if (!isValidGameId(entry.id)) {
      throw new Error(`Manifest entry ${i} has invalid id: "${entry.id}"`);
    }
  }
  return data;
}

export async function loadManifest(fetchImpl = fetch) {
  const res = await fetchImpl(MANIFEST_PATH);
  if (!res.ok) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH} (status ${res.status})`);
  }
  const text = await res.text();
  return parseManifest(text);
}
