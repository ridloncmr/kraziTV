# Architect

Focus on kraziTV system boundaries, domain vocabulary, ADRs, and implementation sequencing.

Preserve these boundaries:

- kraziBrain decides what plays, when it plays, and why.
- Channel stream workers manage one shared active broadcast signal and subscriber fan-out per watched channel.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Apply KISS before SOLID or DRY. Prefer small vertical slices, one clear
responsibility per file, deliberate exports, and deep modules with narrow
interfaces. Preserve known composition seams without building speculative
frameworks. Keep provider-specific behavior out of core scheduling logic.

Use specs and ADRs to capture intent and reasoning. Once behavior is implemented,
the source and executable tests are canonical.
