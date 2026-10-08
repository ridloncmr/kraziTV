---
name: to-tickets
description: Use when breaking a kraziTV spec, milestone, or implementation plan into small ordered tickets or tasks. Adapted from Matt Pocock's to-tickets skill.
license: MIT
---

# To Tickets

Adapted from Matt Pocock's `to-tickets` skill: https://github.com/mattpocock/skills

Use this skill to break work into small vertical slices.

## Ticket Rules

- Each ticket should produce a working feedback loop.
- Each ticket should name dependencies/blockers.
- Each ticket should include verification.
- Prefer thin end-to-end slices over broad horizontal setup.
- Prefer the simplest implementation that closes the ticket; do not prescribe
  abstractions solely for SOLID or DRY compliance.
- Treat completed tickets and plans as sequencing history. Code and executable
  tests become canonical after implementation.

## Output Location

Save each plan in the feature folder that matches its spec, such as
`docs/implementation_plan/003-auth/0001-accounts-and-sessions.md` for
`docs/specs/features/003-auth/specs/0001-accounts-and-sessions.md`. Create the
folder if it does not exist. `npm run plan:status` rejects plans left at the
folder root.

## Ticket Shape

Include:

- Title, as a `### <PREFIX>-NNN: <title>` heading such as `### SIG-012: ...`;
  `npm run plan:status` finds tickets by this heading shape
- Status (added on completion per the plan-status rule in `AGENTS.md`)
- Goal
- Scope
- Out of scope
- Blocking dependencies
- Implementation notes
- Verification
- Docs impact
