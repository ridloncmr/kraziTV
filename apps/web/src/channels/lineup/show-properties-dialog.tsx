import { useId, useRef, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  AssignmentMember,
  MarathonSettings,
  PlaybackMode,
  SourceAssignment,
  StretchSuggestion,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { CollectionPreviewSection } from "../assignments/collection-preview-section.js";
import { MemberRows } from "../assignments/member-rows.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import {
  StretchFields,
  suggestMarathon,
  toStretchSetting,
} from "../assignments/stretch-fields.js";
import { memberKey } from "../../media-search/collection-or-item-search.js";
import {
  draftMarathon,
  type ShowDraft,
  suggestionPath,
  toSettings,
  toShowDraft,
} from "./show-draft.js";
import { PerSittingField } from "../assignments/per-sitting-field.js";
import { marathonLabel } from "../assignments/stretch-words.js";
import { OCCASIONAL_MARATHONS } from "./marathons-control.js";

/**
 * Edits one show, a programming source assignment, in a window dialog.
 * Nothing writes until **OK** or **Apply**, and **Cancel** discards every
 * change. The main section holds order, per sitting, and whether the show
 * can marathon; **Advanced** holds members, rotation, the marathon length
 * override, and the collection preview. Saving a show never changes the
 * channel's marathon settings: while they are off, checking **Can
 * marathon** offers to turn them on as its own write.
 */
