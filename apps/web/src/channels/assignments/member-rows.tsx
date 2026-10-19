import type { MediaCollection } from "../../http/contracts/collections.js";
import type { AssignmentMember } from "../../http/contracts/programming.js";
import {
  CollectionOrItemSearch,
  memberKey,
} from "../../media-search/collection-or-item-search.js";

/**
 * Edits a show's members in saved order: each one named, movable, and
 * removable while another remains, with the combined collection-and-item
 * search to add one. Checking a result adds it last and unchecking removes
 * it, except the only member. Every change goes through `edit`, and
 * `onPicked` hears each added member's name, which the caller may not know.
 */
export function MemberRows({
  members,
  name,
  collections,
  unavailable,
  visible,
  edit,
  onPicked,
}: {
  members: readonly AssignmentMember[];
  name: (member: AssignmentMember) => string;
  collections: MediaCollection[] | undefined;
  /** Members other shows play, by member key, which this one cannot add. */
  unavailable: ReadonlyMap<string, string>;
  visible: boolean;
  edit: (change: (rows: AssignmentMember[]) => AssignmentMember[]) => void;
  onPicked: (member: AssignmentMember, name: string) => void;
}) {
  const keys = new Set(members.map(memberKey));
  // The only member stays: a show always plays something.
  const locked =
    members.length === 1 && members[0]
      ? new Map([[memberKey(members[0]), "the show's only member"]])
      : new Map<string, string>();
  return (
    <>
      <ol aria-label="Members">
        {members.map((member, index) => (
          <li key={memberKey(member)} className="inline-form">
            <span>{name(member)}</span>
            {members.length > 1 && (
              <span className="row-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => edit((rows) => moveRow(rows, index, -1))}
                >
                  Move member up
                </button>
                <button
                  type="button"
                  disabled={index === members.length - 1}
                  onClick={() => edit((rows) => moveRow(rows, index, 1))}
                >
                  Move member down
                </button>
                <button
                  type="button"
                  onClick={() =>
                    edit((rows) => rows.filter((_, at) => at !== index))
                  }
                >
                  Remove member
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <CollectionOrItemSearch
        collections={collections}
        checked={keys}
        unavailable={new Map([...unavailable, ...locked])}
        visible={visible}
        onToggle={({ member, name: picked }, checked) => {
          if (checked) onPicked(member, picked);
          edit((rows) =>
            checked
              ? [...rows, member]
              : rows.filter((row) => memberKey(row) !== memberKey(member)),
          );
        }}
      />
    </>
  );
}

/** Moves one member a place earlier or later. */
function moveRow(
  rows: AssignmentMember[],
  index: number,
  offset: -1 | 1,
): AssignmentMember[] {
  const [moved] = rows.splice(index, 1);
  if (moved !== undefined) rows.splice(index + offset, 0, moved);
  return rows;
}
