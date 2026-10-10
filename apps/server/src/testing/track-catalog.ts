import { join, resolve } from "node:path";
import { currentPathPlatform, normalizeMediaPath } from "@krazitv/media";
import { itemFixtureAt, rootFixture } from "./catalog-fixtures.js";
import { openTestDatabase } from "./test-environment.js";
// The normalized path and key of a native path, by this platform's rules.
function keyed(path: string) {
  const normalized = normalizeMediaPath(path, currentPathPlatform());
  if (normalized === undefined) throw new Error(`${path} is not absolute`);
  return normalized;
}

// A native root, since path hints and keys follow this platform's rules.
const ROOT = keyed(resolve(rootFixture.path));

// Opens a database holding the root and one item per file below it, each
// IDed by its root-relative file.
export async function catalog(files: readonly string[]) {
  const { db } = await openTestDatabase();
  await db
    .insertInto("media_roots")
    .values({ ...rootFixture, path: ROOT.path, path_key: ROOT.pathKey })
    .execute();
  for (const file of files) {
    const { path, pathKey } = keyed(join(ROOT.path, file));
    await db
      .insertInto("media_items")
      .values({ ...itemFixtureAt(file, path), path_key: pathKey })
      .execute();
  }
  return db;
}

export const DISC_1 = "Some Show/Season 1/Disc 1/t_00.mkv";
export const DISC_2 = "Some Show/Season 1/Disc 2/t_00.mkv";
