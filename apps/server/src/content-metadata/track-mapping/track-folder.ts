import {
  currentPathPlatform,
  discTrack,
  mediaPathSegments,
  type PathHints,
} from "@krazitv/media";
import type { Kysely } from "kysely";

import { pathHintsBelow } from "../../catalog-scan/scanner/catalog-candidate.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { jsonIdList } from "../../database/writes/parameter-chunks.js";
import type { FolderTrack, MetadataRefusal } from "../contracts.js";
import { compareTracks } from "./track-proposal.js";

/** A mapped track with what its match record needs beside the API fields. */
export interface ReadTrack extends FolderTrack {
  pathKey: string;
  hints: PathHints;
}

/**
 * The disc tracks one track mapping covers, in proposal order, with the
 * series and season hints the dialog starts from.
 */
export interface TrackFolder {
  series: string | null;
  season: number | null;
  tracks: ReadTrack[];
}

/** Captures catalog and owner decisions so a delayed mapping cannot erase newer edits. */
export async function readTrackStates(
  db: Kysely<DatabaseSchema>,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("media_items")
    .leftJoin(
      "metadata_matches",
      "metadata_matches.media_item_id",
      "media_items.id",
    )
    .leftJoin(
      "metadata_corrections",
      "metadata_corrections.media_item_id",
      "media_items.id",
    )
    .select([
      "media_items.id",
      "media_items.path_key",
      "media_items.duration_ms",
      "metadata_matches.state",
      "metadata_matches.extra",
      "metadata_matches.looked_up_at",
      "metadata_matches.evidence",
      "metadata_matches.matched_duration_ms",
      "metadata_matches.lookup_error",
      "metadata_corrections.title",
      "metadata_corrections.series_name",
      "metadata_corrections.season_number",
      "metadata_corrections.episode_number",
      "metadata_corrections.tags",
    ])
    .where("media_items.id", "in", jsonIdList(ids))
    .where("media_items.removed_at", "is", null)
    .execute();
  return new Map(rows.map(({ id, ...state }) => [id, JSON.stringify(state)]));
}

/**
 * Reads the disc tracks mapped together with `mediaItemId`: every cataloged
 * item under its root whose path hints place it under the same series folder
 * and season, in proposal order. Hints are derived from each path now rather
 * than read from stored evidence, since tracks are never looked up and so
 * have none, but only for items under the series folder, which the root's
 * path-key index finds without reading the rest of the root. Refuses an
 * unknown or removed item, and one that is no disc track.
 */
export async function readTrackFolder(
  db: Kysely<DatabaseSchema>,
  mediaItemId: string,
): Promise<TrackFolder | MetadataRefusal> {
  const anchor = await db
    .selectFrom("media_items")
    .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
    .select([
      "media_items.media_root_id as rootId",
      "media_items.path",
      "media_items.path_key as pathKey",
      "media_roots.path as rootPath",
      "media_roots.path_key as rootPathKey",
    ])
    .where("media_items.id", "=", mediaItemId)
    .where("media_items.removed_at", "is", null)
    .executeTakeFirst();
  if (anchor === undefined) return { kind: "item_not_found" };
  const hints = pathHintsBelow(anchor.rootPath, anchor.path);
  const place = hints === undefined ? undefined : discTrack(hints);
  if (place === undefined) return { kind: "not_disc_track" };

  const range = folderKeyRange(
    anchor.rootPathKey,
    anchor.pathKey,
    hints?.seriesFolder ?? "",
  );
  const rows = await db
    .selectFrom("media_items")
    .select(["id", "path", "path_key", "duration_ms"])
    .where("media_root_id", "=", anchor.rootId)
    .where("path_key", ">=", range.from)
    .where("path_key", "<", range.to)
    .where("removed_at", "is", null)
    .execute();
  const tracks = rows.flatMap((row): ReadTrack[] => {
    const rowHints = pathHintsBelow(anchor.rootPath, row.path);
    const rowPlace = rowHints === undefined ? undefined : discTrack(rowHints);
    if (rowHints === undefined || rowPlace?.key !== place.key) return [];
    return [
      {
        mediaItemId: row.id,
        path: row.path,
        pathKey: row.path_key,
        hints: rowHints,
        disc: rowPlace.disc ?? null,
        track: rowPlace.track,
        durationMs: row.duration_ms,
      },
    ];
  });
  return {
    series: place.series ?? null,
    season: place.season ?? null,
    tracks: tracks.sort(compareTracks),
  };
}

/**
 * The path keys of every file under the anchor's series folder, as a
 * half-open range: keys are already normalized for the platform, so a
 * folder is a key prefix ending in a separator, and every key below it
 * sorts before that prefix with its separator raised by one. Takes the
 * folder's depth from the hint and its spelling from the anchor's own key.
 */
function folderKeyRange(
  rootPathKey: string,
  anchorPathKey: string,
  seriesFolder: string,
): { from: string; to: string } {
  const platform = currentPathPlatform();
  const separator = platform === "win32" ? "\\" : "/";
  const depth = seriesFolder === "" ? 0 : seriesFolder.split("/").length;
  const folders = (
    mediaPathSegments(rootPathKey, anchorPathKey, platform) ?? []
  ).slice(0, depth);
  const root = rootPathKey.endsWith(separator)
    ? rootPathKey
    : rootPathKey + separator;
  const from = root + folders.map((folder) => folder + separator).join("");
  const next = String.fromCharCode(separator.charCodeAt(0) + 1);
  return { from, to: from.slice(0, -1) + next };
}
