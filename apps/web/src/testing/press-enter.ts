import { fireEvent } from "@testing-library/react";

/**
 * Presses Enter in a text or date field as a browser does, which jsdom does
 * not: implicit submission clicks the form's default button, its first
 * submit button in tree order, and does nothing while that button is
 * disabled or when the field cancels the keydown. A test therefore sees
 * which button Enter presses, not just that the form submitted.
 */
export function pressEnter(field: HTMLInputElement): void {
  if (!fireEvent.keyDown(field, { key: "Enter" })) return;
  const defaultButton = field.form?.querySelector(
    "button:not([type]), button[type=submit], input[type=submit]",
  );
  if (defaultButton) fireEvent.click(defaultButton);
}
