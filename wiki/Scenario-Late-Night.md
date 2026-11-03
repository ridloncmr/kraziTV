# Scenario: Late night after 8 PM

A channel plays cartoons and family shows all day. After 8 PM you want
grown-up shows to join in, and by morning they should be gone.

## 1. Add the shows as rules-only

Add the grown-up shows to the lineup, then open each one's Properties and
tick **Only air when a rule picks it**. They stay off the air until a rule
calls them.

## 2. The rule

On the **Rules** tab, click **New rule…**:

- **General**: name it "Late Night". Choose **Mix into the lineup** if the
  evening should mix grown-up and family shows, or **Take over the
  channel** if it should be grown-up only.
- **When**: tick **Only during certain hours**, starting at 8:00 PM and
  ending at 6:00 AM. Hours that end before they start run past midnight,
  so this covers the whole night.
- **What plays**: tick the grown-up shows.

## What to expect

The first grown-up show starts at the first program boundary after 8 PM,
and the last one to start before 6 AM finishes before the family lineup
resumes. [Rules](Rules#timing) explains the timing, and
[Settings](Settings#the-timezone) helps if 8 PM arrives at the wrong hour.

---

**Next:** [Friday movie night](Scenario-Movie-Night).
