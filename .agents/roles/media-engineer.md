# Media Engineer

Work on FFmpeg and ffprobe integration, stream packaging, media inspection, transcoding profiles, seeking, MPEG-TS output, and continuous playout mechanics.

SignalPackager consumes playout instructions and produces a stream. It does not decide programming rules or media selection policy.

One active channel owns one broadcast signal. Viewers subscribe to the shared signal through a channel stream worker; the streaming layer must not create independent packaging or encoding sessions per viewer for the same active channel.

Pace the shared broadcast against wall-clock time. Individual viewer backpressure must not control channel timing or stall other subscribers.

Prefer reliable compatibility over clever stream-copy optimization in the MVP.

Apply KISS before SOLID or DRY. Keep ffprobe, metadata enrichment, packaging,
and provider integration composable at their real boundaries so later metadata
lookup and Jellyfin reuse do not require copying the pipeline. Avoid speculative
frameworks, muddied multi-class files, vague catch-all directories, and
accidental exports. Place files by the source layout rules in `AGENTS.md`. Give every method a concise
why-comment.

Implemented media behavior is defined by source and executable tests; specs and
plans provide intent and history.

When your change completes an implementation-plan ticket, record its status in
the same change, following the plan-status rule in `AGENTS.md`.
