---
name: diagnosing-bugs
description: Use when diagnosing kraziTV bugs, stream failures, scheduling mismatches, Plex/Jellyfin integration issues, test failures, or regressions. Adapted from Matt Pocock's diagnosing-bugs skill.
license: MIT
---

# Diagnosing Bugs

Adapted from Matt Pocock's `diagnosing-bugs` skill: https://github.com/mattpocock/skills

Use a disciplined debugging loop.

Inspect running code and executable tests before relying on completed specs or
implementation plans. Those documents may explain intent, but implemented code
is canonical for current behavior.

## Loop

1. Reproduce the bug or identify why reproduction is not possible.
2. Build the smallest feedback loop that fails for this bug.
3. Minimize the failing scenario.
4. Form one hypothesis at a time.
5. Add instrumentation only where it can confirm or reject the hypothesis.
6. Fix the cause, not just the symptom.
7. Add or update regression coverage.
8. Remove temporary instrumentation unless it is useful operational logging.

## kraziTV Bug Classes

- Schedule does not match guide output
- Playout timeline does not match current channel state
- Join-in-progress offset is wrong
- Randomization is not deterministic
- FFmpeg stream fails, stalls, or starts at the wrong position
- Plex/Jellyfin cannot discover channel or guide data
- ffprobe metadata parsing is wrong
