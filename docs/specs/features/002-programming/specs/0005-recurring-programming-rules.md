# Recurring Programming Rules

Status: Draft

## Problem

An unchanging rotation cannot express prime-time preferences, Friday movies, or
seasonal programming. Users need recurring intent without maintaining daily schedules.

## Goals

- Add a small, explainable calendar rule model over continuous source assignments.
- Support weekday, time-window, one-off date-range, and annual seasonal applicability.
- Support seasonal sources joining normal rotation and featured sources taking over a window.
- Preserve default programming outside applicable or usable special rules.
- Keep selection deterministic and make its reason visible in backend previews.

## Non-goals

- Scripting, nested boolean expressions, additive rule scoring, or arbitrary metadata queries.
- Strict daily quotas, random source weighting, or a scheduling optimization framework.
- Exact starts, manual draft publication, commercials, or station identification.

## Dependencies And Spec Boundary

Depends on [continuous multi-source programming](0004-kraziplan.md). Rules reference
assigned collections, including manually created ones; metadata is not a scheduling
dependency. Calendar applicability and precedence are separate from source rotation
and from the exact reservations introduced in spec 0006.

## Established Behavior And Proposed Policy

Existing schedule arithmetic uses UTC integer milliseconds and is independent of
browser timezone. The calendar, precedence, and boundary policies below are
proposals requiring review before acceptance.

## User-Facing Behavior

A rule form selects its sources, behavior, priority, and optional date, weekday, and time
conditions. Conditions in one rule are combined with AND; omitted conditions are
unrestricted. Source rotation and airtime targets reuse source-assignment settings.

Examples include Christmas sources during December, science fiction during a
chosen month, preferred comedy sources during prime time, and movies on Friday
evenings. Ordinary defaults continue outside special windows.

| Behavior             | Active programming sources                                        |
| -------------------- | ----------------------------------------------------------------- |
| Join normal rotation | Default sources plus the rule's sources, each taking a turn       |
| Feature in a window  | Only the rule's sources, with defaults as an unavailable fallback |

For example, Christmas Movies can join the normal rotation throughout December,
while a higher-priority rule features Christmas Movies on Friday evenings in
December. Outside Friday evenings, the mixed rotation resumes; outside December,
only normal sources participate. Halloween Movies can similarly join during October.

Assignments may participate in default programming or be rule-only. Creating a
seasonal assignment does not automatically add it to the year-round default rotation.
These behaviors control source selection, not collection membership or exact starts.

The preview explains the winning rule, skipped unusable rules, fallback, and the
effective time of each choice. A time window is a preference evaluated at program
boundaries; the UI must not promise a movie starts exactly at its opening time.

## Technical Behavior

### Calendar Interpretation

Use one explicit IANA programming timezone in server configuration initially.
Store schedule instants in UTC; evaluate calendar conditions in that timezone.
Browser display timezone never controls rule eligibility.

Support local one-off date ranges and annual month/day ranges, including ranges
crossing year end. Date endpoints are inclusive calendar dates. Time windows are
half-open local time intervals; a window crossing midnight belongs to the weekday
and date on which it begins. A missing time window means the whole applicable day.
Annual February 29 applicability in non-leap years remains an open question.

At repeated local times during daylight-saving fall-back, both occurrences are
eligible; skipped local times during spring-forward do not create invented
schedule instants. Resolve rule boundaries to UTC using the configured timezone.
Define timezone-database updates as explicit scheduling input changes if they
alter future decisions, rather than rewriting covered windows on reads.

### Precedence And Fallback

Programming follows this precedence:

1. Published manual overrides and clock-anchored reservations (specs 0006 and 0007).
2. The winning applicable, usable calendar rule.
3. Ordinary default rotation.
4. The channel's reported unschedulable condition when no eligible media is playable.

Reservations protect future airtime; they do not replace enduring assignments or
rules. Calendar generation operates around them and resumes afterward. This spec
does not introduce an off-air slate or missing-media substitution policy. Spec 0006's
planned boundary filler remains distinct from an unschedulable channel.

At each program boundary, consider applicable rules in descending explicit priority.
Break ties by saved rule order, then stable identity. Choose the first rule with
a schedulable assigned source. For join behavior, rotate among usable default and
winning-rule sources; for feature behavior, rotate only among the winning rule's
usable sources. If no rule can provide a program, use default assignments.
If defaults also cannot supply media,
report unschedulable rather than bypassing published availability policy.

Only one rule wins. A higher-priority Friday feature therefore temporarily replaces
the December mixed rotation; lower-priority join rules are not merged into it.
Priority selects the rule, not a source frequency or weight.

For the first release, join rules are winner-takes-all just like feature rules.
On a Friday in December, separate Christmas, Winter, and Friday Comedy join rules
do not accumulate their sources. Only the winning rule joins defaults. Users can
put all three sources into one rule if they want that combination. Compositional
joins are deferred.

### Rotation Participation

