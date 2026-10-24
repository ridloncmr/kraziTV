import { useId, useRef, useState } from "react";
import { CheckboxOption } from "../../controls/checkbox-option.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { TabbedPanel } from "../../controls/tabbed-panel.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  AssignmentMember,
  MarathonSettings,
  SourceAssignment,
  StretchSuggestion,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { CollectionPreviewSection } from "../assignments/collection-preview-section.js";
import { MemberRows } from "../assignments/member-rows.js";
import { PlayOrderField } from "../assignments/play-order-field.js";
import {
  isStretchComplete,
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
import { joinShowNames } from "./show-labels.js";

// The dialog's property-sheet tabs, in the order they show.
type ShowTab = "general" | "contents" | "upNext";

/**
 * Edits one show, a programming source assignment, in a window dialog laid
 * out as an XP property sheet. **General** holds the show's name, play
 * order, how much plays at a time, marathons, and rule-only airing; **Contents** holds members;
 * **Up Next** previews a saved collection and offers a restart. Nothing
 * writes until **OK** or **Apply**, and **Cancel** discards every change.
 * Saving a show never changes the channel's marathon settings: while they
 * are off, checking **Allow marathons** offers to turn them on as its own
 * write.
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
  const nameHintId = useId();
  const tabsId = useId();
  const [tab, setTab] = useState<ShowTab>("general");
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
  // Up Next previews saved collections only, so a show without one has none.
  const tabs = [
    { key: "general" as const, label: "General" },
    { key: "contents" as const, label: "Contents" },
    ...(assignment.members.some((member) => member.kind === "collection")
      ? [{ key: "upNext" as const, label: "Up Next" }]
      : []),
  ];
  // A tab Apply removed, such as Up Next after the last collection left,
  // shows General instead.
  const shown = tabs.some((item) => item.key === tab) ? tab : "general";
  // Only the shown tab's fields are in the form, so the browser checks
  // General's required fields only while General shows.
  const generalIncomplete =
    hasCollection &&
    (!isStretchComplete(draft.stretch) ||
      (draft.canMarathon &&
        draft.marathonOverride !== null &&
        !isStretchComplete(draft.marathonOverride)));
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
          if (shown !== "general" && generalIncomplete) {
            // Shows General so the browser can point at the missing field.
            const form = event.currentTarget;
            setTab("general");
            requestAnimationFrame(() => form.reportValidity());
            return;
          }
          const close = closeAfterSave.current;
          void mutation.run(assignmentPath, "PATCH", toSettings(draft), () => {
            setSaves((count) => count + 1);
            changed();
            if (close) onClose();
          });
        }}
      >
        <TabbedPanel
          label="Show properties"
          idPrefix={`show-${tabsId}`}
          tabs={tabs}
          selected={shown}
          onSelect={setTab}
        >
          <fieldset disabled={mutation.pending} className="form-stack">
            {shown === "general" && (
              <>
                <fieldset className="form-stack form-section">
                  <legend>Show</legend>
                  <label>
                    Name
                    <input
                      value={draft.name}
                      maxLength={80}
                      placeholder={joinShowNames(members.map(name))}
                      aria-describedby={nameHintId}
                      onChange={(event) => edit({ name: event.target.value })}
                    />
                  </label>
                  <small id={nameHintId} className="secondary">
                    Leave blank to name the show after what it plays.
                  </small>
                </fieldset>
                <fieldset className="form-stack form-section">
                  <legend>Playback</legend>
                  {hasCollection ? (
                    <>
                      <PlayOrderField
                        mode={draft.mode}
                        hint
                        onChange={(mode) => edit({ mode })}
                      />
                      <PerSittingField
                        draft={draft.stretch}
                        contentKind={contentKind}
                        hint="How much plays each time this show comes up, before the channel moves on to another show."
                        onChange={(stretch) => edit({ stretch })}
                      />
                    </>
                  ) : (
                    <p className="secondary">
                      A single item plays once each time this show comes up.
                    </p>
                  )}
                </fieldset>
                {hasCollection && (
                  <fieldset className="form-stack form-section">
                    <legend>Marathons</legend>
                    <CheckboxOption
                      label="Allow marathons"
                      description={
                        marathon === null
                          ? "Now and then, this show can get a longer run instead."
                          : `Now and then, this show gets a longer run instead: ${marathonLabel(toStretchSetting(marathon), contentKind)}.`
                      }
                      checked={draft.canMarathon}
                      onChange={(canMarathon) => edit({ canMarathon })}
                    />
                    {draft.canMarathon && (
                      <CheckboxOption
                        label="Choose the marathon length"
                        description="Otherwise it follows how much plays at a time."
                        checked={draft.marathonOverride !== null}
                        onChange={(chosen) =>
                          edit({
                            marathonOverride: chosen
                              ? suggestMarathon(draft.stretch)
                              : null,
                          })
                        }
                      />
                    )}
                    {draft.canMarathon && draft.marathonOverride !== null && (
                      <StretchFields
                        marathon
                        draft={draft.marathonOverride}
                        onChange={(marathonOverride) =>
                          edit({ marathonOverride })
                        }
                      />
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
                    <RequestFeedback
                      loading={turnOn.pending}
                      error={turnOn.error}
                    />
                    {turnedOn && (
                      <p role="status">
                        Occasional marathons are now on for this channel.
                      </p>
                    )}
                  </fieldset>
                )}
                <fieldset className="form-stack form-section">
                  <legend>Rotation</legend>
                  <CheckboxOption
                    label="Only air when a rule picks it"
                    description="Leaves this show out of the regular rotation. It airs only while one of the channel's rules selects it."
                    checked={!draft.rotates}
                    onChange={(ruleOnly) => edit({ rotates: !ruleOnly })}
                  />
                </fieldset>
              </>
            )}
            {shown === "contents" && (
              <>
                <p className="secondary">
                  A show with several collections and items is a wheel. They
                  share one spot in the rotation: each time the wheel comes up,
                  the next one in this list plays. To give one its own spot, add
                  it to the lineup as a separate show.
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
              </>
            )}
            {shown === "upNext" && (
              <CollectionPreviewSection
                assignmentPath={assignmentPath}
                assignment={assignment}
                draftMode={draft.mode}
                draftCollectionIds={members.flatMap((member) =>
                  member.kind === "collection"
                    ? [member.mediaCollectionId]
                    : [],
                )}
                collections={collections}
                visible={visible}
                changed={changed}
                refreshKey={saves}
              />
            )}
          </fieldset>
        </TabbedPanel>
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
