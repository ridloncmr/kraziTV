const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const utf8 = new TextEncoder();

/**
 * Plain FNV-1a 32-bit over the UTF-8 bytes of `text`. Encodes explicitly so
 * non-ASCII IDs hash identically on every platform.
 */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8.encode(text)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The murmur3 `fmix32` finalizer. FNV-1a mixes its low bits weakly, and
 * random selection reduces hashes modulo small counts, so every output bit
 * must depend on every input bit.
 */
function fmix32(input: number): number {
  let hash = input;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * The project-owned source of determinism for schedule generation: FNV-1a
 * then `fmix32`, as an unsigned 32-bit integer. Uses only `Math.imul` and
 * unsigned shifts so every JavaScript runtime computes identical values.
 */
export function hash32(text: string): number {
  return fmix32(fnv1a32(text));
}

/**
 * Derives a channel's persisted seed from its identity and schedule anchor,
 * so a channel whose schedule restarts from a new anchor gets a fresh random
 * sequence while one that keeps its anchor replays the same one.
 */
export function deriveChannelSeed(
  channelId: string,
  anchorTime: number,
): number {
  return hash32(`channel:${channelId}:${anchorTime}`);
}

/**
 * Derives the seed random selection uses for one collection on one channel.
 * Keyed by collection rather than block, so separate blocks of the same
 * collection continue one sequence while different collections stay unrelated.
 */
export function deriveCollectionSeed(
  channelSeed: number,
  collectionId: string,
): number {
  return hash32(`collection:${channelSeed}:${collectionId}`);
}
