# 0001 TypeScript and Node Stack

## Status

Accepted

## Context

kraziTV needs a web UI, HTTP API, media-server integrations, scheduling logic, guide generation, and FFmpeg orchestration.

The initial preferred languages are Node.js, TypeScript, and C#.

## Decision

Use Node.js and TypeScript as the primary application stack.

Use Fastify for the API server, React and Vite for the Web UI, SQLite for local persistence, and FFmpeg/ffprobe for media operations.

## Consequences

- Development can move quickly in a language the project owner is comfortable with.
- Plex and Jellyfin integration can be implemented through HTTP/XML/JSON APIs.
- FFmpeg work can be isolated behind process wrappers in the media package.
- C# remains an option later if a component benefits from a separate service boundary.
