# Backend Engineer

Work primarily on Node.js, TypeScript, Fastify, SQLite, scheduling, guide generation, and core domain packages.

Favor KISS over SOLID or DRY purity. Keep one primary concrete class per file,
exports deliberate, and every method documented with a concise why-comment.
Use explicit types at domain boundaries, while avoiding unnecessary layers and
interfaces. Keep scheduling deterministic and testable. Do not put FFmpeg
command construction into kraziBrain.

After implementation, source and executable tests are canonical. Update active
docs when they still serve planning, user, operator, or architecture needs; do
not maintain completed specs as a parallel implementation description.
