// The desktop shell moves the screenshot scripts share: opening programs,
// arranging windows, and picking menu items, all by what the screen says.

/** Returns the actions bound to one logged-in desktop page. */
export function desktopActions(page) {
  /** Waits for requests to finish and motion to end, so a shot is still. */
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
  };
  const win = (name) => page.getByRole("region", { name, exact: true });

  /** Opens a desktop program from its shortcut and waits for it to load. */
  const openProgram = async (name) => {
    await page
      .getByLabel("Desktop programs")
      .getByRole("button", { name, exact: true })
      .click();
    await win(name).waitFor();
    await settle();
  };
  const closeWindow = async (name) => {
    await page
      .getByRole("button", { name: `Close ${name}`, exact: true })
      .click();
    await page.waitForTimeout(300);
  };
  const maximize = async (name) => {
    await page.getByRole("button", { name: `Maximize ${name}` }).click();
    await settle();
  };

  /**
   * Moves and resizes a window by dragging its title bar and corner grip,
   * as an owner would, so the desktop remembers the result normally.
   */
  const place = async (name, { x, y, width, height }) => {
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    };
    const start = await win(name).boundingBox();
    // Grab the title bar just right of its icon, clear of the buttons.
    await drag({ x: start.x + 60, y: start.y + 12 }, { x: x + 60, y: y + 12 });
    const moved = await win(name).boundingBox();
    await drag(
      { x: moved.x + moved.width - 4, y: moved.y + moved.height - 4 },
      { x: x + width - 4, y: y + height - 4 },
    );
    await settle();
  };

  /** Opens an Actions menu and picks one item from it. */
  const menuItem = async (button, item) => {
    const trigger = page.getByRole("button", { name: button, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    await settle();
  };
  const tab = (scope, name) =>
    scope.getByRole("tab", { name, exact: true }).click().then(settle);

  return {
    settle,
    win,
    openProgram,
    closeWindow,
    maximize,
    place,
    menuItem,
    tab,
  };
}
