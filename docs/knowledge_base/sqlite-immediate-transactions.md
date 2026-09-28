# SQLite Immediate Transactions With Kysely

## Question

How can kraziTV acquire SQLite write authority before reading schedule state
while using Kysely's `SqliteDialect` with `better-sqlite3`?

## Findings

- SQLite transactions are deferred by default. If the first statement after
  `BEGIN` is a `SELECT`, SQLite starts a read transaction and only attempts to
  upgrade it when a later write occurs. That upgrade can fail with
  `SQLITE_BUSY` if another connection has written in the meantime.
- `BEGIN IMMEDIATE` starts a write transaction immediately. It fails or waits
  according to the configured busy handling when another write transaction is
  already active, so a successful caller owns write authority before its first
  schedule read.
- Kysely's current built-in `SqliteDriver.beginTransaction()` executes plain
  `begin`, not `begin immediate`.
- Kysely issue 1274 tracks transaction-mode support and remains open. Ordinary
  `db.transaction()` therefore must not be assumed to provide SQLite immediate
  transaction semantics.
- `better-sqlite3` transaction functions expose `.immediate()`, but those
  wrappers are synchronous and explicitly do not support async callback work.
  Normal Kysely query execution returns promises, so placing Kysely operations
  inside a `better-sqlite3` transaction callback would allow the wrapper to
  finish before the async work completes.
- Kysely's `db.connection().execute()` provides a Kysely instance pinned to one
  database connection. A project-owned helper can issue `BEGIN IMMEDIATE` on
  that instance, run all schedule queries through it, and explicitly `COMMIT` or
  `ROLLBACK` on the same connection.
- Read-only consistency has a different requirement from mutation. A deferred
  transaction establishes its read snapshot on the first `SELECT`; later reads
  in that transaction continue from that snapshot even if another connection
  commits newer data.
- Kysely's ordinary `db.transaction()` pins its callback work to the transaction
  connection and is suitable for a multi-query read-only snapshot, provided
  every query uses the callback's transaction object rather than the root
  database handle.
- A deferred read transaction should not later be upgraded into schedule
  mutation. If the read discovers work such as horizon extension or gap repair,
  it should end, run that work through the immediate-transaction helper, and
  retry the read from the beginning.

## Sources

- [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html)
- [Kysely SQLite driver source](https://github.com/kysely-org/kysely/blob/master/src/dialect/sqlite/sqlite-driver.ts)
- [Kysely transaction-mode issue 1274](https://github.com/kysely-org/kysely/issues/1274)
- [Kysely single-connection API](https://kysely-org.github.io/kysely-apidoc/classes/Kysely.html#connection)
- [`better-sqlite3` transaction API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function)

## Implications for kraziTV

- Schedule mutations use a project-owned immediate-transaction helper instead
  of ordinary Kysely `db.transaction()`.
- The helper pins one Kysely connection, executes `BEGIN IMMEDIATE` before the
  first domain read, passes only the pinned Kysely instance to the mutation,
  commits on success, and rolls back on failure.
- The helper must not be nested or mixed with Kysely-managed or
  `better-sqlite3`-managed transactions on the same connection.
- Busy handling is bounded. A caller that cannot acquire write authority retries
  the entire mutation from fresh state or returns a retryable error.
- Integration tests use at least two connections to the same SQLite database
  file and prove that concurrent read-modify-write schedule mutations cannot
  both proceed from stale state.
- Channel-state and selected-playout repositories use a separate ordinary
  Kysely transaction for consistent multi-query reads. They read the schedule
  revision first, keep every source read on that transaction object, and return
  only the completed typed projection.
- Read-snapshot integration tests may enable WAL mode so a writer can commit
  regeneration while the reader's transaction remains open. The reader must
  still return the complete earlier snapshot, never the earlier revision paired
  with regenerated entries.

## Open Questions

- The exact busy timeout and retry/backoff defaults for the MVP.
- Whether a future Kysely release adds a supported SQLite transaction-mode API
  that can replace the project-owned helper without weakening the tests.
