import { describe, expect, it } from "vitest";
import type { PreviewTurn } from "../../http/contracts/programming.js";
import {
  type TurnContext,
  rulesInPlay,
  skipWords,
  turnWords,
} from "./preview-words.js";

const program = (title: string) => ({
  mediaItemId: title,
  title,
  startsAt: "2026-10-14T20:00:00.000Z",
  endsAt: "2026-10-14T20:07:00.000Z",
});

const turn: PreviewTurn = {
  assignmentId: "bluey",
  member: {
    kind: "collection",
    mediaCollectionId: "bluey",
    playbackMode: "episode",
  },
  roundNumber: 2,
  turnIndex: 0,
  continues: false,
  winningRuleId: null,
  skippedRules: [],
  decidedAt: "2026-10-14T20:00:00.000Z",
  settingOrigins: { ordinary: "assignment", marathon: "assignment" },
  startsAt: "2026-10-14T20:00:00.000Z",
  endsAt: "2026-10-14T20:07:00.000Z",
  size: { kind: "programs", value: 1 },
  marathon: false,
  marathonChancePercent: null,
  airtimeMinutes: 7,
  overrunMinutes: null,
  programs: [program("Magic Xylophone")],
};

const context: TurnContext = {
  show: "Bluey",
  kind: "episodes",
  rulesInPlay: false,
  ruleName: (id) => (id === "fridays" ? "Friday movies" : "a rule"),
};

describe("turn words", () => {
  it("reads as a listing: the show, then what plays in its content's unit", () => {
    expect(turnWords(turn, context)).toBe("Bluey · 1 episode (7 min)");
    expect(
      turnWords(
        {
          ...turn,
          airtimeMinutes: 95.4,
          programs: [program("A"), program("B")],
        },
        { ...context, show: "Friday Films", kind: "movies" },
      ),
    ).toBe("Friday Films · 2 movies (1 hr 35 min)");
    expect(turnWords(turn, { ...context, kind: null })).toBe(
      "Bluey · 1 program (7 min)",
    );
  });

  it("says a continued turn is already airing", () => {
    expect(turnWords({ ...turn, continues: true }, context)).toBe(
      "Bluey · 1 episode (7 min) · already airing",
    );
  });

  it("explains an overrun past an airtime target in the owner's units", () => {
    expect(
      turnWords(
        {
          ...turn,
          size: { kind: "airtime", value: 60 },
          airtimeMinutes: 66,
          overrunMinutes: 6.2,
          programs: [program("A"), program("B"), program("C")],
        },
        context,
      ),
    ).toBe(
      "Bluey · 3 episodes (1 hr 6 min) · 6 min over its 1 hr target, since whole programs air",
    );
  });

  it("marks a marathon without its chance or round", () => {
    const words = turnWords(
      {
        ...turn,
        marathon: true,
        marathonChancePercent: 10,
        size: { kind: "programs", value: 6 },
        airtimeMinutes: 42,
        programs: Array.from({ length: 6 }, (_, i) => program(`E${i}`)),
      },
      context,
    );
    expect(words).toBe("Bluey · marathon, 6 episodes (42 min)");
    expect(words).not.toMatch(/%|round/i);
  });

  it("says normal rotation only while a rule is in play", () => {
    expect(turnWords(turn, { ...context, rulesInPlay: true })).toBe(
      "Bluey · 1 episode (7 min) · normal rotation",
    );
    expect(turnWords(turn, context)).not.toMatch(/rotation/);
  });

  it("names the rule that chose a turn, the rules passed over, and the settings the rule set", () => {
    expect(
      turnWords(
        {
          ...turn,
          winningRuleId: "fridays",
          skippedRules: [
            { ruleId: "broken", reason: "no_usable_source" },
            { ruleId: "empty", reason: "no_sources" },
            { ruleId: "odd", reason: "something_new" },
          ],
          settingOrigins: { ordinary: "rule", marathon: "disabled" },
        },
        { ...context, rulesInPlay: true },
      ),
    ).toBe(
      "Bluey · 1 episode (7 min) · chosen by Friday movies · passed over a rule: none of its shows can air · passed over a rule: it names no shows · passed over a rule: something_new · length set by the rule · no marathons under the rule",
    );
    expect(
      turnWords(
        {
          ...turn,
          winningRuleId: "fridays",
          marathon: true,
          settingOrigins: { ordinary: "assignment", marathon: "rule" },
        },
        { ...context, rulesInPlay: true },
      ),
    ).toBe(
      "Bluey · marathon, 1 episode (7 min) · chosen by Friday movies · marathon length set by the rule",
    );
  });

  it("ignores a rule's marathon length when the turn is not a marathon", () => {
    expect(
      turnWords(
        {
          ...turn,
          winningRuleId: "fridays",
          settingOrigins: { ordinary: "assignment", marathon: "rule" },
        },
        { ...context, rulesInPlay: true },
      ),
    ).toBe("Bluey · 1 episode (7 min) · chosen by Friday movies");
  });
});

describe("rules in play", () => {
  it("is true once any turn was chosen by a rule or passed one over", () => {
    expect(rulesInPlay([turn, { ...turn, winningRuleId: "fridays" }])).toBe(
      true,
    );
    expect(
      rulesInPlay([
        { ...turn, skippedRules: [{ ruleId: "x", reason: "no_sources" }] },
      ]),
    ).toBe(true);
    expect(rulesInPlay([turn, { ...turn, skippedRules: null }])).toBe(false);
    expect(rulesInPlay([])).toBe(false);
  });
});

describe("skip words", () => {
  it("names the show and every reason in the owner's words, keeping an unknown code", () => {
    expect(skipWords("Bluey", ["empty_collection"])).toBe(
      "Bluey is skipped: its collection is empty.",
    );
    expect(
      skipWords("Movie night", [
        "no_schedulable_members",
        "media_item_unschedulable",
        "brand_new",
      ]),
    ).toBe(
      "Movie night is skipped: nothing in its collection can air; its item cannot air; brand_new.",
    );
  });
});
