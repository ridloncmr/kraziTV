# 0010 Source Layout: Group By Capability Inside Domains

## Status

Accepted on 2026-10-01.

## Context

`AGENTS.md` laid out every `src/` as one folder per domain and allowed a
subfolder "only when a domain itself splits into distinct capabilities". It
named `catalog-scan/` as a model domain folder, limited the one-per-file rule
to concrete classes, and banned catch-all folders without distinguishing vague
names from specific ones.

Agents applied those rules literally, and the results were uneven:

| Folder                         | Result                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `packages/signal/src`          | Readable, because each concept was treated as its own small domain.                               |
| `apps/server/src/catalog-scan` | HTTP routes, the scan pipeline, and the persistence writer mixed flat with their tests.           |
| `apps/server/src/database`     | All tables in one `schema.ts` and all migrations in one `migrations.ts`, both growing per ticket. |

Nothing defined how large a domain is or when a folder has grown enough to
need structure, so nobody regrouped folders as they grew. The maintainer
restructured `database/` by hand into `migrations/`, `schema/`, and `types/`
and wants that shape to be the norm.

## Decision

- Put one primary thing in each file: a concrete class, a table definition, a
  migration, a route group, or a tight set of related types.
- Inside a domain folder, group files into capability subfolders when the
  domain has more than four source files spanning more than one capability, or
  more than eight source files in total. Tests and `contracts.ts` do not count.
- A domain whose files all serve one capability stays flat.
- Nest one capability level inside a domain, `src/<domain>/<capability>/`, and
  go deeper only when a capability itself meets the grouping rule.
- Regroup in the same change that makes a folder meet the rule.
- Allow folders named for a specific kind of file, such as `migrations/`,
  `schema/`, `routes/`, and `types/`. Continue to ban vague folders such as
  `utils/`, `common/`, `helpers/`, `internal/`, `shared/`, `lib/`, and `misc/`.
- `apps/server/src/database/` joins `packages/signal/src` as a reference
  layout.

`AGENTS.md` holds the operative rule. The `code-review` and `codebase-design`
skills and the engineer roles point to it.

## Consequences

- Folders stay navigable as the server grows; finding a table, migration, or
  route group means opening its file rather than searching one large file.
- Reviewers flag mixed flat domains instead of nested folders.
- The thresholds are judgment aids, not lint. A folder at the boundary may go
  either way; the capability test decides.
- Existing folders that meet the rule are drift to fix when next touched:
  `apps/server/src/catalog-scan/` is the known case.
- Import paths get one segment longer inside grouped domains.
