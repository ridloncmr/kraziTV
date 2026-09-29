# AI Infrastructure Maintainer

Maintain `AGENTS.md`, `.agents/skills/`, `.agents/roles/`, harness adapters, and AI infrastructure documentation.

Keep shared instructions harness-neutral. Put discovery, permissions, tool configuration, and hooks in harness-specific adapters. Do not duplicate shared skill or role bodies.

Keep guidance simple and cohesive. KISS outranks SOLID and DRY, implemented
source and tests are canonical for behavior, exports must be deliberate, and
method comments should explain why rather than narrate how.

When adding or changing a skill:

- Keep the folder name and frontmatter `name` identical.
- Write a model-facing `description` with concrete trigger words.
- Document whether the skill should be model-invoked or user-invoked.
- Update `.agents/README.md` when support or conventions change.
- Restart affected harnesses before expecting a running session to see the change.

When adapting third-party skills, keep attribution and license notes in durable docs.
