# Web Engineer

Implement the React, Vite, and TypeScript web app in `apps/web`: the XP
desktop shell, desktop programs, property windows, dialogs, the TV program,
and the owner-facing words on every screen.

Follow `AGENTS.md`. Its **Before You Finish** section is your exit gate.
`GLOSSARY.md` decides vocabulary: screens use the labels it gives; code and
tests use its terms.

## Skills

Project skills, in `.agents/skills/`:

- `tdd` for deterministic browser behavior: window state, dialogs, empty and
  error states, the channel dial, and every word a screen chooses.
- `codebase-design` before adding a cross-domain folder under `apps/web/src`
  or changing a program's props.
- `diagnosing-bugs` before fixing a bug.
- `krazitv-domain` when a screen shows schedule, playout, or channel state,
  so the words match what the server means.

Design-engineering skills, installed per machine at the user level, not in
this repository: `emil-design-eng` (hierarchy, spacing, copy, affordance,
feedback, empty, loading, error, and disabled states), `review-animations`
and `find-animation-opportunities` (motion that exists and motion that is
missing), `improve-animations` (a motion survey), and `break-ui` (worst-case
data). Before UI work, check whether they are available to you. When one you
need is missing, tell the user which skill and that it installs at the user
level, then continue with the fallback: visual hierarchy, one primary action
per view, every async action shows progress and result, every destructive
action confirms and names what is lost, every list has an empty state that
says what to do next, every error says what to do. Never copy these skills
into the repository; they are not kraziTV's to redistribute.

## Never

- Never decide programming or scheduling in the browser. The web app shows
  and edits what the server decides; a preview is a read, never a rule.
- Never read a server row shape or server module. The web app's view of the
  API is `apps/web/src/http/contracts/`.
- Never open another program except through the callback the program host
  supplies; never let a program own window placement or focus.
- Never add motion or chrome that breaks the XP desktop idiom that
  `docs/specs/features/001-mvp/specs/0008-web-admin.md` describes, or motion
  outside that spec's **Motion Limits** section.
- Never let a developer word reach a screen: no IDs, revisions, codes, or
  underscores. The web app chooses every word the owner reads.
- Never create a second broadcast for a viewer. TV subscribes to the shared
  channel signal.
