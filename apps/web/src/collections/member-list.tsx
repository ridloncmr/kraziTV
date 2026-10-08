import { useState } from "react";
import { displayDuration } from "../controls/display-duration.js";
import { withIds } from "../controls/id-selection.js";
import { Pager } from "../controls/pager.js";
import { useRangeToggle } from "../controls/use-range-toggle.js";
import type { DraftMember } from "./contracts.js";
import { moveMembers, sortMembers } from "./member-order.js";

const PAGE_SIZE = 100;

/**
 * Edits the draft member order. The filter and pages only narrow what is
 * shown; positions and bulk moves always address the whole order, so a
 * filtered view never reorders members it hides.
 */
export function MemberList({
  members,
  onChange,
}: {
  members: readonly DraftMember[];
  onChange: (members: DraftMember[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = members
    .map((item, index) => ({ item, position: index + 1 }))
    .filter(
      ({ item }) =>
        item.title.toLowerCase().includes(needle) ||
        item.path.toLowerCase().includes(needle),
    );
  const page = shown.slice(offset, offset + PAGE_SIZE);
  // A discarded draft can drop chosen members, so count only those still present.
  const chosenCount = members.filter((item) =>
    chosen.has(item.mediaItemId),
  ).length;
  const allShownChosen =
    shown.length > 0 && shown.every(({ item }) => chosen.has(item.mediaItemId));

  /** Chooses or releases members without touching choices hidden by the filter. */
  function choose(ids: string[], on: boolean) {
    setChosen(withIds(chosen, ids, on));
  }

  // Ranges follow the filtered order across pages, never members the filter hides.
  const range = useRangeToggle(
    shown.map(({ item }) => item.mediaItemId),
    (id) => chosen.has(id),
    choose,
  );

  /**
   * Drops members from the draft and releases their choices. Other choices
   * stay, and the view returns to the first page so it never sits past the end.
   */
  function remove(ids: ReadonlySet<string>) {
    onChange(members.filter((item) => !ids.has(item.mediaItemId)));
    setChosen(new Set([...chosen].filter((id) => !ids.has(id))));
    setOffset(0);
  }

  /** Moves the chosen block so it starts at a zero-based index of the final order. */
  function moveChosen(index: number) {
    onChange(moveMembers(members, chosen, index));
  }

  return (
    <fieldset className="collection-pane">
      <legend>Members ({members.length})</legend>
      <label className="search-field">
        Filter members
        <input
          type="search"
          value={filter}
          placeholder="Title or path"
          onChange={(event) => {
            setFilter(event.target.value);
            setOffset(0);
          }}
        />
      </label>
      <div className="row-actions">
        <button disabled={chosenCount === 0} onClick={() => remove(chosen)}>
          Remove selected ({chosenCount})
        </button>
        <button
          disabled={shown.length === 0}
          onClick={() =>
            remove(new Set(shown.map(({ item }) => item.mediaItemId)))
          }
        >
          Remove all ({shown.length})
        </button>
        <button
          disabled={chosenCount === 0}
          onClick={() => setChosen(new Set())}
        >
          Clear selection
        </button>
      </div>
      <div className="row-actions bulk-actions">
        <button disabled={chosenCount === 0} onClick={() => moveChosen(0)}>
          Move to top
        </button>
        <button
          disabled={chosenCount === 0}
          onClick={() => moveChosen(Infinity)}
        >
          Move to bottom
        </button>
        <form
          className="row-actions"
          onSubmit={(event) => {
            event.preventDefault();
            moveChosen(Number(target) - 1);
          }}
        >
          <input
            aria-label="Target position"
            className="position-input"
            type="number"
            min={1}
            max={members.length}
            required
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <button disabled={chosenCount === 0} type="submit">
            Move to position
          </button>
        </form>
        <button onClick={() => onChange(sortMembers(members, "path"))}>
          Sort all by path
        </button>
        <button onClick={() => onChange(sortMembers(members, "title"))}>
          Sort all by title
        </button>
      </div>
      <Pager
        offset={offset}
        limit={PAGE_SIZE}
        total={shown.length}
        onChange={setOffset}
      />
      {members.length === 0 && (
        <p className="empty-state">
          This collection has no media. Add items from the catalog.
        </p>
      )}
      {members.length > 0 && shown.length === 0 && (
        <p className="empty-state">No members match this filter.</p>
      )}
      {page.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all shown members"
                    checked={allShownChosen}
                    onChange={() =>
                      choose(
                        shown.map(({ item }) => item.mediaItemId),
                        !allShownChosen,
                      )
                    }
                  />
                </th>
                <th>#</th>
                <th>Title / path</th>
                <th>Duration</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {page.map(({ item, position }) => (
                <tr
                  key={item.mediaItemId}
                  className={`clickable-row${chosen.has(item.mediaItemId) ? " selected-row" : ""}`}
                  {...range.row(item.mediaItemId)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select member ${item.title}`}
                      checked={chosen.has(item.mediaItemId)}
                      onChange={range.checkbox(item.mediaItemId)}
                    />
                  </td>
                  <td>{position}</td>
                  <td>
                    {item.title}
                    <small className="secondary path-cell">
                      {item.status} · {item.path}
                    </small>
                  </td>
                  <td>{displayDuration(item.durationMs)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        aria-label={`Move ${item.title} up`}
                        disabled={position === 1}
                        onClick={() =>
                          onChange(
                            moveMembers(
                              members,
                              new Set([item.mediaItemId]),
                              position - 2,
                            ),
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move ${item.title} down`}
                        disabled={position === members.length}
                        onClick={() =>
                          onChange(
                            moveMembers(
                              members,
                              new Set([item.mediaItemId]),
                              position,
                            ),
                          )
                        }
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}
