# Recurring Programming Rules

Status: Partially Implemented (reservation precedence waits on spec 0006)

## Problem

A shuffled rotation alone cannot express prime-time preferences, Friday movies, or
seasonal programming. Users need recurring intent without maintaining daily schedules.

## Goals

- Add a small, explainable calendar rule model over shuffled source rounds.
- Support weekday, time-window, one-off date-range, and annual seasonal applicability.
- Support seasonal sources joining normal rotation and featured sources taking over a window.
- Preserve default programming outside applicable or usable special rules.
- Keep selection deterministic and make its reason visible in backend previews.
- Allow rule-specific ordinary and marathon sizes without changing assignment defaults.

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
browser timezone. The calendar, precedence, and boundary policies below were
reviewed and accepted on 2026-10-15.

## User-Facing Behavior

A rule form selects its sources, behavior, priority, and optional date, weekday, and time
conditions. Conditions in one rule are combined with AND; omitted conditions are
unrestricted. Source ordering uses spec 0004's shuffled rounds. Stretch settings
inherit source-assignment settings unless the rule explicitly overrides them.

For each referenced source, optionally replace its ordinary stretch setting and
choose whether its marathon setting is inherited, disabled, or replaced. For
example, a movie collection may normally air one film, while a Friday feature
uses a two-film ordinary stretch and an optional three-film marathon. These
settings apply only while that rule wins, and never modify the assignment itself.
Channel-wide marathon chance and cooldown still apply.

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

Use one server-wide IANA programming timezone for every channel. Server
configuration may set it explicitly; when unset, the server detects the host
timezone at startup. Store schedule instants in UTC; evaluate calendar
conditions in that timezone. Browser display timezone never controls rule
eligibility. Per-channel timezones are deferred.

Support local one-off date ranges and annual month/day ranges, including ranges
crossing year end. Date endpoints are inclusive calendar dates. Time windows are
half-open local time intervals; a window crossing midnight belongs to the weekday
and date on which it begins. A missing time window means the whole applicable day.
In a non-leap year, an annual range endpoint of February 29 is treated as
February 28.

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

Use spec 0004's shuffled-round continuation and source-change policies. Saved
assignment order supplies deterministic input, not a repeating broadcast order.
Include an assignment once even when both defaults and the winning rule reference it.

Join behavior shares the default round. Newly eligible seasonal sources enter
seeded positions in the unplayed portion without reshuffling pending sources or
preempting an eligible active stretch. A served/skipped source cannot receive
another turn by leaving and rejoining. Remove ineligible pending sources while
remembering unserved status; a source rejoining within that round may recover its
one pending turn. Starting a new round shuffles the current usable eligible set.

Feature behavior owns separate round continuation per rule and suspends the
default/mixed context. Higher-priority features likewise suspend lower features.
Entering a feature takes effect at the next program boundary and ends the
interrupted turn, marking it served. Leaving resumes the next eligible pending
turn in the next winning context, reconciling eligibility before selection.
Use spec 0004's repeat-avoidance policy; never reset collection playback progress.

Collection progress remains shared per channel, collection, and mode. Rule-only
sources stay excluded unless a winning rule includes them. Eligibility loss,
feature takeover, or a feature ceasing to apply ends a started turn at the next
program boundary, including a marathon. A join ending does not end a default
source's stretch if it remains eligible. Discard interrupted remainder without
airtime or program-count debt. Recheck rules after every whole program, never
cutting a program to satisfy a soft calendar window.

Round continuation is per context, but generated marathon chance and cooldown
are channel-wide under spec 0004. Mid-round joins do not reroll chance; marathon
eligibility is checked at round creation and again when a reserved opportunity
starts. Automatic context changes cannot bypass cooldown. Only the user's explicit
fresh-rebuild action resets it under spec 0004. Published deliberate events are
exempt from generated marathon chance and cooldown.

Rules do not execute collection criteria. A holiday rule selects a Christmas
collection; its membership is owned by spec 0002 or manual collection editing.
Do not compose competing rules by multiplying weights or merging priorities.

### Rule-Specific Stretch Settings

Store optional ordinary size replacement and marathon behavior per rule/source
reference. Ordinary size inherits when absent. Marathon behavior is explicitly
inherit, disabled, or replacement; absent means inherit. Replacements use spec
0004's fixed airtime, fixed program count, or variable airtime settings, not a
second sizing algorithm. Rules do not override playback mode or reset progress.

