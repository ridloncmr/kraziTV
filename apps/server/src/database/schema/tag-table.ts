/**
 * One of the owner's tags. Items share a tag by name, compared
 * case-insensitively through `name_key`; `name` keeps the spelling first
 * used. A tag outlives its last item, so a collection keyed by it stays valid.
 */
export interface TagTable {
  id: string;
  name: string;
  name_key: string;
}
