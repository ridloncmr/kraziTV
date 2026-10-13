import { useState } from "react";
import { displayDuration } from "../../controls/display-duration.js";
import { Pager } from "../../controls/pager.js";
import type { CollectionMember } from "../../http/contracts.js";
import { MissingLabel } from "../editor/missing-label.js";

const PAGE_SIZE = 100;

/**
 * Lists members in saved order without editing controls: an automatic
 * collection's members and a criterion preview both come from the server,
 * which alone decides membership and order.
 */
export function ReadOnlyMembers({
  members,
}: {
  members: readonly CollectionMember[];
}) {
  const [offset, setOffset] = useState(0);
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
        onChange={setOffset}
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title / path</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {page.map((member, index) => (
              <tr key={member.mediaItemId}>
                <td>{offset + index + 1}</td>
                <td>
                  {member.title}
                  {member.status === "missing" && <MissingLabel />}
                  <small className="secondary path-cell">{member.path}</small>
                </td>
                <td>{displayDuration(member.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
