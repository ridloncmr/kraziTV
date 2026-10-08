# Programming Feature

Status: Planned

This feature grows kraziTV from one looping programming block per channel into
continuous, rule-driven programming that a user configures once and mostly leaves
alone. Add media, scan/enrich it, organize or accept recommended collections, and
define the channel's programming strategy. kraziTV keeps generating programming
indefinitely; manual schedules are deliberate overrides, never a daily obligation.

[ADR 0009](../../../adrs/0009-programming-blocks.md) defines the model this
feature extends: channels hold identity only, programming blocks select a media
collection with a playback mode or a single media item, schedule entries are
materialized from blocks, and playback progress is tracked per channel and
collection.

Source and executable tests describe current behavior. Accepted ADRs remain
architectural constraints; the specs below propose new behavior and identify
decisions that must be resolved before implementation. This feature extends the
MVP rather than redefining its completed specs.

## Related Specs

Each spec owns its purpose, scope, non-goals, dependencies, proposed policy, open
questions, architecture impact, and acceptance criteria. Spec status appears only
in its own `Status:` line. Detailed implementation tickets belong in
`docs/implementation_plan/` once product and architecture decisions are resolved.

| Spec                                                                                           | Capability                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [0001 — Content Metadata Enrichment](specs/0001-metadata-enrichment.md)                        | Optional provider-neutral facts, match provenance, and durable corrections       |
| [0002 — Recommended And Automatic Collections](specs/0002-automatic-collections.md)            | Consent-based recommendations and optional automatic membership maintenance      |
| [0003 — Collection Playback Ordering](specs/0003-playback-ordering.md)                         | Saved order, metadata order, and deterministic random with explicit continuation |
| [0004 — Continuous Multi-Source Programming With kraziPlan](specs/0004-kraziplan.md)           | Enduring source assignments and repeating whole-program stretches                |
| [0005 — Recurring Programming Rules](specs/0005-recurring-programming-rules.md)                | Calendar applicability, priority, default programming, and explained selection   |
| [0006 — Clock-Anchored Programming And Boundary Coverage](specs/0006-clock-anchored-blocks.md) | Exact reservations and non-guide transmission coverage                           |
| [0007 — Manual Programming Overrides And Publishing](specs/0007-manual-programming.md)         | Drafts, conflict validation, publication, cancellation, and generated resumption |

## Dependency Shape

Metadata enrichment supports recommendations and metadata ordering independently.
Basic multi-source programming needs neither: manually built collections and
existing playback modes remain sufficient. Recurring rules extend kraziPlan;
exact boundaries and manual publication build on continuous programming.

```text
0001 metadata -> 0002 collections
              -> 0003 ordering -> integrates with 0004

0004 kraziPlan -> 0005 recurring rules -> integrates with 0006
              -> 0006 exact boundaries -> 0007 manual publication
```

The numbering follows the recommended product progression, not mandatory serial
implementation. Detailed delivery sequencing belongs in the implementation plans.

## Constraints Carried From ADR 0009

- kraziPlan writes programming blocks; it never writes schedule entries
  directly.
- Saved user overrides take precedence over generated blocks.
- Regenerating an edited block replaces only its own future entries and never
  the entry currently airing.
- How a collection was built is invisible to blocks and channels; every
  collection is consumed as an ordered list of media items.

## Decisions Required Before Implementation

- Metadata ordering proposes identity-based continuation. Resolve the extension
  to ADR 0009's existing progress contract explicitly; keep existing chronological
  settings equivalent to saved collection order.
- Manual edits can change downstream durations or selection progress. Spec 0007
  requires a resolution of ADR 0009's localized-regeneration constraint before
  implementing broader reflow.
- Exact boundaries introduce intentional non-guide intervals and richer playout
  cursors. Spec 0006 requires coherent coverage and revision semantics rather than
  treating those intervals as accidental schedule gaps.

## Release Scope And Deferred Work

Proposed first richer-programming release: metadata, recommendations, ordering,
multi-source programming, and recurring rules. Include specs 0006 and 0007 together
if exact-time specials are required for that release. The meaning and scope of
"1.0" still need a product decision; this is not a change to the original MVP goal.

Commercials, bumpers, station identification, promos, and seasonal presentation
belong in a separate future feature. kraziBrain owns their selection and timing
through playout policy; SignalPackager owns transmission mechanics. Do not make
them ordinary guide programs. Also defer scripting, strict quotas, alternative
episode-order schemes, no-repeat shuffle, comprehensive artwork, full guide-grid
editing, scheduled rescans, and media acquisition.

## Open Questions

The capability-specific questions live in each spec. Review those proposals before
accepting them; drafting a spec does not approve its open product choices or amend
an accepted ADR.
