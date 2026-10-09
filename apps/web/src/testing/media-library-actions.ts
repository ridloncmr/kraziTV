import { fireEvent, screen } from "@testing-library/react";

/** Opens an item's details through its list action, without selecting its row. */
export function openMediaDetails(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Details for ${title}` }));
  return screen.getByRole("dialog", { name: "Media details" });
}
