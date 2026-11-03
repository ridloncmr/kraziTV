# Scenario: Christmas in December

You want your sitcom channel to mix in Christmas episodes and movies all
December, and to play nothing but Christmas on the day itself. The rest of
the year, none of it should air.

## 1. Gather the Christmas material

Christmas episodes are scattered across many shows, so a [tag](Media-Library#tags)
is the way to collect them. In Media Library, find each episode, open
**Details…**, then **Correct details…**, and add the tag `Christmas`.
Filtering by series makes this quick: tick a series in **Filter…**, then
walk its episodes.

Then, in [Collections](Collections), click **New automatic collection…**,
choose **Tag**, and pick `Christmas`. Name it "Christmas Episodes". Make a
second one for movies if you tag those too, or keep everything in one.

From now on, tagging a new episode adds it to the collection by itself.

## 2. Add it to the channel, out of rotation

In My Channels, open the channel's Properties and click **Add shows…**.
Tick Christmas Episodes, click **Next (1)**, choose a play order and how
much plays at a time, and click **Add (1)**.

Now open the show's Properties and tick **Only air when a rule picks it**.
The lineup marks it **Rules only**. It is on the lineup, but nothing picks
it yet, so it never airs.

## 3. Make the December rule

On the **Rules** tab, click **New rule…**:

- **General**: name it "December", choose **Mix into the lineup**, leave
  the priority at 3.
- **When**: set **Dates** to **Every year between two dates**, from
  `12-01` through `12-31`.
- **What plays**: tick Christmas Episodes.

Click **OK**. Every December, Christmas Episodes takes turns with the
regular shows, and on January 1 it drops out again. Nothing to do next year.

## 4. Christmas Day only

Add a second rule, "Christmas Day": **Take over the channel**, priority
**4**, every year from `12-25` through `12-25`, playing Christmas Episodes.

On the 25th the higher priority wins outright, so only Christmas airs.
Being a takeover, the regular shows pause and resume on the 26th where
they left off. [When two rules overlap](Scenario-Rules-Overlap) explains
why the priority matters here.

## Variations

- **Horror all October** is the same recipe with `10-01` through `10-31`
  and a horror tag or genre collection.
- **Star Wars day** is a one-day yearly rule, `05-04` through `05-04`,
  playing a Star Wars franchise collection.
- **A range over New Year** such as `12-20` through `01-05` works as you
  would expect.
- To give the Christmas show longer runs in December, set its
  **Marathons** to **Choose a marathon length** in the rule's **What
  plays** tab, and make sure the channel's [Marathons](Marathons) are on.

---

**Next:** [Saturday morning cartoons](Scenario-Saturday-Cartoons).
