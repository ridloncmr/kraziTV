import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { manualClock } from "../testing/manual-clock.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { AuthService } from "./auth-service.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";
import { verifyPassword } from "./passwords/password-hash.js";

afterEach(cleanUpTestEnvironment);

const START = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const owner = { displayName: "Owner", password: "correct horse" };

/** Opens a fresh database with an auth service on a clock the test steps. */
async function openAuth() {
  const database = await openTestDatabase();
  const clock = manualClock(START);
  return {
    db: database.db,
    clock,
    auth: new AuthService(database.db, { now: clock.now }),
  };
}

/** Sets up the owner account and returns the issued session token. */
async function setUpOwner(auth: AuthService): Promise<string> {
  const result = await auth.setUp(owner);
  if (result.kind !== "created") throw new Error(`setup ${result.kind}`);
  return result.session.token;
}

describe("AuthService", () => {
  it("reports that a fresh server needs setup and has no account", async () => {
    const { auth } = await openAuth();

    await expect(auth.state(undefined)).resolves.toEqual({
      setupRequired: true,
      account: null,
      authenticated: false,
    });
  });

  it("creates the account with the default avatar and a 30-day session", async () => {
    const { auth, db } = await openAuth();

    const result = await auth.setUp(owner);

    expect(result).toEqual({
      kind: "created",
      session: {
        token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        maxAgeSeconds: 30 * 24 * 60 * 60,
      },
    });
    await expect(
      db
        .selectFrom("accounts")
        .select(["display_name", "avatar_id", "created_at", "updated_at"])
        .execute(),
    ).resolves.toEqual([
      {
        display_name: "Owner",
        avatar_id: DEFAULT_AVATAR_ID,
        created_at: START,
        updated_at: START,
      },
    ]);
    await expect(
      db.selectFrom("sessions").select(["created_at", "expires_at"]).execute(),
    ).resolves.toEqual([
      { created_at: START, expires_at: START + 30 * DAY_MS },
    ]);
  });

  it("recognizes the issued session and reports the account", async () => {
    const { auth } = await openAuth();
    const token = await setUpOwner(auth);

    await expect(auth.state(token)).resolves.toEqual({
      setupRequired: false,
      account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
      authenticated: true,
    });
    await expect(auth.state(undefined)).resolves.toMatchObject({
      authenticated: false,
    });
    await expect(auth.state(`${token}x`)).resolves.toMatchObject({
      authenticated: false,
    });
  });

  it("stores neither the password nor the session token", async () => {
    const { auth, db } = await openAuth();
    const token = await setUpOwner(auth);

    const account = await db
      .selectFrom("accounts")
      .select("password_hash")
      .executeTakeFirstOrThrow();
    const session = await db
      .selectFrom("sessions")
      .select("token_hash")
      .executeTakeFirstOrThrow();

    expect(account.password_hash).not.toContain(owner.password);
    await expect(
      verifyPassword(owner.password, account.password_hash),
    ).resolves.toBe(true);
    expect(session.token_hash).not.toBe(token);
    expect(session.token_hash).toBe(
      createHash("sha256").update(token).digest("base64url"),
    );
  });

  it("refuses a second setup and keeps the first account", async () => {
    const { auth, db } = await openAuth();
    await setUpOwner(auth);

    await expect(
      auth.setUp({ displayName: "Intruder", password: "another one" }),
    ).resolves.toEqual({ kind: "already_set_up" });
    await expect(
      db.selectFrom("accounts").select("display_name").execute(),
    ).resolves.toEqual([{ display_name: "Owner" }]);
    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toHaveLength(1);
  });

  it("creates exactly one account when two connections set up at once", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await openTestDatabase(dataDirectory);
    const second = await openTestDatabase(dataDirectory);

    const results = await Promise.all([
      new AuthService(first.db).setUp(owner),
      new AuthService(second.db).setUp({ ...owner, displayName: "Other" }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "already_set_up",
      "created",
    ]);
    await expect(
      first.db.selectFrom("accounts").select("id").execute(),
    ).resolves.toHaveLength(1);
    await expect(
      first.db.selectFrom("sessions").select("id").execute(),
    ).resolves.toHaveLength(1);
  });

  it("treats an expired session as absent and deletes it when read", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);

    clock.advance(30 * DAY_MS - 1);
    await expect(auth.state(token)).resolves.toMatchObject({
      authenticated: true,
    });

    clock.advance(1);
    await expect(auth.state(token)).resolves.toEqual({
      setupRequired: false,
      account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
      authenticated: false,
    });
    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toEqual([]);
  });
});
