import {
  randomBytes,
  scrypt,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";

/** scrypt's CPU/memory cost (`N`), block size (`r`), and parallelization (`p`). */
interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

// Twice Node's default N. Each hash stores its own cost, so these can rise
// later without invalidating hashes stored under the old values.
const DEFAULT_COST: ScryptCost = { N: 32_768, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const STORED_HASH = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([\w-]+)\$([\w-]+)$/;

/**
 * Hashes a password with a fresh 16-byte salt into one self-describing string,
 * `scrypt$N$r$p$salt$hash`, so verification never depends on today's defaults.
 * Tests may pass a cheaper cost; production always takes the default.
 */
export async function hashPassword(
  password: string,
  cost: ScryptCost = DEFAULT_COST,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, cost, KEY_BYTES);
  return [
    "scrypt",
    cost.N,
    cost.r,
    cost.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

/**
 * Checks a password against a stored hash in constant time, using the cost
 * and key length the hash was stored with. A stored value that is not a
 * hash this module wrote is corruption, so it throws instead of answering false.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const match = STORED_HASH.exec(stored);
  if (match === null) {
    throw new Error("The stored password hash is not in scrypt format");
  }
  const [, N, r, p, salt, hash] = match;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64url"),
    { N: Number(N), r: Number(r), p: Number(p) },
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

/**
 * Runs scrypt off the event loop. `maxmem` follows the cost, because Node's
 * 32 MiB default refuses any N and r whose working set reaches it.
 */
function derive(
  password: string,
  salt: Buffer,
  cost: ScryptCost,
  keyLength: number,
): Promise<Buffer> {
  const options: ScryptOptions = { ...cost, maxmem: 256 * cost.N * cost.r };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}
