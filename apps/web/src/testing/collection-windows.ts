import { createElement, Fragment } from "react";
import { CollectionsApp } from "../collections/collections-app.js";
import { CollectionPropertiesApp } from "../collections/properties/collection-properties-app.js";
import { propertiesTarget } from "../desktop/programs.js";
import {
  PropertiesTestWindow,
  usePropertiesTestWindows,
} from "./properties-test-windows.js";

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
      createElement(PropertiesTestWindow, {
        key: id,
        id,
        windows,
        render: (onDirtyChange) =>
          createElement(CollectionPropertiesApp, {
            collectionId: propertiesTarget(id)!.objectId,
            visible,
            windows: windows.collections,
            onDirtyChange,
            onOpenChannels,
          }),
      }),
    ),
  );
}
