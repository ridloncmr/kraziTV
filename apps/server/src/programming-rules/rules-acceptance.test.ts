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
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

/** An instant's New York year, month (1-12), day, weekday, and hour, as rules see it. */
function local(instant: number) {
  const parts = Object.fromEntries(
    localParts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
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

// Programming spec 0009 acceptance: Nick and Cartoon Network take over
// Saturday mornings at one priority and share a show, Halloween and Snow
// Day mix in for their months at that priority, and a higher-priority
// Christmas takeover replaces everything on Saturday 2027-12-25.
describe("combined programming rules acceptance", () => {
  // Monday 2027-09-27, 09:00 in New York, before Halloween mixes in.
  const COMBINED_START = Date.parse("2027-09-27T13:00:00Z");
  // Saturday 2027-10-16, 08:00 in New York, when the server restarts.
  const RESTART_AT = Date.parse("2027-10-16T12:00:00Z");
  // Monday 2027-12-27, 09:00 in New York, past the Christmas Saturday.
  const COMBINED_END = Date.parse("2027-12-27T14:00:00Z");

  /**
   * Catalogs two hour-long default series and six rule-only collections,
   * then saves the five rules in saved order: Nick, Cartoon Network,
   * Halloween, Snow Day, and Christmas.
   */
  async function configureCombined(
    server: FastifyInstance,
    db: Kysely<DatabaseSchema>,
  ) {
    const assign = async (
      collection: string,
      minutes: number,
      count: number,
      participation: "default" | "rule_only",
    ) => {
      await insertCollectionOfItems(
        db,
        collection,
        Array(200).fill(minutes * MINUTE),
      );
      return (
        await send(server, "POST", ASSIGNMENTS_URL, {
          ...collectionAssignment(collection),
          participation,
          ordinaryStretch: { kind: "programs", count },
        })
      ).body.id as string;
    };
    const ids = {
      office: await assign("office", 60, 2, "default"),
      parks: await assign("parks", 60, 2, "default"),
      nick: await assign("nick", 30, 3, "rule_only"),
      cartoon: await assign("cartoon", 30, 3, "rule_only"),
      sponge: await assign("sponge", 30, 3, "rule_only"),
      halloween: await assign("halloween", 30, 1, "rule_only"),
      snow: await assign("snow", 30, 1, "rule_only"),
      christmas: await assign("christmas", 110, 1, "rule_only"),
    };
    const source = (assignmentId: string, count?: number) => ({
      assignmentId,
      ordinaryStretch: count === undefined ? null : { kind: "programs", count },
      marathon: { mode: "inherit" },
    });
    const saturdays = (startHour: number, endHour: number) => ({
      weekdays: [6],
      window: { startMinute: startHour * 60, endMinute: endHour * 60 },
    });
    const annual = (startMonthDay: string, endMonthDay: string) => ({
      dates: { kind: "annual", startMonthDay, endMonthDay },
    });
    const rule = async (body: object) => {
      const response = await send(server, "POST", RULES_URL, body);
      expect(response.status).toBe(201);
      return response.body.id as string;
    };
    const rules = {
      nick: await rule({
        name: "Nick Cartoons",
        behavior: "feature",
        priority: 3,
        ...saturdays(7, 11),
        sources: [source(ids.nick), source(ids.sponge, 1)],
      }),
      cartoon: await rule({
        name: "Cartoon Network Cartoons",
        behavior: "feature",
        priority: 3,
        ...saturdays(9, 11),
        sources: [source(ids.cartoon), source(ids.sponge, 2)],
      }),
      halloween: await rule({
        name: "Halloween Specials",
        behavior: "join",
        priority: 3,
        ...annual("10-01", "10-31"),
        sources: [source(ids.halloween)],
      }),
      snow: await rule({
        name: "Snow Day",
        behavior: "join",
        priority: 3,
        ...annual("12-01", "12-31"),
        sources: [source(ids.snow)],
      }),
      christmas: await rule({
        name: "Christmas Movies",
        behavior: "feature",
        priority: 4,
        ...annual("12-25", "12-25"),
        sources: [source(ids.christmas)],
      }),
    };
    return { ids, rules };
  }

  /**
   * What spec 0009 lets air at an entry's start, as collections and the
   * rotation context they take turns in.
   */
  function expectedAt(
    instant: number,
    rules: Awaited<ReturnType<typeof configureCombined>>["rules"],
  ) {
    const { month, day, weekday, hour } = local(instant);
    if (month === 12 && day === 25) {
      return { collections: ["christmas"], context: `rule:${rules.christmas}` };
    }
    const mixIns = month === 10 ? ["halloween"] : month === 12 ? ["snow"] : [];
    if (weekday === "Sat" && hour >= 9 && hour < 11) {
      return {
        collections: ["nick", "sponge", "cartoon", ...mixIns],
        context: `rule:${[rules.nick, rules.cartoon].sort().join("+")}`,
      };
    }
    if (weekday === "Sat" && hour >= 7 && hour < 9) {
      return {
        collections: ["nick", "sponge", ...mixIns],
        context: `rule:${rules.nick}`,
      };
    }
    return { collections: ["office", "parks", ...mixIns], context: "default" };
  }

  it("combines same-priority rules, lets a higher priority take over, and reproduces them after a restart and regeneration", async () => {
    const first = await startScheduleScenarioServer(
      { source: null },
      { entriesPerTransaction: 25, programmingTimezone: TIME_ZONE },
    );
    const { clock, dataDirectory } = first;
    clock.set(COMBINED_START);
    const { ids, rules } = await configureCombined(first.server, first.db);
    // The first rule, in saved order, naming each show; none names a
    // default show, so no rule chose its turns.
    const namingRule = new Map([
      [ids.office, null],
      [ids.parks, null],
      [ids.nick, rules.nick],
      [ids.sponge, rules.nick],
      [ids.cartoon, rules.cartoon],
      [ids.halloween, rules.halloween],
      [ids.snow, rules.snow],
      [ids.christmas, rules.christmas],
    ]);
    await coverUntil(first.server, clock, RESTART_AT);

    // A restart keeps everything covered, and a regeneration from now
    // writes what chunked generation wrote and what the preview showed.
    const covered = await readScheduleEntries(first.db, CHANNEL_ID);
    const second = await startScheduleServer(dataDirectory, clock, "b", {
      programmingTimezone: TIME_ZONE,
    });
    expect(await readScheduleEntries(second.db, CHANNEL_ID)).toEqual(covered);
    const preview = await send(
      second.server,
      "GET",
      `/channels/${CHANNEL_ID}/programming-preview?turns=20`,
    );
    expect(preview.status).toBe(200);
    const regenerated = await send(second.server, "POST", GENERATE_URL, {
      regenerate: true,
    });
    expect(regenerated.status).toBe(200);
    const boundary = covered.find(
      (entry) => entry.starts_at <= RESTART_AT && entry.ends_at > RESTART_AT,
    )?.ends_at;
    const from = (list: Entries) =>
      shape(
        list.filter((entry) => entry.starts_at >= (boundary ?? RESTART_AT)),
      );
    const rewritten = await readScheduleEntries(second.db, CHANNEL_ID);
    expect(from(rewritten).slice(0, 60)).toEqual(from(covered).slice(0, 60));

    // The preview names the rule that chose each turn, as generation records.
    const written = await readBlocks(second.db);
    const fresh = (preview.body.turns as Record<string, unknown>[]).filter(
      (turn) => !turn.continues,
    );
    expect(fresh.length).toBeGreaterThan(10);
    for (const turn of fresh) {
      const block = written.find(
        (candidate) =>
          candidate.starts_at === Date.parse(turn.startsAt as string),
      );
      expect(block).toMatchObject({
        assignment_id: turn.assignmentId,
        winning_rule_id: turn.winningRuleId,
      });
    }
    for (const turn of fresh) {
      expect(turn.winningRuleId).toBe(
        namingRule.get(turn.assignmentId as string),
      );
    }
    expect(fresh.some((turn) => turn.winningRuleId === null)).toBe(true);
    expect(fresh.some((turn) => turn.winningRuleId === rules.nick)).toBe(true);

    await coverUntil(second.server, clock, COMBINED_END);
    const entries = await readScheduleEntries(second.db, CHANNEL_ID);
    const blocks = await readBlocks(second.db);
    const blockOf = new Map(blocks.map((block) => [block.id, block]));

    // Every program airs only what its instant's active rules allow, in
    // their rotation context, and every allowed collection airs somewhere.
    const aired = new Map<string, Set<string>>();
    for (const entry of entries) {
      const expected = expectedAt(entry.starts_at, rules);
      expect(expected.collections).toContain(entry.media_collection_id);
      expect(blockOf.get(entry.programming_block_id ?? "")?.context_key).toBe(
        expected.context,
      );
      const key = expected.collections.join(",");
      aired.set(
        key,
        (aired.get(key) ?? new Set()).add(entry.media_collection_id ?? ""),
      );
    }
    for (const [key, collections] of aired) {
      expect([...collections].sort()).toEqual(key.split(",").sort());
    }

    // Each turn records the first rule, in saved order, naming its show:
    // Nick for the shared show, at Nick's size.
    for (const block of blocks) {
      expect(block.winning_rule_id).toBe(
        namingRule.get(block.assignment_id ?? ""),
      );
      if (block.assignment_id === ids.sponge) {
        expect(block.resolved_value).toBe(1);
      }
    }

    // Every context's round gives each show at most one turn, and a lone
    // takeover's rounds continue across the combinations between them.
    const rounds = new Map<string, string[]>();
    for (const block of blocks) {
      const key = `${block.context_key}#${block.round_number}`;
      rounds.set(key, [...(rounds.get(key) ?? []), block.assignment_id ?? ""]);
    }
    for (const round of rounds.values()) {
      expect(new Set(round).size).toBe(round.length);
    }
    const nickRounds = blocks
      .filter((block) => block.context_key === `rule:${rules.nick}`)
      .map((block) => block.round_number);
    expect(nickRounds).toEqual([...nickRounds].sort((a, b) => a - b));
    expect(new Set(nickRounds).size).toBeGreaterThan(1);

    // The shared show's episodes air in order across every context.
    const sponge = entries
      .filter((entry) => entry.media_collection_id === "sponge")
      .map((entry) => entry.media_item_id);
    expect(sponge.length).toBeGreaterThan(10);
    expect(sponge).toEqual(sponge.map((_, index) => `sponge-${index + 1}`));

    // Halloween mixing in at midnight on October 1 ends no turn under way.
    const midnight = Date.parse("2027-10-01T04:00:00Z");
    const straddling = entries.findIndex(
      (entry) => entry.starts_at >= midnight,
    );
    expect(entries[straddling]?.programming_block_id).toBe(
      entries[straddling - 1]?.programming_block_id,
    );
  }, 600_000);
});
