# Combined Programming Rules

Status: Planned

## Problem

[Spec 0005](0005-recurring-programming-rules.md) lets exactly one programming
rule win at any instant. Overlapping rules never combine, even when the owner
wants them to:

| Owner's intent                                                                                  | What spec 0005 does                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Nick Cartoons and Cartoon Network Cartoons both take over Saturday mornings and air together.   | One rule wins by priority or saved order; the other's cartoons never air while both apply. |
| Saturday Cartoons takes over, and a Halloween mix-in adds Halloween specials to whatever is on. | The takeover wins alone; the mix-in contributes nothing.                                   |
| Christmas, Winter, and Friday Comedy mix-ins overlap on a December Friday.                      | Only the winning mix-in joins the lineup; the owner must merge all three into one rule.    |

Priority is also a free integer, including negatives. Owners have to invent a
numbering scheme, and the current hint ("what they play is never combined")
describes a limit, not a tool.

## Goals

- Rules that overlap at the same priority play together.
- A higher priority still takes over completely, so Christmas Movies can
  replace Saturday Cartoons on a Christmas Saturday.
- "Mix into the lineup" means mixing into whatever is playing, including a
  takeover at the same priority.
- Priority is a small, fixed scale (1 to 5) that the owner can read at a
  glance.
- Existing single-rule behavior, rotation state, and collection progress carry
  over unchanged.

## Non-goals

- Weighting how often a rule's sources air. Priority decides which rules are
  active, never how often a source takes a turn.
- Lower-priority mix-ins adding to a higher-priority rule.
- Carrying a started turn across a change in the set of active rules.
- Exclusive rules, rule scripting, or per-rule combine switches.

## Dependencies And Spec Boundary

Supersedes spec 0005's **Precedence And Fallback** section and the parts of
**Rotation Participation** and **Rule-Specific Stretch Settings** that assume a
single winning rule. Everything else in spec 0005 (calendar interpretation,
rotation continuation, marathon cooldown, change handling) still applies, with
"the winning rule" read as "the active rules" defined below.

Reservations and manual overrides (specs 0006 and 0007) still take precedence
over every rule.

## Decisions

Agreed with the owner on 2026-10-27:

| Question                                             | Decision                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Combine all overlapping rules, or only some?         | Only rules at the same priority. A higher priority takes over completely.                  |
| A takeover and a mix-in at the same priority         | The takeover replaces the lineup, and the mix-in's sources join the takeover's rotation.   |
| A mix-in at a lower priority than an active takeover | Contributes nothing, like every lower-priority rule.                                       |
| A show named by two active rules                     | Takes one turn per round, with settings from the first of those rules in saved rule order. |
| The set of active rules changes mid-turn             | The airing program finishes, then the turn ends, as any context change does today.         |
| Priority scale                                       | Integers 1 to 5, higher wins; new rules start at 3.                                        |

## User-Facing Behavior

### Priority

The rule dialog's General tab shows **Priority** as a drop-down: **1 (lowest)**,
2, **3**, 4, **5 (highest)**. A new rule starts at 3, so the owner can raise or
lower one rule without renumbering the others. The hint below it reads:

> Rules that overlap at the same priority play together. A higher priority
> takes over completely. For example, give Christmas Movies priority 4 and
> Saturday Cartoons priority 3, and a Christmas Saturday plays only Christmas
> movies. Give both priority 3, and they take turns.

The Rules tab intro reads: "Rules change what the channel plays on certain
dates, days, or hours. Overlapping rules with the same priority play together;
a higher priority takes over." The list still orders rules by priority, then
saved order. Moving a rule up or down still works only among rules of its
priority; the saved order now decides whose settings a shared show uses.

### What plays

At any instant, the **active rules** are the applicable rules at the highest
priority that has at least one usable rule. The table shows what takes turns:

| Active rules                   | What takes turns                                          | Rotation context    |
| ------------------------------ | --------------------------------------------------------- | ------------------- |
| None                           | The default lineup                                        | `default`           |
| Mix-ins only                   | The default lineup plus every active mix-in's sources     | `default`           |
| One takeover, any mix-ins      | The takeover's sources plus every active mix-in's sources | `rule:<id>`         |
| Several takeovers, any mix-ins | Every active takeover's and mix-in's sources              | `rule:<idA>+<idB>…` |

Examples, with all rules at priority 3 unless noted:

- **Nick Cartoons** (takeover, Saturday 7:00–11:00) and **Cartoon Network
  Cartoons** (takeover, Saturday 9:00–11:00). From 7:00 only Nick shows play.
  From 9:00 both rules' shows take turns, with no default lineup shows. At
  11:00 the default lineup resumes.
- Add **Halloween Specials** (mix-in, October). On an October Saturday from
  9:00, Nick, Cartoon Network, and Halloween shows take turns.
- Add **Christmas Movies** (takeover, December 25, priority 4). On a Christmas
  Saturday only Christmas movies play all day; the cartoon and Halloween rules
  contribute nothing.

### Preview

The upcoming-programming preview still labels each turn **chosen by** a rule.
The label names the first active rule, in saved rule order, that names the
turn's show. A default-lineup show taking a turn alongside mix-ins has no
label, because no rule chose it. Skipped rules are explained as today.

## Technical Behavior

### Choosing the active rules

`decideRule` in `packages/krazi-brain/src/krazi-plan/rules/winning-rule.ts`
returns the active rules instead of one winner:

