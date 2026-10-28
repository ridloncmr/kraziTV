# Project Licensing

## Question

Which license should kraziTV use?

## Decision

kraziTV is free software under the GNU Affero General Public License, version
3 or later, SPDX identifier `AGPL-3.0-or-later`, as of 2026-10-28. It replaced
PolyForm Noncommercial 1.0.0, which made kraziTV source-available but not open
source, because it withheld commercial use. Christian Ridlon was the only
contributor at the time, so no one else's consent was needed to relicense.

AGPL rather than a permissive license keeps forks open: kraziTV is a
self-hosted server, and the AGPL's network clause makes anyone who runs a
modified version for others offer them its source, which the plain GPL does
not.

## Findings

- The AGPL allows any use, including commercial use, and meets the Open
  Source Definition.
- Section 13 applies to modified versions only: whoever modifies kraziTV and
  lets others use it over a network must offer those users its source.
  Running kraziTV unmodified adds no duty beyond the GPL's.
- The adapted Matt Pocock skills are MIT, which may be combined with
  AGPL-licensed code.
- The Docker image's FFmpeg is GPL. kraziTV runs it as a separate program and
  never links it, and GPLv3 and AGPLv3 explicitly permit combination anyway.
  Publishing the image still means meeting the GPL for FFmpeg itself; see
  `THIRD_PARTY_NOTICES.md`.
- "Or later" lets future FSF versions of the AGPL apply, as the FSF
  recommends.
- Third-party files keep their own licenses; the project license does not
  replace their notices.

## Sources

- [GNU AGPL v3 text](https://www.gnu.org/licenses/agpl-3.0.txt)
- [Why the Affero GPL](https://www.gnu.org/licenses/why-affero-gpl.html)
- [AGPL-3.0-or-later (SPDX)](https://spdx.org/licenses/AGPL-3.0-or-later.html)
- [FFmpeg license and legal considerations](https://ffmpeg.org/legal.html)
- [Matt Pocock skills MIT license](https://github.com/mattpocock/skills/blob/main/LICENSE)

## Implications For kraziTV

- The root `LICENSE` holds the unmodified AGPL v3 text; the README carries the
  copyright notice.
- Package metadata and the Docker image label use `AGPL-3.0-or-later`.
- `THIRD_PARTY_NOTICES.md` records every third-party notice, for both the
  repository and the published Docker image.
- Contributions arrive under the same license unless a contributor says
  otherwise.

## Open Questions

- Section 13 favors a visible link to the source in the web app, such as on
  the logon screen or an About window, so anyone running a modified version
  passes it on. kraziTV has none yet.
