// Test-only interaction helper; production code must never import this module.
import { fireEvent, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Clicks a button once it enables, as a person would. Dialogs that confirm
 * a server preview enable their action a render after the preview shows,
 * so clicking at once could land on the still-disabled button.
 */
export async function clickWhenEnabled(button: HTMLElement): Promise<void> {
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  fireEvent.click(button);
}
