import { TmdbClient } from "@krazitv/media";
import { MetadataRefreshService } from "../content-metadata/refresh/metadata-refresh-service.js";
import { TmdbKeyService } from "../content-metadata/tmdb-key/tmdb-key-service.js";
import { rootFixture } from "./catalog-fixtures.js";
import {
  ALIEN_PATH,
  itemId,
  scanToEnd,
  setupEnrichmentScan,
} from "./enrichment-scan.js";
import { manualClock } from "./manual-clock.js";
import { recordingLog } from "./recording-log.js";
import { SCAN_ALIEN, SCAN_FIREFLY } from "./scan-metadata.js";
import { TrackedRuntime } from "./tracked-runtime.js";
const EPISODE_PATH = "Firefly/Season 1/s01e05.mkv";
const AMBIGUOUS_PATH = "The Thing/movie.mkv";
/**
 * Scans a movie, an episode, and an ambiguous title, then builds the real
 * refresh service over the same database and scripted TMDB, with its clock
 * at the scan time. `busy` stands in for the scanner's job check.
 */
export async function scannedLibrary() {
  const context = await setupEnrichmentScan({
    files: [ALIEN_PATH, EPISODE_PATH, AMBIGUOUS_PATH],
  });
  const firefly = { ...SCAN_FIREFLY };
  context.tmdb.series.push(firefly);
  await scanToEnd(context);
  const { db, tmdb } = context;
  const { scannedAt } = await db
    .selectFrom("metadata_provider_refs")
    .select((eb) => eb.fn.max("fetched_at").as("scannedAt"))
    .executeTakeFirstOrThrow();
  const clock = manualClock(scannedAt);
  const client = new TmdbClient({ fetch: tmdb.fetch, timeoutMs: 1_000 });
  const busy = { root: false };
  const runtime = new TrackedRuntime();
  const log = recordingLog();
  const keys = new TmdbKeyService(db, client);
  const refresh = new MetadataRefreshService({
    db,
    tmdbKeys: keys,
    tmdb: client,
    isScanning: (rootId) => busy.root && rootId === rootFixture.id,
    timers: runtime,
    now: clock.now,
    log,
  });

  tmdb.requests.splice(0);
  return {
    ...context,
    client,
    keys,
    clock,
    busy,
    runtime,
    log,
    refresh,
    firefly,
    alien: await itemId(context, ALIEN_PATH),
    episode: await itemId(context, EPISODE_PATH),
    ambiguous: await itemId(context, AMBIGUOUS_PATH),
  };
}

type Library = Awaited<ReturnType<typeof scannedLibrary>>;

// Changes what the scripted TMDB says about Alien, so a refresh shows in its facts.
export function changeAlien(
  { tmdb }: Library,
  change: { title?: string; genres?: string[] },
): void {
  const index = tmdb.movies.findIndex((movie) => movie.id === SCAN_ALIEN.id);
  tmdb.movies[index] = { ...SCAN_ALIEN, ...change };
}

// Reads one item's stored facts, reference, and match state.
export async function stored({ db }: Library, id: string) {
  return db
    .selectFrom("media_items")
    .leftJoin("content_facts", "content_facts.media_item_id", "media_items.id")
    .leftJoin(
      "metadata_provider_refs",
      "metadata_provider_refs.media_item_id",
      "media_items.id",
    )
    .leftJoin(
      "metadata_matches",
      "metadata_matches.media_item_id",
      "media_items.id",
    )
    .select([
      "metadata_matches.state",
      "content_facts.title",
      "content_facts.series_name",
      "content_facts.series_tmdb_id",
      "content_facts.season_number",
      "content_facts.episode_number",
      "content_facts.release_date",
      "content_facts.genres",
      "content_facts.poster_path",
      "metadata_provider_refs.external_id",
      "metadata_provider_refs.fetched_at",
      "metadata_provider_refs.refresh_error",
      "metadata_provider_refs.expired_at",
    ])
    .where("media_items.id", "=", id)
    .executeTakeFirstOrThrow();
}
