# 0006 Media Roots and Media Collections Are Separate

## Status

Accepted

## Context

Media roots define where kraziTV discovers files. Channel programming needs a different concept: which media items are eligible for a channel or rule.

Using a root path directly as a channel source can accidentally include unrelated content from the same filesystem tree.

## Decision

kraziTV separates media roots from media collections.

Media roots answer where media is located. Media collections answer what media can be selected for programming.

Channels and programming rules should reference media collections rather than filesystem roots.

## Consequences

- Channel configuration better represents programming intent.
- A single root can contain media for many channels without forcing all of it into every channel.
- MVP collections can be simple explicit media item lists.
- Advanced query-based or tag-based collections can be added later without changing the media root model.
