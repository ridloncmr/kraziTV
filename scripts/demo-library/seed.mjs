// Fills a fresh demo kraziTV (see start.mjs) over its HTTP API: account,
// TMDB key, the demo media root, tags, collections, channels, shows, rules,
// and a special. Run it once against an empty data/demo/db.
//
// Usage:
//   TMDB_API_KEY=<read access token> node scripts/demo-library/seed.mjs

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_PASSWORD, DEMO_TIMEZONE, DEMO_URL, movies } from "./library.mjs";

// Local times below, such as the special's 8 PM, mean the demo's timezone.
process.env.TZ = DEMO_TIMEZONE;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mediaDir = join(repoRoot, "data", "demo", "media");
let cookie = "";

/**
 * Calls the demo API with the session cookie, keeping any renewed cookie,
 * and retries a busy schedule because the server marks it retryable.
 */
async function api(method, path, body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${DEMO_URL}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (response.status === 503 && data?.error?.retryable && attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    }
    return data;
  }
}

/** Finds one entry by name in a picker list, failing with what was there. */
function pick(list, name, key = "name") {
  const found = list.find((entry) => entry[key] === name);
  if (!found) {
    const names = list.map((entry) => entry[key]).join(", ");
    throw new Error(`No "${name}" in [${names}]`);
  }
  return found;
}

const tmdbKey = process.env.TMDB_API_KEY;
if (!tmdbKey) throw new Error("Set TMDB_API_KEY to a TMDB read access token.");

await api("POST", "/auth/setup", {
  displayName: "Owner",
  password: DEMO_PASSWORD,
});
await api("PATCH", "/account", { avatarId: "crt-tv" });
await api("PUT", "/metadata/tmdb-key", { apiKey: tmdbKey });

// The key is saved first, because a scan looks items up only when it has one.
const root = await api("POST", "/media-roots", { path: mediaDir });
await api("POST", `/media-roots/${root.id}/scan`);
let scan;
do {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  scan = await api("GET", `/media-roots/${root.id}/scan`);
  console.log(
    `scan: ${scan.phase} ${scan.settledCount}/${scan.discoveredCount}`,
  );
} while (!["completed", "failed", "cancelled"].includes(scan.phase));
if (scan.phase !== "completed")
  throw new Error(`Scan ${scan.phase}: ${scan.error}`);
console.log("scan summary", scan.summary);

const { items } = await api("POST", "/media-items/matches", {});
const itemFor = (fileName) => {
  const item = items.find((entry) => entry.path.endsWith(fileName));
  if (!item) throw new Error(`No media item for ${fileName}`);
  return item;
};
const movieItem = (title) => {
  const movie = movies.find((entry) => entry.title === title);
  return itemFor(`${movie.title} (${movie.year}).mkv`);
};

for (const movie of movies.filter((entry) => entry.tags.length > 0)) {
  await api("PATCH", `/metadata/corrections/${movieItem(movie.title).id}`, {
    tags: movie.tags,
  });
}

const series = await api("GET", "/media-collections/series");
const franchises = await api("GET", "/media-collections/franchises");
const tags = await api("GET", "/media-collections/tags");
const genres = await api("GET", "/media-collections/genres");
const collection = (name, criterion) =>
  api("POST", "/media-collections", { name, criterion });

const showCollections = {};
for (const entry of series) {
  showCollections[entry.name] = await collection(entry.name, {
    kind: "series",
    tmdbId: entry.tmdbId,
  });
}
/** The series collection TMDB named this way, failing if it did not match. */
const show = (name) => pick(Object.values(showCollections), name);
const sherlock = franchises.find((entry) => /Sherlock/.test(entry.name));
const sherlockCollection = sherlock
  ? await collection(sherlock.name, {
      kind: "franchise",
      tmdbId: sherlock.tmdbId,
    })
  : undefined;
const halloween = await collection("Halloween", {
  kind: "tag",
  tagId: pick(tags, "Halloween").tagId,
});
const christmas = await collection("Christmas", {
  kind: "tag",
  tagId: pick(tags, "Christmas").tagId,
});
const horror = genres.find((entry) => entry.name === "Horror");
if (horror) await collection("Horror", { kind: "genre", name: "Horror" });
const comedyClassics = await api("POST", "/media-collections", {
  name: "Comedy Classics",
  mediaItemIds: [
    "His Girl Friday",
    "My Man Godfrey",
    "Charade",
    "The General",
    "The Kid",
  ].map((title) => movieItem(title).id),
});

