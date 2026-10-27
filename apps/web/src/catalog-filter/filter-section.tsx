import { useState } from "react";
import { displayCount } from "../controls/display-count.js";

/** One value a filter section offers: what the server receives and what the owner reads. */
export interface FilterOption {
  value: string;
  label: string;
  /** How many cataloged items carry the value, when the server counted them. */
  itemCount?: number;
}

// A section longer than this gets a find box, so a long series list stays usable.
const FIND_THRESHOLD = 8;

/**
 * One filter section: a checkbox per value, any of which an item may match.
 * A long section can be narrowed by typing; narrowing only hides rows and
 * never unchecks a value.
 */
export function FilterSection({
  legend,
  options,
  chosen,
  onToggle,
  empty,
}: {
  legend: string;
  options: readonly FilterOption[];
  chosen: readonly string[];
  onToggle: (value: string, on: boolean) => void;
  /** What the section says when it has no values to offer. */
  empty: string;
}) {
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;
  return (
    <fieldset className="filter-section">
      <legend>{legend}</legend>
      {options.length > FIND_THRESHOLD && (
        <input
          type="search"
          aria-label={`Find ${legend.toLowerCase()}`}
          placeholder="Find"
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
      )}
      {options.length === 0 ? (
        <p className="secondary">{empty}</p>
      ) : (
        <div className="filter-options">
          {shown.map((option) => (
            <label key={option.value} className="choice">
              <input
                type="checkbox"
                checked={chosen.includes(option.value)}
                onChange={(event) =>
                  onToggle(option.value, event.target.checked)
                }
              />
              <span>
                {option.label}
                {option.itemCount !== undefined && (
                  <small> ({displayCount(option.itemCount)})</small>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
