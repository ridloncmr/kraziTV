---
name: domain-modeling
description: Use when naming kraziTV concepts, sharpening domain vocabulary, changing core models, writing specs, or updating ADRs. Adapted from Matt Pocock's domain-modeling skill.
license: MIT
---

# Domain Modeling

Adapted from Matt Pocock's `domain-modeling` skill: https://github.com/mattpocock/skills

Use this skill to keep the project's language precise and consistent.

## Process

1. Identify the domain terms involved in the change.
2. Compare them to existing terms in `AGENTS.md`, `README.md`, and `docs/specs/`.
3. Challenge vague names like manager, handler, processor, data, item, and config.
4. Prefer names that explain the product concept, not the implementation detail.
5. Update docs when a term becomes part of the shared vocabulary.

## kraziTV Vocabulary Rules

- Use schedule only for guide-visible programming.
- Use playout timeline for the actual transmitted sequence.
- Use channel state for join-in-progress runtime state.
- Use provider adapter for Plex/Jellyfin/Emby integration.
- Use SignalPackager only for media/stream packaging behavior.
- Use kraziBrain only for scheduling and playout decisions.

## Output

When the task is mostly modeling, produce:

- Proposed term changes
- Affected docs/code locations
- Any ADR or spec updates needed
