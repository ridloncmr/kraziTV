# Programming Feature

Status: In Development

This feature grows kraziTV from one looping programming block per channel into
continuous, rule-driven programming that a user configures once and mostly leaves
alone. Add media, scan/enrich it, organize or accept recommended collections, and
define the channel's programming strategy. kraziTV keeps generating programming
indefinitely; manual schedules are deliberate overrides, never a daily obligation.

[ADR 0009](../../../adrs/0009-programming-blocks.md) defines the model this
feature extends: channels hold identity only, programming blocks select a media
collection with a playback mode or a single media item, schedule entries are
materialized from blocks, and playback progress is tracked per channel,
collection, and playback mode.

Source and executable tests describe current behavior. Accepted ADRs remain
architectural constraints; the specs below record the intent each capability
was built from. This feature extends the MVP rather than redefining its
completed specs.

## Related Specs

Each spec owns its purpose, scope, non-goals, dependencies, policy, open
questions, architecture impact, and acceptance criteria. Spec status appears only
in its own `Status:` line. Implementation tickets live in
`docs/implementation_plan/`.

| Spec                                                                                           | Capability                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [0001 — Content Metadata Enrichment](specs/0001-metadata-enrichment.md)                        | Optional provider-neutral facts, match provenance, and durable corrections       |
| [0002 — Recommended And Automatic Collections](specs/0002-automatic-collections.md)            | Consent-based recommendations and optional automatic membership maintenance      |
| [0003 — Collection Playback Ordering](specs/0003-playback-ordering.md)                         | Saved order, metadata order, and deterministic random with explicit continuation |
| [0004 — Continuous Multi-Source Programming With kraziPlan](specs/0004-kraziplan.md)           | Enduring source assignments and repeating whole-program stretches                |
| [0005 — Recurring Programming Rules](specs/0005-recurring-programming-rules.md)                | Calendar applicability, priority, default programming, and explained selection   |
| [0006 — Clock-Anchored Programming And Boundary Coverage](specs/0006-clock-anchored-blocks.md) | Exact reservations and non-guide transmission coverage                           |
| [0007 — Manual Programming Overrides And Publishing](specs/0007-manual-programming.md)         | Preview and publish, interruption, cancellation, and generated resumption        |
| [0008 — Channel Programming Setup In My Channels](specs/0008-channel-setup-ux.md)              | Lineup list, show properties, per-sitting presets, and one marathon control      |
| [0009 — Combined Programming Rules](specs/0009-combined-programming-rules.md)                  | Same-priority rules play together; a 1–5 priority scale                          |

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
- Regeneration starts at the regeneration boundary, so it never alters the
  playout item currently airing; editing a reservation regenerates ordinary
  programming from there, per the 2026-10-16 amendment.
- How a collection was built is invisible to blocks and channels; every
  collection is consumed as an ordered list of media items.

## Resolved Decisions

- Exact boundaries, filler, and their coverage and revisions: [ADR 0014](../../../adrs/0014-planned-filler-coverage.md).
- Manual programming's interruption: [ADR 0015](../../../adrs/0015-scheduled-interruption.md); its downstream reflow: [ADR 0009](../../../adrs/0009-programming-blocks.md)'s 2026-10-16 amendment.

## Release Scope And Deferred Work

The 1.0 release is scoped by the [release-polish feature](../004-release-polish/README.md).

Commercials, bumpers, station identification, promos, and seasonal presentation
belong in a separate future feature. kraziBrain owns their selection and timing
through playout policy; SignalPackager owns transmission mechanics. Do not make
them ordinary guide programs. Also defer scripting, strict quotas, alternative
episode-order schemes, no-repeat shuffle, comprehensive artwork, full guide-grid
editing, scheduled rescans, and media acquisition.

## Open Questions

Capability-specific open questions live in each spec.
