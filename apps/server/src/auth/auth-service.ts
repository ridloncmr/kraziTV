import { randomUUID } from "node:crypto";

import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";
import type {
  AccountProfile,
  Authentication,
  AuthState,
  ChangePasswordResult,
  IssuedSession,
  IssuedSessionLifetime,
  LogInResult,
  PasswordChange,
  ProfileUpdate,
  ResetPasswordResult,
  RequestAuthenticator,
  SetUpInput,
  SetUpResult,
  TooManyAttempts,
} from "./contracts.js";
import { PasswordAttemptThrottle } from "./passwords/password-attempt-throttle.js";
import { hashPassword, verifyPassword } from "./passwords/password-hash.js";
import {
  createSessionToken,
  hashSessionToken,
  SESSION_LIFETIME_MS,
  SESSION_RENEWAL_INTERVAL_MS,
} from "./sessions/session-token.js";

/** Reports whether the one account exists, on whichever connection the caller holds. */
async function hasAccount(db: Kysely<DatabaseSchema>): Promise<boolean> {
  const row = await db.selectFrom("accounts").select("id").executeTakeFirst();
  return row !== undefined;
}

/**
 * Reports whether the account still has the password hash a caller verified
 * without write authority. Callers ask on their pinned connection, so a
 * password reset or change that committed meanwhile is seen before they write.
 */
async function hasPasswordHash(
  db: Kysely<DatabaseSchema>,
  accountId: string,
  verifiedHash: string,
): Promise<boolean> {
  const current = await db
    .selectFrom("accounts")
    .select("password_hash")
    .where("id", "=", accountId)
    .executeTakeFirst();
  return current?.password_hash === verifiedHash;
}

/**
 * Owns the one account and its sessions (ADR 0012). Session tokens enter and
 * leave only as plain strings; cookies and HTTP stay in the routes. The clock
 * is injectable so expiry is testable with a manual clock.
 */
export class AuthService implements RequestAuthenticator {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;
  // One counter per service, and one service per server: there is one account.
  readonly #attempts = new PasswordAttemptThrottle();

