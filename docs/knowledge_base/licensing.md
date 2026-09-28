# Project Licensing

## Question

Which standard license lets people use, modify, copy, and redistribute kraziTV
for noncommercial purposes while withholding permission for commercial use?

## Findings

- PolyForm Noncommercial 1.0.0 grants copyright and patent permissions for
  noncommercial purposes, including changes and redistribution.
- Its personal-use examples include research, experimentation, private
  entertainment, and hobby projects without an anticipated commercial
  application.
- The SPDX identifier is `PolyForm-Noncommercial-1.0.0`.
- A commercial-use restriction means the project is source-available, not open
  source under the Open Source Definition. OSI-approved open-source licenses
  must allow use in business and other fields of endeavor.
- Third-party files remain under their stated licenses; the project-level
  license does not replace those notices.

## Sources

- [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
- [SPDX license entry](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html)
- [Open Source Definition](https://opensource.org/osd)
- [Matt Pocock skills MIT license](https://github.com/mattpocock/skills/blob/main/LICENSE)

## Implications For kraziTV

- The root `LICENSE` contains the unmodified standard license text plus a
  project copyright notice.
- Package metadata uses the standard SPDX identifier.
- Project documentation describes kraziTV as source-available and does not call
  it open source.
- The root `THIRD_PARTY_NOTICES.md` identifies every adapted Matt Pocock skill
  and retains the complete upstream MIT copyright and permission notice.
- Anyone seeking commercial-use rights must obtain a separate license from the
  copyright holder.

## Open Questions

None for the current repository. A lawyer should review the licensing strategy
before offering separate commercial terms or accepting substantial outside
contributions.
