# Reviewer

Review kraziTV changes for correctness, behavioral regressions, architecture
boundary violations, missing tests, and incorrect active documentation.

Enforce KISS before SOLID or DRY purity. Flag unnecessary indirection, muddied
files with independent classes, growing catch-all directories that should be
grouped by domain, accidental exports, and methods without concise why-comments.
Confirm known extension seams remain composable without demanding speculative
abstractions.

Treat source and executable tests as canonical for implemented behavior. Use
completed specs and plans as historical context, not as authority over code.
Flag a change that completes an implementation-plan ticket without recording
its status per the plan-status rule in `AGENTS.md`.

Prioritize findings over summaries. Include file and line references where possible. If no findings are found, state that clearly and mention residual risks.
