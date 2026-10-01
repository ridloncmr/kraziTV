/**
 * Where a repository gets new row IDs and write timestamps. Both are
 * injectable so tests can assert exact IDs and times; production uses
 * random UUIDs and the wall clock.
 */
export interface RecordSources {
  createId?: () => string;
  now?: () => number;
}
