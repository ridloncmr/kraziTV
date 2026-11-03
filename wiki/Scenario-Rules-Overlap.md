# Scenario: When two rules overlap

A channel has Saturday morning cartoons and a December Christmas rule.
What plays on a Saturday morning in December? It depends on their
priorities and on whether each mixes in or takes over.

## The rule

At any moment, kraziTV looks at the rules that apply right now and keeps
only those at the **highest priority** that can air something. Everything
at a lower priority is ignored. Then:

| What is active at the top priority  | What takes turns                             |
| ----------------------------------- | -------------------------------------------- |
| Nothing                             | The regular lineup                           |
| Only mix-in rules                   | The regular lineup plus every mix-in's shows |
| A takeover, with or without mix-ins | The takeover's shows plus any mix-ins' shows |
| Several takeovers                   | All their shows together                     |

A takeover removes the regular shows. A mix-in adds its shows to whatever
is playing, which might be the regular lineup or another rule's takeover.

## Worked examples

**Both mix in, same priority.** December (mix in, priority 3) and Saturday
Cartoons (mix in, priority 3): on a December Saturday morning, the regular
shows, the Christmas show, and the cartoons all take turns.

**Takeover and mix-in, same priority.** Saturday Cartoons takes over and
December mixes in, both priority 3: cartoons and Christmas take turns; the
regular shows pause.

**Different priorities.** Christmas Day takes over at priority 4 and
Saturday Cartoons runs at priority 3: on a Saturday December 25th, only
Christmas airs. The cartoons rule is simply not consulted. This is true
even if the lower rule is a mix-in.

**Two takeovers, same priority.** Nick cartoons from 7 to 11 and Cartoon
Network cartoons from 9 to 11, both takeovers at priority 3: from 9 to 11,
both sets of cartoons take turns together.

**A rule that cannot play.** If the top rule's shows are empty or missing,
it is skipped and the next priority down gets its turn, all the way down
to the regular lineup. A broken rule never leaves a channel dark.

## Choosing priorities

Think of priority as "who wins an argument", not "who plays more". Give
special days a higher number than weekly habits, and weekly habits a
higher number than month-long seasons, and most overlaps sort themselves
out. The Preview tab says which rule chose each of the next ten turns, so
check it once the rule's day is near.

One more detail: when two active rules pick the same show, it still gets
one turn per round, with the size settings from whichever rule is higher
in the Rules list. **Move up** and **Move down** reorder rules of the same
priority.

---

**Next:** back to [Scenarios](Scenarios), or [Troubleshooting](Troubleshooting).
