import type { TmdbClient, TmdbKeyCheck } from "@krazitv/media";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";

/**
 * Owns the owner's TMDB key (ADR 0013). The key goes in through `save` and
 * out only to TMDB: `readKey` serves the catalog scan's lookups, and no
 * route handler calls it, so no response can carry the key.
 */
export class TmdbKeyService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #client: TmdbClient;
  #revision = 0;

  // The client is injected so tests point it at a scripted TMDB.
  constructor(db: Kysely<DatabaseSchema>, client: TmdbClient) {
    this.#db = db;
    this.#client = client;
  }

  /** Reports whether a key is saved, never the key itself. */
  async isConfigured(): Promise<boolean> {
    return (await this.readKey()) !== undefined;
  }

  /**
   * Reads the saved key for a TMDB call, or undefined when none is set. Only
   * TMDB lookups may use it; it must never reach a response or a log line.
   */
  async readKey(): Promise<string | undefined> {
    const row = await this.#db
      .selectFrom("server_settings")
      .select("tmdb_api_key")
      .executeTakeFirstOrThrow();
    return row.tmdb_api_key ?? undefined;
  }

  /**
   * Asks TMDB about `apiKey` and stores it only when TMDB accepts it, so a
   * rejected key or an outage leaves any saved key in place. The TMDB call
   * runs before the write, never inside one (ADR 0013).
   */
  async save(apiKey: string): Promise<TmdbKeyCheck | { kind: "superseded" }> {
    const revision = ++this.#revision;
    const check = await this.#client.checkKey(apiKey);
    // A later save or removal owns the key even if this lookup finishes last.
    if (revision !== this.#revision) return { kind: "superseded" };
    if (check.kind === "valid") await this.#store(apiKey);
    return check;
  }

  /** Forgets the saved key; removing when none is saved is harmless. */
  async remove(): Promise<void> {
    ++this.#revision;
    await this.#store(null);
  }

  /** Writes the one settings row's key column. */
  async #store(apiKey: string | null): Promise<void> {
    await this.#db
      .updateTable("server_settings")
      .set({ tmdb_api_key: apiKey })
      .execute();
  }
}
