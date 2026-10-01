import { parseChannelNumber, type ChannelNumber } from "@krazitv/krazi-brain";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { KraziDatabase } from "../database/database.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { ChannelRepository } from "./channel-repository.js";

afterEach(cleanUpTestEnvironment);

// Builds a canonical number for fixtures; a typo here should fail loudly.
function channelNumber(input: string): ChannelNumber {
  const parsed = parseChannelNumber(input);
  if (parsed === undefined) throw new Error(`Not canonical: ${input}`);
  return parsed;
}

// Creates a repository with a controllable clock and sequential IDs.
function createRepository(database: KraziDatabase) {
  const clock = { now: FIXTURE_TIME };
  let nextId = 0;
  const repository = new ChannelRepository(database.db, {
    createId: () => `channel-${String(++nextId).padStart(3, "0")}`,
    now: () => clock.now,
  });
  return { repository, clock };
}

const comedy = {
  number: channelNumber("69"),
  name: "Krazi Comedy",
  enabled: true,
};

describe("ChannelRepository", () => {
  it("creates a channel with exact identity and timestamps", async () => {
    const { repository } = createRepository(await openTestDatabase());

    await expect(repository.create(comedy)).resolves.toEqual({
      kind: "created",
      channel: {
        id: "channel-001",
        number: "69",
        name: "Krazi Comedy",
        enabled: true,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      },
    });
  });

  it("rejects a duplicate number, including one held by a disabled channel", async () => {
    const { repository } = createRepository(await openTestDatabase());
    await repository.create({ ...comedy, enabled: false });

    await expect(
      repository.create({ ...comedy, name: "Another" }),
    ).resolves.toEqual({ kind: "duplicate_number", number: "69" });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("finds a channel by ID and returns undefined for unknown IDs", async () => {
    const { repository } = createRepository(await openTestDatabase());
    await repository.create(comedy);

    await expect(repository.findById("channel-001")).resolves.toMatchObject({
      number: "69",
      name: "Krazi Comedy",
    });
    await expect(repository.findById("missing")).resolves.toBeUndefined();
  });

  it("updates only the given fields and advances only updatedAt", async () => {
    const { repository, clock } = createRepository(await openTestDatabase());
    await repository.create(comedy);
    clock.now = FIXTURE_TIME + 60_000;

    await expect(
      repository.update("channel-001", { enabled: false }),
    ).resolves.toEqual({
      kind: "updated",
      channel: {
        id: "channel-001",
        number: "69",
        name: "Krazi Comedy",
        enabled: false,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME + 60_000,
      },
    });

    await expect(
      repository.update("channel-001", {
        number: channelNumber("69.1"),
        name: "Krazi Classics",
      }),
    ).resolves.toMatchObject({
      kind: "updated",
      channel: { number: "69.1", name: "Krazi Classics", enabled: false },
    });
  });

  it.each([
    ["repeats every stored value", { ...comedy }],
    ["names no fields", {}],
  ])(
    "leaves the channel and updatedAt alone when an update %s",
    async (_label, changes) => {
      const { repository, clock } = createRepository(await openTestDatabase());
      const created = await repository.create(comedy);
      clock.now = FIXTURE_TIME + 60_000;

      await expect(repository.update("channel-001", changes)).resolves.toEqual(
        created.kind === "created" && {
          kind: "updated",
          channel: created.channel,
        },
      );
    },
  );

  it("rejects an update to another channel's number and keeps the prior one", async () => {
    const { repository } = createRepository(await openTestDatabase());
    await repository.create(comedy);
    await repository.create({ ...comedy, number: channelNumber("70") });

    await expect(
      repository.update("channel-002", { number: comedy.number }),
    ).resolves.toEqual({ kind: "duplicate_number", number: "69" });
    await expect(repository.findById("channel-002")).resolves.toMatchObject({
      number: "70",
    });
  });

  it("reports an unknown channel on update", async () => {
    const { repository } = createRepository(await openTestDatabase());

    await expect(
      repository.update("missing", { name: "Anything" }),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("deletes a channel and reports whether one existed", async () => {
    const { repository } = createRepository(await openTestDatabase());
    await repository.create(comedy);

    await expect(repository.delete("channel-001")).resolves.toBe(true);
    await expect(repository.delete("channel-001")).resolves.toBe(false);
    await expect(repository.findById("channel-001")).resolves.toBeUndefined();
  });

  it("rejects non-canonical numbers and invalid enabled values at the schema", async () => {
    const database = await openTestDatabase();
    const insert = (number: string, enabled = 1) =>
      sql`
        insert into channels (id, number, name, enabled, created_at, updated_at)
        values (${number}, ${number}, 'Channel', ${enabled}, 0, 0)
      `.execute(database.db);

    for (const number of [
      "",
      "0",
      "069",
      "69.0",
      "69.01",
      "69.",
      ".1",
      "1.2.3",
      " 69",
      "+69",
      "6a",
    ]) {
      await expect(insert(number), number).rejects.toThrow(/CHECK constraint/);
    }
    await expect(insert("70", 2)).rejects.toThrow(/CHECK constraint/);
    await expect(insert("69")).resolves.toBeDefined();
    await expect(insert("69.1")).resolves.toBeDefined();
  });

  it("keeps channels after closing and reopening the database", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await openTestDatabase(dataDirectory);
    await createRepository(first).repository.create(comedy);
    await first.close();

    const reopened = createRepository(await openTestDatabase(dataDirectory));
    await expect(reopened.repository.list()).resolves.toMatchObject([
      { id: "channel-001", number: "69", name: "Krazi Comedy", enabled: true },
    ]);
  });
});
