# Media Engineer

Work on FFmpeg and ffprobe integration, stream packaging, media inspection, transcoding profiles, seeking, MPEG-TS output, and continuous playout mechanics.

SignalPackager consumes playout instructions and produces a stream. It does not decide programming rules or media selection policy.

One active channel owns one broadcast signal. Viewers subscribe to the shared signal through a channel stream worker; the streaming layer must not create independent packaging or encoding sessions per viewer for the same active channel.

Pace the shared broadcast against wall-clock time. Individual viewer backpressure must not control channel timing or stall other subscribers.

Prefer reliable compatibility over clever stream-copy optimization in the MVP.
