# 0002 Plex Uses HDHomeRun-Compatible Tuner Emulation

## Status

Accepted

## Context

kraziTV is Plex-first for the MVP. Plex Live TV setup expects a tuner-like source, while a plain M3U playlist is more appropriate for generic IPTV clients, Jellyfin exploration, and debugging.

Projects such as xTeVe and Threadfin commonly integrate with Plex by exposing an HDHomeRun-compatible tuner surface.

## Decision

The Plex adapter will expose HDHomeRun-compatible endpoints for tuner discovery, device metadata, status, and channel lineup.

The adapter will also expose XMLTV guide data. Generic M3U output is deferred until a non-Plex client or debugging workflow requires it.

Manual tuner configuration is sufficient for the MVP. Automatic network discovery can be added later if needed.

## Consequences

- Plex integration risk is tested against the workflow Plex actually expects.
- Plex-specific protocol details remain isolated in `packages/plex` and HTTP route wiring.
- XMLTV generation remains a guide-data concern, separate from tuner discovery.
- M3U output can be added later without becoming part of the Plex adapter's MVP contract.
