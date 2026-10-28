import { createElement, Fragment, useCallback } from "react";
import { CollectionsApp } from "../collections/collections-app.js";
import { CollectionPropertiesApp } from "../collections/properties/collection-properties-app.js";
import type { WindowId } from "../desktop/contracts.js";
import { propertiesTarget } from "../desktop/programs.js";
import { usePropertiesTestWindows } from "./properties-test-windows.js";

type TestWindows = ReturnType<typeof usePropertiesTestWindows>;

/**
 * Collections beside a Collection Properties window per opened collection,
 * wired through the shell's own bookkeeping, so a test can open collections
 * and edit them without the whole desktop. Each window is a region named
 * for its title, as on the desktop.
 */
export function CollectionWindows({
  visible = true,
  onOpenChannels,
}: {
  visible?: boolean;
  onOpenChannels?: () => void;
}) {
  const windows = usePropertiesTestWindows();
  return createElement(
    Fragment,
    null,
    createElement(CollectionsApp, { visible, windows: windows.collections }),
    ...windows.open.map((id) =>
      createElement(CollectionWindow, {
        key: id,
        id,
        visible,
        windows,
        onOpenChannels,
      }),
    ),
  );
}

/** One Collection Properties window, with a stable unsaved callback as the shell gives it. */
function CollectionWindow({
  id,
  visible,
  windows,
  onOpenChannels,
}: {
  id: WindowId;
  visible: boolean;
  windows: TestWindows;
  onOpenChannels?: () => void;
}) {
  const { markUnsaved } = windows;
  const onDirtyChange = useCallback(
    (dirty: boolean) => markUnsaved(id, dirty),
    [id, markUnsaved],
  );
  return createElement(
    "section",
    { "aria-label": windows.titleOf(id) },
    createElement(CollectionPropertiesApp, {
      collectionId: propertiesTarget(id)!.objectId,
      visible,
      windows: windows.collections,
      onDirtyChange,
      onOpenChannels,
    }),
  );
}
