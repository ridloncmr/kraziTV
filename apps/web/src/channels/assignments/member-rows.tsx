import type {
  AssignmentMember,
  MediaCollection,
} from "../../http/contracts.js";
import { MediaItemPicker } from "../../media-search/media-item-picker.js";

/** One member row as the form edits it; an empty source is not chosen yet. */
export interface MemberDraft {
  kind: AssignmentMember["kind"];
  sourceId: string;
}

export const NEW_MEMBER: MemberDraft = { kind: "collection", sourceId: "" };

/**
 * Edits an assignment's members in saved order: each row a collection or a
 * single item, movable, removable while another remains, plus a row to add
 * one. Every change goes through `edit`, so the form marks itself edited.
 */
export function MemberRows({
  members,
  collections,
  visible,
  edit,
}: {
  members: readonly MemberDraft[];
  collections: MediaCollection[] | undefined;
  visible: boolean;
  edit: (change: (rows: MemberDraft[]) => MemberDraft[]) => void;
}) {
  return (
    <>
      <ol aria-label="Members">
        {members.map((member, index) => (
          <li key={index} className="inline-form">
            <label>
              Source type
              <select
                value={member.kind}
                onChange={(event) => {
                  const kind = event.target.value as MemberDraft["kind"];
                  edit((rows) =>
                    rows.map((row, at) =>
                      at === index ? { kind, sourceId: "" } : row,
                    ),
                  );
                }}
              >
                <option value="collection">Media collection</option>
                <option value="media_item">Single media item</option>
              </select>
            </label>
            {member.kind === "collection" ? (
              <label>
                Programming source
                <select
                  required
                  value={member.sourceId}
                  onChange={(event) => {
                    const sourceId = event.target.value;
                    edit((rows) =>
                      rows.map((row, at) =>
                        at === index ? { ...row, sourceId } : row,
                      ),
                    );
                  }}
                >
                  <option value="">Choose a source</option>
                  {collections?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <MediaItemPicker
                label="Programming source"
                value={member.sourceId}
                visible={visible}
                onChange={(item) => {
                  const sourceId = item?.id ?? "";
                  edit((rows) =>
                    rows.map((row, at) =>
                      at === index ? { ...row, sourceId } : row,
                    ),
                  );
                }}
              />
            )}
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
      <button
        type="button"
        onClick={() => edit((rows) => [...rows, NEW_MEMBER])}
      >
        Add member
      </button>
    </>
  );
}

/** Moves one member row a place earlier or later. */
function moveRow(
  rows: MemberDraft[],
  index: number,
  offset: -1 | 1,
): MemberDraft[] {
  const [moved] = rows.splice(index, 1);
  if (moved !== undefined) rows.splice(index + offset, 0, moved);
  return rows;
}
