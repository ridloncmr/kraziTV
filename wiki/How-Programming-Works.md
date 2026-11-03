# How programming works

You never schedule a program by hand. You give a channel a lineup of shows,
and kraziTV decides what airs and when. This page explains how it decides,
so the results make sense and you can shape them.

## Rounds and turns

A channel's lineup is a list of shows. kraziTV programs the channel in
**rounds**. In each round, every show gets exactly one **turn**, in a
shuffled order. When the round ends, a new one starts with a new shuffle.

A turn plays the amount you set as **Plays at a time**: three episodes, one
movie, about an hour. Then the next show's turn begins.

So a channel with Bluey, Curious George, and a movie collection plays
something like: three Bluey episodes, a movie, three Curious George
episodes, and then a new round in a different order. Every show airs about as often
as every other.

Two details keep this feeling natural:

- The same show never plays twice in a row across the round boundary,
  unless it is the only show.
- A show added mid-round waits for the next round.

## Shows pick up where they left off

Each show remembers how far it has gone through its collection on this
channel. When Bluey's turn comes around again, it continues from the next
episode. In [Play order](Play-Order) you choose whether that means episode
order, release order, the collection's own order, or random picks.

That memory belongs to the channel, the collection, and the play order
together. Two channels playing the same series each keep their own place.
A collection can be in only one show per channel, and a [special](Specials)
that plays it in the same play order shares the show's place, so the two
never repeat each other.

## What a turn will not do

A turn only ever plays whole programs. kraziTV never cuts a program short
to hit a time target, never trims a movie to fit before the hour, and never
starts something it will have to interrupt. The only interruptions are the
ones you ask for: a [special](Specials) that cuts in, or **Stop it now**
when you change a channel.

Because of that, time targets overrun. "About an hour" of 22-minute
episodes airs 66 minutes. That is deliberate: real channels run late too.

## Shows that cannot air

A show whose collection is empty, or whose files are all missing or
[too short](Media-Library#scanning), is skipped for that round and checked
again in the next. The Preview
tab says which shows are skipped and why. If no show can air, the channel
goes dark and My Channels reports that nothing is scheduled.

## How far ahead

kraziTV keeps every enabled channel programmed three days ahead.

## When you change something

Changes take effect after whatever is airing. Turns that had not started
are replaced and the round carries on with the new lineup; shows keep
their place in their collections either way. [My
Channels](My-Channels#changing-a-channel-on-the-air) covers the choice
between letting the program finish and stopping it now.

## Building on the basics

- [Wheels](Wheels) let several shows share one turn.
- [Marathons](Marathons) let a show run long now and then.
- [Rules](Rules) change the lineup on certain days, dates, or hours.
- [Specials](Specials) put something exact at an exact time.

---

**Next:** [Play order](Play-Order).
