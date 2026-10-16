import type { ProgrammingRule } from "@krazitv/krazi-brain";

/** How a rule's dates are stored: unrestricted, one local date range, or one yearly range. */
type RuleDateKind = "any" | "one_off" | "annual";

/**
 * One programming rule: recurring channel configuration that selects
 * sources under calendar conditions (programming spec 0005). Dates are
 * local: `YYYY-MM-DD` for a one-off range or `MM-DD` for a yearly one,
 * each pair set only for its kind; checks enforce each shape. Its sources
 * live in `programming_rule_sources`.
 */
export interface ProgrammingRuleTable {
  id: string;
  channel_id: string;
  name: string;
  behavior: ProgrammingRule["behavior"];
  /** Higher wins. */
  priority: number;
  /** Saved rule order; breaks priority ties before the ID does. */
  rule_order: number;
  date_kind: RuleDateKind;
  start_date: string | null;
  end_date: string | null;
  start_month_day: string | null;
  end_month_day: string | null;
  /** Bit `1 << day` for each local weekday, 0 for Sunday; 0 or null means every day. */
  weekdays: number | null;
  /** Local minutes after midnight, set together; null together for the whole day. */
  window_start_minute: number | null;
  window_end_minute: number | null;
  created_at: number;
  updated_at: number;
}