Only the winning rule's settings apply, and only to sources it references. A
default source included in a join but not referenced by that rule keeps assignment
settings. Losing rules contribute no overrides. Resolve effective ordinary and
marathon settings before selection and validate the resulting pair: same size
kind, with marathon size strictly larger under spec 0004. If changing ordinary
size makes an inherited marathon invalid, require an explicit replacement or
disable it; do not silently coerce values. Validate rule edits and affected
assignment edits, including inherited settings, before saving.

At round creation, use effective settings to identify marathon-enabled candidates.
At turn start, resolve and record the winning rule, setting origins, and chosen
size once. If a reserved opportunity is no longer marathon-enabled, discard it
without replacement and use ordinary settings. Calendar changes do not resize a
retained turn whose source remains eligible; apply the next effective settings
on its next turn. Explicit configuration edits follow the regeneration policy
below, rather than masquerading as calendar transitions.

### Changes And Reproducibility

Rule and programming-timezone edits are scheduling input changes. Use spec 0004's
existing administrative finish-or-interrupt choice. By default, preserve the
airing entry and end an affected started turn after it; rebuild eligible future
programming from that boundary with new settings. The explicit stop-and-rebuild
option follows ADR 0003's from-now regeneration and after-commit worker stop,
and spec 0004's fresh-slate policy: discard all round continuations and cooldown,
then evaluate the current winning rule to form new programming decisions.
Preserve unrelated published reservations and respect spec 0007's running-event
editing lifecycle. Ordinary regeneration restores round/collection continuation
and channel-wide cooldown from retained decisions. Explicit fresh rebuilding
restores only collection progress from retained entries and starts new programming
state; it does not reset assignments or rules. Equivalent
configuration and catalog snapshots yield equivalent programming regardless of
request order, restart, or generation chunk boundaries.

## Data Model Impact

Add narrow rule records with channel ownership, behavior, priority, saved order,
applicability, and references to source assignments with optional ordinary-size
replacement and inherit/disable/replace marathon settings. Record whether each assignment
participates in defaults or is rule-only. Store the programming timezone explicitly.
Record winning-rule identity, resolved size and setting origins, and restorable shuffled-round decisions on generated blocks
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

## Resolved Questions

Resolved on 2026-10-15:

- Saved-order priority ties and fallback apply to both behaviors as written.
- Exclusive rules that refuse fallback are deferred.
- One server-wide programming timezone, defaulting to the detected host timezone.
- Annual February 29 endpoints become February 28 in non-leap years.

## Acceptance Criteria

- December Christmas programming recurs across years and normal programming resumes afterward.
- A December join rule rotates Christmas Movies alongside normal collections,
  using shuffled rounds and inherited or explicit rule-specific stretch sizes
  without daily publication.
- Rule-only Christmas and Halloween sources stay out of normal rotation outside
  their respective annual windows, unless another applicable rule selects them.
- A higher-priority December Friday-evening feature selects only Christmas Movies;
  the mixed December rotation resumes afterward and defaults resume after December.
- A source referenced by both defaults and a join rule receives one rotation turn,
  not duplicate turns; seasonal activation does not restart normal collection progress.
- Joining sources enter the unplayed round without reshuffling pending sources;
  a feature interrupts only at a program boundary, then suspended programming
  resumes pending turns without replay or compensation for discarded remainder.
- Optional rule-specific ordinary and marathon settings override only referenced
  sources while that rule wins, leaving assignment defaults and playback modes intact.
- Effective inherited/replaced size pairs must validate before edits are saved;
  previews explain setting origins and resolved sizes.
- A calendar transition does not resize an eligible retained turn; its next turn
  uses the new effective settings. A disabled reserved marathon becomes ordinary.
- Featured rules and default programming share cooldown; suspended opportunities
  cannot start a marathon while channel-wide cooldown blocks them.
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
- An annual range ending February 29 ends February 28 in a non-leap year.
- With no configured timezone, rules evaluate in the detected host timezone.
- Rule edits preserve current airing by default; explicit stop-and-rebuild follows
  ADR 0003 and starts fresh round/cooldown state under the current winning rule.
  Finish-current-program edits retain continuation and count a shortened started
  marathon. Each path produces equivalent decisions after restart or chunked generation.
- Default programming needs no manual daily publication and resumes its own collection progress.