export function ShowPropertiesDialog({
  assignmentsPath,
  assignment,
  title,
  collections,
  memberName,
  unavailable,
  settingsPath,
  marathons,
  visible,
  changed,
  onClose,
}: {
  assignmentsPath: string;
  assignment: SourceAssignment;
  title: string;
  collections: MediaCollection[] | undefined;
  /** Names a saved member; members picked here are named by the picker. */
  memberName: (member: AssignmentMember) => string;
  /** Members other shows play, by member key, which this show cannot add. */
  unavailable: ReadonlyMap<string, string>;
  /** Where the channel's marathon settings save. */
  settingsPath: string;
  marathons: ReturnType<typeof useResource<MarathonSettings>>;
  visible: boolean;
  /** Runs after every write the server accepted. */
  changed: () => void;
  onClose: () => void;
}) {
  const mutation = useMutation();
  const turnOn = useMutation();
  // Whether the owner turned channel marathons on from here, which it says.
  const [turnedOn, setTurnedOn] = useState(false);
  const hintId = useId();
  const [draft, setDraft] = useState<ShowDraft>(() => toShowDraft(assignment));
  // Names of members picked here, which the lineup has not read.
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  // Counts accepted saves, so the collection preview reads again.
  const [saves, setSaves] = useState(0);
  // Whether the pressed button was OK, which closes after the save.
  const closeAfterSave = useRef(true);
  const assignmentPath = `${assignmentsPath}/${encodeURIComponent(assignment.id)}`;
  const { members } = draft;
  const hasCollection = members.some((member) => member.kind === "collection");
  // The suggestion's content kind words the presets for the members shown.
  const suggestion = useResource<StretchSuggestion>(
    hasCollection ? suggestionPath(members) : null,
    visible,
  );
  const contentKind = suggestion.data?.contentKind ?? null;
  const name = (member: AssignmentMember) =>
    pickedNames.get(memberKey(member)) ?? memberName(member);
  const marathon = draftMarathon(draft);
  // Applies one edit to the draft.
  const edit = (change: Partial<ShowDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  // Member rows edit through a function of the current rows.
  const editMembers = (
    change: (rows: AssignmentMember[]) => AssignmentMember[],
  ) =>
    setDraft((current) => ({
      ...current,
      members: change([...current.members]),
    }));
  return (
    <WindowDialog
      title={title}
      busy={mutation.pending || turnOn.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const close = closeAfterSave.current;
          void mutation.run(assignmentPath, "PATCH", toSettings(draft), () => {
            setSaves((count) => count + 1);
            changed();
            if (close) onClose();
          });
        }}
      >
        <fieldset disabled={mutation.pending}>
          {hasCollection ? (
            <>
              <label>
                Order
                <select
                  value={draft.mode}
                  aria-describedby={hintId}
                  onChange={(event) =>
                    edit({ mode: event.target.value as PlaybackMode })
                  }
                >
                  {PLAYBACK_MODE_CHOICES.map((choice) => (
                    <option key={choice.mode} value={choice.mode}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <small id={hintId} className="secondary">
                {
                  PLAYBACK_MODE_CHOICES.find(
                    (choice) => choice.mode === draft.mode,
                  )?.hint
                }
              </small>
              <PerSittingField
                draft={draft.stretch}
                contentKind={contentKind}
                onChange={(stretch) => edit({ stretch })}
              />
              <label className="choice">
                <input
                  type="checkbox"
                  checked={draft.canMarathon}
                  onChange={(event) =>
                    edit({ canMarathon: event.target.checked })
                  }
                />
                Can marathon
              </label>
              {marathon !== null && (
                <small className="secondary">
                  {marathonLabel(toStretchSetting(marathon), contentKind)}
                </small>
              )}
              {draft.canMarathon &&
                marathons.data?.marathonChancePercent === 0 && (
                  <div className="inline-notice">
                    <p>Marathons are off for this channel.</p>
                    <button
                      type="button"
                      disabled={turnOn.pending}
                      onClick={() =>
                        void turnOn.run(
                          settingsPath,
                          "PUT",
                          OCCASIONAL_MARATHONS,
                          () => {
                            setTurnedOn(true);
                            marathons.refresh();
                            changed();
                          },
                        )
                      }
                    >
                      Turn on occasional marathons
                    </button>
                  </div>
                )}
              <RequestFeedback loading={turnOn.pending} error={turnOn.error} />
              {turnedOn && (
                <p role="status">
                  Occasional marathons are now on for this channel.
                </p>
              )}
            </>
          ) : (
            <p className="secondary">Single items air once per sitting.</p>
          )}
          <details>
            <summary>Advanced</summary>
            <fieldset>
              <legend>Members</legend>
              <p className="secondary">
                Members share this show&apos;s turn and take it in order. Add
                separate shows for separate turns.
              </p>
              <MemberRows
                members={members}
                name={name}
                collections={collections}
                unavailable={unavailable}
                visible={visible}
                edit={editMembers}
                onPicked={(member, picked) =>
                  setPickedNames((current) =>
                    new Map(current).set(memberKey(member), picked),
                  )
                }
              />
            </fieldset>
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.rotates}
                onChange={(event) => edit({ rotates: event.target.checked })}
              />
              Plays in normal rotation
            </label>
            {!draft.rotates && (
              <p className="secondary">
                Airs only while a programming rule selects it.
              </p>
            )}
            {hasCollection && draft.canMarathon && (
              <>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={draft.marathonOverride !== null}
                    onChange={(event) =>
                      edit({
                        marathonOverride: event.target.checked
                          ? suggestMarathon(draft.stretch)
                          : null,
                      })
                    }
                  />
                  Choose the marathon length
                </label>
                {draft.marathonOverride !== null && (
                  <StretchFields
                    marathon
                    draft={draft.marathonOverride}
                    onChange={(marathonOverride) => edit({ marathonOverride })}
                  />
                )}
              </>
            )}
            <CollectionPreviewSection
              assignmentPath={assignmentPath}
              assignment={assignment}
              draftMode={draft.mode}
              draftCollectionIds={members.flatMap((member) =>
                member.kind === "collection" ? [member.mediaCollectionId] : [],
              )}
              collections={collections}
              visible={visible}
              changed={changed}
              refreshKey={saves}
            />
          </details>
        </fieldset>
        <RequestFeedback
          loading={mutation.pending}
          error={mutation.error}
          message={mutation.message}
        />
        <div className="dialog-actions">
          <button
            type="submit"
            disabled={mutation.pending}
            onClick={() => {
              closeAfterSave.current = true;
            }}
          >
            OK
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.pending}
            onClick={() => {
              closeAfterSave.current = false;
            }}
          >
            Apply
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}