1. Group applicable rules by priority, highest first.
2. In each group, a rule with no usable source is skipped and reported in
   `passedOver` with its current reason (`no_sources` or `no_usable_source`).
3. The first group with at least one usable rule is the active set. Lower
   groups are not examined and are not reported.
4. If no group has a usable rule, the default lineup programs the instant.

The active rules are ordered by saved rule order, then ID. `validUntil` is
unchanged: the earliest instant any rule's applicability may change. Each rule
is still examined at most once per decision.

### Building the rotation scope

`ruleScope` takes the active rules and builds one scope:

- **Takeovers active:** eligible assignments are the union of every active
  rule's sources, takeovers and mix-ins alike. Every eligible assignment is
  rule-driven. The context key is `rule:` followed by the active takeover
  IDs, sorted and joined with `+`. A lone takeover keeps `rule:<id>`, so
  existing checkpoints need no migration.
- **Only mix-ins active:** eligible assignments are the defaults plus every
  active mix-in's sources, in the `default` context, as spec 0005's join
  behavior does for one rule.

Each assignment appears once. Mix-ins never change the context key, so a
mix-in starting or stopping during a takeover behaves like a join starting or
stopping in the default lineup: its sources enter or leave the round without
ending other turns.

Each combination keeps its own round continuation under its context key. When
it ends and a lone takeover resumes, that takeover continues its own
`rule:<id>` rotation where it stopped. Member positions, collection progress,
and marathon cooldown stay channel-wide, as spec 0005 requires.

### Settings for shared sources

`applyRuleSettings` resolves an assignment's settings from the first active
rule, in saved rule order, that names it. Rules later in that order contribute
no settings for it, and settings are never merged across rules. The block's
`winningRuleId` records that same rule, or null when no active rule names the
assignment. Validation of each rule's own effective size pairs is unchanged.

### Turn boundaries

`generate-programming.ts` already ends the open turn at the next program
boundary when the rotation context changes. A takeover joining or leaving a
combination changes the context key, so the turn ends there even if its show
is still eligible. A mix-in joining or leaving does not change the context
key, so it ends only turns whose show loses eligibility.

`turnTerms` compares the context key, eligibility, and effective settings
built from the active rules, so a rule edit ends a started turn only when it
changes one of them, as today.

## Data Model Impact

- **Priority range:** a new migration replaces the `programming_rules_priority`
  check with `priority between 1 and 5`. Existing rows move by `3 + priority`,
  clamped to 1–5, so the old default 0 becomes the new default 3 and rules
  keep their side of it. Rules that were ranked apart may now share a priority
  and combine; the live database has no rules, so no deployed channel changes.
- **API:** the rule routes accept only integers 1 to 5 for `priority`.
- **Blocks:** no schema change. `winning_rule_id` keeps one rule ID per block,
  chosen as described above.
- **Checkpoints:** no schema change. Combination context keys are new keys in
  the existing per-context rotation map.

## Architecture Boundaries

| Area              | Impact                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| Schedule          | Materializes blocks chosen from combined rules; covered windows are unchanged  |
| Playout timeline  | None; follows schedule entries                                                 |
| Channel state     | None                                                                           |
| kraziBrain        | Owns active-rule selection, combined scopes, and per-source setting resolution |
| SignalPackager    | None                                                                           |
| Provider adapters | None                                                                           |

The server validates the priority range and migrates stored priorities. The
web app changes the priority control and its wording.

## Documentation Impact

In the implementing change:

- Add a superseded-by note to spec 0005's **Precedence And Fallback** section.
- Update `GLOSSARY.md`: **Join rule**, **Feature rule**, and **Rotation
  context** say "while it wins" and describe one rule's context; reword them
  for active rules and combination contexts.
- Add a plan ticket with its `**Status**` block, then run `npm run plan:status`.

## Open Questions

None.

## Acceptance Criteria

- Two takeovers at the same priority whose windows overlap take turns together,
  with no default lineup sources, while both apply.
- A takeover at a higher priority than another applicable takeover programs
  alone; the lower one contributes nothing.
- A mix-in at the same priority as an active takeover adds its sources to the
  takeover's rotation; a mix-in at a lower priority adds nothing.
- Several mix-ins at the same priority, with no takeover, all join the default
  lineup in the `default` context.
- A show named by two active rules takes one turn per round, using the
  settings of the first of those rules in saved rule order; `winningRuleId`
  names that rule.
- A default-lineup show taking a turn alongside mix-ins records no
  `winningRuleId`.
- A rule with no usable source drops out of its priority and is reported in
  `passedOver`; when no rule at a priority is usable, the next lower priority
  is tried, then the default lineup.
- When a combination ends, a lone takeover resumes its own rotation where it
  stopped, and collection progress continues across all contexts.
- A takeover joining a combination mid-turn ends the open turn after the
  airing program, even if the turn's show stays eligible. A mix-in starting
  mid-turn ends no turn whose show stays eligible.
- A lone takeover's context key is still `rule:<id>`; an existing checkpoint
  resumes unchanged.
- The API rejects priorities outside 1 to 5; the migration maps 0 to 3 and
  clamps other values into range.
- The rule dialog offers priorities 1 to 5, defaults new rules to 3, and shows
  the Christmas example hint.
- Equivalent configuration and catalog snapshots yield equivalent programming
  regardless of request order, restart, or generation chunk boundaries.
