import { fireEvent } from "@testing-library/react";

/**
 * Presses one key on whatever has focus, as a keyboard does, so a test sees
 * where the keys went without clicking anything first.
 */
export function pressKey(key: string): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}
