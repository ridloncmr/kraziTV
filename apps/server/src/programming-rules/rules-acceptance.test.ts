// Programming spec 0005 acceptance: default collections, rule-only
// Christmas and Halloween movies, a December join, a December
// Friday-evening feature, and an October join, configured once through the
// API, generate more than a year of programming in the programming
// timezone, through an edit, a restart, chunked generation, and
// regeneration.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { iso, send } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import type { ManualClock } from "../testing/manual-clock.js";
import {
  insertCollectionOfItems,
  readBlocks,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  startScheduleScenarioServer,
  startScheduleServer,
} from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TIME_ZONE = "America/New_York";
// Monday 2024-11-25, 09:00 in New York.
const START = Date.parse("2024-11-25T14:00:00Z");
// Mid-December, when the Friday feature is edited and the server restarts.
const EDIT_AT = Date.parse("2024-12-16T17:00:00Z");
// Past the second December, so two of each season are generated.
const END = Date.parse("2026-01-12T14:00:00Z");
// The channel seedScheduleScenario writes.
const CHANNEL_ID = channelFixture.id;
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;
const RULES_URL = `/channels/${CHANNEL_ID}/programming-rules`;
const GENERATE_URL = `/channels/${CHANNEL_ID}/schedule/generate`;

type Entries = Awaited<ReturnType<typeof readScheduleEntries>>;

