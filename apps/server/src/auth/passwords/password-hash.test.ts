import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password-hash.js";

describe("password hashing", () => {
  it("stores scrypt with its cost parameters, salt, and hash, never the password", async () => {
    const stored = await hashPassword("correct horse");

    expect(stored).toMatch(
      /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]+$/,
    );
    expect(stored).not.toContain("correct horse");
  });

  it("salts each hash, so the same password never stores the same string", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");

    expect(first).not.toBe(second);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");

    await expect(verifyPassword("correct horse", stored)).resolves.toBe(true);
    await expect(verifyPassword("correct horsf", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("verifies with the cost parameters stored in the hash, so raising them keeps old hashes valid", async () => {
    const stored = await hashPassword("correct horse");
    const [, , r, p, salt, hash] = stored.split("$");
    const cheaper = await hashPassword("correct horse", {
      N: 1024,
      r: 1,
      p: 1,
    });

    expect(cheaper.split("$").slice(1, 4)).toEqual(["1024", "1", "1"]);
    await expect(verifyPassword("correct horse", cheaper)).resolves.toBe(true);
    // The same salt and hash under different parameters no longer match.
    await expect(
      verifyPassword("correct horse", `scrypt$1024$${r}$${p}$${salt}$${hash}`),
    ).resolves.toBe(false);
  });

  it("refuses a stored value that is not an scrypt hash", async () => {
    await expect(verifyPassword("anything", "plaintext")).rejects.toThrow(
      /stored password hash/i,
    );
  });
});
