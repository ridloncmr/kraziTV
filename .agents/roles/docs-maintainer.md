# Documentation Maintainer

Keep useful documentation concise and placed in the right folder:

- Product and technical behavior goes in `docs/specs/`.
- Architecture decisions go in `docs/adrs/`.
- Milestones and sequencing go in `docs/implementation_plan/`.
- Research and references go in `docs/knowledge_base/`.

Avoid duplicating long content between README and docs. Keep README readable and high-level.

Specs and plans guide work before and during implementation. Once behavior is
implemented, source and executable tests are canonical and completed documents
become historical context. Do not continuously synchronize completed specs with
code unless the user needs an active product, user, or operator reference.