const localParts = new Intl.DateTimeFormat("en-US-u-nu-latn", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

/** An instant's New York year, month (1-12), weekday, and hour, as rules see it. */
function local(instant: number) {
  const parts = Object.fromEntries(
    localParts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    weekday: parts.weekday,
    hour: Number(parts.hour),
  };
}

/** Whether an instant falls in the December Friday-evening feature window. */
function inFeature(instant: number): boolean {
  const { month, weekday, hour } = local(instant);
  return month === 12 && weekday === "Fri" && hour >= 18 && hour < 23;
}

/**
 * Catalogs two hour-long default series and two rule-only movie
 * collections, and assigns them: defaults two episodes a turn, movies one
 * film a turn and only when a rule selects them. Then saves the three rules.
 */
async function configure(server: FastifyInstance, db: Kysely<DatabaseSchema>) {
  await insertCollectionOfItems(db, "office", Array(30).fill(60 * MINUTE));
  await insertCollectionOfItems(db, "parks", Array(30).fill(60 * MINUTE));
  await insertCollectionOfItems(db, "christmas", Array(12).fill(110 * MINUTE));
  await insertCollectionOfItems(db, "halloween", Array(12).fill(100 * MINUTE));
  const assign = async (collection: string, ruleOnly: boolean) =>
    (
      await send(server, "POST", ASSIGNMENTS_URL, {
        ...collectionAssignment(collection),
        participation: ruleOnly ? "rule_only" : "default",
        ordinaryStretch: { kind: "programs", count: ruleOnly ? 1 : 2 },
      })
    ).body.id as string;
  const ids = {
    office: await assign("office", false),
    parks: await assign("parks", false),
    christmas: await assign("christmas", true),
    halloween: await assign("halloween", true),
  };
  const source = (assignmentId: string, count?: number) => ({
    assignmentId,
    ordinaryStretch: count === undefined ? null : { kind: "programs", count },
    marathon: { mode: "inherit" },
  });
  const rule = async (body: object) =>
    (await send(server, "POST", RULES_URL, body)).body.id as string;
  const rules = {
    october: await rule({
      name: "October",
      behavior: "join",
      priority: 1,
      dates: { kind: "annual", startMonthDay: "10-01", endMonthDay: "10-31" },
      sources: [source(ids.halloween)],
    }),
    december: await rule({
      name: "December",
      behavior: "join",
      priority: 1,
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
      sources: [source(ids.christmas)],
    }),
    fridays: await rule({
      name: "December Friday movies",
      behavior: "feature",
      priority: 2,
      dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
      weekdays: [5],
      window: { startMinute: 18 * 60, endMinute: 23 * 60 },
      sources: [source(ids.christmas, 2)],
    }),
  };
  return { ids, rules, source };
}

/**
 * Covers the channel a week ahead, six days at a time, until `until`, as a
 * long-running server would, so coverage never lapses.
 */
async function coverUntil(
  server: FastifyInstance,
  clock: ManualClock,
  until: number,
) {
  while (clock.now() < until) {
    const response = await send(server, "POST", GENERATE_URL, {
      through: iso(clock.now() + 7 * DAY),
    });
    expect(response.status).toBe(200);
    clock.advance(6 * DAY);
  }
  clock.set(until);
}

/** Each entry's collection and start, the shape regeneration must reproduce. */
function shape(entries: Entries) {
  return entries.map((entry) => [entry.media_collection_id, entry.starts_at]);
}

describe("recurring programming rules acceptance", () => {
  it("programs more than a year of seasons, features, and defaults through edits, a restart, and regeneration", async () => {
    const first = await startScheduleScenarioServer(
      { source: null },
      { entriesPerTransaction: 25, programmingTimezone: TIME_ZONE },
    );
    const { clock, dataDirectory } = first;
    clock.set(START);
    const { ids, rules, source } = await configure(first.server, first.db);
    await coverUntil(first.server, clock, EDIT_AT);

    // An edit mid-December keeps what is airing and changes later features.
    const beforeEdit = await readScheduleEntries(first.db, CHANNEL_ID);
    const airing = beforeEdit.find(
      (entry) => entry.starts_at <= EDIT_AT && entry.ends_at > EDIT_AT,
    );
    const edited = await send(
      first.server,
      "PATCH",
      `${RULES_URL}/${rules.fridays}`,
      {
        name: "December Friday movies",
        behavior: "feature",
        priority: 2,
        dates: {
          kind: "annual",
          startMonthDay: "12-01",
          endMonthDay: "12-31",
        },
        weekdays: [5],
        window: { startMinute: 18 * 60, endMinute: 23 * 60 },
        sources: [source(ids.christmas, 3)],
      },
    );
    expect(edited.status).toBe(200);
    const afterEdit = await readScheduleEntries(first.db, CHANNEL_ID);
    expect(afterEdit.find((entry) => entry.id === airing?.id)).toEqual(airing);

    // A restart under the same timezone changes nothing already covered.
    const second = await startScheduleServer(dataDirectory, clock, "b", {
      programmingTimezone: TIME_ZONE,
    });
    expect(
      (await readScheduleEntries(second.db, CHANNEL_ID)).slice(
        0,
        afterEdit.length,
      ),
    ).toEqual(afterEdit);
    await coverUntil(second.server, clock, END);

    const entries = await readScheduleEntries(second.db, CHANNEL_ID);
    const blocks = await readBlocks(second.db);
    const blockOf = new Map(blocks.map((block) => [block.id, block]));
    const collectionAt = (entry: Entries[number]) => entry.media_collection_id;

    // Christmas airs only in December, every year; Halloween only in October.
    const christmas = entries.filter(
      (entry) => collectionAt(entry) === "christmas",
    );
    const halloween = entries.filter(
      (entry) => collectionAt(entry) === "halloween",
    );
    for (const entry of christmas)
      expect(local(entry.starts_at).month).toBe(12);
    for (const entry of halloween)
      expect(local(entry.starts_at).month).toBe(10);
    expect(
      new Set(christmas.map((entry) => local(entry.starts_at).year)),
    ).toEqual(new Set([2024, 2025]));
    expect(halloween.length).toBeGreaterThan(10);

    // December Friday evenings feature only Christmas movies, two or three a
    // turn under the rule while joined turns air one; the timezone decides.
    const featured = entries.filter((entry) => inFeature(entry.starts_at));
    expect(featured.length).toBeGreaterThan(20);
    for (const entry of featured) expect(collectionAt(entry)).toBe("christmas");
    const featureBlocks = blocks.filter(
      (block) => block.winning_rule_id === rules.fridays,
    );
    expect(featureBlocks.length).toBeGreaterThan(5);
    for (const block of featureBlocks) {
      expect(block.context_key).toBe(`rule:${rules.fridays}`);
      expect([2, 3]).toContain(block.resolved_value);
    }
    expect(
      featureBlocks.some(
        (block) => block.starts_at > EDIT_AT && block.resolved_value === 3,
      ),
    ).toBe(true);
    const joined = blocks.filter(
      (block) =>
        block.winning_rule_id === rules.december &&
        block.assignment_id === ids.christmas,
    );
    expect(joined.length).toBeGreaterThan(10);
    for (const block of joined) {
      expect(block.context_key).toBe("default");
      expect(block.resolved_value).toBe(1);
    }

    // Outside the feature, December rounds mix Christmas with the defaults,
    // each taking at most one turn a round.
    const decemberRounds = new Map<number, string[]>();
    for (const block of blocks) {
      if (block.context_key !== "default") continue;
      if (local(block.starts_at).month !== 12) continue;
      decemberRounds.set(block.round_number, [
        ...(decemberRounds.get(block.round_number) ?? []),
        block.assignment_id ?? "",
      ]);
    }
    expect(
      [...decemberRounds.values()].some(
        (round) =>
          round.includes(ids.christmas) &&
          (round.includes(ids.office) || round.includes(ids.parks)),
      ),
    ).toBe(true);
    for (const round of decemberRounds.values()) {
      expect(new Set(round).size).toBe(round.length);
    }

    // Defaults alone resume after December and before October, and the
    // default series keep one continuous order all year.
    for (const entry of entries) {
      const { month } = local(entry.starts_at);
      const block = blockOf.get(entry.programming_block_id ?? "");
      if (month === 12 || month === 10) continue;
      if (block?.winning_rule_id !== null) continue;
      expect(["office", "parks"]).toContain(collectionAt(entry));
    }
    const officeOrder = entries
      .filter((entry) => collectionAt(entry) === "office")
      .map((entry) => Number(entry.media_item_id?.split("-")[1]));
    officeOrder.forEach((episode, index) => {
      if (index === 0) return;
      const previous = officeOrder[index - 1] ?? 0;
      expect(episode).toBe((previous % 30) + 1);
    });

    // Regeneration from now writes exactly what generation wrote.
    const boundary = entries.find(
      (entry) => entry.starts_at <= END && entry.ends_at > END,
    )?.ends_at;
    const regenerated = await send(second.server, "POST", GENERATE_URL, {
      regenerate: true,
    });
    expect(regenerated.status).toBe(200);
    const after = await readScheduleEntries(second.db, CHANNEL_ID);
    const from = (list: Entries) =>
      shape(list.filter((entry) => entry.starts_at >= (boundary ?? END)));
    expect(from(after).slice(0, 40)).toEqual(from(entries).slice(0, 40));
  }, 600_000);
});
