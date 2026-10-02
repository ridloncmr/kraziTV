import { describe, expect, it } from "vitest";

import {
  deriveChannelSeed,
  deriveCollectionSeed,
  fnv1a32,
  hash32,
} from "./seeded-hash.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const ANCHOR_TIME = 1_767_225_600_000;
const CHANNEL_SEED = 0x5d4886b3;

describe("fnv1a32", () => {
  it.each([
    ["", 0x811c9dc5],
    ["a", 0xe40c292c],
    ["foobar", 0xbf9cf968],
  ])("matches the published FNV-1a 32-bit vector for %j", (input, expected) => {
    expect(fnv1a32(input)).toBe(expected);
  });
});

const UINT32_MASK = 0xffffffffn;

/**
 * An independent statement of the hashing policy: arbitrary-precision BigInt
 * arithmetic over Node's UTF-8 encoder, sharing neither `Math.imul` nor
 * `TextEncoder` with the implementation. Golden values below came from it.
 */
function referenceHash32(text: string): number {
  let hash = 0x811c9dc5n;
  for (const byte of Buffer.from(text, "utf8")) {
    hash = ((hash ^ BigInt(byte)) * 0x01000193n) & UINT32_MASK;
  }
  hash ^= hash >> 16n;
  hash = (hash * 0x85ebca6bn) & UINT32_MASK;
  hash ^= hash >> 13n;
  hash = (hash * 0xc2b2ae35n) & UINT32_MASK;
  hash ^= hash >> 16n;
  return Number(hash);
}

/**
 * Deterministic inputs spanning 1- to 4-byte UTF-8 sequences, ID-like
 * separators, and a lone surrogate, which both encoders replace with U+FFFD.
 */
function referenceInputs(): string[] {
  const pieces = ["", "a", "Z", "0", ":", "-", "é", "频", "📺", "\uD800"];
  const inputs: string[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const first = pieces[index % pieces.length];
    const second = pieces[Math.floor(index / pieces.length) % pieces.length];
    inputs.push(`${first}${index}${second}`);
  }
  return inputs;
}

// Changing any golden value reshuffles every random channel, so treat a
// failure here as an algorithm change, not a stale fixture.
describe("hash32", () => {
  it("agrees with the independent reference across generated inputs", () => {
    for (const input of referenceInputs()) {
      expect(hash32(input), JSON.stringify(input)).toBe(referenceHash32(input));
    }
  });

  it.each([
    ["", 0xab3e7c0b],
    ["a", 0x1a80b1b3],
    ["kraziTV", 0x8b28fa88],
    ["café", 0xdf518d52],
    ["频道", 0x0bc69ff7],
    ["📺", 0xe3af2a09],
  ])("pins the finalized hash of %j", (input, expected) => {
    expect(hash32(input)).toBe(expected);
  });
});

describe("deriveChannelSeed", () => {
  it.each([
    ["ch-1", CHANNEL_SEED],
    ["频道-1", 0x7be07c7b],
  ])(
    "pins the seed for channel %j at a fixed anchor",
    (channelId, expected) => {
      expect(deriveChannelSeed(channelId, ANCHOR_TIME)).toBe(expected);
    },
  );

  it("gives a channel a new seed when its schedule anchor changes", () => {
    expect(deriveChannelSeed("ch-1", ANCHOR_TIME + 1)).not.toBe(CHANNEL_SEED);
  });
});

describe("deriveCollectionSeed", () => {
  it.each([
    ["col-1", 0x6aa31bb0],
    ["col-2", 0xda3c9f9c],
    ["收藏", 0x05a9ff20],
  ])(
    "pins the seed for collection %j on one channel",
    (collectionId, expected) => {
      expect(deriveCollectionSeed(CHANNEL_SEED, collectionId)).toBe(expected);
    },
  );

  it("gives different collections on one channel different seeds", () => {
    expect(deriveCollectionSeed(CHANNEL_SEED, "col-1")).not.toBe(
      deriveCollectionSeed(CHANNEL_SEED, "col-2"),
    );
  });
});