  // Clock and ID sources are injectable so tests can step expiry and assert rows.
  constructor(db: Kysely<DatabaseSchema>, options: RecordSources = {}) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Reports whether setup is still needed, the account's public profile, and
   * whether `token` names a live session. A token is never valid before setup.
   * `log` reports best-effort cleanup of an expired session.
   */
  async state(
    token: string | undefined,
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<AuthState> {
    const account = await this.#db
      .selectFrom("accounts")
      .select(["display_name", "avatar_id"])
      .executeTakeFirst();
    if (account === undefined) {
      return { setupRequired: true, account: null, authenticated: false };
    }
    return {
      setupRequired: false,
      account: {
        displayName: account.display_name,
        avatarId: account.avatar_id,
      },
      authenticated:
        token !== undefined &&
        (await this.#findLiveSession(token, this.#now(), log)) !== undefined,
    };
  }

  /**
   * Answers the auth gate for a request carrying `token`, sliding the
   * session's expiry when it is due (ADR 0012). A live session implies the
   * account exists, so the common signed-in path is one query, plus one write
   * at most once a day; only a request without one asks whether setup is
   * still needed.
   */
  async authenticate(
    token: string | undefined,
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<Authentication> {
    const now = this.#now();
    const session =
      token === undefined
        ? undefined
        : await this.#findLiveSession(token, now, log);
    if (session !== undefined) {
      const renewal = await this.#renew(session, now, log);
      return renewal === undefined
        ? { kind: "authenticated" }
        : { kind: "authenticated", renewal };
    }
    return (await hasAccount(this.#db))
      ? { kind: "unauthenticated" }
      : { kind: "setup_required" };
  }

  /**
   * Deletes every session already expired, so rows of browsers that never
   * return do not pile up. Runs at startup; never throws, because a failure
   * only delays cleanup and expired sessions are refused anyway.
   */
  async deleteExpiredSessions(
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<void> {
    try {
      await this.#db
        .deleteFrom("sessions")
        .where("expires_at", "<=", this.#now())
        .execute();
    } catch (err) {
      log.warn({ err }, "Deleting expired sessions failed");
    }
  }

  /**
   * Creates the one account and logs it in. The emptiness check and both
   * inserts share write authority, so of two concurrent setups exactly one
   * creates the account and the other reports `already_set_up`.
   */
  async setUp(input: SetUpInput): Promise<SetUpResult> {
    // Setup is a public route, so a set-up server refuses before paying for
    // scrypt; the check under write authority below stays the real guard.
    if (await hasAccount(this.#db)) return { kind: "already_set_up" };
    // Hashed outside the transaction: scrypt is slow non-database work that
    // must never hold the pinned connection every other query waits on.
    const passwordHash = await hashPassword(input.password);
    return runImmediateTransaction(this.#db, async (pinned) => {
      if (await hasAccount(pinned)) return { kind: "already_set_up" } as const;

      const now = this.#now();
      const accountId = this.#createId();
      await pinned
        .insertInto("accounts")
        .values({
          id: accountId,
          display_name: input.displayName,
          avatar_id: DEFAULT_AVATAR_ID,
          password_hash: passwordHash,
          created_at: now,
          updated_at: now,
        })
        .execute();
      const session = await this.#startSession(pinned, accountId, now);
      return { kind: "created", session } as const;
    });
  }

  /**
   * Checks `password` against the one account and starts a new session on a
   * match. Every login gets its own session, so browsers log in and out
   * independently. The attempt throttle lives on the service, not the route,
   * so every password check shares one counter; a throttled attempt is
   * refused before its password is checked.
   */
  async logIn(password: string): Promise<LogInResult> {
    const account = await this.#db
      .selectFrom("accounts")
      .select(["id", "password_hash"])
      .executeTakeFirst();
    if (account === undefined) return { kind: "setup_required" };
    const refusal = this.#admitAttempt();
    if (refusal !== undefined) return refusal;
    if (!(await verifyPassword(password, account.password_hash))) {
      return { kind: "invalid_password" };
    }
    const session = await this.#startSessionForVerifiedHash(
      account.id,
      account.password_hash,
    );
    // A password changed during the check leaves the reserved failure counted.
    if (session === undefined) return { kind: "invalid_password" };
    this.#attempts.succeed();
    return { kind: "logged_in", session };
  }

  /**
   * Starts a session only if the account still has the password hash that
   * was just verified. The check is slow and runs without write authority,
   * so a password reset or change may commit meanwhile and end every session;
   * re-checking under write authority keeps the old password from opening a
   * new one afterwards. Returns undefined when the password changed.
   */
  async #startSessionForVerifiedHash(
    accountId: string,
    verifiedHash: string,
  ): Promise<IssuedSession | undefined> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      if (!(await hasPasswordHash(pinned, accountId, verifiedHash))) {
        return undefined;
      }
      return this.#startSession(pinned, accountId, this.#now());
    });
  }

  /**
   * Replaces the password for an owner who proves the current one. The
   * session `token` names stays and every other ends, so a browser that knew
   * the old password is logged out everywhere but here. Shares login's
   * throttle and race rules: admitted after the last await, verified and
   * hashed outside write authority, and written only while the account still
   * has the verified hash, so a reset or another change that committed
   * meanwhile wins and this one answers `invalid_password`. The auth gate
   * already proved the account exists.
   */
  async changePassword(
    token: string | undefined,
    change: PasswordChange,
  ): Promise<ChangePasswordResult> {
    const account = await this.#db
      .selectFrom("accounts")
      .select(["id", "password_hash"])
      .executeTakeFirstOrThrow();
    const refusal = this.#admitAttempt();
    if (refusal !== undefined) return refusal;
    if (
      !(await verifyPassword(change.currentPassword, account.password_hash))
    ) {
      return { kind: "invalid_password" };
    }
    const newHash = await hashPassword(change.newPassword);
    const changed = await runImmediateTransaction(this.#db, async (pinned) => {
      if (!(await hasPasswordHash(pinned, account.id, account.password_hash))) {
        return false;
      }
      await pinned
        .updateTable("accounts")
        .set({ password_hash: newHash, updated_at: this.#now() })
        .where("id", "=", account.id)
        .execute();
      // The auth gate guarantees a token; without one no session is kept,
      // the safe default.
      const ending = pinned.deleteFrom("sessions");
      await (
        token === undefined
          ? ending
          : ending.where("token_hash", "!=", hashSessionToken(token))
      ).execute();
      return true;
    });
    // A password changed during the check leaves the reserved failure counted.
    if (!changed) return { kind: "invalid_password" };
    this.#attempts.succeed();
    return { kind: "changed" };
  }

  /**
   * Admits one password check through the shared throttle at once, reserving
   * its failure, or returns the refusal. Callers run it synchronously after
   * their last await, so checks sent together each see the failures reserved
   * by those before them.
   */
  #admitAttempt(): TooManyAttempts | undefined {
    const admission = this.#attempts.admit(this.#now());
    if (admission.admitted) return undefined;
    return {
      kind: "too_many_attempts",
      retryAfterSeconds: Math.ceil(admission.retryAfterMs / 1000),
    };
  }

  /**
   * Replaces the one account's password without the old one and ends every
   * session, so whoever knew the old password is logged out everywhere. Only
   * the server-host command calls this; there is no HTTP route. Like setup,
   * it hashes before taking write authority, then checks and writes as one
   * transaction. A server holding the write lock makes it throw
   * `WriteAuthorityBusyError`, which the caller reports as retryable.
   */
  async resetPassword(password: string): Promise<ResetPasswordResult> {
    if (!(await hasAccount(this.#db))) return { kind: "setup_required" };
    const passwordHash = await hashPassword(password);
    return runImmediateTransaction(this.#db, async (pinned) => {
      if (!(await hasAccount(pinned)))
        return { kind: "setup_required" } as const;
      await pinned
        .updateTable("accounts")
        .set({ password_hash: passwordHash, updated_at: this.#now() })
        .execute();
      await pinned.deleteFrom("sessions").execute();
      return { kind: "reset" } as const;
    });
  }

  /**
   * Changes the one account's display name and/or avatar and returns the
   * resulting profile. One statement on one row, so it needs no write
   * authority; the auth gate already proved the account exists.
   */
  async updateProfile(update: ProfileUpdate): Promise<AccountProfile> {
    const row = await this.#db
      .updateTable("accounts")
      .set({
        ...(update.displayName === undefined
          ? {}
          : { display_name: update.displayName }),
        ...(update.avatarId === undefined
          ? {}
          : { avatar_id: update.avatarId }),
        updated_at: this.#now(),
      })
      .returning(["display_name", "avatar_id"])
      .executeTakeFirstOrThrow();
    return { displayName: row.display_name, avatarId: row.avatar_id };
  }

  /** Ends the session `token` names; an absent or unknown token is already logged out. */
  async logOut(token: string | undefined): Promise<void> {
    if (token === undefined) return;
    await this.#db
      .deleteFrom("sessions")
      .where("token_hash", "=", hashSessionToken(token))
      .execute();
  }

  /**
   * Inserts a session expiring one lifetime after `now` and returns its token,
   * which is stored only as a hash. Takes the caller's connection so it joins
   * the caller's transaction.
   */
  async #startSession(
    db: Kysely<DatabaseSchema>,
    accountId: string,
    now: number,
  ): Promise<IssuedSession> {
    const token = createSessionToken();
    await db
      .insertInto("sessions")
      .values({
        id: this.#createId(),
        account_id: accountId,
        token_hash: hashSessionToken(token),
        created_at: now,
        expires_at: now + SESSION_LIFETIME_MS,
      })
      .execute();
    return { token, maxAgeSeconds: SESSION_LIFETIME_MS / 1000 };
  }

  /**
   * Finds the unexpired session `token` names at `now`. An expired one is
   * deleted as it is found, only while still expired, so a concurrent
   * extension is never undone. The delete is best-effort: an expired session
   * is refused either way, so a failed delete, such as another process
   * holding the write lock, is logged and left to a later read or startup.
   */
  async #findLiveSession(
    token: string,
    now: number,
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<{ id: string; expires_at: number } | undefined> {
    const session = await this.#db
      .selectFrom("sessions")
      .select(["id", "expires_at"])
      .where("token_hash", "=", hashSessionToken(token))
      .executeTakeFirst();
    if (session === undefined) return undefined;
    if (session.expires_at > now) return session;

    try {
      await this.#db
        .deleteFrom("sessions")
        .where("id", "=", session.id)
        .where("expires_at", "<=", now)
        .execute();
    } catch (err) {
      log.warn({ err }, "Deleting an expired session failed");
    }
    return undefined;
  }

  /**
   * Moves a session's expiry to one lifetime from `now` once a day has
   * passed since its last extension, and returns the cookie lifetime to
   * reissue. The last extension is `expires_at` minus one lifetime, so no
   * extra column is needed. The write applies only while `expires_at` is
   * still the value read: a concurrent renewal wins once, and a session
   * logged out meanwhile stays deleted and gets no cookie.
   *
   * Best-effort: a failed write, such as another process holding the write
   * lock, is logged and the request stays signed in without a new cookie;
   * the session is still valid, and the next request retries.
   */
  async #renew(
    session: { id: string; expires_at: number },
    now: number,
    log: Pick<FastifyBaseLogger, "warn">,
  ): Promise<IssuedSessionLifetime | undefined> {
    const lastExtension = session.expires_at - SESSION_LIFETIME_MS;
    if (now - lastExtension < SESSION_RENEWAL_INTERVAL_MS) return undefined;

    try {
      const result = await this.#db
        .updateTable("sessions")
        .set({ expires_at: now + SESSION_LIFETIME_MS })
        .where("id", "=", session.id)
        .where("expires_at", "=", session.expires_at)
        .executeTakeFirst();
      return result.numUpdatedRows === 0n
        ? undefined
        : { maxAgeSeconds: SESSION_LIFETIME_MS / 1000 };
    } catch (err) {
      log.warn({ err }, "Renewing a session failed");
      return undefined;
    }
  }
}
