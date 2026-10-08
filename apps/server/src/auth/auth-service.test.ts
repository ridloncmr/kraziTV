import { createHash } from "node:crypto";

import type { Kysely, RootOperationNode } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { holdWriteAuthority } from "../testing/hold-write-authority.js";
import { manualClock } from "../testing/manual-clock.js";
import { countQueries } from "../testing/query-counter.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { AuthService } from "./auth-service.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";
import { hashPassword, verifyPassword } from "./passwords/password-hash.js";

afterEach(cleanUpTestEnvironment);

const START = 1_700_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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

/** Reads every session's expiry, oldest first. */
async function readExpiry(db: Kysely<DatabaseSchema>): Promise<number[]> {
  const rows = await db
    .selectFrom("sessions")
    .select("expires_at")
    .orderBy("expires_at")
    .execute();
  return rows.map((row) => row.expires_at);
}

/** Recognizes the statement that asks SQLite for write authority. */
function isBeginImmediate(node: RootOperationNode): boolean {
  return (
    node.kind === "RawNode" &&
    node.sqlFragments.join("").trim().toLowerCase() === "begin immediate"
  );
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

    await expect(auth.state(undefined, recordingLog())).resolves.toEqual({
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

    await expect(auth.state(token, recordingLog())).resolves.toEqual({
      setupRequired: false,
      account: { displayName: "Owner", avatarId: DEFAULT_AVATAR_ID },
      authenticated: true,
    });
    await expect(auth.state(undefined, recordingLog())).resolves.toMatchObject({
      authenticated: false,
    });
    await expect(
      auth.state(`${token}x`, recordingLog()),
    ).resolves.toMatchObject({
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
    await expect(auth.state(token, recordingLog())).resolves.toMatchObject({
      authenticated: true,
    });

    clock.advance(1);
    await expect(auth.state(token, recordingLog())).resolves.toEqual({
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
      await expect(auth.state(token, recordingLog())).resolves.toMatchObject({
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

    await expect(auth.authenticate(undefined, recordingLog())).resolves.toEqual(
      {
        kind: "setup_required",
      },
    );
    await expect(
      auth.authenticate("any-token", recordingLog()),
    ).resolves.toEqual({
      kind: "setup_required",
    });
  });

  it("authenticates only a live session after setup", async () => {
    const { auth, clock } = await openAuth();
    const token = await setUpOwner(auth);

    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "authenticated",
    });
    await expect(auth.authenticate(undefined, recordingLog())).resolves.toEqual(
      {
        kind: "unauthenticated",
      },
    );
    await expect(
      auth.authenticate(`${token}x`, recordingLog()),
    ).resolves.toEqual({
      kind: "unauthenticated",
    });

    clock.advance(30 * DAY_MS);
    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("does not renew a session used within a day of its last extension", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);

    clock.advance(12 * HOUR_MS);

    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "authenticated",
    });
    await expect(readExpiry(db)).resolves.toEqual([START + 30 * DAY_MS]);
  });

  it("renews a session used a day or more after its last extension", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);

    clock.advance(DAY_MS - 1);
    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "authenticated",
    });
    clock.advance(1);
    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "authenticated",
      renewal: { maxAgeSeconds: 30 * 24 * 60 * 60 },
    });
    await expect(readExpiry(db)).resolves.toEqual([START + 31 * DAY_MS]);

    // The next renewal waits a day from this extension, not from creation.
    clock.advance(DAY_MS - 1);
    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "authenticated",
    });
  });

  it("keeps an active session alive past its first 30 days", async () => {
    const { auth, clock } = await openAuth();
    const token = await setUpOwner(auth);

    for (let day = 0; day < 40; day += 1) {
      clock.advance(DAY_MS);
      await expect(
        auth.authenticate(token, recordingLog()),
      ).resolves.toMatchObject({
        kind: "authenticated",
      });
    }
  });

  it("renews once when two requests race past the renewal point", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);
    clock.advance(25 * HOUR_MS);

    const results = await Promise.all([
      auth.authenticate(token, recordingLog()),
      auth.authenticate(token, recordingLog()),
    ]);

    expect(results.filter((result) => "renewal" in result)).toHaveLength(1);
    await expect(readExpiry(db)).resolves.toEqual([
      START + 25 * HOUR_MS + 30 * DAY_MS,
    ]);
  });

  it("never resurrects or reissues a session logged out during its renewal", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);
    clock.advance(25 * HOUR_MS);

    const [authentication] = await Promise.all([
      auth.authenticate(token, recordingLog()),
      auth.logOut(token),
    ]);

    expect(authentication).not.toHaveProperty("renewal");
    await expect(readExpiry(db)).resolves.toEqual([]);
    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("deletes an idle session's row when it is used after 30 days", async () => {
    const { auth, db, clock } = await openAuth();
    const token = await setUpOwner(auth);
    clock.advance(30 * DAY_MS);

    await expect(auth.authenticate(token, recordingLog())).resolves.toEqual({
      kind: "unauthenticated",
    });
    await expect(readExpiry(db)).resolves.toEqual([]);
  });

  it("deletes every expired session and keeps live ones", async () => {
    const { auth, db, clock } = await openAuth();
    await setUpOwner(auth);
    clock.advance(DAY_MS);
    await auth.logIn(owner.password);
    clock.advance(30 * DAY_MS - DAY_MS);

    await auth.deleteExpiredSessions(recordingLog());

    await expect(readExpiry(db)).resolves.toEqual([START + 31 * DAY_MS]);
  });

  it("logs instead of throwing when expired-session cleanup fails", async () => {
    const database = await openTestDatabase();
    const auth = new AuthService(database.db);
    const log = recordingLog();
    await database.close();

    await expect(auth.deleteExpiredSessions(log)).resolves.toBeUndefined();
    expect(log.lines).toMatchObject([
      { level: "warn", message: "Deleting expired sessions failed" },
    ]);
  });

  it("updates only the given profile fields and moves updated_at to now", async () => {
    const { auth, db, clock } = await openAuth();
    await setUpOwner(auth);
    clock.advance(HOUR_MS);

    await expect(auth.updateProfile({ avatarId: "chess" })).resolves.toEqual({
      displayName: "Owner",
      avatarId: "chess",
    });
    await expect(
      db
        .selectFrom("accounts")
        .select(["display_name", "avatar_id", "created_at", "updated_at"])
        .execute(),
    ).resolves.toEqual([
      {
        display_name: "Owner",
        avatar_id: "chess",
        created_at: START,
        updated_at: START + HOUR_MS,
      },
    ]);
  });

  it("resets the password, so only the new one logs in, and ends every session", async () => {
    const { auth, db, clock } = await openAuth();
    const setupToken = await setUpOwner(auth);
    await auth.logIn(owner.password);
    clock.advance(HOUR_MS);

    await expect(auth.resetPassword("brand new secret")).resolves.toEqual({
      kind: "reset",
    });

    await expect(readExpiry(db)).resolves.toEqual([]);
    await expect(
      auth.authenticate(setupToken, recordingLog()),
    ).resolves.toEqual({ kind: "unauthenticated" });
    await expect(auth.logIn(owner.password)).resolves.toEqual({
      kind: "invalid_password",
    });
    await expect(auth.logIn("brand new secret")).resolves.toMatchObject({
      kind: "logged_in",
    });
    await expect(
      db
        .selectFrom("accounts")
        .select(["display_name", "created_at", "updated_at"])
        .execute(),
    ).resolves.toEqual([
      { display_name: "Owner", created_at: START, updated_at: START + HOUR_MS },
    ]);
  });

  it("refuses a reset before setup without writing", async () => {
    const { auth, db } = await openAuth();

    await expect(auth.resetPassword("brand new secret")).resolves.toEqual({
      kind: "setup_required",
    });
    await expect(
      db.selectFrom("accounts").select("id").execute(),
    ).resolves.toEqual([]);
  });

  it("starts no session for a login whose password was reset while it was being checked", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const server = await openTestDatabase(dataDirectory);
    const command = await openTestDatabase(dataDirectory);
    await setUpOwner(new AuthService(server.db));
    const newHash = await hashPassword("brand new secret");
    // The reset command holds write authority, its writes queued until released.
    const reset = await holdWriteAuthority(command.db, async (pinned) => {
      await pinned
        .updateTable("accounts")
        .set({ password_hash: newHash })
        .execute();
      await pinned.deleteFrom("sessions").execute();
    });
    // The login read and verified the old hash; as it asks for write
    // authority to start its session, the reset commits first.
    const watched = countQueries(server.db, (node) => {
      if (isBeginImmediate(node)) void reset.release();
    });

    try {
      await expect(
        new AuthService(watched.db).logIn(owner.password),
      ).resolves.toEqual({ kind: "invalid_password" });
    } finally {
      await reset.release();
    }

    await expect(readExpiry(server.db)).resolves.toEqual([]);
    await expect(
      new AuthService(server.db).logIn("brand new secret"),
    ).resolves.toMatchObject({ kind: "logged_in" });
  });

  it("changes nothing and ends no session when the password was replaced while the current one was being checked", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const server = await openTestDatabase(dataDirectory);
    const other = await openTestDatabase(dataDirectory);
    const serverAuth = new AuthService(server.db);
    const token = await setUpOwner(serverAuth);
    await serverAuth.logIn(owner.password);
    const racingHash = await hashPassword("racing secret");
    // Another writer holds write authority with a new hash queued, but ends
    // no session, so any session this change deletes would show.
    const race = await holdWriteAuthority(other.db, async (pinned) => {
      await pinned
        .updateTable("accounts")
        .set({ password_hash: racingHash })
        .execute();
    });
    // The change verified the old hash; as it asks for write authority to
    // write, the racing replacement commits first.
    const watched = countQueries(server.db, (node) => {
      if (isBeginImmediate(node)) void race.release();
    });

    try {
      await expect(
        new AuthService(watched.db).changePassword(token, {
          currentPassword: owner.password,
          newPassword: "brand new secret",
        }),
      ).resolves.toEqual({ kind: "invalid_password" });
    } finally {
      await race.release();
    }

    await expect(readExpiry(server.db)).resolves.toHaveLength(2);
    const account = await server.db
      .selectFrom("accounts")
      .select("password_hash")
      .executeTakeFirstOrThrow();
    expect(account.password_hash).toBe(racingHash);
  });

  it("fails a reset retryably, changing nothing, while another connection holds the write lock", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const server = await openTestDatabase(dataDirectory);
    const serverAuth = new AuthService(server.db);
    const token = await setUpOwner(serverAuth);
    const command = await openTestDatabase(dataDirectory);
    const held = await holdWriteAuthority(server.db);

    try {
      await expect(
        new AuthService(command.db).resetPassword("brand new secret"),
      ).rejects.toBeInstanceOf(WriteAuthorityBusyError);
    } finally {
      await held.release();
    }

    await expect(
      serverAuth.authenticate(token, recordingLog()),
    ).resolves.toEqual({ kind: "authenticated" });
    await expect(serverAuth.logIn(owner.password)).resolves.toMatchObject({
      kind: "logged_in",
    });
  });

  it("logs out only the given session", async () => {
    const { auth } = await openAuth();
    const kept = await setUpOwner(auth);
    const login = await auth.logIn(owner.password);
    if (login.kind !== "logged_in") throw new Error(`login ${login.kind}`);

    await auth.logOut(login.session.token);

    await expect(
      auth.state(login.session.token, recordingLog()),
    ).resolves.toMatchObject({
      authenticated: false,
    });
    await expect(auth.state(kept, recordingLog())).resolves.toMatchObject({
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
