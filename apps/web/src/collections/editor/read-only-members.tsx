import { useRef, useState } from "react";
import { displayDuration } from "../../controls/formatting/display-duration.js";
import { Pager } from "../../controls/pager/pager.js";
import type { CollectionMember } from "../../http/contracts/collections.js";
import { fileNote } from "../../media-availability/availability-label.js";
import { MissingLabel } from "./missing-label.js";

const PAGE_SIZE = 100;

/**
 * Lists members in saved order without editing controls: an automatic
 * collection's members and a criterion preview both come from the server,
 * which alone decides membership and order. `exclude`, when given, adds a
 * per-row action that asks the server to keep the member out.
 */
export function ReadOnlyMembers({
  members,
  exclude,
}: {
  members: readonly CollectionMember[];
  exclude?: { run: (member: CollectionMember) => void; disabled: boolean };
}) {
  const [offset, setOffset] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const page = members.slice(offset, offset + PAGE_SIZE);
  if (members.length === 0) {
    return (
      <p className="empty-state">
        Nothing in the catalog matches yet. Matching media joins as it is
        cataloged.
      </p>
    );
  }
  return (
    <>
      <Pager
        offset={offset}
        limit={PAGE_SIZE}
        total={members.length}
        list={list}
        onChange={setOffset}
      />
      <div ref={list} className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title / path</th>
              <th>Duration</th>
              {exclude && <th>Membership</th>}
            </tr>
          </thead>
          <tbody>
            {page.map((member, index) => (
              <tr key={member.mediaItemId}>
                <td>{offset + index + 1}</td>
                <td>
                  {member.title}
                  {member.status === "missing" && <MissingLabel />}
                  <small className="secondary path-cell" title={member.path}>
                    {fileNote(member)}
                  </small>
                </td>
                <td>{displayDuration(member.durationMs)}</td>
                {exclude && (
                  <td>
                    <button
                      aria-label={`Exclude ${member.title} from this collection`}
                      disabled={exclude.disabled}
                      onClick={() => exclude.run(member)}
                    >
                      Exclude from this collection
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
