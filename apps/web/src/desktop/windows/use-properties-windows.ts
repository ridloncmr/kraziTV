import { useCallback, useMemo, useState, type Dispatch } from "react";
import type { PropertiesKind, WindowAction, WindowId } from "../contracts.js";
import { programOf, propertiesWindow } from "../programs.js";

/** What a properties window shows: a channel or a collection, by its ID and name. */
export interface PropertiesObject {
  id: string;
  name: string;
}

/**
 * One kind's properties windows as the program listing that kind and the
 * windows themselves use them. Its identity changes only with `revision`.
 */
export interface PropertiesWindows {
  /** Counts the changes this kind's windows saved, so the list reads again. */
  revision: number;
  /** Opens an object's own window, or brings it forward when open. */
  show: (object: PropertiesObject) => void;
  /** Takes a window's fresh read of its object, for its title. */
  read: (object: PropertiesObject) => void;
  /** Reports a change a window saved. */
  changed: () => void;
  /** Closes a deleted object's window. */
  deleted: (objectId: string) => void;
}

/**
 * The shell's record of its properties windows: each one's object name, for
 * its title and close confirmation, which hold unsaved changes, and how many
 * changes each kind saved, so My Channels and Collections read their lists
 * again. Desktop shell state only; every callback is stable, so memoized
 * program contents never re-render for one.
 */
export function usePropertiesWindows(dispatch: Dispatch<WindowAction>) {
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [unsaved, setUnsaved] = useState<ReadonlySet<WindowId>>(new Set());
  const [revisions, setRevisions] = useState<
    Readonly<Record<PropertiesKind, number>>
  >({
    "channel-properties": 0,
    "collection-properties": 0,
  });
  /** Records an object's name for its window; the same name keeps state as it is. */
  const name = useCallback(
    (kind: PropertiesKind, object: PropertiesObject) =>
      setNames((current) => {
        const id = propertiesWindow(kind, object.id);
        return current[id] === object.name
          ? current
          : { ...current, [id]: object.name };
      }),
    [],
  );
  /** Opens an object's own properties window, or brings it forward when open. */
  const show = useCallback(
    (kind: PropertiesKind, object: PropertiesObject) => {
      name(kind, object);
      dispatch({ type: "open", id: propertiesWindow(kind, object.id) });
    },
    [dispatch, name],
  );
  /** Counts a saved change, so the program listing that kind reads again. */
  const changed = useCallback(
    (kind: PropertiesKind) =>
      setRevisions((current) => ({ ...current, [kind]: current[kind] + 1 })),
    [],
  );
  /** Closes a deleted object's window, which has nothing left to save. */
  const deleted = useCallback(
    (kind: PropertiesKind, objectId: string) => {
      const id = propertiesWindow(kind, objectId);
      setUnsaved((current) => without(current, id));
      dispatch({ type: "close", id });
      changed(kind);
    },
    [changed, dispatch],
  );
  /** Records whether a window holds unsaved changes, so closing it asks first. */
  const markUnsaved = useCallback(
    (id: WindowId, dirty: boolean) =>
      setUnsaved((current) =>
        current.has(id) === dirty
          ? current
          : dirty
            ? new Set([...current, id])
            : without(current, id),
      ),
    [],
  );
  /** A window's title: a properties window names its object, as XP's did. */
  const titleOf = useCallback(
    (id: WindowId) =>
      names[id] === undefined ? programOf(id).name : `${names[id]} Properties`,
    [names],
  );
  /** What a window would lose on close, by name, or undefined when it holds nothing unsaved. */
  const unsavedName = (id: WindowId) =>
    unsaved.has(id) ? (names[id] ?? programOf(id).name) : undefined;
  /** Binds the callbacks to one kind, keeping its bundle while its revision holds. */
  const bind = useCallback(
    (kind: PropertiesKind, revision: number): PropertiesWindows => ({
      revision,
      show: (object) => show(kind, object),
      read: (object) => name(kind, object),
      changed: () => changed(kind),
      deleted: (objectId) => deleted(kind, objectId),
    }),
    [changed, deleted, name, show],
  );
  const channelRevision = revisions["channel-properties"];
  const collectionRevision = revisions["collection-properties"];
  const channels = useMemo(
    () => bind("channel-properties", channelRevision),
    [bind, channelRevision],
  );
  const collections = useMemo(
    () => bind("collection-properties", collectionRevision),
    [bind, collectionRevision],
  );
  return { channels, collections, markUnsaved, titleOf, unsavedName };
}

/** A set less one member, as a new set, since state is never mutated. */
function without<T>(set: ReadonlySet<T>, member: T): ReadonlySet<T> {
  const next = new Set(set);
  next.delete(member);
  return next;
}
