import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";
import type {
  AuthState,
  IssuedSession,
  SetUpInput,
  SetUpResult,
} from "./contracts.js";
import { hashPassword } from "./passwords/password-hash.js";
import {
  createSessionToken,
  hashSessionToken,
  SESSION_LIFETIME_MS,
} from "./sessions/session-token.js";

/** Reports whether the one account exists, on whichever connection the caller holds. */
async function hasAccount(db: Kysely<DatabaseSchema>): Promise<boolean> {
  const row = await db.selectFrom("accounts").select("id").executeTakeFirst();
  return row !== undefined;
}

/**
 * Owns the one account and its sessions (ADR 0012). Session tokens enter and
 * leave only as plain strings; cookies and HTTP stay in the routes. The clock
 * is injectable so expiry is testable with a manual clock.
 */
export class AuthService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can step expiry and assert rows.
  constructor(db: Kysely<DatabaseSchema>, options: RecordSources = {}) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Reports whether setup is still needed, the account's public profile, and
   * whether `token` names a live session. A token is never valid before setup.
   */
  async state(token: string | undefined): Promise<AuthState> {
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
      authenticated: token !== undefined && (await this.#isLive(token)),
    };
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
   * Decides whether `token` names an unexpired session. An expired one is
   * deleted as it is found, only while still expired, so a concurrent
   * extension is never undone.
   */
  async #isLive(token: string): Promise<boolean> {
    const session = await this.#db
      .selectFrom("sessions")
      .select(["id", "expires_at"])
      .where("token_hash", "=", hashSessionToken(token))
      .executeTakeFirst();
    if (session === undefined) return false;

    const now = this.#now();
    if (session.expires_at > now) return true;
    await this.#db
      .deleteFrom("sessions")
      .where("id", "=", session.id)
      .where("expires_at", "<=", now)
      .execute();
    return false;
  }
}
