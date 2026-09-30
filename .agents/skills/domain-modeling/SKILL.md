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
2. Compare them first to `GLOSSARY.md` and implemented types, APIs, and tests,
   then use specs and ADRs for intent and history.
3. Challenge vague names like manager, handler, processor, data, item, and config.
4. Prefer names that explain the product concept, not the implementation detail.
5. When a term becomes shared vocabulary, add or update it in `GLOSSARY.md`,
   including rejected synonyms under **Avoid**. Do not maintain completed specs
   as a duplicate of implemented code.

## kraziTV Vocabulary Rules

- `GLOSSARY.md` is the single source for kraziTV terms. Never keep a second
  term list in a skill, role, or adapter.
- Use a glossary term exactly as written; do not introduce a synonym it lists
  under **Avoid**.

## Output

When the task is mostly modeling, produce:

- Proposed term changes
- Affected docs/code locations
- Any ADR or spec updates needed
