# Specs

Specs are organized by feature. A feature folder's `README.md` describes the feature goal and tracks related specs. Detailed behavior belongs in numbered files under that feature folder's `specs/` directory.

## Status Values

- `Planned` - Known future feature or spec that has not been drafted yet.
- `Draft` - Proposed behavior that has not been accepted or implemented.
- `Accepted` - Agreed behavior that is ready to implement or already guides the project.
- `Implemented` - Behavior exists in the codebase and has passing verification.
- `Superseded` - Kept for history but replaced by a newer spec or ADR.

## Layout

```text
features/
  001-example/
    README.md       feature goal and spec status table
    specs/
      0001-*.md     detailed behavior specs
```

## Current Features

| Feature                      | Status   | Description                                             |
| ---------------------------- | -------- | ------------------------------------------------------- |
| `features/000-architecture/` | Accepted | System architecture, responsibilities, and request flow |
| `features/001-mvp/`          | Accepted | First usable Plex-focused kraziTV release               |
