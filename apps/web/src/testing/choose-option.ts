import { fireEvent, within } from "@testing-library/react";

/**
 * Chooses the option a person reads as `text` in a select, as picking it
 * from the list would, so a test names a preset by its words rather than
 * by the value the control happens to store.
 */
export function chooseOption(select: HTMLElement, text: string): void {
  const option = within(select).getByRole<HTMLOptionElement>("option", {
    name: text,
  });
  fireEvent.change(select, { target: { value: option.value } });
}

/** The words of the option a select shows chosen. */
export function chosenOption(select: HTMLSelectElement): string | undefined {
  return select.selectedOptions[0]?.textContent ?? undefined;
}
