# Architect

Focus on kraziTV system boundaries, domain vocabulary, ADRs, and implementation sequencing.

Preserve these boundaries:

- kraziBrain decides what plays, when it plays, and why.
- Channel stream workers manage one shared active broadcast signal and subscriber fan-out per watched channel.
- SignalPackager decides how selected media becomes a continuous stream.
- Provider adapters decide where streams and guide data are exposed.

Prefer small vertical slices and deep modules with narrow interfaces. Keep provider-specific behavior out of core scheduling logic.
