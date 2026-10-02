// Spec 0003 acceptance: collections and channels configured over HTTP against
// the real composition and a real temporary SQLite file, then read back after a
// restart. Only the channel runtime is replaced, so stops can be observed.
import { sql, type Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaItemTable } from "../database/schema/media-item-table.js";
import { send } from "../testing/api-requests.js";
import { itemFixture, rootFixture } from "../testing/catalog-fixtures.js";
import { RecordingChannelRuntime } from "../testing/recording-channel-runtime.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

// The whole public channel shape; anything more would leak provider, FFmpeg,
// or programming concerns into channel identity.
const CHANNEL_FIELDS = [
  "createdAt",
  "enabled",
  "id",
  "name",
  "number",
  "updatedAt",
];
const CHANNEL_COLUMNS = [
  "created_at",
  "enabled",
  "id",
  "name",
  "number",
  "updated_at",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Builds a cataloged media item whose ID doubles as its unique path and title.
function item(id: string): Insertable<MediaItemTable> {
  const path = `/media/shows/${id}.mkv`;
  return { ...itemFixture, id, path, path_key: path, title: id };
}

// Composes the server the way index.ts does, except for a recording runtime.
async function startServer(
  dataDirectory: string,
  options: { seedCatalog?: boolean } = {},
) {
  const runtime = new RecordingChannelRuntime();
  const { server, db } = await startTestServer({
    dataDirectory,
    seed: async (db) => {
      if (!options.seedCatalog) return;
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([item("pilot"), item("second"), item("finale")])
        .execute();
    },
    overrides: () => ({ channelRuntime: runtime }),
  });
  return { server, db, runtime };
}

describe("channel configuration acceptance", () => {
  it("configures collections and channels, then keeps them across a restart", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await startServer(dataDirectory, { seedCatalog: true });

    // Collections: created from an explicit order, renamed, reordered, deleted.
    const office = await send(first.server, "POST", "/media-collections", {
      name: "The Office",
      mediaItemIds: ["pilot", "second", "finale"],
    });
    expect(office.status).toBe(201);
    const officeId: string = office.body.id;
    const scratch = await send(first.server, "POST", "/media-collections", {
      name: "Scratch",
    });
    expect(
      (
        await send(first.server, "PATCH", `/media-collections/${officeId}`, {
          name: "The Office (US)",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          first.server,
          "PUT",
          `/media-collections/${officeId}/items`,
          {
            mediaItemIds: ["finale", "pilot", "pilot"],
          },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          first.server,
          "PUT",
          `/media-collections/${officeId}/items`,
          {
            mediaItemIds: ["finale", "pilot"],
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          first.server,
          "DELETE",
          `/media-collections/${scratch.body.id}`,
        )
      ).status,
    ).toBe(204);

    // Channels: identity only, numbers canonical and unique.
    const news = await send(first.server, "POST", "/channels", {
      number: "69.1",
      name: "Krazi News",
    });
    expect(news.status).toBe(201);
    const main = await send(first.server, "POST", "/channels", {
      number: "69",
      name: "Krazi Main",
    });
    const reruns = await send(first.server, "POST", "/channels", {
      number: "7",
      name: "Reruns",
    });
    expect(
      (
        await send(first.server, "POST", "/channels", {
          number: "69",
          name: "Copycat",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(first.server, "POST", "/channels", {
          number: "069",
          name: "Leading Zero",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(first.server, "POST", "/channels", {
          number: "70",
          name: "Programmed",
          mediaCollectionId: officeId,
        })
      ).status,
    ).toBe(400);

    // Lifecycle: disable and delete stop the runtime; rename does not.
    expect(
      (
        await send(first.server, "PATCH", `/channels/${main.body.id}`, {
          name: "Krazi Prime",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(first.server, "PATCH", `/channels/${news.body.id}`, {
          enabled: false,
        })
      ).body.enabled,
    ).toBe(false);
    expect(
      (await send(first.server, "DELETE", `/channels/${reruns.body.id}`))
        .status,
    ).toBe(204);
    expect(first.runtime.stops).toEqual([
      { channelId: news.body.id, reason: "disabled" },
      { channelId: reruns.body.id, reason: "deleted" },
    ]);

    const channelsBefore = (await send(first.server, "GET", "/channels")).body;
    const collectionsBefore = (
      await send(first.server, "GET", "/media-collections")
    ).body;
    expect(collectionsBefore.map(({ name }: { name: string }) => name)).toEqual(
      ["The Office (US)"],
    );
    await first.server.close();

    const second = await startServer(dataDirectory);

    const channels: Record<string, unknown>[] = (
      await send(second.server, "GET", "/channels")
    ).body;
    expect(channels).toEqual(channelsBefore);
    expect(
      channels.map(({ number, name, enabled }) => ({
        number,
        name,
        enabled,
      })),
    ).toEqual([
      { number: "69", name: "Krazi Prime", enabled: true },
      { number: "69.1", name: "Krazi News", enabled: false },
    ]);
    expect(
      (await send(second.server, "GET", "/media-collections")).body,
    ).toEqual(collectionsBefore);
    expect(
      (await send(second.server, "GET", `/media-collections/${officeId}`)).body
        .name,
    ).toBe("The Office (US)");
    expect(
      (
        await send(second.server, "GET", `/media-collections/${officeId}/items`)
      ).body.map(({ mediaItemId }: { mediaItemId: string }) => mediaItemId),
    ).toEqual(["finale", "pilot"]);

    // Provider-neutral identity in both the API and the stored rows.
    for (const channel of channels) {
      expect(Object.keys(channel).sort()).toEqual(CHANNEL_FIELDS);
      expect(channel.id).toMatch(UUID);
    }
    const { rows } = await sql<{ name: string }>`
      select name from pragma_table_info('channels')
    `.execute(second.db);
    expect(rows.map(({ name }) => name).sort()).toEqual(CHANNEL_COLUMNS);

    // After the restart a disabled channel still holds its number, while a
    // deleted channel's number is free again.
    expect(
      (
        await send(second.server, "POST", "/channels", {
          number: "69.1",
          name: "Squatter",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(second.server, "POST", "/channels", {
          number: "7",
          name: "Reruns Again",
        })
      ).status,
    ).toBe(201);
  });
});