Join behavior reuses the default rotation continuation. Form its active source list
in saved assignment order, including each assignment once even when both the defaults
and the rule reference it. Reconcile changes to that list by continuing after the
last retained assignment in saved order, wrapping as needed. Newly eligible seasonal
sources join on their next turn rather than immediately preempting a default stretch.
If no retained assignment exists, begin at the first usable active assignment.

Feature behavior has its own suspended rotation continuation. Entering a winning
feature takes effect at the next program boundary and ends the interrupted turn.
Leaving it resumes the default or mixed rotation at its next saved-order turn,
with a fresh airtime target. Collection playback progress
remains shared per channel, collection, and mode, including when a collection appears
in both behaviors. Rule-only sources are excluded when no active winning rule includes
them. Removing an active source at a window's end ends its stretch at the next program
boundary without resetting its collection progress.

A featured rule ceasing to apply ends its selected stretch at the next program
boundary. A join rule ceasing to apply does not end a default source's stretch;
only a source losing eligibility must yield at that boundary.
Do not cut the airing program to satisfy a window. Likewise, a higher-priority
feature rule beginning during a stretch takes effect at the next program boundary.
Retain the next rotation position for featured rules and the default/mixed rotation,
but discard any unfulfilled target when a calendar window ends a turn. There is no
airtime debt or later compensation. Recheck applicability after
every whole program, including within an airtime-target stretch.

Rules do not execute collection criteria. A holiday rule selects a Christmas
collection; its membership is owned by spec 0002 or manual collection editing.
Do not compose competing rules by multiplying weights or merging priorities.

### Changes And Reproducibility

Rule and programming-timezone edits are scheduling input changes. Preserve the
airing entry and published manual reservations, regenerate eligible future blocks,
and restore rule/collection continuation from retained decisions. Equivalent
configuration and catalog snapshots yield equivalent programming regardless of
request order, restart, or generation chunk boundaries.

## Data Model Impact

Add narrow rule records with channel ownership, behavior, priority, saved order,
applicability, and references to source assignments. Record whether each assignment
participates in defaults or is rule-only. Store the programming timezone explicitly.
Record winning-rule identity and restorable rotation decisions on generated blocks
or their associated continuation. Keep configuration revisions distinct from
schedule revisions so previews can identify stale inputs.

## Architecture Boundaries

| Area              | Impact                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| Schedule          | Materializes rule-selected blocks and preserves covered windows             |
| Playout timeline  | Follows selected entries; does not evaluate calendar rules independently    |
| Channel state     | Remains backend-derived                                                     |
| kraziBrain        | Owns calendar applicability, precedence, source selection, and explanations |
| SignalPackager    | No rule evaluation                                                          |
| Provider adapters | Expose generated schedules without provider-specific rule semantics         |

Server composition provides configuration, timezone, typed catalog inputs, and
persistence. The browser submits rules and displays backend eligibility/preview.

## Open Questions

- Approve saved-order priority ties and fallback for both behaviors?
- Approve saved-assignment-order insertion and retained-turn continuation for seasonal participation?
- Should some rules reserve exclusivity and refuse fallback? Defer unless required.
- Approve a single programming timezone rather than one per channel?
- How should annual February 29 ranges behave in non-leap years?
- Does a source need a rule-specific airtime target, or are assignment targets sufficient?

## Acceptance Criteria

- December Christmas programming recurs across years and normal programming resumes afterward.
- A December join rule rotates Christmas Movies alongside normal collections,
  using their existing whole-program airtime targets without daily publication.
- Rule-only Christmas and Halloween sources stay out of normal rotation outside
  their respective annual windows, unless another applicable rule selects them.
- A higher-priority December Friday-evening feature selects only Christmas Movies;
  the mixed December rotation resumes afterward and defaults resume after December.
- A source referenced by both defaults and a join rule receives one rotation turn,
  not duplicate turns; seasonal activation does not restart normal collection progress.
- Joining sources take their next saved-order turn; a feature interrupts a stretch
  only at a program boundary, and leaving it resumes the next rotation turn without
  making up the interrupted turn's unfulfilled target.
- Friday-evening movies and weekday prime-time sources follow the configured timezone.
- Overlapping rules select the documented winner and expose its reason.
- Overlapping December, Winter, and Friday join rules contribute only the winning
  rule's sources; placing those sources in one rule explicitly produces the combined rotation.
- Published reservations override both rule behaviors without changing enduring
  configuration; calendar/default selection resumes when the reserved range ends.
- A winning but unusable rule falls through predictably without an infinite search.
- An airing movie finishes beyond the soft window; the next program follows current eligibility.
- A higher-priority feature window beginning mid-stretch takes effect at the next program boundary.
- Overnight, year-crossing, and daylight-saving windows satisfy the documented policies.
- Rule edits preserve current airing and produce equivalent results after restart or chunked generation.
- Default programming needs no manual daily publication and resumes its own collection progress.
