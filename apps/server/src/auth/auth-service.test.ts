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

  it("refuses login before setup without writing", async () => {
    const { auth, db } = await openAuth();

    await expect(auth.logIn(owner.password)).resolves.toEqual({
      kind: "setup_required",
    });
    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toEqual([]);
  });

  it("refuses a wrong password without starting a session", async () => {
    const { auth, db } = await openAuth();
    await setUpOwner(auth);

    await expect(auth.logIn("correct horsf")).resolves.toEqual({
      kind: "invalid_password",
    });
    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toHaveLength(1);
  });

  it("starts a separate 30-day session for each login", async () => {
    const { auth, db, clock } = await openAuth();
    const setupToken = await setUpOwner(auth);
    clock.advance(DAY_MS);

    const first = await auth.logIn(owner.password);
    const second = await auth.logIn(owner.password);

    if (first.kind !== "logged_in" || second.kind !== "logged_in") {
      throw new Error(`login ${first.kind}, ${second.kind}`);
    }
    expect(first.session.maxAgeSeconds).toBe(30 * 24 * 60 * 60);
    expect(
      new Set([setupToken, first.session.token, second.session.token]).size,
    ).toBe(3);
    for (const token of [
      setupToken,
      first.session.token,
      second.session.token,
    ]) {
      await expect(auth.state(token)).resolves.toMatchObject({
        authenticated: true,
      });
    }
    await expect(
      db
        .selectFrom("sessions")
        .select("expires_at")
        .where("created_at", "=", START + DAY_MS)
        .execute(),
    ).resolves.toEqual([
      { expires_at: START + 31 * DAY_MS },
      { expires_at: START + 31 * DAY_MS },
    ]);
  });

  it("makes the sixth attempt after five wrong passwords wait, even with the right password", async () => {
    const { auth, db } = await openAuth();
    await setUpOwner(auth);
    for (let i = 0; i < 5; i += 1) {
      await expect(auth.logIn("wrong password")).resolves.toEqual({
        kind: "invalid_password",
      });
    }

    await expect(auth.logIn(owner.password)).resolves.toEqual({
      kind: "too_many_attempts",
      retryAfterSeconds: 1,
    });
    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toHaveLength(1);
  });

  it("rounds a partial wait up to whole seconds", async () => {
    const { auth, clock } = await openAuth();
    await setUpOwner(auth);
    for (let i = 0; i < 6; i += 1) {
      await auth.logIn("wrong password");
      clock.advance(1000);
    }

    // The sixth failure began a 2-second wait; 1 second of it has passed.
    clock.advance(1);
    await expect(auth.logIn("wrong password")).resolves.toEqual({
      kind: "too_many_attempts",
      retryAfterSeconds: 1,
    });
  });

  it("refuses wrong passwords sent together beyond the limit before checking them", async () => {
    const { auth } = await openAuth();
    await setUpOwner(auth);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => auth.logIn("wrong password")),
    );

    expect(results.filter((r) => r.kind === "invalid_password")).toHaveLength(
      5,
    );
    expect(results.filter((r) => r.kind === "too_many_attempts")).toHaveLength(
      3,
    );
  });

  it("logs in with the right password after the wait and forgives earlier failures", async () => {
    const { auth, clock } = await openAuth();
    await setUpOwner(auth);
    for (let i = 0; i < 5; i += 1) await auth.logIn("wrong password");
    clock.advance(1000);

    await expect(auth.logIn(owner.password)).resolves.toMatchObject({
      kind: "logged_in",
    });
    for (let i = 0; i < 5; i += 1) {
      await expect(auth.logIn("wrong password")).resolves.toEqual({
        kind: "invalid_password",
      });
    }
  });

  it("does not count a login attempt before setup as a failure", async () => {
    const { auth } = await openAuth();
    for (let i = 0; i < 6; i += 1) {
      await expect(auth.logIn("anything at all")).resolves.toEqual({
        kind: "setup_required",
      });
    }
    await setUpOwner(auth);

    await expect(auth.logIn(owner.password)).resolves.toMatchObject({
      kind: "logged_in",
    });
  });

  it("authenticates nothing before setup, whatever the token", async () => {
    const { auth } = await openAuth();

    await expect(auth.authenticate(undefined)).resolves.toEqual({
      kind: "setup_required",
    });
    await expect(auth.authenticate("any-token")).resolves.toEqual({
      kind: "setup_required",
    });
  });

  it("authenticates only a live session after setup", async () => {
    const { auth, clock } = await openAuth();
    const token = await setUpOwner(auth);

    await expect(auth.authenticate(token)).resolves.toEqual({
      kind: "authenticated",
    });
    await expect(auth.authenticate(undefined)).resolves.toEqual({
      kind: "unauthenticated",
    });
    await expect(auth.authenticate(`${token}x`)).resolves.toEqual({
      kind: "unauthenticated",
    });

    clock.advance(30 * DAY_MS);
    await expect(auth.authenticate(token)).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("logs out only the given session", async () => {
    const { auth } = await openAuth();
    const kept = await setUpOwner(auth);
    const login = await auth.logIn(owner.password);
    if (login.kind !== "logged_in") throw new Error(`login ${login.kind}`);

    await auth.logOut(login.session.token);

    await expect(auth.state(login.session.token)).resolves.toMatchObject({
      authenticated: false,
    });
    await expect(auth.state(kept)).resolves.toMatchObject({
      authenticated: true,
    });
  });

  it("logs out without a token or with an unknown one without failing", async () => {
    const { auth, db } = await openAuth();
    await setUpOwner(auth);

    await auth.logOut(undefined);
    await auth.logOut("not-a-session");

    await expect(
      db.selectFrom("sessions").select("id").execute(),
    ).resolves.toHaveLength(1);
  });
});
