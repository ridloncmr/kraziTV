---
name: to-spec
description: Use when turning a conversation, product idea, feature request, or design decision into a kraziTV spec. Adapted from Matt Pocock's to-spec skill.
license: MIT
---

# To Spec

Adapted from Matt Pocock's `to-spec` skill: https://github.com/mattpocock/skills

Use this skill to convert a conversation into a durable spec.

## Output Location

Save specs in `docs/specs/` unless they are pure implementation sequencing, which belongs in `docs/implementation_plan/`.

## Spec Shape

Include:

- Problem
- Goals
- Non-goals
- User-facing behavior
- Technical behavior
- Data model impact
- Architecture boundaries
- Open questions
- Acceptance criteria

## kraziTV Check

Every spec should make clear whether it affects:

- Schedule
- Playout timeline
- Channel state
- kraziBrain
- SignalPackager
- Provider adapters
