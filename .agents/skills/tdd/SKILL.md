---
name: tdd
description: Use when implementing scheduling, guide generation, channel state, media selection, bug fixes, or any deterministic behavior that should be test-driven. Adapted from Matt Pocock's tdd skill.
license: MIT
---

# TDD

Adapted from Matt Pocock's `tdd` skill: https://github.com/mattpocock/skills

Use a red-green-refactor loop for core behavior.

## Loop

1. Write or identify the smallest failing test that proves the desired behavior.
2. Run the test and confirm it fails for the expected reason.
3. Implement the smallest change that makes it pass.
4. Run the relevant test command.
5. Refactor only with tests green.

## kraziTV Test Priorities

Prioritize tests around:

- Schedule generation
- Playout timeline generation
- Channel join-in-progress offset calculations
- Randomization with deterministic seeds
- Chronological episode progression
- Repeat prevention
- XMLTV/M3U output shape
- Media duration/probe parsing

## Avoid

- Snapshot-only tests for domain behavior
- Tests coupled to implementation internals
- Broad end-to-end tests before the core rules are covered
- Mocking so much that the real behavior disappears
