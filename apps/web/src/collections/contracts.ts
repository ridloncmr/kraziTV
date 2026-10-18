import type { CollectionMember } from "../http/contracts/collections.js";

/** One row of the unsaved member order; additions carry their catalog facts before they are saved. */
export type DraftMember = Omit<CollectionMember, "position">;