/** Creates one channel with its marathon settings and shows, in order. */
async function channel(number, name, marathons, assignments) {
  const created = await api("POST", "/channels", { number, name });
  await api("PUT", `/channels/${created.id}/programming-settings`, marathons);
  const saved = await api(
    "POST",
    `/channels/${created.id}/programming-assignments/batch`,
    { assignments },
  );
  return { ...created, assignments: saved };
}
const fromCollections = (collections, playbackMode, extra = {}) => ({
  playbackMode,
  participation: "default",
  ordinaryStretch: { kind: "programs", count: 2 },
  members: collections.map((entry) => ({
    kind: "collection",
    mediaCollectionId: entry.id,
  })),
  ...extra,
});
const noMarathons = { marathonChancePercent: 0, marathonMinOrdinaryRounds: 0 };
const marathon = { kind: "programs", count: 5 };

await channel(
  "2",
  "Classic TV",
  { marathonChancePercent: 25, marathonMinOrdinaryRounds: 2 },
  [
    fromCollections(
      [show("The Beverly Hillbillies"), show("The Andy Griffith Show")],
      "episode",
      { marathonStretch: marathon },
    ),
    fromCollections([show("The Dick Van Dyke Show")], "episode", {
      marathonStretch: marathon,
    }),
  ],
);
await channel("3", "Westerns", noMarathons, [
  fromCollections([show("Bonanza")], "episode", {
    ordinaryStretch: { kind: "programs", count: 1 },
  }),
  fromCollections([show("The Lone Ranger")], "episode"),
]);
await channel("4", "Mystery Theater", noMarathons, [
  fromCollections([show("Dragnet")], "episode"),
  fromCollections([show("One Step Beyond")], "chronological"),
]);

const movieShows = [
  fromCollections([comedyClassics], "random", {
    ordinaryStretch: { kind: "programs", count: 1 },
  }),
  fromCollections([halloween], "random", {
    participation: "rule_only",
    ordinaryStretch: { kind: "programs", count: 1 },
  }),
  fromCollections([christmas], "random", {
    participation: "rule_only",
    ordinaryStretch: { kind: "programs", count: 1 },
  }),
  {
    playbackMode: null,
    participation: "default",
    ordinaryStretch: { kind: "programs", count: 1 },
    members: ["Plan 9 from Outer Space", "Detour", "D.O.A."].map((title) => ({
      kind: "media_item",
      mediaItemId: movieItem(title).id,
    })),
    name: "Cult Picks",
  },
];
if (sherlockCollection) {
  movieShows.push(
    fromCollections([sherlockCollection], "release", {
      ordinaryStretch: { kind: "programs", count: 1 },
    }),
  );
}
const movieNight = await channel("5", "Movie Night", noMarathons, movieShows);

// Three more channels so the guide looks like a full lineup.
await channel("6", "Sitcom Gold", noMarathons, [
  fromCollections([show("The Dick Van Dyke Show")], "random"),
  fromCollections([show("The Beverly Hillbillies")], "random"),
  fromCollections([show("The Andy Griffith Show")], "random"),
]);
await channel("7", "Fright Night", noMarathons, [
  fromCollections([halloween], "random", {
    ordinaryStretch: { kind: "programs", count: 1 },
  }),
  fromCollections([show("One Step Beyond")], "episode"),
]);
await channel("8", "Detective Hour", noMarathons, [
  fromCollections([show("Dragnet")], "random"),
  ...(sherlockCollection
    ? [
        fromCollections([sherlockCollection], "release", {
          ordinaryStretch: { kind: "programs", count: 1 },
        }),
      ]
    : []),
]);

/** Adds a feature rule that plays one rule-only show across a yearly date range. */
const seasonalRule = (name, assignment, startMonthDay, endMonthDay) =>
  api("POST", `/channels/${movieNight.id}/programming-rules`, {
    name,
    behavior: "feature",
    priority: 3,
    dates: { kind: "annual", startMonthDay, endMonthDay },
    weekdays: null,
    window: null,
    sources: [{ assignmentId: assignment.id }],
  });
await seasonalRule("Halloween", movieNight.assignments[1], "10-01", "10-31");
await seasonalRule("Christmas", movieNight.assignments[2], "12-01", "12-25");

// A special two days out at 8 PM local, previewed right before saving
// because the save is refused if programming changed since the preview.
const start = new Date();
start.setDate(start.getDate() + 2);
start.setHours(20, 0, 0, 0);
const special = {
  startsAt: start.toISOString(),
  endsAt: null,
  interrupts: false,
  source: {
    kind: "media_items",
    mediaItemIds: [movieItem("It's a Wonderful Life").id],
  },
};
const preview = await api(
  "POST",
  `/channels/${movieNight.id}/reservations/preview`,
  special,
);
if (preview.conflicts.length > 0) {
  throw new Error(`Special refused: ${JSON.stringify(preview.conflicts)}`);
}
await api("POST", `/channels/${movieNight.id}/reservations`, {
  ...special,
  expectedProgrammingRevision: preview.programmingRevision,
  requestKey: randomUUID(),
});
console.log(`Seeded the demo kraziTV at ${DEMO_URL}`);
